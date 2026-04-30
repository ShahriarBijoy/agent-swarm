'use server';

import { redirect } from 'next/navigation';

export async function createScenarioTask(formData: FormData) {
  const prompt = String(formData.get('prompt') ?? '').trim();
  const customerEmail =
    String(formData.get('customer_email') ?? '').trim() || undefined;
  if (!prompt) return;
  const res = await fetch(
    new URL(
      '/api/tasks',
      process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3100',
    ),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'scenario',
        prompt,
        customer_email: customerEmail,
      }),
    },
  );
  const body = await res.json();
  redirect(`/tasks/${body.taskId}`);
}
