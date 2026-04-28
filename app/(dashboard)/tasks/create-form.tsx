'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function CreateTaskForm({ onCreated }: { onCreated?: () => void } = {}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        throw new Error(
          body?.message ?? body?.error ?? `POST /api/tasks failed: ${res.status}`,
        );
      }
      const { taskId } = (await res.json()) as { taskId: string };
      onCreated?.();
      router.push(`/tasks/${taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const empty = !prompt.trim();
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-[var(--color-ink)]">Prompt</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          maxLength={4000}
          disabled={submitting}
          placeholder="What should the fleet orchestrator do?"
          autoFocus
          className="rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-2.5 font-mono text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-muted-2)] outline-none focus:border-[var(--color-ink)] focus:ring-2 focus:ring-[var(--color-ink)]/10 disabled:opacity-60"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
          {prompt.length} / 4000
        </span>
      </label>
      {error && (
        <div role="alert" className="rounded-[8px] border border-[var(--color-red)]/40 bg-[rgba(215,25,33,0.06)] p-2.5 text-[12px] text-[var(--color-red)]">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting || empty}
        className="rounded-full bg-[var(--color-ink)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-surface)] transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-[var(--color-muted-2)] disabled:text-white/70"
      >
        {submitting ? 'Creating…' : 'Create task'}
      </button>
    </form>
  );
}
