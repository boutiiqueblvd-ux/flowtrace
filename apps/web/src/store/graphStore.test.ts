import { describe, expect, it } from 'vitest';
import { useGraphStore } from './graphStore';

describe('graph editor store', () => {
  it('adds a node with a stable id and selected state', () => {
    useGraphStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      validationMessage: null,
    });

    useGraphStore.getState().addNode('transform');

    expect(useGraphStore.getState().nodes).toHaveLength(1);
    expect(useGraphStore.getState().selectedNodeId).toBe('Transform1');
    expect(useGraphStore.getState().nodes[0].data.kind).toBe('transform');
  });

  it('rejects incoming edges into input nodes', () => {
    useGraphStore.setState({
      nodes: [
        { id: 'Input1', type: 'workflowNode', position: { x: 0, y: 0 }, data: { kind: 'input', label: 'Input', description: 'Entry point' } },
        { id: 'Transform1', type: 'workflowNode', position: { x: 200, y: 0 }, data: { kind: 'transform', label: 'Transform', description: 'Process' } },
      ],
      edges: [],
      selectedNodeId: null,
      validationMessage: null,
    });

    useGraphStore.getState().onConnect({ source: 'Transform1', target: 'Input1', sourceHandle: null, targetHandle: null });

    expect(useGraphStore.getState().validationMessage).toMatchObject({
      type: 'error',
      text: 'Input nodes cannot accept incoming connections.',
    });
  });

  it('rejects cycles', () => {
    useGraphStore.setState({
      nodes: [
        { id: 'A', type: 'workflowNode', position: { x: 0, y: 0 }, data: { kind: 'transform', label: 'A', description: 'A' } },
        { id: 'B', type: 'workflowNode', position: { x: 200, y: 0 }, data: { kind: 'transform', label: 'B', description: 'B' } },
      ],
      edges: [{ id: 'e1', source: 'A', target: 'B' }],
      selectedNodeId: null,
      validationMessage: null,
    });

    useGraphStore.getState().onConnect({ source: 'B', target: 'A', sourceHandle: null, targetHandle: null });

    expect(useGraphStore.getState().validationMessage).toMatchObject({
      type: 'error',
      text: 'This connection creates a cycle and is not allowed.',
    });
  });
});
