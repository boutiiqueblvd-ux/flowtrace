import { applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from 'reactflow';
import { create } from 'zustand';
import type { GraphEdge, GraphNode, WorkflowNodeType } from '../types';

interface ValidationMessage {
  type: 'error' | 'info';
  text: string;
}

interface GraphStore {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  validationMessage: ValidationMessage | null;
  addNode: (kind: WorkflowNodeType) => void;
  updateNode: (nodeId: string, updates: Partial<GraphNode['data']>) => void;
  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setSelectedEdge: (edgeId: string | null) => void;
  setNodes: (changes: NodeChange[]) => void;
  setEdges: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  clearValidationMessage: () => void;
}

const getNodeById = (nodes: GraphNode[], nodeId: string) => nodes.find((node) => node.id === nodeId);

const hasPath = (from: string, to: string, edges: GraphEdge[]) => {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const next = adjacency.get(edge.source) ?? [];
    next.push(edge.target);
    adjacency.set(edge.source, next);
  }

  const visited = new Set<string>();
  const queue = [from];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    if (current === to) {
      return true;
    }

    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return false;
};

const buildCycleCheckEdges = (edges: GraphEdge[], nextEdge: Connection) => {
  if (!nextEdge.source || !nextEdge.target) {
    return edges;
  }

  return [...edges, { id: `edge-${Date.now()}`, source: nextEdge.source, target: nextEdge.target }];
};

const createNodeId = (kind: WorkflowNodeType, nodes: GraphNode[]) => {
  const prefix = kind.charAt(0).toUpperCase() + kind.slice(1);
  let index = 1;

  while (true) {
    const candidate = `${prefix}${index}`;
    if (!nodes.some((node) => node.id === candidate)) {
      return candidate;
    }
    index += 1;
  }
};

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  validationMessage: null,
  addNode: (kind) => {
    const id = createNodeId(kind, get().nodes);
    const nextNode: GraphNode = {
      id,
      type: 'workflowNode',
      position: { x: 80 + get().nodes.length * 70, y: 80 + (get().nodes.length % 5) * 80 },
      data: {
        kind,
        label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
        description: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} node for the workflow.`,
      },
    };

    set((state) => ({
      nodes: [...state.nodes, nextNode],
      selectedNodeId: nextNode.id,
      validationMessage: { type: 'info', text: `${kind} node added.` },
    }));
  },
  updateNode: (nodeId, updates) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                ...updates,
              },
            }
          : node,
      ),
    }));
  },
  deleteNode: (nodeId) => {
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== nodeId),
      edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      validationMessage: { type: 'info', text: 'Node deleted.' },
    }));
  },
  deleteEdge: (edgeId) => {
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
      selectedEdgeId: state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
      validationMessage: { type: 'info', text: 'Connection removed.' },
    }));
  },
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setSelectedEdge: (edgeId) => set({ selectedEdgeId: edgeId }),
  setNodes: (changes) => {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
    }));
  },
  setEdges: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
    }));
  },
  onConnect: (connection) => {
    const { nodes, edges } = get();

    if (!connection.source || !connection.target) {
      set({ validationMessage: { type: 'error', text: 'A valid connection requires both a source and target.' } });
      return;
    }

    const sourceNode = getNodeById(nodes, connection.source);
    const targetNode = getNodeById(nodes, connection.target);

    if (!sourceNode || !targetNode) {
      set({ validationMessage: { type: 'error', text: 'The connection references a node that does not exist.' } });
      return;
    }

    if (targetNode.data.kind === 'input') {
      set({
        validationMessage: { type: 'error', text: 'Input nodes cannot accept incoming connections.' },
      });
      return;
    }

    if (sourceNode.data.kind === 'output') {
      set({
        validationMessage: { type: 'error', text: 'Output nodes cannot emit outgoing connections.' },
      });
      return;
    }

    const nextEdges = buildCycleCheckEdges(edges, connection);
    const wouldCycle = hasPath(connection.target, connection.source, nextEdges);

    if (wouldCycle) {
      set({
        validationMessage: { type: 'error', text: 'This connection creates a cycle and is not allowed.' },
      });
      return;
    }

    set((state) => ({
      edges: [...state.edges, { id: `edge-${Date.now()}`, source: connection.source!, target: connection.target! }],
      validationMessage: { type: 'info', text: 'Connection created.' },
    }));
  },
  clearValidationMessage: () => set({ validationMessage: null }),
}));
