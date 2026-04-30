'use client';

import { useFormStatus } from 'react-dom';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  "I want to rent a vehicle for my weekend trip — 4 people, ~600 km round trip, leaving Friday afternoon.",
  "What's the status of my trip?",
];

export function ChatComposer({
  defaultEmail,
  conversationId,
  action,
  disabled = false,
  disabledReason,
  showSuggestions = false,
  placeholder = 'Type your request…',
}: {
  defaultEmail: string;
  conversationId?: string;
  action: (fd: FormData) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
  showSuggestions?: boolean;
  placeholder?: string;
}) {
  return (
    <form
      action={action}
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-bg)] p-3 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)]',
        disabled && 'opacity-90',
      )}
    >
      {conversationId && (
        <input type="hidden" name="conversationId" value={conversationId} />
      )}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="inline-flex items-center gap-2 rounded-full bg-black/5 px-2.5 py-0.5 text-[11px] text-[var(--color-muted)]">
          Replying as <span className="font-mono">{defaultEmail}</span>
        </span>
        {disabled && disabledReason && (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
            {disabledReason}
          </span>
        )}
      </div>

      <Textarea
        name="prompt"
        rows={3}
        placeholder={placeholder}
        disabled={disabled}
        className="border-transparent bg-transparent px-2 text-sm focus-visible:ring-0"
        required
      />

      {showSuggestions && !disabled && (
        <div className="flex flex-wrap gap-2 px-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={(e) => {
                const ta = (
                  e.currentTarget.closest('form') as HTMLFormElement
                ).elements.namedItem('prompt') as HTMLTextAreaElement;
                ta.value = s;
                ta.focus();
              }}
              className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-black/5 hover:text-[var(--color-ink)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end px-1">
        <SubmitButton disabled={disabled} />
      </div>
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={cn(
        'rounded-full bg-[#FA692E] px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_-4px_rgba(250,105,46,0.6)]',
        'transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {pending ? 'Sending…' : 'Send'}
    </button>
  );
}
