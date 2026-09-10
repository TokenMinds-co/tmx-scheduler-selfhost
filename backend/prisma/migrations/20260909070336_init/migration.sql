-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('pending', 'sending', 'sent', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AuthType" AS ENUM ('smtp_password', 'oauth_google', 'oauth_microsoft');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'operator');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('bounce', 'unsubscribe', 'complaint', 'manual', 'reply_no');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'operator',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "authType" "AuthType" NOT NULL DEFAULT 'smtp_password',
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpUser" TEXT NOT NULL,
    "requireTls" BOOLEAN NOT NULL DEFAULT true,
    "smtpPasswordEnc" TEXT,
    "oauthClientId" TEXT,
    "oauthClientSecretEnc" TEXT,
    "oauthRefreshTokenEnc" TEXT,
    "oauthTenantId" TEXT,
    "signatureHtml" TEXT NOT NULL DEFAULT '',
    "signatureText" TEXT NOT NULL DEFAULT '',
    "dailyLimit" INTEGER NOT NULL DEFAULT 20,
    "minGapSeconds" INTEGER NOT NULL DEFAULT 45,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Singapore',
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "sentTodayDate" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_queue" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "sendingEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "group" TEXT,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "note" TEXT,
    "sourceEmailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_queue_dedupeKey_key" ON "email_queue"("dedupeKey");

-- CreateIndex
CREATE INDEX "email_queue_status_scheduledAt_idx" ON "email_queue"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "email_queue_status_claimedAt_idx" ON "email_queue"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "email_queue_accountId_status_scheduledAt_idx" ON "email_queue"("accountId", "status", "scheduledAt" DESC);

-- CreateIndex
CREATE INDEX "email_queue_toEmail_idx" ON "email_queue"("toEmail");

-- CreateIndex
CREATE INDEX "email_queue_group_idx" ON "email_queue"("group");

-- CreateIndex
CREATE INDEX "email_queue_importBatchId_idx" ON "email_queue"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_email_key" ON "suppression"("email");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt" DESC);
