import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionTimeline } from './ExecutionTimeline';

describe('execution timeline', () => {
  it('focuses a node when a node-related event is selected', () => {
    const onSelectNode = vi.fn();

    render(
      <ExecutionTimeline
        events={[
          {
            id: 1,
            sequence: 1,
            type: 'run-created',
            timestamp: '2024-01-01T00:00:00.000Z',
            message: 'queued',
          },
          {
            id: 2,
            sequence: 2,
            type: 'node-started',
            timestamp: '2024-01-01T00:00:01.000Z',
            nodeId: 'alpha',
            runId: 'run-1',
          },
        ]}
        selectedEventId={null}
        onSelectEvent={vi.fn()}
        onSelectNode={onSelectNode}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /focus alpha/i }));

    expect(onSelectNode).toHaveBeenCalledWith('alpha');
  });

  it('names nodes by label and keeps skips, interruptions and never-started nodes distinct', () => {
    render(
      <ExecutionTimeline
        events={[
          { id: 1, sequence: 1, type: 'node-failed', timestamp: '2024-01-01T00:00:01.000Z', nodeId: 'enrich', reason: 'Simulated failure in "Enrich Request".' },
          { id: 2, sequence: 2, type: 'node-skipped', timestamp: '2024-01-01T00:00:01.000Z', nodeId: 'result', reason: 'Upstream node "Enrich Request" failed.' },
          { id: 3, sequence: 3, type: 'node-cancelled', timestamp: '2024-01-01T00:00:02.000Z', nodeId: 'validate', interrupted: true },
          { id: 4, sequence: 4, type: 'node-cancelled', timestamp: '2024-01-01T00:00:02.000Z', nodeId: 'report', interrupted: false },
        ]}
        nodeLabels={{ enrich: 'Enrich Request', result: 'Enriched Result', validate: 'Validate Request', report: 'Validation Result' }}
        selectedEventId={null}
        onSelectEvent={vi.fn()}
        onSelectNode={vi.fn()}
      />,
    );

    expect(screen.getByText('Enrich Request failed')).toBeInTheDocument();
    expect(screen.getByText('Simulated failure in "Enrich Request".')).toBeInTheDocument();
    expect(screen.getByText('Enriched Result skipped')).toBeInTheDocument();
    expect(screen.getByText('Upstream node "Enrich Request" failed.')).toBeInTheDocument();
    expect(screen.getByText('Validate Request interrupted')).toBeInTheDocument();
    expect(screen.getByText('Validation Result not started')).toBeInTheDocument();
    expect(screen.queryByText(/Validate Request skipped|Validation Result skipped/)).not.toBeInTheDocument();
  });
});
