import type { Node } from 'reactflow';

export type WorkflowNodeType = 'input' | 'transform' | 'output';

export interface WorkflowNodeData {
  kind: WorkflowNodeType;
  label: string;
  description: string;
}

export type GraphNode = Node<WorkflowNodeData>;

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  comment?: string;
  branch?: 'yes' | 'no';
};

export type ExecutionNodeStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

export type ExecutionEvent =
  | {
      id?: number;
      sequence?: number;
      type: 'run-created';
      timestamp: string;
      message: string;
      runId?: string;
      nodeId?: never;
    }
  | {
      id?: number;
      sequence?: number;
      type: 'run-started';
      timestamp: string;
      runId: string;
      nodeId?: never;
    }
  | {
      id?: number;
      sequence?: number;
      type: 'node-started';
      timestamp: string;
      nodeId: string;
      runId?: string;
    }
  | {
      id?: number;
      sequence?: number;
      type: 'node-succeeded';
      timestamp: string;
      nodeId: string;
      output?: unknown;
      runId?: string;
    }
  | {
      id?: number;
      sequence?: number;
      type: 'node-failed';
      timestamp: string;
      nodeId: string;
      reason?: string;
      runId?: string;
    }
  | {
      id?: number;
      sequence?: number;
      type: 'node-skipped';
      timestamp: string;
      nodeId: string;
      reason?: string;
      runId?: string;
    }
  | {
      id?: number;
      sequence?: number;
      type: 'run-terminal';
      timestamp: string;
      status: 'succeeded' | 'failed' | 'cancelled';
      runId?: string;
      nodeId?: never;
    }
  | {
      id?: number;
      sequence?: number;
      type: 'run-cancelled';
      timestamp: string;
      reason?: string;
      runId?: string;
      nodeId?: never;
    };

export interface NodeExecutionInfo {
  nodeId: string;
  status: ExecutionNodeStatus;
  startedAt?: string;
  finishedAt?: string;
  lastUpdatedAt?: string;
  durationMs?: number;
  output?: unknown;
  error?: string;
  skipReason?: string;
}

export interface RunSnapshotLike {
  id: string;
  workflowId: string;
  status: string;
  events: ExecutionEvent[];
  metadata?: Record<string, unknown>;
}
