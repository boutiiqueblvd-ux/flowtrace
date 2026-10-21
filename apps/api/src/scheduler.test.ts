import { describe, expect, it } from 'vitest';
import { createWorkflowScheduler } from './scheduler.js';
import type { Workflow } from './workflow.js';

const makeWorkflow = (nodes: Workflow['nodes'], edges: Workflow['edges']): Workflow => ({
  id: 'workflow-1',
  name: 'Test workflow',
  nodes,
  edges,
});

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

  it('continues independent branches after a sibling failure', async () => {
    const scheduler = createWorkflowScheduler({
      maxConcurrency: 2,
      delay: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      executionFn: async (node) => {
        if (node.id === 'branch-a') {
          return { status: 'failed', reason: 'branch-a failed' };
        }
        return { status: 'succeeded' };
      },
    });

    const workflow = makeWorkflow(
      [
        { id: 'root', type: 'input', position: { x: 0, y: 0 }, config: { label: 'Root', description: 'Root input', defaultValue: 'root' } },
        { id: 'branch-a', type: 'transform', position: { x: 200, y: 0 }, config: { label: 'A', description: 'Branch A', expression: 'a' } },
        { id: 'branch-b', type: 'transform', position: { x: 200, y: 120 }, config: { label: 'B', description: 'Branch B', expression: 'b' } },
      ],
      [
        { id: 'e1', source: 'root', target: 'branch-a' },
        { id: 'e2', source: 'root', target: 'branch-b' },
      ],
    );

    const run = await scheduler.run(workflow);

    expect(run.status).toBe('failed');
    expect(run.events.some((event) => event.type === 'node-failed' && event.nodeId === 'branch-a')).toBe(true);
    expect(run.events.some((event) => event.type === 'node-succeeded' && event.nodeId === 'branch-b')).toBe(true);
  });

  it('supports cancellation and prevents scheduling new nodes after cancel', async () => {
    let started: string[] = [];
    const scheduler = createWorkflowScheduler({
      maxConcurrency: 2,
      delay: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      executionFn: async (node) => {
        started.push(node.id);
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { status: 'succeeded' };
      },
    });

    const workflow = makeWorkflow(
      [
        { id: 'a', type: 'input', position: { x: 0, y: 0 }, config: { label: 'A', description: 'Input A', defaultValue: 'a' } },
        { id: 'b', type: 'transform', position: { x: 200, y: 0 }, config: { label: 'B', description: 'Middle transform', expression: 'b' } },
        { id: 'c', type: 'output', position: { x: 400, y: 0 }, config: { label: 'C', description: 'Final output', sink: 'console' } },
      ],
      [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
      ],
    );

    const runPromise = scheduler.run(workflow);
    await new Promise((resolve) => setTimeout(resolve, 10));
    scheduler.cancel('manual stop');
    const run = await runPromise;

    expect(run.status).toBe('cancelled');
    expect(run.events.filter((event) => event.type === 'run-terminal')).toHaveLength(1);
    expect(started.length).toBeLessThanOrEqual(2);
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
