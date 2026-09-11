import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AUTH_TYPES, AuthType } from '@ims/shared';

/**
 * Accepts an address or a bare domain; the service reduces one to the other
 * and rejects anything that is not a plausible hostname. Kept loose here so the
 * error the operator sees names their input rather than a regex.
 */
export class CheckDomainDto {
  @IsString()
  @MinLength(3)
  @MaxLength(320)
  domain!: string;
}

export class CreateAccountDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  displayName!: string;

  @IsIn(AUTH_TYPES)
  authType!: AuthType;

  @IsString()
  @MinLength(1)
  smtpHost!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort!: number;

  @IsString()
  @MinLength(1)
  smtpUser!: string;

  /**
   * Defaults to true. Set false only for a plain-SMTP relay on the same host —
   * over a network it means sending the password in the clear.
   */
  @IsOptional()
  @IsBoolean()
  requireTls?: boolean;

  /** Required for `smtp_password`; ignored for the OAuth types. */
  @IsOptional()
  @IsString()
  smtpPassword?: string;

  @IsOptional()
  @IsString()
  oauthClientId?: string;

  @IsOptional()
  @IsString()
  oauthClientSecret?: string;

  @IsOptional()
  @IsString()
  oauthRefreshToken?: string;

  @IsOptional()
  @IsString()
  oauthTenantId?: string;

  /** Library signature to send with. */
  @IsOptional()
  @IsUUID()
  signatureId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50000)
  dailyLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  minGapSeconds?: number;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * Every field optional. A secret field that is absent leaves the stored secret
 * alone; sending an empty string clears it. The UI relies on that distinction
 * because it never receives the current secret to echo back.
 */
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @IsOptional()
  @IsIn(AUTH_TYPES)
  authType?: AuthType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  smtpUser?: string;

  @IsOptional()
  @IsBoolean()
  requireTls?: boolean;

  @IsOptional()
  @IsString()
  smtpPassword?: string;

  @IsOptional()
  @IsString()
  oauthClientId?: string;

  @IsOptional()
  @IsString()
  oauthClientSecret?: string;

  @IsOptional()
  @IsString()
  oauthRefreshToken?: string;

  @IsOptional()
  @IsString()
  oauthTenantId?: string;

  /** Library signature to send with; null detaches. */
  @IsOptional()
  @IsUUID()
  signatureId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50000)
  dailyLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  minGapSeconds?: number;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SendTestEmailDto {
  @IsEmail()
  to!: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;
}
