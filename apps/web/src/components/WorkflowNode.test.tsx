import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { describe, expect, it } from 'vitest';
import { WorkflowNode } from './WorkflowNode';

const renderNode = (data: ComponentProps<typeof WorkflowNode>['data']) => {
  const props = { id: 'n1', data, selected: false, type: 'workflowNode', zIndex: 0, isConnectable: true, xPos: 0, yPos: 0, dragging: false } as ComponentProps<typeof WorkflowNode>;
  return render(
    <ReactFlowProvider>
      <WorkflowNode {...props} />
    </ReactFlowProvider>,
  );
};

describe('WorkflowNode', () => {
  it('shows the execution status on the canvas node', () => {
    const { container } = renderNode({ kind: 'transform', label: 'Enrich Request', description: '', executionLabel: 'Failed', executionTone: 'failed' });

    expect(screen.getByText('Failed')).toHaveClass('status-failed');
    expect(container.querySelector('.workflow-node')).toHaveClass('tone-failed');
  });

  it('shows no status badge before any run', () => {
    renderNode({ kind: 'input', label: 'Customer Request', description: '' });

    expect(screen.queryByText(/queued|running|failed/i)).not.toBeInTheDocument();
  });
});
