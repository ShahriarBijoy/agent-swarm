import { Role, TaskState, type Message, type Task } from '@a2a-js/sdk';
import { ClientFactory, DefaultAgentCardResolver, JsonRpcTransportFactory } from '@a2a-js/sdk/client';
import { messageText, textPart } from '@/lib/a2a/executor';

/**
 * Phase 13 — call any A2A agent (ours or a third party's) and get its answer
 * as text. Discovers the agent from its Agent Card, picks the JSON-RPC
 * transport, sends one blocking `SendMessage`, and reads the answer from the
 * returned Message, or from the Task's artifacts / final status message.
 */

export type CallA2AAgentArgs = {
  /** Agent base URL; the card is read from `<url>/.well-known/agent-card.json`. */
  url: string;
  text: string;
  /** Bearer token for agents whose card requires one. */
  token?: string;
  /** Free-text caller label sent as `X-A2A-Caller` (Auto-Ride logs it). */
  caller?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type CallA2AAgentResult = {
  text: string;
  state: 'completed' | 'failed' | 'canceled' | 'input-required' | 'other' | 'message';
  taskId?: string;
  agentName: string;
};

export async function callA2AAgent(args: CallA2AAgentArgs): Promise<CallA2AAgentResult> {
  const baseFetch = args.fetchImpl ?? fetch;
  const authedFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (args.token) headers.set('Authorization', `Bearer ${args.token}`);
    if (args.caller) headers.set('X-A2A-Caller', args.caller);
    return baseFetch(input, { ...init, headers });
  };

  const factory = new ClientFactory({
    transports: [new JsonRpcTransportFactory({ fetchImpl: authedFetch })],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl: authedFetch }),
  });
  // The SDK resolves the card path relative to the base URL, so the base must
  // end with "/" or its last segment (the agent name) is dropped.
  const client = await factory.createFromUrl(`${args.url.replace(/\/+$/, '')}/`);
  const card = await client.getAgentCard();

  const message: Message = {
    messageId: crypto.randomUUID(),
    contextId: '',
    taskId: '',
    role: Role.ROLE_USER,
    parts: [textPart(args.text)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
  const result = await client.sendMessage(
    { tenant: '', message, configuration: undefined, metadata: undefined },
    args.signal ? { signal: args.signal } : undefined,
  );
  return { ...readResult(result), agentName: card.name };
}

function isTask(value: Message | Task): value is Task {
  return 'status' in value && 'artifacts' in value;
}

function readResult(result: Message | Task): Omit<CallA2AAgentResult, 'agentName'> {
  if (!isTask(result)) return { text: messageText(result), state: 'message' };
  const artifactText = result.artifacts.map((a) => messageText({ parts: a.parts } as Message)).filter(Boolean).join('\n');
  const statusText = messageText(result.status?.message);
  return {
    text: artifactText || statusText,
    state: stateName(result.status?.state),
    taskId: result.id,
  };
}

function stateName(state: TaskState | undefined): CallA2AAgentResult['state'] {
  switch (state) {
    case TaskState.TASK_STATE_COMPLETED:
      return 'completed';
    case TaskState.TASK_STATE_FAILED:
      return 'failed';
    case TaskState.TASK_STATE_CANCELED:
      return 'canceled';
    case TaskState.TASK_STATE_INPUT_REQUIRED:
      return 'input-required';
    default:
      return 'other';
  }
}
