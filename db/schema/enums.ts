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

export const vehicleSegmentEnum = pgEnum('vehicle_segment', [
  'sedan',
  'suv',
  'van',
  'truck',
]);

export const vehicleStatusEnum = pgEnum('vehicle_status', [
  'available',
  'in-use',
  'maintenance',
]);

export const tripStatusEnum = pgEnum('trip_status', [
  'requested',
  'confirmed',
  'in-route',
  'completed',
  'cancelled',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'pending',
  'paid',
  'cancelled',
]);
