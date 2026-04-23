// Env is loaded by `tsx --env-file=.env.local` in package.json's `query:demo`.
// Running this file directly without that flag will fail env validation in lib/env.ts.
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { memories } from '@/db/schema/memories';
import { taskEvents, taskRuns, tasks } from '@/db/schema';
import { writeMemory } from '@/db/queries/memory-write';
import {
  DEFAULT_MAX_BUDGET_USD,
  DEFAULT_MAX_TURNS,
} from '@/lib/agent/options';
import { runOrchestrator } from '@/lib/agent/runtime';
import { eq } from 'drizzle-orm';

const TEST_ID = 'phase-05-demo';
const DEFAULT_PROMPT = [
  'Check the fleet. Use the memory MCP to recall what you know about service',
  'intervals and vehicle counts. Then delegate to the fleet-analyst subagent',
  'to summarize what a morning-of maintenance dispatch should prioritize.',
  'Be concise — one paragraph.',
].join(' ');

async function stage1_seed(): Promise<string[]> {
  console.log('\n=== stage 1: seed two memories for the fleet-analyst to recall ===');
  const fixtures = [
    {
      segment: 'identity' as const,
      content: 'Auto-ride operates 50 lease sedans out of Bremen, DE.',
    },
    {
      segment: 'knowledge' as const,
      content: 'Lease sedan service interval is 5000 miles.',
    },
  ];
  const ids: string[] = [];
  for (const f of fixtures) {
    const r = await writeMemory({
      content: f.content,
      segment: f.segment,
      metadata: { test_id: TEST_ID },
    });
    console.log(`  [${f.segment.padEnd(10)}] ${r.id}  "${f.content}"`);
    ids.push(r.id);
  }
  return ids;
}

async function stage2_run(prompt: string): Promise<Awaited<ReturnType<typeof runOrchestrator>>> {
  console.log('\n=== stage 2: run orchestrator ===');
  console.log(`  prompt: ${prompt}`);
  console.log(
    `  caps: maxBudgetUsd=$${DEFAULT_MAX_BUDGET_USD.toFixed(2)}, maxTurns=${DEFAULT_MAX_TURNS}`,
  );

  const result = await runOrchestrator({
    prompt,
    createdBy: 'cli',
    onSessionStart: (sid) => console.log(`  session started: ${sid}`),
    onEvent: (e) => {
      console.log(`  [seq=${String(e.seq).padStart(3, ' ')}] ${e.type.padEnd(18)} ${summarizeEvent(e.type, e.payload)}`);
    },
  });

  console.log(`  auth path: ${result.auth}`);
  return result;
}

function summarizeEvent(type: string, payload: Record<string, unknown>): string {
  if (type === 'assistant_turn') {
    const content = extractAssistantText(payload);
    return short(content, 120);
  }
  if (type === 'tool_call') {
    const name = String(payload.tool_name ?? '?');
    const input = short(JSON.stringify(payload.input ?? {}), 80);
    return `${name}(${input})`;
  }
  if (type === 'tool_result') {
    const isErr = payload.is_error === true ? ' [ERROR]' : '';
    const body = short(JSON.stringify(payload.content ?? ''), 80);
    return `${payload.tool_use_id ?? '?'}${isErr}: ${body}`;
  }
  if (type === 'run_result') {
    const subtype = String(payload.subtype ?? '?');
    const cost = Number(payload.total_cost_usd ?? 0).toFixed(4);
    const turns = String(payload.num_turns ?? 0);
    return `${subtype}  $${cost}  turns=${turns}`;
  }
  if (type === 'compact_boundary') {
    const meta = payload.compact_metadata as { trigger?: string } | undefined;
    return `trigger=${meta?.trigger ?? '?'}`;
  }
  if (type === 'user_message') {
    return '(user prompt)';
  }
  return '';
}

