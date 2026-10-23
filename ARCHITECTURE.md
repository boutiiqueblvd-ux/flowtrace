# FlowTrace Architecture

This document describes how FlowTrace is built and why. It states which behavior is backed by tests and what remains a limitation. For setup, the API reference and the list of verification evidence, see [README.md](README.md).

## 1. Component boundaries

```text
apps/api/src/
  workflow.ts      Zod schemas, validateWorkflow, createRun (readable errors), cancelRun helper
  scheduler.ts     createWorkflowScheduler: DAG scheduling, failure skipping, cancellation, onEvent
  index.ts         Fastify routes, in-memory run store, recordEvent (sequencing), SSE fan-out
  testing.ts       createControlledExecutor: test helper whose nodes finish on command
apps/web/
  vite.config.ts   Dev and preview server; /api proxy to the API
  src/App.tsx                    Shell: run, cancel, import/export, sample, error banners
  src/runStream.ts               SSE client: resume, retry with backoff, gap fill, connection state
  src/executionStatus.ts         The single node-state → label mapping used by every view
  src/store/graphStore.ts        Editable graph and connection rules
  src/store/executionStore.ts    Ordered event log, resume cursor, derived node states
  src/components/                WorkflowNode (canvas), ExecutionTimeline, NodeInspectorPanel, Toolbar
```

The flow between them:

```mermaid
sequenceDiagram
    participant UI as App / stores
    participant RS as runStream.ts
    participant API as index.ts
    participant S as scheduler.ts
    UI->>API: POST /api/runs (via Vite proxy)
    API->>API: createRun: validate, run-created = seq 1
    API->>S: run(workflow), not awaited
    S-->>API: onEvent run-started, node-started… (sync)
    API-->>UI: 201 live snapshot
    UI->>RS: followRunStream(runId)
    RS->>API: GET /stream?after=lastSequence
    API-->>RS: replay, then live SSE frames (id = sequence)
    RS->>UI: appendEvent, in order, once
    S-->>API: run-terminal
    API-->>RS: final frame; stream closes
```

## 2. Graph editing state

`useGraphStore` holds the nodes, edges, selection and validation messages. `onConnect` rejects cycles, edges into input nodes and edges out of output nodes, and says why. The node inspector edits the label (max 80 characters) and description (max 250), which matches the server schema.

Editing is independent of execution. A run uses the payload built when Run was clicked, so editing during a run does not affect it. Import, Load sample and Clear all are disabled while a run is active, so the run being displayed cannot be orphaned. When a run is not active, those actions also clear the execution view.

## 3. Execution state

`useExecutionStore` keeps:

- the selected run id,
- the ordered event list,
- `lastSequence`, the resume cursor,
- the node states derived from the events.

Both snapshots and live events go through one fold, `applyEventToNodeState`, so the two paths cannot disagree. A test asserts this for cancellation. The store rejects events at or below the cursor and events belonging to a different run. Loading a different run replaces the state, including the cursor.

`describeNodeStatus` (`executionStatus.ts`) maps a node's state to a tone, a label and a detail. Because the canvas badge, the inspector and the timeline all use it, they cannot drift apart. A node with no events reads "Queued" during a run, "Not run" before any run, and "Not in last run" if it was added after the run started.

## 4. Backend validation

`POST /runs` parses the request with Zod, then runs `validateWorkflow`, which checks:

- the 50-node limit,
- duplicate node ids,
- duplicate edges,
- edges that reference missing nodes,
- edge direction (no edges into inputs, none out of outputs),
- cycles.

Schema errors are rewritten so they name the node by id instead of by array index, for example `node "enrich-request" config.label: String must contain at least 1 character(s)`. The UI never calls `POST /workflows/validate`, because run creation already enforces the same checks.

## 5. DAG scheduling

`createWorkflowScheduler` tracks a status for each node: queued, running, succeeded, failed, skipped or cancelled.

- `scheduleReadyNodes` starts queued nodes whose prerequisites have **all** succeeded, while fewer than `maxConcurrency` nodes are running. The default is 2.
- The main loop awaits `Promise.race` over the in-flight tasks, propagates skips, and schedules again. JavaScript is single-threaded and every status change happens synchronously between awaits, so this bookkeeping has no races.
- **Failure:** the node is marked failed with its reason. `propagateBlockers` then repeats until nothing changes, skipping every queued node with a prerequisite that did not succeed. Each skip records the name of the upstream node that caused it. The run does **not** end at the first failure. It ends only after every in-flight node has settled.
- **Terminal state:** `succeeded` only if every node succeeded; otherwise `failed` or `cancelled`. Exactly one `run-terminal` event is emitted, and it is the last event.

