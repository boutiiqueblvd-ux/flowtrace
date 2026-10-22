# FlowTrace AI Notes

## 1. Purpose and scope

AI assistance was used to scaffold the project, propose the architecture, write the validation layer and scheduler, iterate on the UI, and later to review and correct the frontend–backend integration. The developer set the scope and the acceptance criteria. The developer also decided what to ask for and when to stop.

This document records:

- the iterations that materially shaped the result,
- the architectural corrections made during the integration review, with evidence for each,
- which decisions were AI suggestions and which were the developer's.

Entries in §2 predate the integration review. Their exact wording is not available, so they are **reconstructed summaries** from the repository and git history. The entries in §3 come from the recorded session and are concrete.

## 2. Consequential iterations before the integration review (reconstructed)

1. **Architecture framing.** The developer defined a narrow scope: a React + Vite editor and a Fastify API with validation, DAG execution, and an SSE event stream. The repository still follows these boundaries.
2. **Verification-first baseline.** Test results were reported only after running the actual suite, not from reading the code.
3. **UI clarity.** Run and cancel controls, the panel hierarchy, and the status labelling were made more obvious without changing the architecture.
4. **Import, export, and sample workflow.** A realistic sample workflow and JSON import/export were added so reviewers do not have to build a graph by hand.
5. **Invalid-connection feedback.** The editor already blocked cycles and invalid edges, but did so silently. Validation messages now explain why.
6. **Branch semantics in the sample.** Edge labels, comments, and `yes`/`no` branch metadata were added to the sample and the editor. *Correction recorded in §3: these remain visual only, and execution ignores them.*
7. **Layout and connector geometry.** The canvas no longer overlaps the footer, and edges now attach to node boundaries.

## 3. Integration review: architectural corrections

### What triggered it

The developer asked for a skeptical staff-engineer review of the whole run lifecycle, before any code changes. It covered six scenarios: run, execution events, concurrent branches, failure, cancellation, and reconnection. For each scenario the review had to separate behavior proven by tests from behavior only inferred from the code.

The existing suite (8 web tests and 17 API tests) passed, along with the type checks and the build. The AI then wrote throwaway probe scripts outside the repository that drove the real modules with slow executors. All six scenarios showed defects. The developer approved fixing all six. A later documentation review found one more gap, which was not fixed.

The common root cause: **most tests used executors that finish instantly**. With instant executors, a scheduler that streams events and one that dumps them at the end look the same, and so do a failure policy that stops the run and one that lets other branches finish.

### Correction 1: events were not live

- **Problem.** `scheduler.run()` collected events in a local array and returned them only when the run finished. The API merged them into the run in one step at the end. In the probe, a 3-node run with 100 ms per node delivered `run-created` at +3 ms and then every other event together at +330 ms. Halfway through the run, `GET /runs/:id` showed only `run-created` and status `queued`.
- **Change.**
  - Added an `onEvent` callback to the scheduler, called synchronously for each event.
  - The API's new `recordEvent` appends each event, assigns its sequence once, and derives the status (`running` and the terminal status).
  - Removed `reindexEvents`, which renumbered and re-sorted the whole log on every update and so made cursors unstable.
- **Evidence.** After the fix, the same probe received four batches at +3, +112, +223, and +334 ms. New test: `index.test.ts`, "streams each event over SSE before the run finishes".

### Correction 2: the first failure ended the whole run

- **Problem.** `ensureTerminalState` ended the run as soon as any node failed, and the loop exited. Probe:
  - In `root → bad` / `root → slow → after-slow`, the run ended `failed` while `slow` was still running. `after-slow` never started.
  - A `join` node with one failed parent and one parent still running stayed `queued` forever, with no event.

  The existing test "continues independent branches after a sibling failure" passed only because both branches finished in the same microtask flush.
- **Change.**
  - The loop now runs until every in-flight node settles.
  - A node is skipped as soon as **any** prerequisite ends without succeeding.
  - Skips are propagated repeatedly until nothing changes, so dependents of dependents are skipped whatever order the nodes are declared in.
- **Evidence.** New `scheduler.test.ts` tests use `createControlledExecutor` (`testing.ts`), in which nodes finish only when the test says so. They cover independent branches after a failure, transitive skips in reverse declaration order, and prerequisites waiting with free slots.

### Correction 3: a second run in the same session lost its events

- **Problem.** `applyRunSnapshot` kept `Math.max(previous cursor, new cursor)` when it switched to a different run. Separately, `loadRunStream` built its `?after=` cursor from a stale React render closure. Probe: after a 9-event run, events 2–5 of the next run were all dropped. Live `node-started` events also never set `startedAt`, so durations were reported as 0 ms.
- **Change.**
  - A different run now replaces the store state, including the cursor.
  - The stream reads its cursor from `useExecutionStore.getState()` each time it connects.
  - `node-started` now records `startedAt`.
- **Evidence.** New `executionStore.test.ts` tests: "resets the cursor when a different run is loaded…" and "computes node duration from live events".

### Correction 4: cancellation erased history and could change a finished run

- **Problem.**
  - When the scheduler finished after a cancel, the API saw the cancel's terminal event and discarded every scheduler event. The history showed only `run-created, run-terminal`, although nodes `a` and `b` had run.
  - Cancelling a run that had already succeeded returned 200 and changed its status to `cancelled`, while its last event still said `succeeded`.
  - The default executor ignored `AbortSignal`.
