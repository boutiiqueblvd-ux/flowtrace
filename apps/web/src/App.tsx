import { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap, type Connection, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { ExecutionTimeline } from './components/ExecutionTimeline';
import { NodeInspectorPanel } from './components/NodeInspectorPanel';
import { Toolbar } from './components/Toolbar';
import { WorkflowNode } from './components/WorkflowNode';
import { useExecutionStore } from './store/executionStore';
import { useGraphStore } from './store/graphStore';
import type { ExecutionEvent, WorkflowNodeType } from './types';

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
  const [snapshot, setSnapshot] = useState(() => useExecutionStore.getState());

  useEffect(() => {
    const unsubscribe = useExecutionStore.subscribe((state) => {
      setSnapshot(state);
    });

    return unsubscribe;
  }, []);

  return snapshot;
}

export default function App() {
  const graph = useGraphSnapshot();
  const execution = useExecutionSnapshot();
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
  const applyRunSnapshot = useExecutionStore.getState().applyRunSnapshot;
  const appendEvent = useExecutionStore.getState().appendEvent;
  const setSelectedExecutionNode = useExecutionStore.getState().setSelectedNodeId;
  const runRef = useRef<number | null>(null);
  const runCancelledRef = useRef(false);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const selectedNodeData = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        executionStatus: execution.nodeStates[node.id]?.status ?? 'queued',
      },
    }));
  }, [execution.nodeStates, nodes]);

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
    if (execution.status === 'queued' || execution.status === 'running') {
      return;
    }

    if (nodes.length === 0) {
      setExecutionStatus('idle');
      return;
    }

    runCancelledRef.current = false;
    const runId = `run-${Date.now()}`;
    const now = new Date().toISOString();
    const events: ExecutionEvent[] = [
      { id: 1, sequence: 1, type: 'run-created', timestamp: now, message: 'Workflow queued for execution.', runId },
      { id: 2, sequence: 2, type: 'run-started', timestamp: new Date(Date.now() + 50).toISOString(), runId },
    ];

    nodes.forEach((node, index) => {
      events.push({
        id: 3 + index * 2,
        sequence: 3 + index * 2,
        type: 'node-started',
        timestamp: new Date(Date.now() + 100 + index * 250).toISOString(),
        nodeId: node.id,
        runId,
      });

      events.push({
        id: 4 + index * 2,
        sequence: 4 + index * 2,
        type: 'node-succeeded',
        timestamp: new Date(Date.now() + 450 + index * 250).toISOString(),
        nodeId: node.id,
        runId,
        output: { value: `processed-${node.id}` },
      });
    });

    events.push({
      id: events.length + 1,
      sequence: events.length + 1,
      type: 'run-terminal',
      timestamp: new Date(Date.now() + 800).toISOString(),
      status: 'succeeded',
      runId,
    });

    applyRunSnapshot({ id: runId, workflowId: 'workflow-1', status: 'succeeded', events });
    setExecutionStatus('succeeded');
    setSelectedNode(nodes[0]?.id ?? null);
    setSelectedExecutionNode(nodes[0]?.id ?? null);
  };

  const handleCancelWorkflow = () => {
    runCancelledRef.current = true;
    if (runRef.current) {
      window.clearTimeout(runRef.current);
      runRef.current = null;
    }

    if (execution.selectedRunId) {
      appendEvent({
        id: (execution.events.at(-1)?.id ?? execution.lastSequence) + 1,
        sequence: execution.lastSequence + 1,
        type: 'run-cancelled',
        timestamp: new Date().toISOString(),
        reason: 'Cancelled by operator.',
        runId: execution.selectedRunId,
      });
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
          {execution.status === 'queued' || execution.status === 'running' ? (
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
                nodes={selectedNodeData as Node[]}
                edges={edges as Edge[]}
                nodeTypes={nodeTypes}
                fitView
                onNodesChange={setNodes}
                onEdgesChange={setEdges}
                onConnect={handleConnect}
                onNodeClick={(_, node) => {
                  setSelectedNode(node.id);
                  setSelectedEdge(null);
                  setSelectedExecutionNode(node.id);
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

          <div className="execution-inspector">
            <div className="execution-inspector__header">
              <h3>Execution timeline</h3>
              <span>{execution.events.length} events</span>
            </div>
            <ExecutionTimeline
              events={execution.events}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
              onSelectNode={(nodeId) => {
                setSelectedNode(nodeId);
                setSelectedExecutionNode(nodeId);
              }}
            />
          </div>
        </section>

        <NodeInspectorPanel
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          executionInfo={selectedNodeId ? execution.nodeStates[selectedNodeId] ?? null : null}
          onChange={updateNode}
          onDeleteNode={deleteNode}
          onDeleteEdge={deleteEdge}
        />
      </main>

      <footer className="statusbar">
        <span>Execution status</span>
        <strong>{execution.status}</strong>
      </footer>
    </div>
  );
}
