import type { NodeStatusView } from '../executionStatus';
import type { GraphEdge, GraphNode, NodeExecutionInfo } from '../types';

interface NodeInspectorPanelProps {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  executionInfo: NodeExecutionInfo | null;
  statusView: NodeStatusView | null;
  onChange: (nodeId: string, updates: Partial<GraphNode['data']>) => void;
  onUpdateEdge: (edgeId: string, updates: Partial<GraphEdge>) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

export function NodeInspectorPanel({
  selectedNode,
  selectedEdge,
  executionInfo,
  statusView,
  onChange,
  onUpdateEdge,
  onDeleteNode,
  onDeleteEdge,
}: NodeInspectorPanelProps) {
  if (selectedEdge) {
    return (
      <aside className="sidebar-panel">
        <div className="panel-section panel-section--tight">
          <div className="panel-heading">
            <h3>Connection</h3>
            <button type="button" className="danger-button" onClick={() => onDeleteEdge(selectedEdge.id)}>
              Remove edge
            </button>
          </div>
        </div>

        <div className="panel-section">
          <p className="empty-state">{selectedEdge.source} → {selectedEdge.target}</p>
        </div>

        <div className="panel-section">
          <label>
            Label
            <input
              value={selectedEdge.label ?? ''}
              onChange={(event) =>
                onUpdateEdge(selectedEdge.id, {
                  label: event.target.value,
                })
              }
              placeholder="e.g. Request"
            />
          </label>

          <label>
            Comment
            <textarea
              value={selectedEdge.comment ?? ''}
              onChange={(event) =>
                onUpdateEdge(selectedEdge.id, {
                  comment: event.target.value,
                })
              }
              placeholder="Add a note about this handoff."
            />
          </label>
          <p className="field-note">Labels and comments are annotations. Every connection always runs; there is no conditional branching.</p>
        </div>
      </aside>
    );
  }

  if (!selectedNode) {
    return (
      <aside className="sidebar-panel">
        <div className="panel-section">
          <h3>Execution details</h3>
          <p className="empty-state">Select a node on the canvas or in the timeline to see its execution status and details.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar-panel">
      <div className="panel-section panel-section--tight">
        <div className="panel-heading">
          <div>
            <span className="panel-label">Node</span>
            <h3>{selectedNode.data.label}</h3>
          </div>
          <button type="button" className="danger-button" onClick={() => onDeleteNode(selectedNode.id)}>
            Delete
          </button>
        </div>
      </div>

      <div className="panel-section">
        <div className="execution-summary">
          <div>
            <span className="meta-label">Type</span>
            <strong>{selectedNode.data.kind}</strong>
          </div>
          <div>
            <span className="meta-label">Status</span>
            <strong className={`status-text status-text-${statusView?.tone ?? 'idle'}`}>{statusView?.label ?? 'Not run'}</strong>
          </div>
          <div>
            <span className="meta-label">Duration</span>
            <strong>{executionInfo?.durationMs !== undefined ? `${executionInfo.durationMs} ms` : '—'}</strong>
          </div>
        </div>

        {statusView?.detail ? (
          <div className={`execution-detail ${statusView.tone === 'failed' ? 'error-detail' : statusView.tone === 'skipped' || statusView.tone === 'cancelled' ? 'warning-detail' : 'muted-detail'}`}>
            <h4>{statusView.tone === 'failed' ? 'Error' : statusView.label}</h4>
            <p>{statusView.detail}</p>
            {executionInfo?.cancelReason ? <p>Cancel reason: {executionInfo.cancelReason}</p> : null}
          </div>
        ) : null}

        {executionInfo?.output !== undefined ? (
          <div className="execution-detail">
            <h4>Output</h4>
            <pre>{typeof executionInfo.output === 'string' ? executionInfo.output : JSON.stringify(executionInfo.output, null, 2)}</pre>
          </div>
        ) : null}
      </div>

      <div className="panel-section">
        <label>
          Label
          <input
            maxLength={80}
            value={selectedNode.data.label}
            onChange={(event) =>
              onChange(selectedNode.id, {
                label: event.target.value,
              })
            }
          />
        </label>

        <label>
          Description
          <textarea
            maxLength={250}
            value={selectedNode.data.description}
            onChange={(event) =>
              onChange(selectedNode.id, {
                description: event.target.value,
              })
            }
          />
        </label>
        <p className="field-note">
          Label and description are sent with each run but not evaluated. Execution is simulated: each node runs for 0.5–3 s and
          fails at random 10% of the time.
        </p>
      </div>
    </aside>
  );
}
