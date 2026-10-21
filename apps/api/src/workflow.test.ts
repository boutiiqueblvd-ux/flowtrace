import { describe, expect, it } from 'vitest';
import { validateWorkflow } from './workflow.js';

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
});