Tests use `createControlledExecutor`, whose nodes finish only when the test says so. They cover:

- dependents waiting even when slots are free,
- concurrency peaks,
- independent branches finishing after a failure,
- transitive skips with nodes declared in reverse order,
- skip reasons,
- the shipped sample (two concurrent branches; a failure isolated to one branch).

## 6. Event streaming

- **Recording.** `recordEvent` gives each event the next sequence number, derives the run status (`running`, then the terminal status), stores the new snapshot, and notifies the listeners for that run. Sequences start at 1, are contiguous, and are never rewritten.
- **SSE.** `/runs/:id/stream` subscribes first and then replays the events after the cursor, synchronously, so no event can fall between the replay and the live push. Each frame carries `id: <sequence>`. The stream closes after the terminal event. When the request closes, the stream unsubscribes its listener; this was verified by inspection. The scheduler is not tied to any connection, so it keeps running if the browser disconnects (tested).
- **Proxy.** Vite forwards `/api/*` to the API without buffering. `vite.proxy.test.ts` checks that an SSE frame reaches the client before the upstream response finishes.

## 7. Event replay and reconnection

`followRunStream` handles the client side:

- It connects with `?after=<cursor>`, reading the cursor from the store, never from a React closure.
- After an error or an early end of the stream, it retries with backoff of 0.5 s, 1 s, 2 s, 4 s, then 5 s. Each change in connection state is reported to the UI, which shows "Reconnecting…".
- If an event arrives ahead of the cursor, it fetches the missing range from `/events?after=` and applies it first.
- It stops when the run finishes, when it is aborted, or when the server returns 404.

**Verified:**
- by unit tests with a fake `fetch`: resume, retry, gap fill, connection state, 404 and abort;
- against a real HTTP server: `?after` and `Last-Event-ID` replay;
- in headless Chrome: the API connection was dropped mid-run, and the client showed "Reconnecting…", replayed the six missed events, finished, and had no duplicates.

**Not supported:**
- Reattaching after a page reload.
- Snapshot-based recovery. Replay covers the whole run because retention (1,000 events) exceeds the maximum per run (103).

## 8. Cancellation

`scheduler.cancel(reason)` runs synchronously within the cancel request:

1. For each running node, it records `node-cancelled` with `interrupted: true` and aborts the node's `AbortSignal`.
2. For each queued node, it records `node-cancelled` with `interrupted: false`.
3. It records `run-terminal: cancelled`.

After that, no node starts, and `settleNode` ignores results from executors that are still in flight. `run()` still awaits those tasks, so no promise is left orphaned. Cancelling a finished run is a no-op.

The UI shows **Interrupted** and **Not started**, which are distinct from **Skipped**, the label for dependency failures. Tests cover this in the scheduler, over HTTP, in the store, the timeline and the inspector, and it was observed in the browser.

**Limit:** cancellation is cooperative. An executor that ignores `AbortSignal` keeps running until it returns, and its result is then discarded.

## 9. In-memory limitations

- All runs live in a `Map` in a single process. They are lost on restart, and they are never evicted.
- SSE listeners are in-process sets, so a second API instance would see neither the runs nor the streams.
- There is no auth and no per-user isolation.
- Concurrency is fixed at 2.
- Node execution is simulated, and configuration and edge labels are not evaluated. The UI states this.

## 10. Scaling considerations (future design, not implemented)

**500-node workflows**
- Raise the node limit together with the event retention: a 500-node run produces about 1,000 events, so the retention would have to grow.
- Stop copying the full event array on every append, both in `recordEvent` and in the client store. Use an append-only structure and batch store updates, one render per animation frame.
- Virtualize the timeline.
- Make concurrency configurable, and add per-node timeouts.
- Rely on React Flow's viewport culling, and memoize node data so a status change re-renders only that node.

**Collaborative editing**
- Move the graph to a server-authoritative document, using versioned operations or a CRDT such as Yjs, with presence.
- Keep runs bound to an immutable snapshot of the graph (this already happens) and record the graph version on the run.
- Execution state stays read-only and is shared by run id, so any collaborator can follow a run.

**Durable execution**
- Persist the event log. `recordEvent` is the single write point and would become a transactional append; the run status is already derived from the events.
- On startup, mark in-flight runs as failed or interrupted, or resume them from their last completed nodes if executors are idempotent.
- Move work onto a durable queue with leases, so multiple workers can execute nodes. The scheduler would then become a coordinator that reacts to node-completion events.
- Make cancellation a persisted state that workers observe.
- Fan out SSE from a shared log, such as Postgres LISTEN/NOTIFY or Redis Streams, so any API instance can serve any run.
