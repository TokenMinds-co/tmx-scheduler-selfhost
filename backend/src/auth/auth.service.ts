import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { SessionUserDto, UserRole } from '@tmx-scheduler/shared';
import { ApiException } from '../common/errors';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; user: SessionUserDto }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Hash a throwaway value when the user is unknown so a missing account and
    // a wrong password take the same time to answer.
    const ok = user
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt
          .compare(
            password,
            '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaliduO',
          )
          .then(() => false);

    if (!user || !ok) {
      throw ApiException.unauthorized('Incorrect email or password.');
    }
    if (!user.active) {
      throw ApiException.forbidden('This account has been deactivated.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const session = this.toSessionUser(user);
    const token = this.jwt.sign({
      sub: session.id,
      email: session.email,
      name: session.name,
      role: session.role,
    });
    this.logger.log(`Signed in: ${session.email}`);
    return { token, user: session };
  }

  async list(): Promise<SessionUserDto[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { email: 'asc' },
    });
    return users.map((user) => this.toSessionUser(user));
  }

  async create(dto: CreateUserDto): Promise<SessionUserDto> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw ApiException.conflict(`${email} already has an account.`);
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        role: dto.role,
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      },
    });
    return this.toSessionUser(user);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthUser,
  ): Promise<SessionUserDto> {
    if (!UUID.test(id)) throw ApiException.notFound('User not found.');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw ApiException.notFound('User not found.');

    // Locking yourself out is not recoverable from inside the tool, so the two
    // self-demotion paths are refused rather than merely warned about.
    const isSelf = user.id === actor.id;
    if (isSelf && dto.active === false) {
      throw ApiException.badRequest('You cannot deactivate your own account.');
    }
    if (isSelf && dto.role && dto.role !== 'admin' && actor.role === 'admin') {
      throw ApiException.badRequest('You cannot remove your own admin role.');
    }

    const saved = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.password
          ? { passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS) }
          : {}),
      },
    });
    return this.toSessionUser(saved);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    if (id === actor.id) {
      throw ApiException.badRequest('You cannot delete your own account.');
    }
    if (!UUID.test(id)) throw ApiException.notFound('User not found.');

    const remainingAdmins = await this.prisma.user.count({
      where: { role: 'admin', active: true, id: { not: id } },
    });
    if (remainingAdmins === 0) {
      throw ApiException.badRequest(
        'Deleting this user would leave no active admin.',
      );
    }
    await this.prisma.user.deleteMany({ where: { id } });
  }

  private toSessionUser(user: User): SessionUserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
    };
  }
}
