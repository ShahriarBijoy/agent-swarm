import { getEventsSince, getTaskById } from '@/db/queries/task-api';
import type { AguiStreamDeps } from '@/lib/agui/stream';

/** Phase 13 — production data access for the AG-UI stream (task_events + tasks). */
export function taskEventsDeps(): Pick<AguiStreamDeps, 'getEventsSince' | 'getTaskById'> {
  return { getEventsSince, getTaskById };
}
