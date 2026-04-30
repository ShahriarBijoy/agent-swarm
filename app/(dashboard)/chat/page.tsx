import { ChatForm } from './chat-form';
import { createScenarioTask } from './actions';
import { requireSession } from '@/lib/auth/require-session';

export default async function ChatPage() {
  // Phase 11 — the chat ingest identifies the customer via the signed-in
  // operator's email. Earlier phases let `?customer=` override; that's
  // gone — the session is the only source of identity.
  const session = await requireSession();
  return (
    <div className="mx-auto max-w-2xl py-12">
      <h1 className="mb-4 text-2xl font-medium">Talk to Auto-ride</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Ask for a rental, check a trip — the swarm handles the rest.
      </p>
      <ChatForm
        defaultEmail={session.user.email}
        action={createScenarioTask}
      />
    </div>
  );
}
