import { describe, expect, it } from 'vitest';
import { describeNodeStatus } from './executionStatus';

describe('describeNodeStatus', () => {
  it('distinguishes dependency skips from cancellation outcomes', () => {
    const skipped = describeNodeStatus({ nodeId: 'a', status: 'skipped', skipReason: 'Upstream node "Enrich Request" failed.' }, 'failed');
    const interrupted = describeNodeStatus({ nodeId: 'b', status: 'cancelled', interrupted: true, cancelReason: 'Cancelled by operator.' }, 'cancelled');
    const notStarted = describeNodeStatus({ nodeId: 'c', status: 'cancelled', interrupted: false, cancelReason: 'Cancelled by operator.' }, 'cancelled');

    expect(skipped).toEqual({ tone: 'skipped', label: 'Skipped', detail: 'Not run: Upstream node "Enrich Request" failed.' });
    expect(interrupted).toMatchObject({ tone: 'cancelled', label: 'Interrupted' });
    expect(notStarted).toMatchObject({ tone: 'cancelled', label: 'Not started' });
    expect(interrupted.detail).not.toMatch(/dependency|upstream/i);
    expect(notStarted.detail).not.toMatch(/dependency|upstream/i);
  });

  it('shows failures with their error message', () => {
    expect(describeNodeStatus({ nodeId: 'a', status: 'failed', error: 'Simulated failure in "A".' }, 'running')).toEqual({
      tone: 'failed',
      label: 'Failed',
      detail: 'Simulated failure in "A".',
    });
  });

  it('describes nodes without events according to the run state', () => {
    expect(describeNodeStatus(undefined, 'running')).toMatchObject({ tone: 'queued', label: 'Queued' });
    expect(describeNodeStatus(undefined, 'idle')).toMatchObject({ tone: 'idle', label: 'Not run' });
    expect(describeNodeStatus(undefined, 'succeeded')).toMatchObject({ tone: 'idle', label: 'Not in last run' });
  });
});
