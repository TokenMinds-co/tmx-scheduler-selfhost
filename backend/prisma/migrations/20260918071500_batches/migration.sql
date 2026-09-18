-- Batches: one numbered row per import that actually reached the queue.
--
-- The whole point of this migration is that it needs no help on the server.
-- Mail is already queued and already sending on production, so the deploy that
-- brings the batch views up has to give that mail a batch by itself — the
-- container runs `prisma migrate deploy` before it serves a request, and every
-- statement below either applies or none of them do.
--
-- Everything already in `email_queue` becomes batch 1, whatever its status:
-- pending, sending, sent, failed and cancelled alike. A row's status says where
-- it got to, not which import put it there, and splitting the existing queue by
-- status would invent boundaries no import ever drew.

CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sourceFile" TEXT,
    "createdBy" TEXT,
    "totalRows" INTEGER NOT NULL,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "skippedDuplicates" INTEGER NOT NULL DEFAULT 0,
    "skippedSuppressed" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "batches_number_key" ON "batches"("number");

ALTER TABLE "email_queue" ADD COLUMN "batchId" UUID;

-- Batch 1, created only where there is mail for it to describe. A fresh
-- install has an empty queue and gets no phantom first batch; its first real
-- import is batch 1.
--
-- The id is a literal rather than gen_random_uuid(), so this migration does not
-- depend on an extension being installed, and the value below is the same on
-- every database that runs it.
--
-- `totalRows` and `inserted` are both the row count: for a batch assembled
-- after the fact there is no import report to copy, and what is in the queue is
-- all we can honestly claim reached it. `createdAt` is backdated to the oldest
-- row so the batch list is not headed by a batch that appears to have been
-- created during a deploy months later.
INSERT INTO "batches" (
    "id", "number", "name", "totalRows", "inserted", "createdAt", "updatedAt"
)
SELECT
    '00000000-0000-4000-8000-000000000001'::uuid,
    1,
    'Existing queue',
    COUNT(*)::int,
    COUNT(*)::int,
    MIN("createdAt"),
    CURRENT_TIMESTAMP
FROM "email_queue"
HAVING COUNT(*) > 0;

UPDATE "email_queue"
SET "batchId" = '00000000-0000-4000-8000-000000000001'::uuid
WHERE "batchId" IS NULL;

-- Explicit numbers do not advance a sequence, so without this the first import
-- after the deploy would be handed 1 and collide with the row just inserted.
-- The third argument is `is_called`: true means the next number is 2, false
-- means the next is 1, which is what an empty queue should get.
SELECT setval(
    'batches_number_seq',
    1,
    EXISTS (SELECT 1 FROM "batches")
);

CREATE INDEX "email_queue_batchId_idx" ON "email_queue"("batchId");

ALTER TABLE "email_queue"
    ADD CONSTRAINT "email_queue_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "batches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
