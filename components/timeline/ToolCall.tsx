'use client';

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
} from '@/components/ai-elements/tool';

export function ToolCall({
  seq,
  payload,
}: {
  seq: number;
  payload: Record<string, unknown>;
}) {
  const toolName = String(payload.tool_name ?? '?');
  const toolUseId = String(payload.tool_use_id ?? '');
  const input = (payload.input ?? {}) as Record<string, unknown>;

  return (
    <div data-type="tool_call" data-tool-use-id={toolUseId}>
      <Tool defaultOpen={false} className="mb-0">
        <ToolHeader
          type="dynamic-tool"
          toolName={toolName}
          state="input-available"
          title={`${toolName} · seq=${seq}`}
        />
        <ToolContent>
          <ToolInput input={input} />
        </ToolContent>
      </Tool>
    </div>
  );
}
