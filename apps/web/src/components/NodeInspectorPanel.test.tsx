import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { describeNodeStatus } from '../executionStatus';
import type { GraphNode, NodeExecutionInfo } from '../types';
import { NodeInspectorPanel } from './NodeInspectorPanel';

const node: GraphNode = { id: 'enrich', type: 'workflowNode', position: { x: 0, y: 0 }, data: { kind: 'transform', label: 'Enrich Request', description: '' } };

const renderInspector = (info: NodeExecutionInfo) => render(
  <NodeInspectorPanel
    selectedNode={node}
    selectedEdge={null}
    executionInfo={info}
    statusView={describeNodeStatus(info, 'cancelled')}
    onChange={vi.fn()}
    onUpdateEdge={vi.fn()}
    onDeleteNode={vi.fn()}
    onDeleteEdge={vi.fn()}
  />,
);

describe('NodeInspectorPanel', () => {
  it('explains an interrupted node with the cancel reason, not as a dependency skip', () => {
    renderInspector({ nodeId: 'enrich', status: 'cancelled', interrupted: true, cancelReason: 'Cancelled by operator.', durationMs: 1200 });

    expect(screen.getAllByText('Interrupted').length).toBeGreaterThan(0);
    expect(screen.getByText('Stopped while running because the run was cancelled.')).toBeInTheDocument();
    expect(screen.getByText('Cancel reason: Cancelled by operator.')).toBeInTheDocument();
    expect(screen.getByText('1200 ms')).toBeInTheDocument();
    expect(screen.queryByText(/upstream|dependency/i)).not.toBeInTheDocument();
  });

  it('shows the error for a failed node and states that configuration is not evaluated', () => {
    renderInspector({ nodeId: 'enrich', status: 'failed', error: 'Simulated failure in "Enrich Request" (10% failure rate).' });

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Simulated failure in "Enrich Request" (10% failure rate).')).toBeInTheDocument();
    expect(screen.getByText(/sent with each run but not evaluated/i)).toBeInTheDocument();
  });
});
