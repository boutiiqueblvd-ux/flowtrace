import { z } from 'zod';

export const MAX_WORKFLOW_NODES = 50;

// This assessment intentionally does not require a single connected component.
// Disconnected workflows are valid as long as every node and edge remains internally consistent.
export const nodeTypeSchema = z.enum(['input', 'transform', 'output']);

export const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const inputNodeConfigSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().max(250).optional().default(''),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export const transformNodeConfigSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().max(250).optional().default(''),
  expression: z.string().trim().min(1).max(500).optional(),
});

export const outputNodeConfigSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().max(250).optional().default(''),
  sink: z.enum(['console', 'http', 'database']).default('console'),
});

export const workflowNodeSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().trim().min(1).max(128),
    type: z.literal('input'),
    position: positionSchema,
    config: inputNodeConfigSchema,
  }),
  z.object({
    id: z.string().trim().min(1).max(128),
    type: z.literal('transform'),
    position: positionSchema,
    config: transformNodeConfigSchema,
  }),
  z.object({
    id: z.string().trim().min(1).max(128),
    type: z.literal('output'),
    position: positionSchema,
    config: outputNodeConfigSchema,
  }),
]);

export const workflowEdgeSchema = z.object({
  id: z.string().trim().min(1).max(128),
  source: z.string().trim().min(1).max(128),
  target: z.string().trim().min(1).max(128),
});

export const workflowSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(128).optional().default('Untitled workflow'),
  nodes: z.array(workflowNodeSchema).max(MAX_WORKFLOW_NODES, {
    message: `Workflow exceeds the assessment limit of ${MAX_WORKFLOW_NODES} nodes.`,
  }),
  edges: z.array(workflowEdgeSchema).default([]),
});

export const workflowValidationIssueSchema = z.object({
  code: z.enum([
    'invalid-workflow',
    'duplicate-node-id',
    'duplicate-edge',
    'invalid-edge-reference',
    'invalid-edge-direction',
    'cycle-detected',
    'invalid-node-config',
    'max-node-count-exceeded',
  ]),
  path: z.string(),
  message: z.string(),
});

export const workflowValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(workflowValidationIssueSchema),
  warnings: z.array(workflowValidationIssueSchema).default([]),
});

export type WorkflowNodeType = z.infer<typeof nodeTypeSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowValidationIssue = z.infer<typeof workflowValidationIssueSchema>;
export type WorkflowValidationResult = z.infer<typeof workflowValidationResultSchema>;

export const executionEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('run-created'),
    timestamp: z.string().datetime(),
    message: z.string().min(1),
  }),
  z.object({
    type: z.literal('node-started'),
    timestamp: z.string().datetime(),
    nodeId: z.string().min(1),
  }),
  z.object({
    type: z.literal('node-completed'),
    timestamp: z.string().datetime(),
    nodeId: z.string().min(1),
  }),
  z.object({
    type: z.literal('run-completed'),
    timestamp: z.string().datetime(),
    status: z.enum(['succeeded', 'failed']),
  }),
  z.object({
    type: z.literal('run-cancelled'),
    timestamp: z.string().datetime(),
    reason: z.string().max(250).optional(),
  }),
]);

export type ExecutionEvent = z.infer<typeof executionEventSchema>;

export const runStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);

export const runSnapshotSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  workflow: workflowSchema,
  status: runStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
  events: z.array(executionEventSchema).default([]),
  cancelReason: z.string().max(250).optional(),
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

export const createRunRequestSchema = z.object({
  workflow: workflowSchema,
  metadata: z.record(z.unknown()).default({}),
});

export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const cancelRunRequestSchema = z.object({
  reason: z.string().trim().min(1).max(250).optional(),
});

export type CancelRunRequest = z.infer<typeof cancelRunRequestSchema>;

export type RunCreationResult = {
  run: RunSnapshot;
  validation: WorkflowValidationResult;
};

export type CancelRunResult = {
  run: RunSnapshot;
  cancelled: boolean;
};

const buildIssue = (code: WorkflowValidationIssue['code'], path: string, message: string): WorkflowValidationIssue => ({
  code,
  path,
  message,
});

