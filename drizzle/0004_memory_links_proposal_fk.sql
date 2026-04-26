-- Adds the FK on memory_links.proposal_id → memory_cleanup_proposals.id that
-- is documented in docs/superpowers/specs/2026-04-21-phase-02-schema-design.md
-- but cannot be expressed in the Drizzle schema: memories.ts and cleanup.ts
-- would need to import each other (cleanup.ts already imports memories), and
-- a circular import breaks Drizzle's type inference.
--
-- proposal_id is nullable — manual ops can create memory_links rows without a
-- cleanup proposal — so the FK is also nullable. ON DELETE / ON UPDATE are
-- left as NO ACTION (Postgres default): cleanup proposals are append-only and
-- never deleted, so the cascade decision is not yet relevant.

ALTER TABLE "memory_links"
  ADD CONSTRAINT "memory_links_proposal_id_memory_cleanup_proposals_id_fk"
  FOREIGN KEY ("proposal_id") REFERENCES "memory_cleanup_proposals"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
