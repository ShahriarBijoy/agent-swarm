import { Role, TaskState, type Message, type Part, type Task } from '@a2a-js/sdk';
import { AgentEvent, type AgentExecutor, type ExecutionEventBus, type RequestContext } from '@a2a-js/sdk/server';
import type { A2AExposedAgent } from '@/lib/a2a/exposed';

/**
 * Phase 13 — A2A AgentExecutor that runs one Auto-Ride worker per task.
 *
 * Task lifecycle published on the A2A event bus:
 *   task(SUBMITTED) → statusUpdate(WORKING) → artifactUpdate(answer)
 *     → statusUpdate(COMPLETED, final message)
 * or statusUpdate(FAILED | CANCELED) when the worker throws or the caller
 * cancels. The worker itself is injected (`runWorker`) so the protocol path
 * is testable end to end without an LLM; production wires `runWorkerWithSdk`.
 */

export type RunWorkerArgs = {
  agent: A2AExposedAgent;
  prompt: string;
  signal: AbortSignal;
  /** Who is asking, from the A2A ServerCallContext (for logs/audit). */
  caller: string;
};

export type RunWorkerResult = { text: string; costUsd?: number };

export type RunWorker = (args: RunWorkerArgs) => Promise<RunWorkerResult>;

const MAX_PROMPT_CHARS = 4000;

export class WorkerAgentExecutor implements AgentExecutor {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly agent: A2AExposedAgent,
    private readonly runWorker: RunWorker,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute = async (ctx: RequestContext, bus: ExecutionEventBus): Promise<void> => {
    const { taskId, contextId } = ctx;
    const userMessage = ctx.userMessage;

    if (!ctx.task) {
      const task: Task = {
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: this.timestamp() },
        artifacts: [],
        history: [userMessage],
        metadata: { worker: this.agent },
      };
      bus.publish(AgentEvent.task(task));
    }

    const prompt = messageText(userMessage).trim();
    if (prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS) {
      this.publishFinal(
        bus,
        taskId,
        contextId,
        TaskState.TASK_STATE_FAILED,
        prompt.length === 0
          ? 'Send the question as a text part.'
          : `Question is too long (limit ${MAX_PROMPT_CHARS} characters).`,
      );
      bus.finished();
      return;
    }

    const controller = new AbortController();
    this.running.set(taskId, controller);
    bus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          message: agentMessage(taskId, contextId, `${this.agent} is working on it.`),
          timestamp: this.timestamp(),
        },
        metadata: undefined,
      }),
    );

    try {
      const result = await this.runWorker({
        agent: this.agent,
        prompt,
        signal: controller.signal,
        caller: ctx.context.user?.userName ?? 'anonymous',
      });
      if (controller.signal.aborted) return; // cancelTask already published CANCELED

      bus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: {
            artifactId: `${taskId}-answer`,
            name: 'answer',
            description: `Answer from the Auto-Ride ${this.agent} agent`,
            parts: [textPart(result.text)],
            metadata: result.costUsd !== undefined ? { costUsd: result.costUsd } : undefined,
            extensions: [],
          },
          append: false,
          lastChunk: true,
          metadata: undefined,
        }),
      );
      this.publishFinal(bus, taskId, contextId, TaskState.TASK_STATE_COMPLETED, result.text);
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[a2a] ${this.agent} task ${taskId} failed:`, message);
        this.publishFinal(bus, taskId, contextId, TaskState.TASK_STATE_FAILED, 'The worker failed to answer.');
      }
    } finally {
      this.running.delete(taskId);
      bus.finished();
    }
  };

  cancelTask = async (taskId: string, bus: ExecutionEventBus): Promise<void> => {
    const controller = this.running.get(taskId);
    controller?.abort();
    this.publishFinal(bus, taskId, '', TaskState.TASK_STATE_CANCELED, 'Cancelled by the caller.');
  };

  private publishFinal(bus: ExecutionEventBus, taskId: string, contextId: string, state: TaskState, text: string) {
    bus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state, message: agentMessage(taskId, contextId, text), timestamp: this.timestamp() },
        metadata: undefined,
      }),
    );
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export function textPart(text: string): Part {
  return { content: { $case: 'text', value: text }, metadata: undefined, filename: '', mediaType: 'text/plain' };
}

export function messageText(message: Message | undefined): string {
  if (!message) return '';
  return message.parts
    .map((p) => (p.content?.$case === 'text' ? p.content.value : ''))
    .filter((t) => t.length > 0)
    .join('\n');
}

function agentMessage(taskId: string, contextId: string, text: string): Message {
  return {
    messageId: `${taskId}-${Math.random().toString(36).slice(2, 10)}`,
    contextId,
    taskId,
    role: Role.ROLE_AGENT,
    parts: [textPart(text)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}
