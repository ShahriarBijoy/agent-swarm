import type { TimelineEvent } from './types';
import { AssistantTurn } from './AssistantTurn';
import { CompactBoundary } from './CompactBoundary';
import { RunResult } from './RunResult';
import { ToolCall } from './ToolCall';
import { ToolResult } from './ToolResult';
import { UserMessage } from './UserMessage';

export function TimelineEventRenderer({ event }: { event: TimelineEvent }) {
  switch (event.type) {
    case 'user_message':
      return <UserMessage seq={event.seq} payload={event.payload} />;
    case 'assistant_turn':
      return <AssistantTurn seq={event.seq} payload={event.payload} />;
    case 'tool_call':
      return <ToolCall seq={event.seq} payload={event.payload} />;
    case 'tool_result':
      return <ToolResult seq={event.seq} payload={event.payload} />;
    case 'compact_boundary':
      return <CompactBoundary seq={event.seq} payload={event.payload} />;
    case 'run_result':
      return <RunResult seq={event.seq} payload={event.payload} />;
    default:
      return null;
  }
}
