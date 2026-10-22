import { validateWorkflow, type ExecutionEvent, type RunSnapshot, type Workflow, type WorkflowNode } from './workflow.js';

export type NodeExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

export interface SchedulerExecutionContext {
  signal: AbortSignal;
  random: () => number;
  delay: (ms: number, signal?: AbortSignal) => Promise<void>;
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
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  clock?: () => string;
  runId?: string;
  defaultFailureRate?: number;
  // Called synchronously for every event, in order, as soon as it happens.
  onEvent?: (event: ExecutionEvent) => void;
}

export interface WorkflowScheduler {
  run: (workflow: Workflow) => Promise<RunSnapshot>;
  cancel: (reason?: string) => void;
}

const TERMINAL_NODE_STATES: NodeExecutionStatus[] = ['succeeded', 'failed', 'skipped', 'cancelled'];
const TERMINAL_RUN_STATES = ['succeeded', 'failed', 'cancelled'] as const;

type RunTerminalState = (typeof TERMINAL_RUN_STATES)[number];

const abortableDelay = (ms: number, signal?: AbortSignal) => {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

const buildDefaultExecutionFn = (failureRate: number): NodeExecutor => {
  return async (node, { delay, random, signal }) => {
    const duration = 500 + Math.floor(random() * 2500);
    await delay(duration, signal);

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

  // A node can never run once any prerequisite has ended without succeeding,
  // so it is skipped immediately rather than waiting for its other prerequisites.
  return dependencies.some((dependency) => {
    const status = statuses.get(dependency) ?? 'queued';
    return TERMINAL_NODE_STATES.includes(status) && status !== 'succeeded';
  });
};

export const createWorkflowScheduler = (config: WorkflowSchedulerConfig = {}): WorkflowScheduler => {
  const maxConcurrency = config.maxConcurrency ?? 2;
  const randomSource = config.random ?? Math.random;
  const delayFn = config.delay ?? abortableDelay;
  const clockFn = config.clock ?? (() => new Date().toISOString());
  const executionFn = config.executionFn ?? buildDefaultExecutionFn(config.defaultFailureRate ?? 0.1);
  const runId = config.runId ?? `run-${Date.now()}`;
  let cancelRequested = false;
  let cancelReason = 'Cancelled by operator.';
  // Bound by run() so cancel() can settle the active run synchronously.
  let cancelActiveRun: (() => void) | undefined;

  const run = async (workflow: Workflow): Promise<RunSnapshot> => {
    const validation = validateWorkflow(workflow);
    if (!validation.valid) {
      throw new Error(validation.errors.map((issue) => issue.message).join('; '));
    }

    const nodeIds = workflow.nodes.map((node) => node.id);
    const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, string[]>();
    const statuses = new Map<string, NodeExecutionStatus>();

    for (const nodeId of nodeIds) {
      incoming.set(nodeId, []);
      statuses.set(nodeId, 'queued');
    }

    for (const edge of workflow.edges) {
      incoming.get(edge.target)?.push(edge.source);
    }

    const events: ExecutionEvent[] = [];
    const activeControllers = new Map<string, AbortController>();
    const activePromises = new Map<string, Promise<void>>();
    let terminalState: RunTerminalState | undefined;
    let latestTimestamp = clockFn();

    const appendEvent = (event: ExecutionEvent) => {
      if (terminalState) {
        return;
      }

      events.push(event);
      latestTimestamp = event.timestamp;
      config.onEvent?.(event);
    };

    const finalizeRun = (state: RunTerminalState) => {
      if (terminalState) {
        return;
      }

      appendEvent({ type: 'run-terminal', timestamp: clockFn(), status: state, runId });
      terminalState = state;
    };

    const markSkipped = (nodeId: string, reason: string) => {
      statuses.set(nodeId, 'skipped');
      appendEvent({ type: 'node-skipped', timestamp: clockFn(), nodeId, reason });
    };

    // Repeat until stable so skips cascade through transitive dependents regardless of node order.
    const propagateBlockers = () => {
      let changed = true;
      while (changed) {
        changed = false;
        for (const nodeId of nodeIds) {
          if (statuses.get(nodeId) !== 'queued' || !shouldSkipNode(nodeId, incoming, statuses)) {
            continue;
          }

          const blocker = (incoming.get(nodeId) ?? []).find((dependency) => statuses.get(dependency) !== 'succeeded' && TERMINAL_NODE_STATES.includes(statuses.get(dependency) ?? 'queued'));
          markSkipped(nodeId, `Dependency "${blocker}" did not succeed.`);
          changed = true;
        }
      }
    };

    const settleNode = (nodeId: string, outcome: NodeExecutionOutcome) => {
      // The node was already settled by cancellation while its executor was still running.
      if (statuses.get(nodeId) !== 'running') {
        return;
      }

      if (outcome.status === 'failed') {
        statuses.set(nodeId, 'failed');
        appendEvent({ type: 'node-failed', timestamp: clockFn(), nodeId, reason: outcome.reason ?? `Node "${nodeId}" failed.` });
        return;
      }

      statuses.set(nodeId, 'succeeded');
      appendEvent({ type: 'node-succeeded', timestamp: clockFn(), nodeId });
    };

    const scheduleReadyNodes = () => {
      if (cancelRequested || terminalState) {
        return;
      }

      const readyNodes = nodeIds.filter((nodeId) => {
        return statuses.get(nodeId) === 'queued' && incoming.get(nodeId)?.every((dependency) => statuses.get(dependency) === 'succeeded');
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
            settleNode(nodeId, outcome);
          } catch (error) {
            settleNode(nodeId, { status: 'failed', reason: error instanceof Error ? error.message : 'Unknown execution failure' });
          } finally {
            activeControllers.delete(nodeId);
            activePromises.delete(nodeId);
          }
        })();

        activePromises.set(nodeId, task);
      }
    };

    cancelActiveRun = () => {
      if (terminalState) {
        return;
      }

      for (const nodeId of nodeIds) {
        if (statuses.get(nodeId) === 'running') {
          statuses.set(nodeId, 'cancelled');
          appendEvent({ type: 'node-skipped', timestamp: clockFn(), nodeId, reason: cancelReason });
        }
      }

      for (const controller of activeControllers.values()) {
        controller.abort();
      }

      finalizeRun('cancelled');
    };

    appendEvent({ type: 'run-started', timestamp: clockFn(), runId });

    if (cancelRequested) {
      cancelActiveRun();
    }

    scheduleReadyNodes();

    // Keep going until every in-flight node has settled, so a failure in one
    // branch never stops independent branches from finishing.
    while (activePromises.size > 0) {
      await Promise.race(Array.from(activePromises.values()));
      propagateBlockers();
      scheduleReadyNodes();
    }

    propagateBlockers();

    if (cancelRequested) {
      finalizeRun('cancelled');
    } else if (nodeIds.every((nodeId) => statuses.get(nodeId) === 'succeeded')) {
      finalizeRun('succeeded');
    } else {
      finalizeRun('failed');
    }

    cancelActiveRun = undefined;

    const status: RunSnapshot['status'] = terminalState ?? 'failed';
    return {
      id: runId,
      workflowId: workflow.id,
      workflow,
      status,
      createdAt: events[0]?.timestamp ?? clockFn(),
      updatedAt: latestTimestamp,
      startedAt: events.find((event) => event.type === 'run-started')?.timestamp,
      finishedAt: events.find((event) => event.type === 'run-terminal')?.timestamp,
      metadata: {},
      events,
      cancelReason: cancelRequested ? cancelReason : undefined,
    };
  };

  return {
    run,
    cancel: (reason?: string) => {
      if (cancelRequested) {
        return;
      }

      cancelRequested = true;
      cancelReason = reason ?? 'Cancelled by operator.';
      cancelActiveRun?.();
    },
  };
};

export const runWorkflow = async (workflow: Workflow, config: WorkflowSchedulerConfig = {}): Promise<RunSnapshot> => {
  const scheduler = createWorkflowScheduler(config);
  return scheduler.run(workflow);
};

export const defaultFailureRate = 0.1;
