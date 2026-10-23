import type { ExecutionEvent } from '../types';

interface ExecutionTimelineProps {
  events: ExecutionEvent[];
  // Node id -> current label, so events read as "Enrich Request failed" rather than raw ids.
  nodeLabels?: Record<string, string>;
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

const labelForEvent = (event: ExecutionEvent, nodeName: string) => {
  switch (event.type) {
    case 'run-created':
      return 'Run created';
    case 'run-started':
      return 'Run started';
    case 'run-cancelled':
      return 'Run cancelled';
    case 'run-terminal':
      return `Run ${event.status}`;
    case 'node-started':
      return `${nodeName} started`;
    case 'node-succeeded':
      return `${nodeName} succeeded`;
    case 'node-failed':
      return `${nodeName} failed`;
    case 'node-skipped':
      return `${nodeName} skipped`;
    case 'node-cancelled':
      return event.interrupted ? `${nodeName} interrupted` : `${nodeName} not started`;
    default:
      return 'Event';
  }
};

const eventTypeLabel = (event: ExecutionEvent) => {
  if (event.type === 'run-terminal') return 'Final';
  if (event.type === 'run-cancelled') return 'Cancelled';
  if (event.type === 'node-failed') return 'Failure';
  if (event.type === 'node-skipped') return 'Skipped';
  if (event.type === 'node-cancelled') return 'Cancelled';
  if (event.type === 'node-started') return 'Start';
  if (event.type === 'node-succeeded') return 'Success';
  return event.type.replace('run-', '').replace('node-', '');
};

const detailForEvent = (event: ExecutionEvent) => {
  if (event.type === 'node-failed') return event.reason ?? 'No error message provided.';
  if (event.type === 'node-skipped') return event.reason ?? 'A dependency did not succeed.';
  if (event.type === 'node-cancelled') {
    return event.interrupted ? 'Execution was aborted because the run was cancelled.' : 'The run was cancelled before this node started.';
  }
  return null;
};

export function ExecutionTimeline({ events, nodeLabels = {}, selectedEventId, onSelectEvent, onSelectNode }: ExecutionTimelineProps) {
  return (
    <div className="execution-timeline" aria-label="Execution timeline">
      {events.length === 0 ? (
        <p className="empty-state">No execution events yet. Click Run workflow to execute the graph on the server.</p>
      ) : (
        events.map((event) => {
          const isSelected = selectedEventId === event.id;
          const nodeName = event.nodeId ? nodeLabels[event.nodeId] ?? event.nodeId : '';
          const eventLabel = labelForEvent(event, nodeName);
          const detail = detailForEvent(event);
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
                {detail ? <small>{detail}</small> : null}
              </div>

              {isNodeEvent ? (
                <button
                  type="button"
                  className="timeline-focus-button"
                  aria-label={`Focus ${nodeName}`}
                  onClick={() => {
                    onSelectEvent(Number(event.id ?? event.sequence ?? 0));
                    onSelectNode(event.nodeId ?? null);
                  }}
                >
                  Focus node
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