const hasCycle = (nodeIds: string[], edges: WorkflowEdge[]) => {
  const adjacency = new Map<string, string[]>();

  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, []);
  }

  for (const edge of edges) {
    const neighbors = adjacency.get(edge.source) ?? [];
    neighbors.push(edge.target);
    adjacency.set(edge.source, neighbors);
  }

  const visited = new Set<string>();
  const active = new Set<string>();

  const visit = (nodeId: string): boolean => {
    if (active.has(nodeId)) {
      return true;
    }

    if (visited.has(nodeId)) {
      return false;
    }

    active.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (visit(neighbor)) {
        return true;
      }
    }
    active.delete(nodeId);
    visited.add(nodeId);

    return false;
  };

  for (const nodeId of nodeIds) {
    if (visit(nodeId)) {
      return true;
    }
  }

  return false;
};

export function validateWorkflow(input: unknown): WorkflowValidationResult {
  const parsed = workflowSchema.safeParse(input);
  const errors: WorkflowValidationIssue[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(
        buildIssue(
          'invalid-workflow',
          issue.path.length > 0 ? issue.path.join('.') : '$',
          issue.message,
        ),
      );
    }

    return { valid: false, errors, warnings: [] };
  }

  const workflow = parsed.data;

  if (workflow.nodes.length > MAX_WORKFLOW_NODES) {
    errors.push(
      buildIssue(
        'max-node-count-exceeded',
        'nodes',
        `Workflow exceeds the assessment limit of ${MAX_WORKFLOW_NODES} nodes.`,
      ),
    );
  }

  const seenIds = new Set<string>();
  for (const node of workflow.nodes) {
    if (seenIds.has(node.id)) {
      errors.push(
        buildIssue('duplicate-node-id', `nodes.${node.id}`, `Duplicate node ID "${node.id}" is not allowed.`),
      );
      continue;
    }

    seenIds.add(node.id);
  }

  const edgeLookup = new Map<string, WorkflowEdge>();
  const duplicateEdgeSet = new Set<string>();
  for (const edge of workflow.edges) {
    const key = `${edge.source}->${edge.target}`;
    if (edgeLookup.has(key)) {
      duplicateEdgeSet.add(key);
      continue;
    }
    edgeLookup.set(key, edge);
  }

  for (const key of duplicateEdgeSet) {
    errors.push(
      buildIssue('duplicate-edge', 'edges', `Duplicate edge detected between ${key}.`),
    );
  }

  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));

  for (const edge of workflow.edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);

    if (!sourceNode || !targetNode) {
      errors.push(
        buildIssue(
          'invalid-edge-reference',
          `edges.${edge.id}`,
          `Edge "${edge.id}" references a node that does not exist: ${edge.source} -> ${edge.target}`,
        ),
      );
      continue;
    }

    if (targetNode.type === 'input') {
      errors.push(
        buildIssue(
          'invalid-edge-direction',
          `edges.${edge.id}`,
          `Input node "${targetNode.id}" cannot have incoming edges.`,
        ),
      );
    }

    if (sourceNode.type === 'output') {
      errors.push(
        buildIssue(
          'invalid-edge-direction',
          `edges.${edge.id}`,
          `Output node "${sourceNode.id}" cannot have outgoing edges.`,
        ),
      );
    }
  }

  const validEdges = workflow.edges.filter((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    return Boolean(sourceNode && targetNode);
  });

  if (hasCycle(Array.from(nodeById.keys()), validEdges)) {
    errors.push(
      buildIssue('cycle-detected', 'edges', 'Workflow contains a cycle. Directed edges must be acyclic.'),
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}

export function createRun(input: unknown): RunCreationResult {
  const request = createRunRequestSchema.parse(input);
  const validation = validateWorkflow(request.workflow);

  if (!validation.valid) {
    throw new Error(validation.errors.map((issue) => issue.message).join('; '));
  }

  const now = new Date().toISOString();
  const run: RunSnapshot = {
    id: `run-${Date.now()}`,
    workflowId: request.workflow.id,
    workflow: request.workflow,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    metadata: request.metadata ?? {},
    events: [{ type: 'run-created', timestamp: now, message: `Workflow "${request.workflow.name}" was queued.` }],
    cancelReason: undefined,
  };

  return { run, validation };
}

export function cancelRun(run: RunSnapshot, input: unknown): CancelRunResult {
  const request = cancelRunRequestSchema.parse(input ?? {});
  const now = new Date().toISOString();

  const cancelledRun: RunSnapshot = {
    ...run,
    status: 'cancelled',
    updatedAt: now,
    finishedAt: now,
    cancelReason: request.reason ?? 'Cancelled by operator.',
    events: [
      ...run.events,
      { type: 'run-cancelled', timestamp: now, reason: request.reason ?? 'Cancelled by operator.' },
    ],
  };

  return {
    run: cancelledRun,
    cancelled: true,
  };
}
