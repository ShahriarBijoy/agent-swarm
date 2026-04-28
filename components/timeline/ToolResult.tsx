'use client';

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
} from '@/components/ai-elements/tool';

export function ToolResult({
  seq,
  payload,
}: {
  seq: number;
  payload: Record<string, unknown>;
}) {
  const toolUseId = String(payload.tool_use_id ?? '');
  const isError = payload.is_error === true;
  const contentText = stringifyContent(payload.content);

  return (
    <div data-type="tool_result" data-tool-use-id={toolUseId}>
      <Tool defaultOpen={false} className="mb-0">
        <ToolHeader
          type="dynamic-tool"
          toolName="result"
          state={isError ? 'output-error' : 'output-available'}
          title={`result · seq=${seq}`}
        />
        <ToolContent>
          <ToolOutput
            output={
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                {contentText}
              </pre>
            }
            errorText={isError ? contentText : undefined}
          />
        </ToolContent>
      </Tool>
    </div>
  );
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textBlocks = content
      .filter(
        (b): b is { type: 'text'; text: string } =>
          typeof b === 'object' &&
          b !== null &&
          (b as { type?: unknown }).type === 'text',
      )
      .map((b) => b.text);
    if (textBlocks.length > 0) return textBlocks.join('\n');
  }
  return JSON.stringify(content, null, 2);
}
