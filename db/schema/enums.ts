import { pgEnum } from 'drizzle-orm/pg-core';

export const segmentEnum = pgEnum('segment', [
  'identity',
  'correction',
  'preference',
  'relationship',
  'knowledge',
  'behavioral',
  'context',
]);

export const bucketEnum = pgEnum('bucket', ['short', 'long', 'permanent']);

export const taskStatusEnum = pgEnum('task_status', [
  'queued',
  'in_progress',
  'awaiting_approval',
  'done',
  'failed',
  'cancelled',
]);

export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved',
  'modified',
  'denied',
  'timed_out',
]);

export const cleanupActionEnum = pgEnum('cleanup_action', [
  'promote',
  'prune',
  'merge',
  'keep',
]);

export const linkTypeEnum = pgEnum('link_type', ['merged', 'superseded']);
