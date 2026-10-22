import { create } from 'zustand';
import type { ExecutionEvent, ExecutionNodeStatus, NodeExecutionInfo, RunSnapshotLike } from '../types';

export type ExecutionStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface ExecutionState {
  status: ExecutionStatus;
  selectedRunId: string | null;
  lastSequence: number;
  events: ExecutionEvent[];
  nodeStates: Record<string, NodeExecutionInfo>;
  selectedNodeId: string | null;
  setStatus: (status: ExecutionStatus) => void;
  setSelectedRunId: (runId: string | null) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  appendEvent: (event: ExecutionEvent) => void;
  applyRunSnapshot: (snapshot: RunSnapshotLike) => void;
  clear: () => void;
}

const normalizeSequence = (event: ExecutionEvent, fallback: number): number => {
  if (typeof event.sequence === 'number') {
    return event.sequence;
  }

  if (typeof event.id === 'number') {
    return event.id;
  }

  return fallback;
};

const inferDurationMs = (startedAt?: string, finishedAt?: string): number | undefined => {
  if (!startedAt || !finishedAt) {
    return undefined;
  }

  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return undefined;
  }

  return Math.max(0, end - start);
};

const mergeNodeState = (
  current: NodeExecutionInfo | undefined,
  next: Partial<NodeExecutionInfo>,
  defaultStatus: ExecutionNodeStatus,
): NodeExecutionInfo => {
  const base: NodeExecutionInfo = current ?? {
    nodeId: next.nodeId ?? 'unknown',
    status: defaultStatus,
  };

  return {
    ...base,
    ...next,
    status: next.status ?? base.status,
  };
};

const applyEventToNodeState = (
  nodeStates: Record<string, NodeExecutionInfo>,
  event: ExecutionEvent,
): Record<string, NodeExecutionInfo> => {
  if (!event.nodeId) {
    return nodeStates;
  }

  const current = nodeStates[event.nodeId];

  if (event.type === 'node-started') {
    return {
      ...nodeStates,
      [event.nodeId]: mergeNodeState(current, {
        nodeId: event.nodeId,
        status: 'running',
        startedAt: event.timestamp,
        lastUpdatedAt: event.timestamp,
      }, 'queued'),
    };
  }

  if (event.type === 'node-succeeded') {
    const startStamp = current?.startedAt ?? event.timestamp;
    const durationMs = inferDurationMs(startStamp, event.timestamp);

    return {
      ...nodeStates,
      [event.nodeId]: mergeNodeState(current, {
        nodeId: event.nodeId,
        status: 'succeeded',
        output: event.output ?? current?.output,
        durationMs,
        lastUpdatedAt: event.timestamp,
        finishedAt: event.timestamp,
      }, 'queued'),
    };
  }

  if (event.type === 'node-failed') {
    return {
      ...nodeStates,
      [event.nodeId]: mergeNodeState(current, {
        nodeId: event.nodeId,
        status: 'failed',
        error: event.reason ?? 'The node failed without a message.',
        durationMs: inferDurationMs(current?.startedAt, event.timestamp),
        lastUpdatedAt: event.timestamp,
        finishedAt: event.timestamp,
      }, 'queued'),
    };
  }

  if (event.type === 'node-skipped') {
    return {
      ...nodeStates,
      [event.nodeId]: mergeNodeState(current, {
        nodeId: event.nodeId,
        status: 'skipped',
        skipReason: event.reason ?? 'A dependency failed earlier in the run.',
        durationMs: inferDurationMs(current?.startedAt, event.timestamp),
        lastUpdatedAt: event.timestamp,
        finishedAt: event.timestamp,
      }, 'queued'),
    };
  }

  return nodeStates;
};

const buildNodeStatesFromEvents = (events: ExecutionEvent[]) => {
  return events.reduce<Record<string, NodeExecutionInfo>>((accumulator, event) => {
    if (!event.nodeId) {
      return accumulator;
    }

    const base = accumulator[event.nodeId];

    if (event.type === 'node-started') {
      return {
        ...accumulator,
        [event.nodeId]: {
          nodeId: event.nodeId,
          status: 'running',
          startedAt: event.timestamp,
          lastUpdatedAt: event.timestamp,
        },
      };
    }

    if (event.type === 'node-succeeded') {
      const durationMs = inferDurationMs(base?.startedAt, event.timestamp);
      return {
        ...accumulator,
        [event.nodeId]: {
          ...base,
          nodeId: event.nodeId,
          status: 'succeeded',
          durationMs,
          output: event.output ?? base?.output,
          lastUpdatedAt: event.timestamp,
          finishedAt: event.timestamp,
        },
      };
    }

    if (event.type === 'node-failed') {
      return {
        ...accumulator,
        [event.nodeId]: {
          ...base,
          nodeId: event.nodeId,
          status: 'failed',
          error: event.reason ?? 'The node failed without a message.',
          durationMs: inferDurationMs(base?.startedAt, event.timestamp),
          lastUpdatedAt: event.timestamp,
          finishedAt: event.timestamp,
        },
      };
    }

    if (event.type === 'node-skipped') {
      return {
        ...accumulator,
        [event.nodeId]: {
          ...base,
          nodeId: event.nodeId,
          status: 'skipped',
          skipReason: event.reason ?? 'A dependency failed earlier in the run.',
          durationMs: inferDurationMs(base?.startedAt, event.timestamp),
          lastUpdatedAt: event.timestamp,
          finishedAt: event.timestamp,
        },
      };
    }

    return accumulator;
  }, {});
};

