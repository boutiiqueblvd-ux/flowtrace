import type { GraphEdge, GraphNode } from '../types';

interface NodeInspectorPanelProps {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  onChange: (nodeId: string, updates: Partial<GraphNode['data']>) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

export function NodeInspectorPanel({
  selectedNode,
  selectedEdge,
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
          <h3>Configuration</h3>
          <p className="empty-state">Select a node to edit its settings.</p>
        </div>
      </aside>
    );
  }

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