function extractAssistantText(payload: Record<string, unknown>): string {
  const message = payload.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text'
      ) {
        return String((block as { text?: unknown }).text ?? '');
      }
    }
  }
  return '';
}

function short(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `…(+${s.length - n})`;
}

async function stage3_verify(runId: string, taskId: string): Promise<void> {
  console.log('\n=== stage 3: verify task_events persisted ===');
  const rows = await db
    .select({ seq: taskEvents.seq, type: taskEvents.type })
    .from(taskEvents)
    .where(eq(taskEvents.runId, runId))
    .orderBy(taskEvents.seq);

  console.log(`  ${rows.length} events persisted for run ${runId}`);
  for (const r of rows.slice(0, 20)) {
    console.log(`    seq=${String(r.seq).padStart(3, ' ')}  type=${r.type}`);
  }
  if (rows.length > 20) {
    console.log(`    … +${rows.length - 20} more`);
  }

  const hasUser = rows.some((r) => r.type === 'user_message');
  const hasAssistant = rows.some((r) => r.type === 'assistant_turn');
  const hasResult = rows.some((r) => r.type === 'run_result');
  if (!hasUser || !hasAssistant || !hasResult) {
    throw new Error(
      `missing expected event types — user=${hasUser} assistant=${hasAssistant} result=${hasResult}`,
    );
  }

  // Confirm contiguous seq from 0.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.seq !== i) {
      throw new Error(`non-contiguous seq at index ${i}: got ${row?.seq ?? '?'}`);
    }
  }
  console.log(`  ✓ contiguous seq from 0; user/assistant/run_result all present`);

  const runRow = await db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.id, runId))
    .limit(1);
  const taskRow = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  console.log(`  task_runs: status=${runRow[0]?.status}  cost=$${runRow[0]?.totalCostUsd}  session=${runRow[0]?.sessionId ?? 'null'}`);
  console.log(`  tasks: status=${taskRow[0]?.status}  completed_at=${taskRow[0]?.completedAt?.toISOString() ?? 'null'}`);
}

async function stage4_cleanup(): Promise<void> {
  console.log('\n=== stage 4: cleanup seeded memories ===');
  const deleted = await db
    .delete(memories)
    .where(sql`metadata->>'test_id' = ${TEST_ID}`)
    .returning({ id: memories.id });
  console.log(`  deleted ${deleted.length} memories`);
  console.log(`  (task / task_run / task_events rows are KEPT as artifacts — inspect via pnpm db:studio)`);
}

async function run(): Promise<void> {
  const argvPrompt = process.argv.slice(2).join(' ').trim();
  const prompt = argvPrompt.length > 0 ? argvPrompt : DEFAULT_PROMPT;

  await stage1_seed();
  let result;
  try {
    result = await stage2_run(prompt);
    await stage3_verify(result.runId, result.taskId);
  } finally {
    await stage4_cleanup();
  }

  console.log('\n=== summary ===');
  console.log(`  status:        ${result.status}`);
  console.log(`  task id:       ${result.taskId}`);
  console.log(`  run id:        ${result.runId}`);
  console.log(`  session id:    ${result.sessionId ?? '(none)'}`);
  console.log(`  total cost:    $${result.totalCostUsd.toFixed(4)}`);
  console.log(`  num turns:     ${result.numTurns}`);
  if (result.finalText) {
    console.log(`\n  final text:\n${indent(result.finalText, '    ')}`);
  }
  if (result.errorText) {
    console.log(`\n  error:\n${indent(result.errorText, '    ')}`);
  }

  if (result.status !== 'done') {
    throw new Error(`orchestrator did not complete cleanly: ${result.errorText}`);
  }
}

function indent(s: string, prefix: string): string {
  return s
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

run().then(
  () => {
    console.log('\n✓ query-demo complete');
    process.exit(0);
  },
  (err) => {
    console.error('\n✗ query-demo failed:', err);
    process.exit(1);
  },
);
