import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SignatureDto } from '@ims/shared';
import { ApiException } from '../common/errors';
import { htmlToText, sanitizeSignatureHtml } from '../common/html';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSignatureDto, UpdateSignatureDto } from './dto/signature.dto';

/** Postgres rejects a malformed uuid outright, so ids are shape-checked first. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WITH_ACCOUNTS = {
  accounts: {
    select: { id: true, email: true },
    orderBy: { email: 'asc' },
  },
} satisfies Prisma.SignatureInclude;

type SignatureWithAccounts = Prisma.SignatureGetPayload<{
  include: typeof WITH_ACCOUNTS;
}>;

/**
 * The signature library.
 *
 * A signature is written once and shared by any number of mailboxes. The
 * mailbox side of the relation is the only side — `accounts.signatureId`, set
 * from the mailbox's own edit form — so this service never changes which
 * mailboxes use a signature, and attaching never copies markup around.
 */
@Injectable()
export class SignaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SignatureDto[]> {
    const signatures = await this.prisma.signature.findMany({
      include: WITH_ACCOUNTS,
      orderBy: { name: 'asc' },
    });
    return signatures.map(toDto);
  }

  async get(id: string): Promise<SignatureDto> {
    return toDto(await this.findOrThrow(id));
  }

  async create(dto: CreateSignatureDto): Promise<SignatureDto> {
    const saved = await this.prisma.signature.create({
      data: { name: dto.name.trim(), ...content(dto.html, dto.text) },
      include: WITH_ACCOUNTS,
    });
    return toDto(saved);
  }

  async update(id: string, dto: UpdateSignatureDto): Promise<SignatureDto> {
    const current = await this.findOrThrow(id);
    const html = dto.html ?? current.html;
    // New markup without a text half re-derives the text, rather than pairing
    // the new HTML with the old plain-text sign-off.
    const text = dto.text ?? (dto.html !== undefined ? '' : current.text);
    const saved = await this.prisma.signature.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...content(html, text),
      },
      include: WITH_ACCOUNTS,
    });
    return toDto(saved);
  }

  /** Refused while any mailbox sends with it, rather than detaching them. */
  async remove(id: string): Promise<SignatureDto> {
    const signature = await this.findOrThrow(id);
    if (signature.accounts.length) {
      throw ApiException.conflict(
        `"${signature.name}" is used by ` +
          `${signature.accounts.map((account) => account.email).join(', ')}. ` +
          'Pick a different signature on those mailboxes before deleting it.',
        'signature_in_use',
      );
    }
    try {
      await this.prisma.signature.delete({ where: { id } });
    } catch (error) {
      // Attached between the check above and the delete: the foreign key
      // refuses it, which is the same answer the check would have given.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw ApiException.conflict(
          `"${signature.name}" was just attached to a mailbox.`,
          'signature_in_use',
        );
      }
      throw error;
    }
    return toDto(signature);
  }

  private async findOrThrow(id: string): Promise<SignatureWithAccounts> {
    if (!UUID.test(id)) throw ApiException.notFound('Signature not found.');
    const signature = await this.prisma.signature.findUnique({
      where: { id },
      include: WITH_ACCOUNTS,
    });
    if (!signature) throw ApiException.notFound('Signature not found.');
    return signature;
  }
}

/**
 * Sanitised HTML plus a text half, derived when blank. Every message is
 * multipart, so an empty text signature is not "no signature" — it is a blank
 * sign-off shown to every plain-text reader.
 */
function content(
  html: string,
  text: string | undefined,
): { html: string; text: string } {
  const clean = sanitizeSignatureHtml(html);
  const plain = text?.trim() ? text : clean.trim() ? htmlToText(clean) : '';
  return { html: clean, text: plain };
}

function toDto(signature: SignatureWithAccounts): SignatureDto {
  return {
    id: signature.id,
    name: signature.name,
    html: signature.html,
    text: signature.text,
    accounts: signature.accounts,
    createdAt: signature.createdAt.toISOString(),
    updatedAt: signature.updatedAt.toISOString(),
  };
}
