import type { WorkflowNodeType } from '../types';

interface ToolbarProps {
  onAddNode: (kind: WorkflowNodeType) => void;
}

const toolbarItems: Array<{ kind: WorkflowNodeType; label: string }> = [
  { kind: 'input', label: 'Input' },
  { kind: 'transform', label: 'Transform' },
  { kind: 'output', label: 'Output' },
];

export function Toolbar({ onAddNode }: ToolbarProps) {
  return (
    <aside className="toolbar-panel">
      <h2>Nodes</h2>
      {toolbarItems.map((item) => (
        <button type="button" key={item.kind} className="tool-item" onClick={() => onAddNode(item.kind)}>
          Add {item.label}
        </button>
      ))}
    </aside>
  );
}
