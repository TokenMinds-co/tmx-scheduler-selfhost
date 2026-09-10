-- CreateEnum
CREATE TYPE "EmailEventKind" AS ENUM ('open', 'click');

-- AlterTable
ALTER TABLE "email_queue" ADD COLUMN     "firstClickAt" TIMESTAMP(3),
ADD COLUMN     "firstOpenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "email_event" (
    "id" UUID NOT NULL,
    "emailId" UUID NOT NULL,
    "kind" "EmailEventKind" NOT NULL,
    "url" TEXT,
    "delaySeconds" INTEGER NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "ptr" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_event_emailId_kind_idx" ON "email_event"("emailId", "kind");

-- CreateIndex
CREATE INDEX "email_event_kind_delaySeconds_idx" ON "email_event"("kind", "delaySeconds");

-- CreateIndex
CREATE INDEX "email_event_occurredAt_idx" ON "email_event"("occurredAt" DESC);
