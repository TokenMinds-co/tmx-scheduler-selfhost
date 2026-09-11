-- The signature library replaced the per-mailbox signature columns. Before
-- they are dropped, every mailbox still relying on one is moved onto the
-- library: its sign-off becomes a library signature of its own, attached to
-- it. Nothing is dropped that has not first been copied.
--
-- This has to work unaided. Both library migrations ship in one release and
-- the container runs them back to back at startup, so there is never a window
-- in which someone could attach signatures by hand between the two.
--
-- The copy is verbatim — same HTML, same text, attached to the same mailbox —
-- so each mailbox signs off exactly as it did before. The old save path always
-- derived the text half from the HTML when it was left blank, so no row needs
-- a text half invented here.
--
-- The new signature reuses its mailbox's id. Both are uuids and the mailbox's
-- is unique, which lets the attach below find the row it just made without a
-- mapping table. ON CONFLICT makes a re-run after `migrate resolve
-- --rolled-back` harmless.
--
-- It is named after the mailbox's address, which is how operators already
-- tell mailboxes apart. Rename it in the library at any time.

INSERT INTO "signatures" ("id", "name", "html", "text", "createdAt", "updatedAt")
SELECT "id", "email", "signatureHtml", "signatureText", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "accounts"
 WHERE "signatureId" IS NULL
   AND (btrim("signatureHtml") <> '' OR btrim("signatureText") <> '')
ON CONFLICT ("id") DO NOTHING;

UPDATE "accounts"
   SET "signatureId" = "id"
 WHERE "signatureId" IS NULL
   AND (btrim("signatureHtml") <> '' OR btrim("signatureText") <> '');

-- AlterTable
ALTER TABLE "accounts" DROP COLUMN "signatureHtml",
DROP COLUMN "signatureText";
