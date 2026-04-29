'use client';

const SUGGESTIONS = [
  "I want to rent a vehicle for my weekend trip — 4 people, ~600 km round trip, leaving Friday afternoon.",
  "What's the status of my trip? My email is ana.khan@example.com.",
];

export function ChatForm({
  defaultEmail,
  action,
}: {
  defaultEmail?: string;
  action: (fd: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="space-y-4">
      {defaultEmail && (
        <div className="inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600 dark:bg-[#161617] dark:text-[#999]">
          Replying as:{' '}
          <span className="font-mono">{defaultEmail}</span>
          <input type="hidden" name="customer_email" value={defaultEmail} />
        </div>
      )}
      <textarea
        name="prompt"
        rows={4}
        className="w-full rounded-2xl border border-neutral-200 bg-white p-4 text-sm dark:border-[#222] dark:bg-[#0F0F10]"
        placeholder="Type your request…"
      />
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={(e) => {
              const ta = (
                e.currentTarget.closest('form') as HTMLFormElement
              ).elements.namedItem('prompt') as HTMLTextAreaElement;
              ta.value = s;
            }}
            className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-[#222] dark:hover:bg-[#161617]"
          >
            {s}
          </button>
        ))}
      </div>
      <button
        type="submit"
        className="rounded-full bg-[#FA692E] px-4 py-2 text-sm font-semibold text-white"
      >
        Send
      </button>
    </form>
  );
}
