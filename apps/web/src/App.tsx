import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import ReactFlow, { Background, Controls, MiniMap, type Connection, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { ExecutionTimeline } from './components/ExecutionTimeline';
import { NodeInspectorPanel } from './components/NodeInspectorPanel';
import { followRunStream } from './runStream';
import { Toolbar } from './components/Toolbar';
import { WorkflowNode } from './components/WorkflowNode';
import { useExecutionStore } from './store/executionStore';
import { useGraphStore } from './store/graphStore';
import type { ExecutionEvent, GraphNode, WorkflowNodeType } from './types';

const nodeTypes = {
  workflowNode: WorkflowNode,
} as const;

const API_BASE_URL = 'http://localhost:3001';

const buildWorkflowPayload = (sourceNodes: GraphNode[], sourceEdges: ReturnType<typeof useGraphStore.getState>['edges']) => ({
  id: `workflow-${Date.now()}`,
  name: 'Current workflow',
  nodes: sourceNodes.map((node) => ({
    id: node.id,
    type: node.data.kind,
    position: {
      x: Number(node.position.x),
      y: Number(node.position.y),
    },
    config: {
      label: node.data.label,
      description: node.data.description,
      ...(node.data.kind === 'input' ? { defaultValue: '' } : {}),
      ...(node.data.kind === 'transform' ? { expression: 'value' } : {}),
      ...(node.data.kind === 'output' ? { sink: 'console' } : {}),
    },
  })),
  edges: sourceEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  })),
});

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
  const updateEdge = useGraphStore.getState().updateEdge;
  const deleteNode = useGraphStore.getState().deleteNode;
  const deleteEdge = useGraphStore.getState().deleteEdge;
  const clearAllNodes = useGraphStore.getState().clearAllNodes;
  const clearValidationMessage = useGraphStore.getState().clearValidationMessage;
  const setExecutionStatus = useExecutionStore.getState().setStatus;
  const applyRunSnapshot = useExecutionStore.getState().applyRunSnapshot;
  const appendEvent = useExecutionStore.getState().appendEvent;
  const setSelectedExecutionNode = useExecutionStore.getState().setSelectedNodeId;
  const runRef = useRef<number | null>(null);
  const runCancelledRef = useRef(false);
  const streamControllerRef = useRef<AbortController | null>(null);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [leftWidth, setLeftWidth] = useState(260);
  const [timelineWidth, setTimelineWidth] = useState(330);
  const dragRef = useRef<{ type: 'left' | 'timeline'; startX: number; startValue: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const isRunActive = execution.status === 'queued' || execution.status === 'running';
  const executionStatusLabel = execution.status === 'idle' ? 'Not started' : execution.status === 'queued' ? 'Queued' : execution.status === 'running' ? 'Running' : execution.status === 'succeeded' ? 'Succeeded' : execution.status === 'failed' ? 'Failed' : 'Cancelled';
  const shellStyle = useMemo<CSSProperties>(
    () => ({
      ['--left-width' as string]: `${leftWidth}px`,
      ['--timeline-width' as string]: `${timelineWidth}px`,
    }),
    [leftWidth, timelineWidth],
  );
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
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragRef.current) {
        return;
      }

      const delta = event.clientX - dragRef.current.startX;

      if (dragRef.current.type === 'left') {
        setLeftWidth(Math.min(420, Math.max(180, dragRef.current.startValue + delta)));
      }

      if (dragRef.current.type === 'timeline') {
        setTimelineWidth(Math.min(420, Math.max(240, dragRef.current.startValue - delta)));
      }
    };

    const handleMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSelectAll = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a';

      if (isSelectAll) {
        event.preventDefault();
        if (nodes.length === 0) {
          return;
        }

        useGraphStore.setState((state) => ({
          nodes: state.nodes.map((node) => ({ ...node, selected: true })),
          selectedNodeId: state.nodes[0]?.id ?? null,
          selectedEdgeId: null,
        }));
        return;
      }

      if (event.key === 'Escape') {
        setSelectedNode(null);
        setSelectedEdge(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nodes.length, setSelectedEdge, setSelectedNode]);

  const normalizeImportedWorkflow = (workflow: any) => {
    const importedNodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    const importedEdges = Array.isArray(workflow?.edges) ? workflow.edges : [];

    const nextNodes: GraphNode[] = importedNodes.map((node: any, index: number) => ({
      id: String(node?.id ?? `node-${index + 1}`),
      type: 'workflowNode',
      position: {
        x: Number.isFinite(node?.position?.x) ? Number(node.position.x) : 160 + (index % 3) * 220,
        y: Number.isFinite(node?.position?.y) ? Number(node.position.y) : 120 + Math.floor(index / 3) * 200,
      },
      data: {
        kind: ['input', 'transform', 'output'].includes(node?.type) ? node.type : 'transform',
        label: node?.config?.label ?? String(node?.id ?? `Node ${index + 1}`),
        description: node?.config?.description ?? 'Imported workflow node.',
      },
    }));

    const nextEdges = importedEdges.map((edge: any, index: number) => ({
      id: String(edge?.id ?? `edge-${index + 1}`),
      source: String(edge?.source ?? ''),
      target: String(edge?.target ?? ''),
      label: String(edge?.label ?? (edge?.branch === 'yes' ? 'Yes' : edge?.branch === 'no' ? 'No' : 'Continue')),
      comment: typeof edge?.comment === 'string' ? edge.comment : '',
      branch: edge?.branch === 'yes' || edge?.branch === 'no' ? edge.branch : undefined,
    }));

    return { nodes: nextNodes, edges: nextEdges };
  };

  const loadWorkflow = (workflow: any) => {
    const { nodes: nextNodes, edges: nextEdges } = normalizeImportedWorkflow(workflow);
    useGraphStore.setState({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: nextNodes[0]?.id ?? null,
      selectedEdgeId: null,
      validationMessage: {
        type: 'info',
        text: `Loaded workflow "${workflow?.name ?? workflow?.id ?? 'sample'}".`,
      },
    });
  };

  const handleAddNode = (kind: WorkflowNodeType) => {
    addNode(kind);
  };

  const handleClearAllNodes = () => {
    clearAllNodes();
  };

  const handleExportWorkflow = () => {
    const workflow = {
      id: `${(graph.nodes[0]?.id ?? 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'flowtrace-workflow'}-${Date.now()}`,
      name: 'FlowTrace sample workflow',
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.data.kind,
        position: {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        },
        config: {
          label: node.data.label,
          description: node.data.description,
          ...(node.data.kind === 'input' ? { defaultValue: '' } : {}),
          ...(node.data.kind === 'transform' ? { expression: 'value' } : {}),
          ...(node.data.kind === 'output' ? { sink: 'console' } : {}),
        },
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label ?? (edge.branch === 'yes' ? 'Yes' : edge.branch === 'no' ? 'No' : 'Continue'),
        comment: edge.comment ?? '',
        branch: edge.branch,
      })),
    };

    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'flowtrace-workflow'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);

    useGraphStore.setState({
      validationMessage: { type: 'info', text: 'Workflow exported as JSON.' },
    });
  };

  const handleImportWorkflow = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      loadWorkflow(parsed);
    } catch (error) {
      useGraphStore.setState({
        validationMessage: { type: 'error', text: 'That file is not a valid FlowTrace workflow JSON file.' },
      });
    }

    event.target.value = '';
  };

  const handleLoadSampleWorkflow = async () => {
    streamControllerRef.current?.abort();
    useExecutionStore.setState({
      status: 'idle',
      selectedRunId: null,
      lastSequence: 0,
      events: [],
      nodeStates: {},
      selectedNodeId: null,
    });

    try {
      const response = await fetch('/sample-workflow.json');
      if (!response.ok) {
        throw new Error('Sample file not found.');
      }

      const parsed = await response.json();
      loadWorkflow(parsed);
    } catch (error) {
      useGraphStore.setState({
        validationMessage: { type: 'error', text: 'Unable to load the sample workflow file.' },
      });
    }
  };

  const handleConnect = (connection: Connection) => {
    onConnect(connection);
  };

  const loadRunStream = async (runId: string) => {
    streamControllerRef.current?.abort();
    const controller = new AbortController();
    streamControllerRef.current = controller;

    // Read the cursor and status from the store, not the render closure, so a new run
    // never resumes from the previous run's sequence.
    const outcome = await followRunStream({
      apiBaseUrl: API_BASE_URL,
      runId,
      signal: controller.signal,
      getCursor: () => useExecutionStore.getState().lastSequence,
      isFinished: () => ['succeeded', 'failed', 'cancelled'].includes(useExecutionStore.getState().status),
      onEvent: appendEvent,
    });

    if (outcome === 'not-found') {
      useGraphStore.setState({
        validationMessage: { type: 'error', text: 'This run no longer exists on the server.' },
      });
      setExecutionStatus('failed');
    }
  };

  const handleRunWorkflow = async () => {
    if (execution.status === 'queued' || execution.status === 'running') {
      return;
    }

    if (nodes.length === 0) {
      setExecutionStatus('idle');
      return;
    }

    runCancelledRef.current = false;
    const workflow = buildWorkflowPayload(nodes, edges);

    try {
      const response = await fetch(`${API_BASE_URL}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: 'Run request failed.' }));
        throw new Error(errorBody.error || 'Run request failed.');
      }

      const payload = await response.json() as { run: { id: string; workflowId: string; status: string; events: ExecutionEvent[] } };
      const run = payload.run;
      applyRunSnapshot({
        id: run.id,
        workflowId: run.workflowId,
        status: run.status,
        events: run.events,
      });
      setExecutionStatus(run.status === 'queued' ? 'queued' : run.status === 'running' ? 'running' : run.status === 'failed' ? 'failed' : run.status === 'cancelled' ? 'cancelled' : 'succeeded');
      setSelectedNode(nodes[0]?.id ?? null);
      setSelectedExecutionNode(nodes[0]?.id ?? null);

      if (runRef.current) {
        window.clearTimeout(runRef.current);
      }

      void loadRunStream(run.id);
    } catch (error) {
      console.error('Run request failed', error);
      useGraphStore.setState({
        validationMessage: { type: 'error', text: error instanceof Error ? error.message : 'Unable to start workflow execution.' },
      });
      setExecutionStatus('failed');
    }
  };

  const handleCancelWorkflow = async () => {
    if (!execution.selectedRunId) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/runs/${execution.selectedRunId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by operator.' }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: 'Cancel request failed.' }));
        throw new Error(errorBody.error || 'Cancel request failed.');
      }

      // The stream delivers the cancellation events and then closes; applying the snapshot
      // just makes the result visible immediately. Status comes from the run's own events.
      const payload = await response.json() as { run: { id: string; workflowId: string; status: string; events: ExecutionEvent[] } };
      applyRunSnapshot({
        id: payload.run.id,
        workflowId: payload.run.workflowId,
        status: payload.run.status,
        events: payload.run.events,
      });
      runCancelledRef.current = true;
    } catch (error) {
      console.error('Cancel request failed', error);
      useGraphStore.setState({
        validationMessage: { type: 'error', text: error instanceof Error ? error.message : 'Unable to cancel workflow execution.' },
      });
    }
  };

  const beginResize = (type: 'left' | 'timeline', event: React.MouseEvent<HTMLDivElement>) => {
    dragRef.current = {
      type,
      startX: event.clientX,
      startValue: type === 'left' ? leftWidth : timelineWidth,
    };
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-main">
          <p className="eyebrow">Workflow Studio</p>
          <div className="title-row">
            <h1>FlowTrace</h1>
            <span className={`status-pill status-${execution.status}`}>{executionStatusLabel}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="secondary-button" onClick={() => importInputRef.current?.click()}>
            Import workflow
          </button>
          <button type="button" className="secondary-button" onClick={handleExportWorkflow}>
            Export workflow
          </button>
          <button type="button" className="secondary-button" onClick={handleLoadSampleWorkflow}>
            Load sample
          </button>
          <button type="button" className="secondary-button" onClick={clearValidationMessage}>
            Clear feedback
          </button>
          <button type="button" className="secondary-button" onClick={handleClearAllNodes}>
            Clear all
          </button>
          {isRunActive ? (
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

      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={handleImportWorkflow}
      />

      <main className="workspace" style={shellStyle}>
        <div className="left-panel">
          <Toolbar onAddNode={handleAddNode} />
          <div className="left-panel__inspector">
            <NodeInspectorPanel
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              executionInfo={selectedNodeId ? execution.nodeStates[selectedNodeId] ?? null : null}
              onChange={updateNode}
              onUpdateEdge={updateEdge}
              onDeleteNode={deleteNode}
              onDeleteEdge={deleteEdge}
            />
          </div>
        </div>

        <div
          className="resizer resizer-toolbar"
          onMouseDown={(event) => beginResize('left', event)}
          aria-label="Resize left sidebar"
          role="separator"
        />

        <section className="canvas-panel main-stage-panel">
          <div className="canvas-header">
            <div>
              <span className="panel-label">Workflow canvas</span>
              <strong>{nodes.length} nodes</strong>
            </div>
            <span className="canvas-summary">{edges.length} connections</span>
          </div>

          <div className="canvas-surface">
            {nodes.length === 0 ? (
              <div className="empty-state-card">
                <div className="empty-state-icon">+</div>
                <h3>Start your workflow</h3>
                <p>Add an input, transform, or output node to define the flow and begin execution.</p>
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
        </section>

        <div
          className="resizer resizer-timeline"
          onMouseDown={(event) => beginResize('timeline', event)}
          aria-label="Resize timeline"
          role="separator"
        />

        <aside className="timeline-panel">
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
        </aside>
      </main>

      <footer className="statusbar">
        <span>Execution status</span>
        <strong>{execution.status}</strong>
      </footer>
    </div>
  );
}
