import { Handle, Position, type NodeProps } from 'reactflow';
import type { WorkflowNodeData } from '../types';

const nodeStyles: Record<WorkflowNodeData['kind'], { accent: string; label: string }> = {
  input: { accent: '#34d399', label: 'Input' },
  transform: { accent: '#60a5fa', label: 'Transform' },
  output: { accent: '#f472b6', label: 'Output' },
};

export function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  const style = nodeStyles[data.kind];
  const tone = data.executionTone ?? 'idle';

  return (
    <div
      className={`workflow-node tone-${tone} ${selected ? 'selected' : ''}`}
      style={{ borderColor: style.accent }}
    >
      {data.kind !== 'input' && (
        <Handle type="target" position={Position.Left} className="node-handle node-handle-in" id="in" />
      )}
      <div className="workflow-node__header">
        <span className="workflow-node__badge" style={{ background: style.accent }}>
          {style.label}
        </span>
        {data.executionLabel ? (
          <span className={`workflow-node__status status-${tone}`}>{data.executionLabel}</span>
        ) : null}
      </div>
      <div className="workflow-node__body">
        <strong>{data.label}</strong>
        <small>{data.description}</small>
      </div>
      {data.kind !== 'output' && (
        <Handle type="source" position={Position.Right} className="node-handle node-handle-out" id="default" />
      )}
    </div>
  );
}
