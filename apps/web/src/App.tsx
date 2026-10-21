import { useMemo } from 'react';
import ReactFlow, { Background, Controls, MiniMap, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';

const initialNodes: Node[] = [
  {
    id: 'start',
    type: 'input',
    position: { x: 80, y: 120 },
    data: { label: 'Start' },
  },
  {
    id: 'llm',
    position: { x: 320, y: 120 },
    data: { label: 'LLM Step' },
  },
  {
    id: 'tool',
    position: { x: 560, y: 120 },
    data: { label: 'Tool Step' },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 'start', target: 'llm' },
  { id: 'e2', source: 'llm', target: 'tool' },
];

export default function App() {
  const nodeCount = useMemo(() => initialNodes.length, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Workflow Studio</p>
          <h1>FlowTrace</h1>
        </div>
        <div className="topbar-actions">
          <button type="button">Validate</button>
          <button type="button" className="primary">
            Run workflow
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="toolbar-panel">
          <h2>Nodes</h2>
          <div className="tool-item">LLM</div>
          <div className="tool-item">Tool</div>
          <div className="tool-item">Condition</div>
          <div className="tool-item">Merge</div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-header">
            <span>Workflow</span>
            <span>{nodeCount} nodes</span>
          </div>
          <div className="canvas-surface">
            <ReactFlow nodes={initialNodes} edges={initialEdges} fitView>
              <Background />
              <MiniMap />
              <Controls />
            </ReactFlow>
          </div>
        </section>

        <aside className="sidebar-panel">
          <div className="panel-section">
            <h3>Configuration</h3>
            <label>
              Name
              <input defaultValue="Customer triage flow" />
            </label>
            <label>
              Trigger
              <input defaultValue="Manual" />
            </label>
          </div>

          <div className="panel-section">
            <h3>Execution</h3>
            <p className="empty-state">Run status will appear here.</p>
          </div>
        </aside>
      </main>
    </div>
  );
}
