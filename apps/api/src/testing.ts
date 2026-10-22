import type { NodeExecutionOutcome, NodeExecutor } from './scheduler.js';

// Test helper: an executor whose nodes only finish when the test says so,
// so concurrency, failure and cancellation tests do not depend on timing.
export const createControlledExecutor = () => {
  const pending = new Map<string, (outcome: NodeExecutionOutcome) => void>();
  const started: string[] = [];

  const executionFn: NodeExecutor = (node, { signal }) => {
    started.push(node.id);
    return new Promise<NodeExecutionOutcome>((resolve) => {
      pending.set(node.id, resolve);
      signal.addEventListener('abort', () => resolve({ status: 'failed', reason: 'aborted' }), { once: true });
    });
  };

  const finish = async (nodeId: string, status: NodeExecutionOutcome['status'] = 'succeeded') => {
    const resolve = pending.get(nodeId);
    if (!resolve) {
      throw new Error(`Node "${nodeId}" has not started.`);
    }

    pending.delete(nodeId);
    resolve({ status, reason: status === 'failed' ? `${nodeId} failed` : undefined });
    await settle();
  };

  return { executionFn, started, finish };
};

// Lets pending promise continuations and timers run.
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
