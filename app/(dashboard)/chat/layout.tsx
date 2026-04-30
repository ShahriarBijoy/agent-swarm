import { listConversationsForUser } from '@/db/queries/conversations';
import { requireSession } from '@/lib/auth/require-session';
import { ChatSidebar } from './chat-sidebar';

// Phase 11.5 — `/chat` and `/chat/[conversationId]` share this layout. The
// sidebar lists every conversation the operator owns; the right pane is
// either the empty-state composer (route segment `/chat`) or the live
// conversation view (route segment `/chat/[conversationId]`).
//
// Conversations are fetched server-side once per navigation; the chat page
// re-renders by `redirect` after each turn so the sidebar stays in sync
// without a client poll.

export const dynamic = 'force-dynamic';

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const conversations = await listConversationsForUser(session.user.id, 100);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
      <ChatSidebar
        conversations={conversations.map((c) => ({
          id: c.id,
          title: c.title,
          customerEmail: c.customerEmail,
          updatedAt: c.updatedAt.toISOString(),
          latestTaskStatus: c.latestTaskStatus,
          latestPrompt: c.latestPrompt,
        }))}
      />
      <section className="min-w-0">{children}</section>
    </div>
  );
}
