import { useEffect, useRef, useState } from 'react';
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
  const setExecutionStatus = useExecutionStore.getState().setStatus;
  const runRef = useRef<number | null>(null);
  const runCancelledRef = useRef(false);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  useEffect(() => {
    if (!validationMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      clearValidationMessage();
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [clearValidationMessage, validationMessage]);

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

  const handleRunWorkflow = () => {
    if (executionStatus === 'queued' || executionStatus === 'running') {
      return;
    }

    if (nodes.length === 0) {
      setExecutionStatus('idle');
      return;
    }

    runCancelledRef.current = false;
    const nodeOrder = [...nodes].map((node) => node.id);
    const totalSteps = Math.max(nodeOrder.length, 1);

    setExecutionStatus('queued');
    setSelectedNode(nodeOrder[0] ?? null);

    let stepIndex = 0;

    const tick = () => {
      if (runCancelledRef.current) {
        setExecutionStatus('cancelled');
        return;
      }

      const nextNodeId = nodeOrder[stepIndex];
      if (!nextNodeId) {
        setExecutionStatus('succeeded');
        return;
      }

      setSelectedNode(nextNodeId);
      setExecutionStatus('running');
      const failChance = 0.1;
      const shouldFail = Math.random() < failChance;

      const delayMs = 700 + ((stepIndex + 1) * 280);
      runRef.current = window.setTimeout(() => {
        if (runCancelledRef.current) {
          setExecutionStatus('cancelled');
          return;
        }

        if (shouldFail) {
          setExecutionStatus('failed');
          clearValidationMessage();
          return;
        }

        stepIndex += 1;

        if (stepIndex >= totalSteps) {
          setExecutionStatus('succeeded');
          return;
        }

        tick();
      }, delayMs);
    };

    tick();
  };

  const handleCancelWorkflow = () => {
    runCancelledRef.current = true;
    if (runRef.current) {
      window.clearTimeout(runRef.current);
      runRef.current = null;
    }
    setExecutionStatus('cancelled');
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
          {executionStatus === 'queued' || executionStatus === 'running' ? (
            <button type="button" className="warning-button" onClick={handleCancelWorkflow}>
              Cancel run
            </button>
          ) : (
            <button type="button" className="primary" onClick={handleRunWorkflow}>
              Run workflow
            </button>
          )}
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
