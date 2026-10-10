// Phase 13 — call an Auto-Ride worker over the A2A protocol, the way any
// external agent would. Start the app (`pnpm dev`) with A2A_API_KEY set in
// .env.local, then:
//
//   pnpm a2a:demo "Which electric vehicles are available right now?"
//   A2A_DEMO_URL=http://localhost:3100/api/a2a/route-optimizer pnpm a2a:demo "Distance Bremen depot to Hamburg Hbf?"
//
// Uses only the public A2A surface: it discovers the worker from its Agent
// Card, then sends one SendMessage over JSON-RPC with the bearer token.
import { callA2AAgent } from '@/lib/a2a/client';

const DEFAULT_URL = 'http://localhost:3100/api/a2a/fleet-analyst';
const DEFAULT_QUESTION = 'Which electric vehicles are available right now, and what range do they have?';

async function main(): Promise<void> {
  const url = process.env.A2A_DEMO_URL ?? DEFAULT_URL;
  const token = process.env.A2A_API_KEY;
  const question = process.argv.slice(2).join(' ').trim() || DEFAULT_QUESTION;
  if (!token) {
    console.error('A2A_API_KEY is not set (add it to .env.local; the server needs the same value).');
    process.exit(1);
  }

  console.log(`→ A2A agent: ${url}`);
  console.log(`→ question:  ${question}\n`);
  const started = Date.now();
  const result = await callA2AAgent({ url, text: question, token, caller: 'a2a-demo' });
  console.log(`← ${result.agentName} [${result.state}] in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (result.taskId) console.log(`← task ${result.taskId}`);
  console.log(`\n${result.text}`);
  if (result.state !== 'completed' && result.state !== 'message') process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
