import Link from 'next/link';
import { listRecentTasks } from '@/db/queries/task-api';
import { CreateTaskForm } from './create-form';

export const dynamic = 'force-dynamic';

const RELATIVE_TIME = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function timeAgo(date: Date): string {
  const deltaSec = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  if (abs < 60) return RELATIVE_TIME.format(deltaSec, 'second');
  if (abs < 3600) return RELATIVE_TIME.format(Math.round(deltaSec / 60), 'minute');
  if (abs < 86400) return RELATIVE_TIME.format(Math.round(deltaSec / 3600), 'hour');
  return RELATIVE_TIME.format(Math.round(deltaSec / 86400), 'day');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

export default async function TasksListPage() {
  const recent = await listRecentTasks(10);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header>
        <h1 className="font-heading text-lg font-medium">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Create a task → the orchestrator runs → the timeline streams live.
        </p>
      </header>

      <section aria-label="Create task">
        <CreateTaskForm />
      </section>

      <section aria-label="Recent tasks" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Recent</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No tasks yet — create one above.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {recent.map((t) => (
              <li
                key={t.id}
                className="flex items-baseline justify-between gap-3 px-3 py-2 hover:bg-muted/50"
              >
                <Link
                  href={`/tasks/${t.id}`}
                  className="flex min-w-0 flex-1 flex-col gap-0.5"
                >
                  <span className="truncate text-sm">{truncate(t.prompt, 140)}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {t.id}
                  </span>
                </Link>
                <div className="flex shrink-0 items-baseline gap-2">
                  <span
                    data-status={t.status}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
                  >
                    {t.status}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(t.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
