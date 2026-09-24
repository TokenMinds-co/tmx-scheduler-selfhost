import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { AuthType } from '@tmx-scheduler/shared';
import { CryptoService } from '../common/crypto.service';
import { ApiException } from '../common/errors';
import type { Account } from '@prisma/client';

interface CachedTransport {
  transporter: Transporter;
  /** Fingerprint of the settings the transport was built from. */
  signature: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const TOKEN_SKEW_MS = 60_000;

/**
 * Owns one pooled SMTP connection per account.
 *
 * Pooling matters here: opening a TLS session per message is both slow and, on
 * Gmail and M365, a reliable way to trip abuse heuristics. `maxConnections: 1`
 * keeps a mailbox to a single stream so the pacing the worker enforces is the
 * pacing the provider actually sees.
 */
@Injectable()
export class TransportService implements OnModuleDestroy {
  private readonly logger = new Logger(TransportService.name);
  private readonly transports = new Map<string, CachedTransport>();
  private readonly tokens = new Map<string, CachedToken>();

  constructor(private readonly crypto: CryptoService) {}

  async onModuleDestroy(): Promise<void> {
    for (const { transporter } of this.transports.values()) {
      transporter.close();
    }
    this.transports.clear();
  }

  /** Drops the cached connection so the next send rebuilds it. */
  invalidate(accountId: string): void {
    this.transports.get(accountId)?.transporter.close();
    this.transports.delete(accountId);
    this.tokens.delete(accountId);
  }

  async get(account: Account): Promise<Transporter> {
    const id = account.id;
    const signature = this.signatureOf(account);
    const cached = this.transports.get(id);
    if (cached && cached.signature === signature) return cached.transporter;

    if (cached) cached.transporter.close();

    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      // 465 is implicit TLS; 587 starts plaintext and upgrades via STARTTLS.
      secure: account.smtpPort === 465,
      requireTLS: account.smtpPort !== 465 && account.requireTls,
      pool: true,
      maxConnections: 1,
      maxMessages: 100,
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
      auth: await this.buildAuth(account),
    });

    this.transports.set(id, { transporter, signature });
    return transporter;
  }

  /**
   * Proves the credentials work before they are trusted by the queue. Run on
   * every create and on any update that touches connection settings, so a bad
   * password surfaces in the account form rather than as 200 failed sends.
   */
  async verify(account: Account): Promise<void> {
    this.invalidate(account.id);
    const transporter = await this.get(account);
    try {
      await transporter.verify();
    } catch (error) {
      this.invalidate(account.id);
      throw ApiException.unprocessable(
        `SMTP login failed: ${(error as Error).message}`,
        'smtp_verify_failed',
      );
    }
  }

  private signatureOf(account: Account): string {
    return [
      account.smtpHost,
      account.smtpPort,
      account.smtpUser,
      account.authType,
      String(account.requireTls),
      account.smtpPasswordEnc ?? '',
      account.oauthRefreshTokenEnc ?? '',
      account.oauthClientId ?? '',
    ].join('|');
  }

  private async buildAuth(account: Account) {
    if (account.authType === 'smtp_password') {
      if (!account.smtpPasswordEnc) {
        throw ApiException.unprocessable(
          `No SMTP password stored for ${account.email}.`,
          'missing_credentials',
        );
      }
      return {
        user: account.smtpUser,
        pass: this.crypto.decrypt(account.smtpPasswordEnc),
      };
    }

    return {
      type: 'OAuth2' as const,
      user: account.smtpUser,
      accessToken: await this.accessToken(account),
    };
  }

  /**
   * Exchanges the stored refresh token for an access token.
   *
   * Nodemailer can do this itself for Google, but not for Microsoft's v2.0
   * endpoint, and handling both here means one cache, one error path, and one
   * place to look when a tenant revokes consent.
   */
  private async accessToken(account: Account): Promise<string> {
    const id = account.id;
    const cached = this.tokens.get(id);
    if (cached && cached.expiresAt - TOKEN_SKEW_MS > Date.now()) {
      return cached.accessToken;
    }

    if (
      !account.oauthClientId ||
      !account.oauthClientSecretEnc ||
      !account.oauthRefreshTokenEnc
    ) {
      throw ApiException.unprocessable(
        `OAuth credentials are incomplete for ${account.email}.`,
        'missing_credentials',
      );
    }

    const endpoint = this.tokenEndpoint(account.authType, account.oauthTenantId);
    const body = new URLSearchParams({
      client_id: account.oauthClientId,
      client_secret: this.crypto.decrypt(account.oauthClientSecretEnc),
      refresh_token: this.crypto.decrypt(account.oauthRefreshTokenEnc),
      grant_type: 'refresh_token',
    });
    if (account.authType === 'oauth_microsoft') {
      body.set(
        'scope',
        'https://outlook.office.com/SMTP.Send offline_access openid',
      );
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
      error?: string;
    };

    if (!response.ok || !payload.access_token) {
      const detail =
        payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
      throw ApiException.unprocessable(
        `Could not refresh the OAuth token for ${account.email}: ${detail}`,
        'oauth_refresh_failed',
      );
    }

    this.tokens.set(id, {
      accessToken: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    });
    this.logger.log(`Refreshed OAuth access token for ${account.email}`);
    return payload.access_token;
  }

  private tokenEndpoint(authType: AuthType, tenantId: string | null): string {
    if (authType === 'oauth_google') {
      return 'https://oauth2.googleapis.com/token';
    }
    // `common` works for multi-tenant app registrations; a single-tenant one
    // must name its directory or the endpoint rejects the request.
    return `https://login.microsoftonline.com/${tenantId || 'common'}/oauth2/v2.0/token`;
  }
}