- **Change.**
  - The scheduler now owns cancellation. `cancel()` synchronously records the in-flight nodes as cancelled, aborts their signals, and emits `run-terminal: cancelled` through the same event log.
  - Cancelling a finished run is a no-op that returns `cancelled: false`.
  - The default delay can now be interrupted by the abort signal.
  - The scheduler no longer resets its cancel flag inside `run()`, so a cancel that arrives before the run starts is honored.
- **Evidence.** New tests:
  - `scheduler.test.ts`: "cancels in-flight nodes immediately and never starts new ones", "starts no nodes when cancelled before the run begins", and "interrupts the default executor when cancelled".
  - `index.test.ts`: "cancels the real scheduler and keeps the history of nodes that ran" and "treats cancelling a finished run as a no-op".
- **Remaining limit, documented rather than claimed away.** Cancellation is cooperative. An executor that ignores `AbortSignal` is not interrupted. In-flight nodes are reported as `node-skipped`; there is no `node-cancelled` event.

### Correction 5: the client had no reconnection

- **Problem.** The client read the stream with a one-shot `fetch`. On any error it marked the *run* as `failed`, which was wrong, since only the connection had failed. It never retried or replayed. It also created a new `TextDecoder` for every chunk, which can corrupt multi-byte characters split across chunks.
- **Change.**
  - Extracted `followRunStream` into `runStream.ts`.
  - It resumes from the store's cursor and retries with capped exponential backoff.
  - It fills sequence gaps from `/events?after=` before applying later events, so the store only receives events in order.
  - It stops on run completion, on abort, or on 404.
  - One decoder is used per connection.
- **Evidence.** `runStream.test.ts` has 5 tests with a fake `fetch` and SSE frames split mid-frame. `index.test.ts` has "resumes from a cursor via ?after and Last-Event-ID…".
- **Not claimed.** There is no browser test. There is no snapshot recovery, no recovery after a page reload, and no reconnect indicator.

### Correction 6: tests that could not detect these bugs

- **Problem.** The SSE, failure, and cancellation tests used instant or fixed-sleep executors, so they could not tell correct behavior from broken behavior.
- **Change.** Added `createControlledExecutor` and replaced the timing-dependent scheduler tests. Added lifecycle tests against a real HTTP server.
- **Evidence.** These new tests immediately caught a regression in the first version of Correction 1. `createRun` gave `run-created` no sequence number, so the first scheduler event also got sequence 1, and replay from cursor 0 skipped `run-created`. The fix assigns sequence 1 in `createRun`.

### Found during the documentation review, not fixed

- **No CORS.** The web app (`:5173`) calls the API (`:3001`) directly. The API registers no CORS headers and has no `OPTIONS` routes. Against the running server, the preflight `OPTIONS /runs` returns 404. The browser UI therefore cannot start or cancel runs. This also means that none of the fixes above have been observed in a browser.
- **Branch labels are cosmetic.** `buildWorkflowPayload` sends only edge `id`, `source`, and `target`. Both the "Yes" and the "No" branches of the sample run.

Both are listed as limitations in the README and ARCHITECTURE.md. Neither has been fixed yet; that is the developer's call.

## 4. AI suggestions versus human decisions

**Developer decisions:**

- Keep FlowTrace a small, inspectable editor rather than an orchestration platform.
- Keep editor state separate from execution state.
- Treat validation as a server-side gate.
- Ask for a review before any code changes, scenario by scenario, separating what tests prove from what the code merely suggests.
- Approve fixing all six findings.
- Require the documentation to describe only verified behavior, with its limitations. For example, it must not claim reliable reconnection or guaranteed cancellation without tests that support it.

**AI contributions:**

- The initial scaffold, the scheduler, and the UI iterations.
- During integration: the probe-driven diagnosis, the specific designs (synchronous `onEvent` with server-assigned sequences; skip-on-any-failed-prerequisite; scheduler-owned synchronous cancellation; replay-based client recovery with gap fill), the controlled-executor test strategy, and finding the CORS and branch gaps while reviewing the documentation.

**AI choices worth reviewing:**

- Reporting in-flight cancelled nodes as `node-skipped` instead of adding a `node-cancelled` event. This avoided changing the event format on both sides.
- Retrying indefinitely instead of giving up after a fixed number of attempts.
- Marking the run `failed` locally when the server returns 404 for it.

## 5. Verification

Commands run from the repository root after the integration fixes. The documentation changes did not touch any code.

| Command | Result |
|---|---|
| `npm test` | Web: 5 files, 15 tests passed. API: 3 files, 26 tests passed. |
| `npm run typecheck` | Exit 0 (web and API) |
| `npm run build` | Exit 0 (Vite production build and API `tsc`) |

Before the fixes, the same commands passed with 8 web and 17 API tests. Passing tests were not evidence that the lifecycle worked.

**Manual checks:**

- The API was started locally, and `curl` showed `GET /health` responding and the CORS preflight failing (404).
- The browser UI was **not** exercised. Because of the CORS gap it cannot start a run.

## 6. Limitations and remaining work

- **CORS:** missing, which blocks the browser execution flow. This is the next fix to make.
- **Execution model:** branch labels do not affect execution; node execution is simulated; concurrency is fixed at 2.
- **Cancellation:** cooperative; in-flight nodes are reported as skipped.
- **Reconnection:**
  - verified at unit and HTTP level only, not in a browser;
  - no snapshot recovery;
  - no reattach after a page reload;
  - no reconnect indicator;
  - unbounded retries.
- **Operations:** state is in memory and lost on restart, and finished runs are never evicted. There is a single process, no auth, and no durable audit log.
