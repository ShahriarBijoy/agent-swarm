import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

// Phase 11.5 — a `conversation` groups multiple `tasks` into one chat thread.
// Each user submission on /chat or /chat/[id] becomes a `task` row, but
// follow-ups in the same thread are linked through this table so the UI can
// stitch them into one continuous timeline and the dispatcher can be fed
// prior-turn context on the next prompt.
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    customerEmail: text('customer_email').notNull(),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversations_user_id_idx').on(t.userId),
    index('conversations_updated_at_idx').on(t.updatedAt.desc()),
  ],
);
