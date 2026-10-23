import type { ExecutionStatus } from './store/executionStore';
import type { NodeExecutionInfo } from './types';

export type NodeStatusTone = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

export interface NodeStatusView {
  tone: NodeStatusTone;
  label: string;
  detail?: string;
}

// The one place that turns a node's execution state into what the canvas, inspector and
// timeline show, so the three views always agree.
export const describeNodeStatus = (info: NodeExecutionInfo | undefined, runStatus: ExecutionStatus): NodeStatusView => {
  if (!info) {
    if (runStatus === 'queued' || runStatus === 'running') {
      return { tone: 'queued', label: 'Queued', detail: 'Waiting for its dependencies or a free execution slot.' };
    }
    if (runStatus === 'idle') {
      return { tone: 'idle', label: 'Not run' };
    }
    // Every node in a finished run has an outcome event, so this node was added after the run started.
    return { tone: 'idle', label: 'Not in last run', detail: 'This node was not part of the most recent run.' };
  }

  switch (info.status) {
    case 'running':
      return { tone: 'running', label: 'Running' };
    case 'succeeded':
      return { tone: 'succeeded', label: 'Succeeded' };
    case 'failed':
      return { tone: 'failed', label: 'Failed', detail: info.error };
    case 'skipped':
      return { tone: 'skipped', label: 'Skipped', detail: info.skipReason ? `Not run: ${info.skipReason}` : 'Not run because a dependency did not succeed.' };
    case 'cancelled':
      return info.interrupted
        ? { tone: 'cancelled', label: 'Interrupted', detail: 'Stopped while running because the run was cancelled.' }
        : { tone: 'cancelled', label: 'Not started', detail: 'The run was cancelled before this node started.' };
    default:
      return { tone: 'queued', label: 'Queued' };
  }
};
