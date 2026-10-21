import type { GraphEdge, GraphNode, NodeExecutionInfo } from '../types';

interface NodeInspectorPanelProps {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  executionInfo: NodeExecutionInfo | null;
  onChange: (nodeId: string, updates: Partial<GraphNode['data']>) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

const formatStatus = (status: string | undefined) => (status ? status.replace(/-/g, ' ') : 'Not run');

export function NodeInspectorPanel({
  selectedNode,
  selectedEdge,
  executionInfo,
  onChange,
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
          <p className="empty-state">From {selectedEdge.source} to {selectedEdge.target}</p>
        </div>
      </aside>
    );
  }

  if (!selectedNode) {
    return (
      <aside className="sidebar-panel">
        <div className="panel-section">
          <h3>Execution details</h3>
          <p className="empty-state">Select a node to inspect its execution state.</p>
        </div>
      </aside>
    );
  }

  const statusText = executionInfo ? formatStatus(executionInfo.status) : 'Not run yet';

  return (
    <aside className="sidebar-panel">
      <div className="panel-section panel-section--tight">
        <div className="panel-heading">
          <h3>{selectedNode.data.label}</h3>
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
            <strong>{statusText}</strong>
          </div>
          <div>
            <span className="meta-label">Duration</span>
            <strong>{executionInfo?.durationMs ? `${executionInfo.durationMs} ms` : 'Not available'}</strong>
          </div>
        </div>

        {executionInfo?.error ? (
          <div className="execution-detail error-detail">
            <h4>Error</h4>
            <p>{executionInfo.error}</p>
          </div>
        ) : null}

        {executionInfo?.skipReason ? (
          <div className="execution-detail warning-detail">
            <h4>Skipped</h4>
            <p>{executionInfo.skipReason}</p>
          </div>
        ) : null}

        {executionInfo?.output !== undefined ? (
          <div className="execution-detail">
            <h4>Output</h4>
            <pre>{typeof executionInfo.output === 'string' ? executionInfo.output : JSON.stringify(executionInfo.output, null, 2)}</pre>
          </div>
        ) : (
          <div className="execution-detail muted-detail">
            <h4>Output</h4>
            <p>No output recorded yet for this node.</p>
          </div>
        )}
      </div>

      <div className="panel-section">
        <label>
          Label
          <input
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
            value={selectedNode.data.description}
            onChange={(event) =>
              onChange(selectedNode.id, {
                description: event.target.value,
              })
            }
          />
        </label>
      </div>
    </aside>
  );
}
