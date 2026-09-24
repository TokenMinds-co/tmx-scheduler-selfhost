-- 20260910042334 dropped "email_queue_dedupeKey_idx" while schema.prisma still
-- declares @@index([dedupeKey]); every fresh `migrate dev` then reported drift.
-- Restore the index so the migration history and the schema agree.

-- CreateIndex
CREATE INDEX "email_queue_dedupeKey_idx" ON "email_queue"("dedupeKey");
