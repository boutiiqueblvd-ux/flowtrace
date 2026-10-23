import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWorkflowScheduler } from './scheduler.js';
import { createControlledExecutor } from './testing.js';
import { validateWorkflow, type ExecutionEvent, type Workflow } from './workflow.js';

const makeWorkflow = (nodes: Workflow['nodes'], edges: Workflow['edges']): Workflow => ({
  id: 'workflow-1',
  name: 'Test workflow',
  nodes,
  edges,
});

const node = (id: string, type: 'input' | 'transform' | 'output' = 'transform'): Workflow['nodes'][number] => {
  if (type === 'output') {
    return { id, type, position: { x: 0, y: 0 }, config: { label: id, description: '', sink: 'console' } };
  }

  return { id, type, position: { x: 0, y: 0 }, config: { label: id, description: '' } };
};

const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

const summarize = (events: ExecutionEvent[]) => events.map((event) => ('nodeId' in event ? `${event.type}:${event.nodeId}` : event.type));

describe('workflow scheduler', () => {
  it('runs sequential dependencies in order', async () => {
    const order: string[] = [];
    const scheduler = createWorkflowScheduler({
      maxConcurrency: 1,
      delay: async () => undefined,
      executionFn: async (node) => {
        order.push(node.id);
        return { status: 'succeeded' };
      },
    });

    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'input', position: { x: 0, y: 0 }, config: { label: 'Start', description: 'Initial data source', defaultValue: 'A' } },
        { id: 'middle', type: 'transform', position: { x: 200, y: 0 }, config: { label: 'Middle', description: 'Normalizes data', expression: 'value' } },
        { id: 'end', type: 'output', position: { x: 400, y: 0 }, config: { label: 'End', description: 'Emits output', sink: 'console' } },
      ],
      [
        { id: 'e1', source: 'start', target: 'middle' },
        { id: 'e2', source: 'middle', target: 'end' },
      ],
    );

    const run = await scheduler.run(workflow);

    expect(order).toEqual(['start', 'middle', 'end']);
    expect(run.status).toBe('succeeded');
    expect(run.events.filter((event) => event.type === 'run-terminal')).toHaveLength(1);
  });

  it('runs independent ready nodes concurrently', async () => {
    let current = 0;
    let peak = 0;
    const scheduler = createWorkflowScheduler({
      maxConcurrency: 2,
      delay: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      executionFn: async () => {
        current += 1;
        peak = Math.max(peak, current);
        await new Promise((resolve) => setTimeout(resolve, 30));
        current -= 1;
        return { status: 'succeeded' };
      },
    });

    const workflow = makeWorkflow(
      [
        { id: 'a', type: 'input', position: { x: 0, y: 0 }, config: { label: 'A', description: 'Input A', defaultValue: 'x' } },
        { id: 'b', type: 'input', position: { x: 0, y: 100 }, config: { label: 'B', description: 'Input B', defaultValue: 'y' } },
      ],
      [],
    );

    const run = await scheduler.run(workflow);

    expect(peak).toBe(2);
    expect(run.status).toBe('succeeded');
  });

  it('propagates failure and marks downstream dependents skipped', async () => {
    const scheduler = createWorkflowScheduler({
      maxConcurrency: 2,
      delay: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      executionFn: async (node) => {
        if (node.id === 'bad') {
          return { status: 'failed', reason: 'bad node failed' };
        }
        return { status: 'succeeded' };
      },
    });

    const workflow = makeWorkflow(
      [
        { id: 'root', type: 'input', position: { x: 0, y: 0 }, config: { label: 'Root', description: 'Root input', defaultValue: 'root' } },
        { id: 'good', type: 'transform', position: { x: 200, y: 0 }, config: { label: 'Good', description: 'Good branch', expression: 'value' } },
        { id: 'bad', type: 'transform', position: { x: 200, y: 100 }, config: { label: 'Bad', description: 'Bad branch', expression: 'bad' } },
        { id: 'join', type: 'output', position: { x: 400, y: 50 }, config: { label: 'Join', description: 'Aggregates output', sink: 'console' } },
      ],
      [
        { id: 'r1', source: 'root', target: 'good' },
        { id: 'r2', source: 'root', target: 'bad' },
        { id: 'r3', source: 'good', target: 'join' },
        { id: 'r4', source: 'bad', target: 'join' },
      ],
    );

    const run = await scheduler.run(workflow);

    expect(run.status).toBe('failed');
    expect(run.events.some((event) => event.type === 'node-failed' && event.nodeId === 'bad')).toBe(true);
    expect(run.events.some((event) => event.type === 'node-skipped' && event.nodeId === 'join')).toBe(true);
  });

  it('runs the shipped sample workflow as two concurrent, independent branches', async () => {
    const sample = JSON.parse(readFileSync(new URL('../../web/public/sample-workflow.json', import.meta.url), 'utf8'));
    expect(validateWorkflow(sample)).toMatchObject({ valid: true });

    const executor = createControlledExecutor();
    const scheduler = createWorkflowScheduler({ maxConcurrency: 2, executionFn: executor.executionFn });
    const runPromise = scheduler.run(sample);

    await executor.finish('customer-request');
    expect(executor.started).toEqual(['customer-request', 'enrich-request', 'validate-request']);

    // A failure in one branch skips only that branch's output.
    await executor.finish('enrich-request', 'failed');
    await executor.finish('validate-request');
    await executor.finish('validation-result');
    const run = await runPromise;

    expect(summarize(run.events)).toEqual(expect.arrayContaining(['node-skipped:enriched-result', 'node-succeeded:validation-result']));
    expect(run.status).toBe('failed');
  });

  it('makes dependents wait for every prerequisite even when slots are free', async () => {
    const executor = createControlledExecutor();
    const events: ExecutionEvent[] = [];
    const scheduler = createWorkflowScheduler({ maxConcurrency: 4, executionFn: executor.executionFn, onEvent: (event) => events.push(event) });

    const runPromise = scheduler.run(makeWorkflow([node('a', 'input'), node('b', 'input'), node('c', 'output')], [edge('a', 'c'), edge('b', 'c')]));

    expect(executor.started).toEqual(['a', 'b']);
    expect(summarize(events)).toEqual(['run-started', 'node-started:a', 'node-started:b']);

    await executor.finish('a');
    expect(executor.started).toEqual(['a', 'b']);

    await executor.finish('b');
    expect(executor.started).toEqual(['a', 'b', 'c']);

    await executor.finish('c');
    expect((await runPromise).status).toBe('succeeded');
  });

  it('keeps running independent branches after a sibling fails', async () => {
    const executor = createControlledExecutor();
    const events: ExecutionEvent[] = [];
    const scheduler = createWorkflowScheduler({ maxConcurrency: 4, executionFn: executor.executionFn, onEvent: (event) => events.push(event) });

    const runPromise = scheduler.run(makeWorkflow(
      [node('root', 'input'), node('bad'), node('slow'), node('after-slow', 'output'), node('after-bad', 'output')],
      [edge('root', 'bad'), edge('root', 'slow'), edge('slow', 'after-slow'), edge('bad', 'after-bad')],
    ));

    await executor.finish('root');
    await executor.finish('bad', 'failed');

    expect(summarize(events)).toContain('node-skipped:after-bad');
    expect(events.some((event) => event.type === 'run-terminal')).toBe(false);

    await executor.finish('slow');
    await executor.finish('after-slow');
    const run = await runPromise;

    expect(run.status).toBe('failed');
    expect(summarize(run.events)).toContain('node-succeeded:after-slow');
    expect(run.events.filter((event) => event.type === 'run-terminal')).toHaveLength(1);
    expect(run.events.at(-1)).toMatchObject({ type: 'run-terminal', status: 'failed' });
  });

  it('skips transitive dependents as soon as one prerequisite fails, regardless of node order', async () => {
    const executor = createControlledExecutor();
    const events: ExecutionEvent[] = [];
    const scheduler = createWorkflowScheduler({ maxConcurrency: 4, executionFn: executor.executionFn, onEvent: (event) => events.push(event) });

    const runPromise = scheduler.run(makeWorkflow(
      [node('tail', 'output'), node('mid'), node('join', 'output'), node('bad', 'input'), node('slow', 'input')],
      [edge('bad', 'mid'), edge('mid', 'tail'), edge('bad', 'join'), edge('slow', 'join')],
    ));

    await executor.finish('bad', 'failed');

    // "join" is skipped immediately even though "slow" is still running.
    expect(summarize(events)).toEqual(expect.arrayContaining(['node-skipped:mid', 'node-skipped:tail', 'node-skipped:join']));
    // Each skip names the upstream node that caused it.
    const skipReason = (nodeId: string) => {
      const skip = events.find((event) => event.type === 'node-skipped' && event.nodeId === nodeId);
      return skip?.type === 'node-skipped' ? skip.reason : undefined;
    };
    expect(skipReason('join')).toBe('Upstream node "bad" failed.');
    expect(skipReason('tail')).toBe('Upstream node "mid" was skipped.');
    expect(events.some((event) => event.type === 'run-terminal')).toBe(false);

    await executor.finish('slow');
    const run = await runPromise;

    expect(run.status).toBe('failed');
    expect(executor.started).toEqual(['bad', 'slow']);
  });

  it('cancels in-flight nodes immediately and never starts new ones', async () => {
    const executor = createControlledExecutor();
    const events: ExecutionEvent[] = [];
    const scheduler = createWorkflowScheduler({ maxConcurrency: 2, executionFn: executor.executionFn, onEvent: (event) => events.push(event) });

    const runPromise = scheduler.run(makeWorkflow([node('a', 'input'), node('b'), node('c', 'output')], [edge('a', 'b'), edge('b', 'c')]));
    await executor.finish('a');
    expect(executor.started).toEqual(['a', 'b']);

    scheduler.cancel('manual stop');

    // Settled synchronously, before the in-flight executor has returned. The running node is
    // reported as interrupted and the queued one as never started, not as dependency skips.
    expect(events.slice(-3)).toMatchObject([
      { type: 'node-cancelled', nodeId: 'b', interrupted: true, reason: 'manual stop' },
      { type: 'node-cancelled', nodeId: 'c', interrupted: false, reason: 'manual stop' },
      { type: 'run-terminal', status: 'cancelled' },
    ]);
    expect(events.some((event) => event.type === 'node-skipped')).toBe(false);

    const run = await runPromise;

    expect(run.status).toBe('cancelled');
    expect(run.cancelReason).toBe('manual stop');
    expect(executor.started).toEqual(['a', 'b']);
    expect(run.events.filter((event) => event.type === 'run-terminal')).toHaveLength(1);
    expect(run.events.at(-1)).toMatchObject({ type: 'run-terminal', status: 'cancelled' });
  });

  it('starts no nodes when cancelled before the run begins', async () => {
    const executor = createControlledExecutor();
    const scheduler = createWorkflowScheduler({ executionFn: executor.executionFn });

    scheduler.cancel();
    const run = await scheduler.run(makeWorkflow([node('a', 'input')], []));

    expect(run.status).toBe('cancelled');
    expect(executor.started).toEqual([]);
  });

  it('interrupts the default executor when cancelled', async () => {
    const scheduler = createWorkflowScheduler({ random: () => 0.99, defaultFailureRate: 0 });
    const runPromise = scheduler.run(makeWorkflow([node('a', 'input')], []));
    const startedAt = Date.now();

    scheduler.cancel();
    const run = await runPromise;

    expect(run.status).toBe('cancelled');
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('emits exactly one terminal state event for a run', async () => {
    const scheduler = createWorkflowScheduler({
      maxConcurrency: 1,
      delay: async () => undefined,
      executionFn: async (node) => ({ status: node.id === 'bad' ? 'failed' : 'succeeded' }),
    });

    const workflow = makeWorkflow(
      [
        { id: 'good', type: 'input', position: { x: 0, y: 0 }, config: { label: 'Good', description: 'good input', defaultValue: 'good' } },
        { id: 'bad', type: 'transform', position: { x: 200, y: 0 }, config: { label: 'Bad', description: 'bad transform', expression: 'bad' } },
      ],
      [{ id: 'e1', source: 'good', target: 'bad' }],
    );

    const run = await scheduler.run(workflow);

    expect(run.events.filter((event) => event.type === 'run-terminal')).toHaveLength(1);
  });
});
