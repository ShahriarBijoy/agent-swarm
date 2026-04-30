'use client';

import { useFormStatus } from 'react-dom';
import { ArrowUp } from 'lucide-react';

import { createScenarioTask } from '../actions';
import { cn } from '@/lib/utils';

export function FollowUpForm({ disabled }: { disabled: boolean }) {
  return (
    <form action={createScenarioTask} className="flex items-end gap-2">
      <textarea
        name="prompt"
        rows={1}
        required
        disabled={disabled}
        placeholder={
          disabled
            ? 'Wait for the swarm to reply…'
            : 'Ask a follow-up — starts a new conversation'
        }
        className={cn(
          'min-h-[44px] flex-1 resize-none rounded-2xl border border-[var(--color-line)] bg-background/70 px-4 py-2.5 text-sm leading-snug',
          'focus:outline-none focus:ring-1 focus:ring-[var(--color-line)]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter submits — single Enter inserts a newline so users
          // can dictate multi-line scenarios without surprise sends.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
          }
        }}
      />
      <SubmitButton disabled={disabled} />
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  const off = disabled || pending;
  return (
    <button
      type="submit"
      disabled={off}
      className={cn(
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FA692E] text-white shadow-sm transition',
        'hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40',
      )}
      aria-label="Send"
    >
      <ArrowUp className="size-4" />
    </button>
  );
}
