import { validateWorkflow, type ExecutionEvent, type RunSnapshot, type Workflow, type WorkflowNode } from './workflow.js';

export type NodeExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

export interface SchedulerExecutionContext {
  signal: AbortSignal;
  random: () => number;
  delay: (ms: number) => Promise<void>;
  clock: () => string;
}

export type NodeExecutionOutcome = {
  status: 'succeeded' | 'failed';
  reason?: string;
};

export type NodeExecutor = (
  node: WorkflowNode,
  context: SchedulerExecutionContext,
) => Promise<NodeExecutionOutcome>;

export interface WorkflowSchedulerConfig {
  maxConcurrency?: number;
  executionFn?: NodeExecutor;
  delay?: (ms: number) => Promise<void>;
  random?: () => number;
  clock?: () => string;
  runId?: string;
  defaultFailureRate?: number;
}

export interface WorkflowScheduler {
  run: (workflow: Workflow) => Promise<RunSnapshot>;
  cancel: (reason?: string) => void;
}

const TERMINAL_NODE_STATES: NodeExecutionStatus[] = ['succeeded', 'failed', 'skipped', 'cancelled'];
const TERMINAL_RUN_STATES = ['succeeded', 'failed', 'cancelled'] as const;

type RunTerminalState = (typeof TERMINAL_RUN_STATES)[number];

const buildDefaultExecutionFn = (failureRate: number): NodeExecutor => {
  return async (node, { delay, random, signal }) => {
    const duration = 500 + Math.floor(random() * 2500);
    await delay(duration);

    if (signal.aborted) {
      return { status: 'failed', reason: `Node "${node.id}" was cancelled.` };
    }

    if (random() < failureRate) {
      return { status: 'failed', reason: `Node "${node.id}" failed during execution.` };
    }

    return { status: 'succeeded' };
  };
};

const shouldSkipNode = (nodeId: string, incoming: Map<string, string[]>, statuses: Map<string, NodeExecutionStatus>) => {
  const dependencies = incoming.get(nodeId) ?? [];
  if (dependencies.length === 0) {
    return false;
  }

  const terminalDependencies = dependencies.filter((dependency) => TERMINAL_NODE_STATES.includes(statuses.get(dependency) ?? 'queued'));
  if (terminalDependencies.length !== dependencies.length) {
    return false;
  }

  return dependencies.some((dependency) => statuses.get(dependency) !== 'succeeded');
};

