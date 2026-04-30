import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { ChatComposer } from './chat-composer';
import { createScenarioTask } from './actions';
import { requireSession } from '@/lib/auth/require-session';

// Phase 11.5 — empty-state page for `/chat`. Sidebar (in layout.tsx) lists
// every prior conversation; this pane shows an inline composer that starts
// a new chat. Submitting redirects to `/chat/[conversationId]` so the user
// lands directly on their live thread.
export default async function ChatIndexPage() {
  const session = await requireSession();
  return (
    <Frame
      variant="ghost"
      spacing="sm"
      className="h-[calc(100vh-7.5rem)] bg-[var(--color-bg-2)]/55"
    >
      <FrameHeader>
        <FrameTitle className="text-[24px] font-medium tracking-tight">
          Talk to Auto-ride
        </FrameTitle>
        <FrameDescription>
          Ask for a rental, check a trip — the swarm handles the rest. Pick a
          chat from the sidebar to continue, or start a new one below.
        </FrameDescription>
      </FrameHeader>
      <FramePanel className="flex flex-1 flex-col justify-end bg-[var(--color-surface-warm)] border-[var(--color-line)]">
        <ChatComposer
          defaultEmail={session.user.email}
          action={createScenarioTask}
          showSuggestions
          placeholder="Start a new chat — what do you need?"
        />
      </FramePanel>
    </Frame>
  );
}
