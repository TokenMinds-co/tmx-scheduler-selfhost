import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { UserRole } from '@tmx-scheduler/shared';
import { ApiException } from '../common/errors';
import { AuthUser } from '../common/decorators/current-user.decorator';

export const IS_PUBLIC = 'auth:public';
/** Opts a route out of authentication — login and the unsubscribe landing. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_ROLES = 'auth:roles';
export const Roles = (...roles: UserRole[]) =>
  SetMetadata(REQUIRED_ROLES, roles);

/**
 * Registered globally, so a new controller is authenticated unless it opts out
 * with `@Public()` — the safe default for a service that holds mailbox
 * credentials.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractToken(request);
    if (!token) throw ApiException.unauthorized();

    let user: AuthUser;
    try {
      const payload = this.jwt.verify<{
        sub: string;
        email: string;
        name: string;
        role: UserRole;
      }>(token);
      user = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      };
    } catch {
      throw ApiException.unauthorized('Session expired. Sign in again.');
    }

    (request as Request & { user: AuthUser }).user = user;

    const required = this.reflector.getAllAndOverride<UserRole[]>(
      REQUIRED_ROLES,
      targets,
    );
    if (required?.length && !required.includes(user.role)) {
      throw ApiException.forbidden(
        `This action requires the ${required.join(' or ')} role.`,
      );
    }
    return true;
  }
}

/**
 * Accepts the token from the Authorization header or from the `ims_session`
 * cookie. The UI uses the header; the cookie exists so an operator can open an
 * export or unsubscribe-preview URL directly in a browser tab.
 *
 * `ims` is the legacy internal name; the cookie keeps it so existing sessions
 * survive the rename.
 */
function extractToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();

  const cookie = request.headers.cookie;
  if (!cookie) return null;
  const match = /(?:^|;\s*)ims_session=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : null;
}
