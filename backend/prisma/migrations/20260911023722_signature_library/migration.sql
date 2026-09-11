-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "signatureId" UUID;

-- CreateTable
CREATE TABLE "signatures" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "html" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_signatureId_idx" ON "accounts"("signatureId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "signatures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

