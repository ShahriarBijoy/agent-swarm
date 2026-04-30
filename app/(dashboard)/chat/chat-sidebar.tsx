'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type ConversationListItem = {
  id: string;
  title: string | null;
  customerEmail: string;
  updatedAt: string;
  latestTaskStatus:
    | 'queued'
    | 'in_progress'
    | 'awaiting_approval'
    | 'done'
    | 'failed'
    | 'cancelled'
    | null;
  latestPrompt: string | null;
};

const ACTIVE_STATUSES = new Set([
  'queued',
  'in_progress',
  'awaiting_approval',
]);

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function ChatSidebar({
  conversations,
}: {
  conversations: ConversationListItem[];
}) {
  const pathname = usePathname() ?? '/chat';
  const activeId = pathname.startsWith('/chat/')
    ? pathname.slice('/chat/'.length).split('/')[0]
    : null;

  return (
    <aside className="flex h-[calc(100vh-7.5rem)] flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-warm)]/60">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
          Chats
        </span>
        <Link
          href="/chat"
          className={cn(
            'rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
            activeId === null
              ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
              : 'border border-[var(--color-line-strong)] text-[var(--color-muted)] hover:bg-black/5 hover:text-[var(--color-ink)]',
          )}
        >
          + New
        </Link>
      </div>

      {conversations.length === 0 ? (
        <div className="flex-1 px-4 py-6 text-center text-xs text-muted-foreground">
          No chats yet. Send your first message →
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ul className="flex flex-col gap-1 p-2">
            {conversations.map((c) => {
              const isActive = c.id === activeId;
              const isRunning =
                c.latestTaskStatus !== null &&
                ACTIVE_STATUSES.has(c.latestTaskStatus);
              const previewSource = c.latestPrompt ?? '';
              const preview = previewSource
                .replace(/^\[scenario\][^\n]*\n+/u, '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 80);
              return (
                <li key={c.id}>
                  <Link
                    href={`/chat/${c.id}`}
                    className={cn(
                      'flex flex-col gap-1 rounded-xl px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                        : 'hover:bg-black/5',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          'truncate font-medium',
                          isActive ? '' : 'text-[var(--color-ink)]',
                        )}
                      >
                        {c.title ?? 'Untitled chat'}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 font-mono text-[10px]',
                          isActive
                            ? 'text-[var(--color-surface)]/70'
                            : 'text-muted-foreground',
                        )}
                      >
                        {formatRelative(c.updatedAt)}
                      </span>
                    </div>
                    {preview.length > 0 && (
                      <p
                        className={cn(
                          'truncate text-[11px]',
                          isActive
                            ? 'text-[var(--color-surface)]/75'
                            : 'text-muted-foreground',
                        )}
                      >
                        {preview}
                      </p>
                    )}
                    {isRunning && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 self-start font-mono text-[9.5px] uppercase tracking-[0.18em]',
                          isActive
                            ? 'text-[var(--color-lime)]'
                            : 'text-[var(--color-muted)]',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block size-1.5 animate-pulse rounded-full',
                            isActive
                              ? 'bg-[var(--color-lime)]'
                              : 'bg-[var(--color-ink)]',
                          )}
                        />
                        running
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </aside>
  );
}
