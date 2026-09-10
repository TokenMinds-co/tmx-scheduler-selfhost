import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CreateUserDto, LoginDto, UpdateUserDto } from './dto/auth.dto';
import { Public, Roles } from './jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /** Tighter than the global limit: this is the one unauthenticated route. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Roles('admin')
  @Get('users')
  listUsers() {
    return this.auth.list();
  }

  @Roles('admin')
  @Post('users')
  async createUser(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser) {
    const user = await this.auth.create(dto);
    await this.audit.record(actor, 'user.create', user.email, {
      role: user.role,
    });
    return user;
  }

  @Roles('admin')
  @Patch('users/:id')
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const user = await this.auth.update(id, dto, actor);
    await this.audit.record(actor, 'user.update', user.email, {
      // Never log the password itself, only that one was set.
      fields: Object.keys(dto).map((k) => (k === 'password' ? 'password*' : k)),
    });
    return user;
  }

  @Roles('admin')
  @Delete('users/:id')
  async deleteUser(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    await this.auth.remove(id, actor);
    await this.audit.record(actor, 'user.delete', id, null);
    return { ok: true };
  }
}
