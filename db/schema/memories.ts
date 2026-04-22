import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { bucketEnum, linkTypeEnum, segmentEnum } from './enums';
import { tsvector } from './types';

export const memorySegmentConfig = pgTable('memory_segment_config', {
  segment: segmentEnum('segment').primaryKey(),
  defaultImportance: numeric('default_importance', {
    precision: 3,
    scale: 2,
  }).notNull(),
  decayLambdaShort: doublePrecision('decay_lambda_short').notNull(),
  decayLambdaLongFactor: doublePrecision('decay_lambda_long_factor')
    .notNull()
    .default(0.01),
  promotionThresholdLong: numeric('promotion_threshold_long', {
    precision: 3,
    scale: 2,
  })
    .notNull()
    .default('0.50'),
  promotionThresholdPermanent: numeric('promotion_threshold_permanent', {
    precision: 3,
    scale: 2,
  })
    .notNull()
    .default('0.80'),
  fastTrackPermanent: boolean('fast_track_permanent').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    segment: segmentEnum('segment').notNull(),
    bucket: bucketEnum('bucket').notNull().default('short'),
    content: text('content').notNull(),
    contentTsv: tsvector('content_tsv')
      .generatedAlwaysAs(sql`to_tsvector('english', "content")`)
      .notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    importance: numeric('importance', { precision: 3, scale: 2 }).notNull(),
    importanceStreak: integer('importance_streak').notNull().default(0),
    accessCount: integer('access_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('memories_embedding_hnsw_idx')
      .using('hnsw', t.embedding.op('vector_cosine_ops'))
      .with({ m: 16, ef_construction: 64 })
      .where(sql`${t.tombstonedAt} IS NULL`),
    index('memories_content_tsv_gin_idx')
      .using('gin', t.contentTsv)
      .where(sql`${t.tombstonedAt} IS NULL`),
    index('memories_decay_btree_idx')
      .on(t.bucket, t.importance.desc(), t.lastAccessedAt.desc())
      .where(sql`${t.tombstonedAt} IS NULL`),
    index('memories_segment_tombstone_idx').on(t.segment, t.tombstonedAt),
  ],
);

export const memoryLinks = pgTable(
  'memory_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => memories.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => memories.id),
    linkType: linkTypeEnum('link_type').notNull(),
    proposalId: uuid('proposal_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('memory_links_parent_idx').on(t.parentId),
    index('memory_links_child_idx').on(t.childId),
    uniqueIndex('memory_links_pair_type_uq').on(
      t.parentId,
      t.childId,
      t.linkType,
    ),
  ],
);
