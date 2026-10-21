import { useEffect, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap, type Connection, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { NodeInspectorPanel } from './components/NodeInspectorPanel';
import { Toolbar } from './components/Toolbar';
import { WorkflowNode } from './components/WorkflowNode';
import { useExecutionStore } from './store/executionStore';
import { useGraphStore } from './store/graphStore';
import type { WorkflowNodeType } from './types';

const nodeTypes = {
  workflowNode: WorkflowNode,
} as const;

function useGraphSnapshot() {
  const [snapshot, setSnapshot] = useState(() => useGraphStore.getState());

  useEffect(() => {
    const unsubscribe = useGraphStore.subscribe((state) => {
      setSnapshot(state);
    });

    return unsubscribe;
  }, []);

  return snapshot;
}

function useExecutionSnapshot() {
  const [status, setStatus] = useState(() => useExecutionStore.getState().status);

  useEffect(() => {
    const unsubscribe = useExecutionStore.subscribe((state) => {
      setStatus(state.status);
    });

    return unsubscribe;
  }, []);

  return status;
}

export default function App() {
  const graph = useGraphSnapshot();
  const executionStatus = useExecutionSnapshot();
  const nodes = graph.nodes;
  const edges = graph.edges;
  const selectedNodeId = graph.selectedNodeId;
  const selectedEdgeId = graph.selectedEdgeId;
  const validationMessage = graph.validationMessage;
  const addNode = useGraphStore.getState().addNode;
  const setSelectedNode = useGraphStore.getState().setSelectedNode;
  const setSelectedEdge = useGraphStore.getState().setSelectedEdge;
  const setNodes = useGraphStore.getState().setNodes;
  const setEdges = useGraphStore.getState().setEdges;
  const onConnect = useGraphStore.getState().onConnect;
  const updateNode = useGraphStore.getState().updateNode;
  const deleteNode = useGraphStore.getState().deleteNode;
  const deleteEdge = useGraphStore.getState().deleteEdge;
  const clearValidationMessage = useGraphStore.getState().clearValidationMessage;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedNode(null);
        setSelectedEdge(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSelectedEdge, setSelectedNode]);

  const handleAddNode = (kind: WorkflowNodeType) => {
    addNode(kind);
  };

  const handleConnect = (connection: Connection) => {
    onConnect(connection);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Workflow Studio</p>
          <h1>FlowTrace</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={clearValidationMessage}>Clear feedback</button>
          <button type="button" className="primary">
            Run workflow
          </button>
        </div>
      </header>

      <main className="workspace">
        <Toolbar onAddNode={handleAddNode} />

        <section className="canvas-panel">
          <div className="canvas-header">
            <span>Workflow canvas</span>
            <span>{nodes.length} nodes</span>
          </div>

          <div className="canvas-surface">
            {nodes.length === 0 ? (
              <div className="empty-state-card">
                <h3>Start your workflow</h3>
                <p>Add an input, transform, or output node to begin modeling your process.</p>
              </div>
            ) : (
              <ReactFlow
                nodes={nodes as Node[]}
                edges={edges as Edge[]}
                nodeTypes={nodeTypes}
                fitView
                onNodesChange={setNodes}
                onEdgesChange={setEdges}
                onConnect={handleConnect}
                onNodeClick={(_, node) => {
                  setSelectedNode(node.id);
                  setSelectedEdge(null);
                }}
                onEdgeClick={(_, edge) => {
                  setSelectedNode(null);
                  setSelectedEdge(edge.id);
                }}
                onPaneClick={() => {
                  setSelectedNode(null);
                  setSelectedEdge(null);
                }}
                deleteKeyCode={['Delete', 'Backspace']}
                selectionKeyCode="Escape"
              >
                <Background />
                <MiniMap />
                <Controls />
              </ReactFlow>
            )}

            {validationMessage && (
              <div className={`validation-banner ${validationMessage.type}`}>
                {validationMessage.text}
              </div>
            )}
          </div>
        </section>

        <NodeInspectorPanel
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onChange={updateNode}
          onDeleteNode={deleteNode}
          onDeleteEdge={deleteEdge}
        />
      </main>

      <footer className="statusbar">
        <span>Execution status</span>
        <strong>{executionStatus}</strong>
      </footer>
    </div>
  );
}
