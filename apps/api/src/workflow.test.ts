import { describe, expect, it } from 'vitest';
import { cancelRun, createRun, validateWorkflow } from './workflow.js';

const validGraph = {
  id: 'demo-workflow',
  name: 'Demo workflow',
  nodes: [
    {
      id: 'input-1',
      type: 'input',
      position: { x: 0, y: 0 },
      config: {
        label: 'Input',
        description: 'Starts the workflow',
        defaultValue: 'hello',
      },
    },
    {
      id: 'transform-1',
      type: 'transform',
      position: { x: 240, y: 0 },
      config: {
        label: 'Transform',
        description: 'Cleans the value',
        expression: 'value.trim()',
      },
    },
    {
      id: 'output-1',
      type: 'output',
      position: { x: 480, y: 0 },
      config: {
        label: 'Output',
        description: 'Emits the result',
        sink: 'console',
      },
    },
  ],
  edges: [
    { id: 'edge-1', source: 'input-1', target: 'transform-1' },
    { id: 'edge-2', source: 'transform-1', target: 'output-1' },
  ],
};

describe('workflow validation', () => {
  it('accepts a valid workflow', () => {
    const result = validateWorkflow(validGraph);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects cycles', () => {
    const input = {
      ...validGraph,
      edges: [
        { id: 'edge-1', source: 'input-1', target: 'transform-1' },
        { id: 'edge-2', source: 'transform-1', target: 'output-1' },
        { id: 'edge-3', source: 'output-1', target: 'input-1' },
      ],
    };

    const result = validateWorkflow(input);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === 'cycle-detected')).toBe(true);
  });

  it('detects invalid edge references', () => {
    const input = {
      ...validGraph,
      edges: [{ id: 'edge-1', source: 'missing-node', target: 'transform-1' }],
    };

    const result = validateWorkflow(input);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === 'invalid-edge-reference')).toBe(true);
  });

  it('detects invalid node directions', () => {
    const input = {
      ...validGraph,
      edges: [{ id: 'edge-1', source: 'transform-1', target: 'input-1' }],
    };

    const result = validateWorkflow(input);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === 'invalid-edge-direction')).toBe(true);
  });

  it('detects duplicate node ids', () => {
    const input = {
      ...validGraph,
      nodes: [
        ...validGraph.nodes,
        { id: 'input-1', type: 'input', position: { x: 20, y: 20 }, config: { label: 'Duplicate input', defaultValue: 'x' } },
      ],
    };

    const result = validateWorkflow(input);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === 'duplicate-node-id')).toBe(true);
  });

  it('reports run request errors with the offending node id instead of an array index', () => {
    const workflow = structuredClone(validGraph) as any;
    workflow.nodes[1].config.label = '';

    expect(() => createRun({ workflow })).toThrow(`node "${workflow.nodes[1].id}" config.label: String must contain at least 1 character(s)`);
  });

  it('uses a single canonical terminal event when a run is cancelled', () => {
    const run = {
      id: 'run-42',
      workflowId: 'demo-workflow',
      workflow: validGraph,
      status: 'running',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.500Z',
      metadata: {},
      events: [
        { type: 'run-created', timestamp: '2024-01-01T00:00:00.000Z', message: 'Workflow queued.' },
        { type: 'run-started', timestamp: '2024-01-01T00:00:00.250Z', runId: 'run-42' },
      ],
    };

    const result = cancelRun(run as any, { reason: 'Stopped by user' });

    expect(result.run.status).toBe('cancelled');
    expect(result.run.events.filter((event) => event.type === 'run-terminal')).toHaveLength(1);
    expect(result.run.events.filter((event) => event.type === 'run-cancelled')).toHaveLength(0);
  });
});
