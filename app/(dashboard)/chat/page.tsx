import { ChatForm } from './chat-form';
import { createScenarioTask } from './actions';

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto max-w-2xl py-12">
      <h1 className="mb-4 text-2xl font-medium">Talk to Auto-ride</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Ask for a rental, check a trip — the swarm handles the rest.
      </p>
      <ChatForm
        defaultEmail={params.customer}
        action={createScenarioTask}
      />
    </div>
  );
}
