import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@tmx-scheduler/shared';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

/** Reads the user that `JwtAuthGuard` attached to the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest().user,
);