export const createWorkflowScheduler = (config: WorkflowSchedulerConfig = {}): WorkflowScheduler => {
  const maxConcurrency = config.maxConcurrency ?? 2;
  const randomSource = config.random ?? Math.random;
  const delayFn = config.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clockFn = config.clock ?? (() => new Date().toISOString());
  const executionFn = config.executionFn ?? buildDefaultExecutionFn(config.defaultFailureRate ?? 0.1);
  const runId = config.runId ?? `run-${Date.now()}`;
  let cancelled = false;
  let cancelReason = 'Cancelled by operator.';
  const activeControllers = new Map<string, AbortController>();

  const run = async (workflow: Workflow): Promise<RunSnapshot> => {
    const validation = validateWorkflow(workflow);
    if (!validation.valid) {
      throw new Error(validation.errors.map((issue) => issue.message).join('; '));
    }

    cancelled = false;
    cancelReason = 'Cancelled by operator.';
    const nodeIds = workflow.nodes.map((node) => node.id);
    const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    const statuses = new Map<string, NodeExecutionStatus>();

    for (const nodeId of nodeIds) {
      incoming.set(nodeId, []);
      outgoing.set(nodeId, []);
      statuses.set(nodeId, 'queued');
    }

    for (const edge of workflow.edges) {
      const nextIncoming = incoming.get(edge.target) ?? [];
      nextIncoming.push(edge.source);
      incoming.set(edge.target, nextIncoming);

      const nextOutgoing = outgoing.get(edge.source) ?? [];
      nextOutgoing.push(edge.target);
      outgoing.set(edge.source, nextOutgoing);
    }

    const events: ExecutionEvent[] = [{ type: 'run-started', timestamp: clockFn(), runId }];
    const activePromises = new Map<string, Promise<void>>();
    let terminalState: RunTerminalState | undefined;
    let latestTimestamp = clockFn();

    const appendEvent = (event: ExecutionEvent) => {
      if (terminalState) {
        return;
      }

      events.push(event);
      latestTimestamp = event.timestamp;
    };

    const finalizeRun = (state: RunTerminalState) => {
      if (terminalState) {
        return;
      }

      const terminalEvent: ExecutionEvent = { type: 'run-terminal', timestamp: clockFn(), status: state, runId };
      terminalState = state;
      events.push(terminalEvent);
      latestTimestamp = terminalEvent.timestamp;
    };

    const markSkipped = (nodeId: string, reason: string) => {
      if (cancelled || terminalState) {
        return;
      }

      if (statuses.get(nodeId) === 'running' || TERMINAL_NODE_STATES.includes(statuses.get(nodeId) ?? 'queued')) {
        return;
      }

      statuses.set(nodeId, 'skipped');
      appendEvent({ type: 'node-skipped', timestamp: clockFn(), nodeId, reason });
    };

    const markNodeFailed = (nodeId: string, reason: string) => {
      if (cancelled || terminalState) {
        return;
      }

      if (TERMINAL_NODE_STATES.includes(statuses.get(nodeId) ?? 'queued')) {
        return;
      }

      statuses.set(nodeId, 'failed');
      appendEvent({ type: 'node-failed', timestamp: clockFn(), nodeId, reason });

      for (const dependentId of outgoing.get(nodeId) ?? []) {
        if (statuses.get(dependentId) === 'queued' && shouldSkipNode(dependentId, incoming, statuses)) {
          markSkipped(dependentId, `Dependent of failed node "${nodeId}" cannot execute.`);
        }
      }
    };

    const propagateBlockers = () => {
      for (const nodeId of nodeIds) {
        if (statuses.get(nodeId) === 'queued' && shouldSkipNode(nodeId, incoming, statuses)) {
          markSkipped(nodeId, `Node "${nodeId}" has a failed dependency and cannot run.`);
        }
      }
    };

    const scheduleReadyNodes = () => {
      if (cancelled || terminalState) {
        return;
      }

      const readyNodes = nodeIds.filter((nodeId) => {
        const current = statuses.get(nodeId) ?? 'queued';
        return current === 'queued' && !shouldSkipNode(nodeId, incoming, statuses) && incoming.get(nodeId)?.every((dependency) => statuses.get(dependency) === 'succeeded');
      });

      for (const nodeId of readyNodes) {
        if (activePromises.size >= maxConcurrency) {
          break;
        }

        const node = nodeMap.get(nodeId);
        if (!node) {
          continue;
        }

        statuses.set(nodeId, 'running');
        appendEvent({ type: 'node-started', timestamp: clockFn(), nodeId });

        const controller = new AbortController();
        activeControllers.set(nodeId, controller);

        const task = (async () => {
          try {
            const outcome = await executionFn(node, {
              signal: controller.signal,
              random: randomSource,
              delay: delayFn,
              clock: clockFn,
            });

            if (cancelled || controller.signal.aborted) {
              statuses.set(nodeId, 'cancelled');
              appendEvent({ type: 'node-skipped', timestamp: clockFn(), nodeId, reason: cancelReason });
              return;
            }

            if (outcome.status === 'failed') {
              markNodeFailed(nodeId, outcome.reason ?? `Node "${nodeId}" failed.`);
              return;
            }

            statuses.set(nodeId, 'succeeded');
            appendEvent({ type: 'node-succeeded', timestamp: clockFn(), nodeId });
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'Unknown execution failure';
            markNodeFailed(nodeId, reason);
          } finally {
            activeControllers.delete(nodeId);
            activePromises.delete(nodeId);
          }
        })();

        activePromises.set(nodeId, task);
      }
    };

    const ensureTerminalState = () => {
      if (terminalState || cancelled) {
        return;
      }

      if (nodeIds.some((nodeId) => statuses.get(nodeId) === 'failed')) {
        finalizeRun('failed');
        return;
      }

      if (nodeIds.every((nodeId) => statuses.get(nodeId) === 'succeeded')) {
        finalizeRun('succeeded');
        return;
      }

      if (nodeIds.every((nodeId) => TERMINAL_NODE_STATES.includes(statuses.get(nodeId) ?? 'queued'))) {
        finalizeRun('failed');
      }
    };

    scheduleReadyNodes();

    while (activePromises.size > 0) {
      if (cancelled) {
        finalizeRun('cancelled');
        break;
      }

      propagateBlockers();
      scheduleReadyNodes();

      if (cancelled) {
        finalizeRun('cancelled');
        break;
      }

      const next = await Promise.race(Array.from(activePromises.values()));
      void next;
      propagateBlockers();
      scheduleReadyNodes();
      ensureTerminalState();

      if (terminalState) {
        break;
      }
    }

    if (!terminalState) {
      propagateBlockers();
      scheduleReadyNodes();

      if (cancelled) {
        finalizeRun('cancelled');
      } else if (nodeIds.every((nodeId) => statuses.get(nodeId) === 'succeeded')) {
        finalizeRun('succeeded');
      } else if (nodeIds.some((nodeId) => statuses.get(nodeId) === 'failed')) {
        finalizeRun('failed');
      } else {
        finalizeRun(nodeIds.length === 0 ? 'succeeded' : 'failed');
      }
    }

    const status: RunSnapshot['status'] = terminalState ?? 'queued';
    const finalRun: RunSnapshot = {
      id: runId,
      workflowId: workflow.id,
      workflow,
      status,
      createdAt: events[0]?.timestamp ?? clockFn(),
      updatedAt: latestTimestamp,
      startedAt: events.find((event) => event.type === 'run-started')?.timestamp,
      finishedAt: events.filter((event) => event.type === 'run-terminal').at(-1)?.timestamp,
      metadata: {},
      events,
      cancelReason: cancelled ? cancelReason : undefined,
    };

    return finalRun;
  };

  return {
    run,
    cancel: (reason?: string) => {
      cancelled = true;
      cancelReason = reason ?? 'Cancelled by operator.';
      for (const controller of activeControllers.values()) {
        controller.abort();
      }
    },
  };
};

export const runWorkflow = async (workflow: Workflow, config: WorkflowSchedulerConfig = {}): Promise<RunSnapshot> => {
  const scheduler = createWorkflowScheduler(config);
  return scheduler.run(workflow);
};

export const defaultFailureRate = 0.1;
