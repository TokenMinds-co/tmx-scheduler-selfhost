-- Duplicate detection should ignore mail the operator has cancelled.
--
-- The old index reserved a dedupe key forever. Cancelling a message is how an
-- operator says "not this one" — and then re-importing the corrected sheet was
-- silently skipped as a duplicate of the row they had just cancelled, with the
-- import reporting "0 inserted" and no explanation of why.
--
-- A partial index keeps the guarantee that matters (the same person is never
-- queued the same pitch twice while it is still live) without letting a
-- cancelled row block a deliberate re-import.

-- DropIndex
DROP INDEX "email_queue_dedupeKey_key";

-- CreateIndex: unique only across rows that are still live.
CREATE UNIQUE INDEX "email_queue_dedupeKey_live_key"
  ON "email_queue" ("dedupeKey")
  WHERE "status" <> 'cancelled';

-- Cancelled rows still need to be findable by key for reporting.
CREATE INDEX "email_queue_dedupeKey_idx" ON "email_queue" ("dedupeKey");
