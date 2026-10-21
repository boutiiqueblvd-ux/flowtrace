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
};