const inferRunStatus = (events: ExecutionEvent[], fallback: ExecutionStatus): ExecutionStatus => {
  const terminalEvent = [...events].reverse().find((event) => event.type === 'run-terminal' || event.type === 'run-cancelled');

  if (terminalEvent?.type === 'run-cancelled') {
    return 'cancelled';
  }

  if (terminalEvent?.type === 'run-terminal') {
    return terminalEvent.status === 'failed' ? 'failed' : terminalEvent.status === 'cancelled' ? 'cancelled' : 'succeeded';
  }

  if (events.some((event) => event.type === 'run-started')) {
    return 'running';
  }

  if (events.some((event) => event.type === 'run-created')) {
    return 'queued';
  }

  return fallback;
};

const dedupeEvents = (events: ExecutionEvent[]) => {
  const deduplicated = new Map<number, ExecutionEvent>();

  for (const event of events) {
    const sequence = normalizeSequence(event, 0);
    if (sequence <= 0) {
      continue;
    }

    deduplicated.set(sequence, {
      ...event,
      id: typeof event.id === 'number' ? event.id : sequence,
      sequence,
    });
  }

  return Array.from(deduplicated.values()).sort((left, right) => normalizeSequence(left, 0) - normalizeSequence(right, 0));
};

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  status: 'idle',
  selectedRunId: null,
  lastSequence: 0,
  events: [],
  nodeStates: {},
  selectedNodeId: null,
  setStatus: (status) => set({ status }),
  setSelectedRunId: (selectedRunId) => set({ selectedRunId }),
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  appendEvent: (event) => {
    const current = get();
    if (event.runId && current.selectedRunId && current.selectedRunId !== event.runId) {
      return;
    }

    const normalized = {
      ...event,
      id: typeof event.id === 'number' ? event.id : undefined,
      sequence: typeof event.sequence === 'number' ? event.sequence : undefined,
    };
    const nextSequence = normalizeSequence(normalized, current.lastSequence + 1);

    if (nextSequence <= current.lastSequence) {
      return;
    }

    const nextEvents = dedupeEvents([...current.events, { ...normalized, sequence: nextSequence, id: normalized.id ?? nextSequence }]);
    const nextNodeStates = applyEventToNodeState(current.nodeStates, { ...normalized, sequence: nextSequence, id: normalized.id ?? nextSequence });
    const nextStatus = inferRunStatus(nextEvents, current.status);

    set({
      lastSequence: nextSequence,
      events: nextEvents,
      nodeStates: nextNodeStates,
      status: nextStatus,
      selectedRunId: event.runId ?? current.selectedRunId,
    });
  },
  applyRunSnapshot: (snapshot) => {
    const current = get();
    const normalizedEvents = dedupeEvents([...snapshot.events]
      .map((event, index) => ({
        ...event,
        sequence: typeof event.sequence === 'number' ? event.sequence : index + 1,
        id: typeof event.id === 'number' ? event.id : index + 1,
        runId: event.runId ?? snapshot.id,
      })));

    const nextSequence = normalizedEvents.length > 0 ? Math.max(...normalizedEvents.map((event) => normalizeSequence(event, 0))) : 0;
    // A snapshot of the same run that is not newer than what we have would roll the UI back.
    // A different run replaces state completely, including the cursor, so runs never mix.
    if (current.selectedRunId === snapshot.id && nextSequence <= current.lastSequence) {
      return;
    }

    const nextNodeStates = buildNodeStatesFromEvents(normalizedEvents);
    const nextStatus = inferRunStatus(normalizedEvents, (snapshot.status as ExecutionStatus) ?? 'idle');

    set({
      status: nextStatus,
      selectedRunId: snapshot.id ?? current.selectedRunId,
      lastSequence: nextSequence,
      events: normalizedEvents,
      nodeStates: nextNodeStates,
    });
  },
  clear: () => set({
    status: 'idle',
    selectedRunId: null,
    lastSequence: 0,
    events: [],
    nodeStates: {},
    selectedNodeId: null,
  }),
}));
