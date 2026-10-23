import { describe, expect, it } from 'vitest';
import { useExecutionStore } from './executionStore';

describe('execution store', () => {
  it('updates node state from ordered execution events', () => {
    const { clear, applyRunSnapshot } = useExecutionStore.getState();

    clear();
    applyRunSnapshot({
      id: 'run-123',
      workflowId: 'wf-1',
      status: 'queued',
      events: [
        { id: 1, sequence: 1, type: 'run-created', timestamp: '2024-01-01T00:00:00.000Z', message: 'queued' },
        { id: 2, sequence: 2, type: 'node-started', timestamp: '2024-01-01T00:00:01.000Z', nodeId: 'alpha', runId: 'run-123' },
        { id: 3, sequence: 3, type: 'node-succeeded', timestamp: '2024-01-01T00:00:03.000Z', nodeId: 'alpha', runId: 'run-123' },
        { id: 4, sequence: 4, type: 'run-terminal', timestamp: '2024-01-01T00:00:03.500Z', status: 'succeeded', runId: 'run-123' },
      ],
    });

    const state = useExecutionStore.getState();
    expect(state.status).toBe('succeeded');
    expect(state.nodeStates.alpha).toMatchObject({
      status: 'succeeded',
      durationMs: expect.any(Number),
    });
  });

  it('ignores stale events that are older than the latest seen sequence', () => {
    const { clear, applyRunSnapshot, appendEvent } = useExecutionStore.getState();

    clear();
    applyRunSnapshot({
      id: 'run-99',
      workflowId: 'wf-2',
      status: 'running',
      events: [
        { id: 1, sequence: 1, type: 'run-created', timestamp: '2024-01-01T00:00:00.000Z', message: 'queued' },
        { id: 2, sequence: 2, type: 'node-started', timestamp: '2024-01-01T00:00:01.000Z', nodeId: 'beta', runId: 'run-99' },
      ],
    });

    appendEvent({ id: 1, sequence: 1, type: 'run-created', timestamp: '2024-01-01T00:00:00.000Z', message: 'stale replay' });

    expect(useExecutionStore.getState().lastSequence).toBe(2);
    expect(useExecutionStore.getState().nodeStates.beta).toMatchObject({
      status: 'running',
    });
  });

  it('resets the cursor when a different run is loaded so its events are not dropped', () => {
    const { clear, applyRunSnapshot, appendEvent } = useExecutionStore.getState();

    clear();
    applyRunSnapshot({
      id: 'run-1',
      workflowId: 'wf-1',
      status: 'succeeded',
      events: [
        { id: 1, sequence: 1, type: 'run-created', timestamp: '2024-01-01T00:00:00.000Z', message: 'queued' },
        { id: 2, sequence: 2, type: 'run-started', timestamp: '2024-01-01T00:00:00.000Z', runId: 'run-1' },
        { id: 3, sequence: 3, type: 'node-started', timestamp: '2024-01-01T00:00:00.000Z', nodeId: 'alpha', runId: 'run-1' },
        { id: 4, sequence: 4, type: 'run-terminal', timestamp: '2024-01-01T00:00:01.000Z', status: 'succeeded', runId: 'run-1' },
      ],
    });

    applyRunSnapshot({
      id: 'run-2',
      workflowId: 'wf-1',
      status: 'queued',
      events: [{ id: 1, sequence: 1, type: 'run-created', timestamp: '2024-01-01T00:01:00.000Z', message: 'queued', runId: 'run-2' }],
    });
    expect(useExecutionStore.getState().lastSequence).toBe(1);

    appendEvent({ id: 2, sequence: 2, type: 'node-started', timestamp: '2024-01-01T00:01:01.000Z', nodeId: 'beta', runId: 'run-2' });

    const state = useExecutionStore.getState();
    expect(state.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(state.nodeStates).toEqual({ beta: expect.objectContaining({ status: 'running' }) });
  });

  it('records cancellation outcomes identically from live events and from a snapshot', () => {
    const { clear, appendEvent, applyRunSnapshot } = useExecutionStore.getState();
    const events = [
      { id: 1, sequence: 1, type: 'run-created' as const, timestamp: '2024-01-01T00:00:00.000Z', message: 'queued', runId: 'run-c' },
      { id: 2, sequence: 2, type: 'node-started' as const, timestamp: '2024-01-01T00:00:01.000Z', nodeId: 'alpha', runId: 'run-c' },
      { id: 3, sequence: 3, type: 'node-cancelled' as const, timestamp: '2024-01-01T00:00:02.000Z', nodeId: 'alpha', interrupted: true, reason: 'stop', runId: 'run-c' },
      { id: 4, sequence: 4, type: 'node-cancelled' as const, timestamp: '2024-01-01T00:00:02.000Z', nodeId: 'beta', interrupted: false, reason: 'stop', runId: 'run-c' },
      { id: 5, sequence: 5, type: 'run-terminal' as const, timestamp: '2024-01-01T00:00:02.000Z', status: 'cancelled' as const, runId: 'run-c' },
    ];

    clear();
    events.forEach((event) => appendEvent(event));
    const live = useExecutionStore.getState();

    expect(live.status).toBe('cancelled');
    expect(live.nodeStates.alpha).toMatchObject({ status: 'cancelled', interrupted: true, cancelReason: 'stop', durationMs: 1000 });
    expect(live.nodeStates.beta).toMatchObject({ status: 'cancelled', interrupted: false, cancelReason: 'stop' });

    clear();
    applyRunSnapshot({ id: 'run-c', workflowId: 'wf', status: 'cancelled', events });
    expect(useExecutionStore.getState().nodeStates).toEqual(live.nodeStates);
  });

  it('computes node duration from live events', () => {
    const { clear, appendEvent } = useExecutionStore.getState();

    clear();
    appendEvent({ id: 1, sequence: 1, type: 'node-started', timestamp: '2024-01-01T00:00:01.000Z', nodeId: 'alpha', runId: 'run-5' });
    appendEvent({ id: 2, sequence: 2, type: 'node-succeeded', timestamp: '2024-01-01T00:00:04.000Z', nodeId: 'alpha', runId: 'run-5' });

    expect(useExecutionStore.getState().nodeStates.alpha).toMatchObject({
      startedAt: '2024-01-01T00:00:01.000Z',
      durationMs: 3000,
    });
  });
});
