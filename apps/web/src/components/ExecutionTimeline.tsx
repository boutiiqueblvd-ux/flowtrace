import type { ExecutionEvent } from '../types';

interface ExecutionTimelineProps {
  events: ExecutionEvent[];
  selectedEventId: number | null;
  onSelectEvent: (eventId: number | null) => void;
  onSelectNode: (nodeId: string | null) => void;
}

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const labelForEvent = (event: ExecutionEvent) => {
  if (event.type === 'run-terminal') {
    return `Run ${event.status}`;
  }

  if (event.type === 'run-created') {
    return 'Run created';
  }

  if (event.type === 'run-started') {
    return 'Run started';
  }

  if (event.type === 'run-cancelled') {
    return 'Run cancelled';
  }

  if (event.type === 'node-started') {
    return `Node ${event.nodeId} started`;
  }

  if (event.type === 'node-succeeded') {
    return `Node ${event.nodeId} succeeded`;
  }

  if (event.type === 'node-failed') {
    return `Node ${event.nodeId} failed`;
  }

  if (event.type === 'node-skipped') {
    return `Node ${event.nodeId} skipped`;
  }

  return 'Event';
};

const eventTypeLabel = (event: ExecutionEvent) => {
  if (event.type === 'run-terminal') return 'Final';
  if (event.type === 'run-cancelled') return 'Cancelled';
  if (event.type === 'node-failed') return 'Failure';
  if (event.type === 'node-skipped') return 'Skipped';
  if (event.type === 'node-started') return 'Start';
  if (event.type === 'node-succeeded') return 'Success';
  return event.type.replace('run-', '').replace('node-', '');
};

export function ExecutionTimeline({ events, selectedEventId, onSelectEvent, onSelectNode }: ExecutionTimelineProps) {
  return (
    <div className="execution-timeline" aria-label="Execution timeline">
      {events.length === 0 ? (
        <p className="empty-state">No execution events yet.</p>
      ) : (
        events.map((event) => {
          const isSelected = selectedEventId === event.id;
          const eventLabel = labelForEvent(event);
          const isNodeEvent = Boolean(event.nodeId);
          const isErrorEvent = event.type === 'node-failed' || (event.type === 'run-terminal' && event.status === 'failed') || event.type === 'run-cancelled';

          return (
            <div
              key={event.id ?? `${event.type}-${event.timestamp}`}
              className={`timeline-event ${isSelected ? 'selected' : ''} ${isErrorEvent ? 'error' : ''}`}
            >
              <div className="timeline-meta">
                <span>{formatTimestamp(event.timestamp)}</span>
                <span className="timeline-tag">{eventTypeLabel(event)}</span>
              </div>

              <div className="timeline-body">
                <strong>{eventLabel}</strong>
                {event.type === 'node-failed' || event.type === 'node-skipped' ? (
                  <small>{event.reason ?? 'No reason provided.'}</small>
                ) : null}
                {event.type === 'run-terminal' ? (
                  <small>Final status: {event.status}</small>
                ) : null}
              </div>

              {isNodeEvent ? (
                <button
                  type="button"
                  className="timeline-focus-button"
                  aria-label={`Focus ${event.nodeId}`}
                  onClick={() => {
                    onSelectEvent(Number(event.id ?? event.sequence ?? 0));
                    onSelectNode(event.nodeId ?? null);
                  }}
                >
                  Focus {event.nodeId}
                </button>
              ) : (
                <button
                  type="button"
                  className="timeline-focus-button"
                  aria-label={`Focus event ${event.id ?? event.sequence}`}
                  onClick={() => onSelectEvent(Number(event.id ?? event.sequence ?? 0))}
                >
                  Select event
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
