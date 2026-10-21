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
});
