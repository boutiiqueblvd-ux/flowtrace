# FlowTrace AI Notes

## 1. How AI was used

AI assistance (Claude, through Claude Code) was used to:

- scaffold the project,
- write the scheduler, the validation layer and the UI,
- review and correct the frontend–backend integration in a later recorded session,
- harden the submission.

The candidate set scope and acceptance criteria and decided what to fix. All commits were made by the candidate; a repository rule forbids the AI from committing or pushing.

Evidence levels used below:

- **Recorded:** happened in the recorded integration session and is backed by code, tests or command output in this repository.
- **Reconstructed, needs confirmation:** earlier work whose prompts are not available verbatim. It is summarized from git history and must be confirmed by the candidate before submission ([§6](#6-items-to-confirm-before-submission)).

## 2. Consequential prompts (recorded)

Quotes are excerpts of the candidate's actual prompts.

1. **Skeptical review before any change.** *"Act as a skeptical Staff Engineer reviewing the implementation… Do not modify any files yet. Trace the complete execution lifecycle… Distinguish behavior proven by tests from behavior inferred from code inspection."*
   - Six scenarios: run, events, concurrency, failure, cancellation, reconnection.
   - Outcome: the AI wrote throwaway probe scripts that drove the real modules with slow executors. Every scenario showed defects, even though all 25 existing tests passed.
2. **"Fix these issues all from 1 to 6."** The candidate approved fixing all six findings:
   - live events,
   - failure isolation,
   - the run-to-run cursor bug,
   - cancellation history,
   - client reconnection,
   - timing-independent tests.
3. **Truthful documentation.** *"The documentation must describe the actual implementation, including any limitations… don't claim that SSE reconnection is fully reliable unless you've tested event replay and snapshot recovery."* While checking the docs against the running server, the AI found that the browser could not reach the API at all, because of CORS.
4. **Smallest reliable CORS fix.** *"Preferred approach: Configure a Vite development proxy… Do not add unnecessary dependencies… Do not claim browser verification unless it has actually been performed."*
5. **Final submission hardening.** This was a P0/P1/P2 audit. It included the instruction *"If it uses Yes/No or other conditional branch labels without actual conditional execution, replace them with a truthful parallel workflow example"*, the specified sample shape and node names, and *"Make the following outcomes distinguishable"* for failure and cancellation.

## 3. AI output that was rejected, corrected or reworked (recorded)

### Case A: The first integration pass passed its tests but was wrong

- **What happened.** The probe scripts showed six defects that the passing tests could not see:
  - The scheduler returned all events only when the run ended. In a 3-node run, every event after `run-created` arrived at +330 ms in one batch.
  - The first failure ended the run while an independent branch was still running.
  - A second run in the same session dropped its first events, because `lastSequence` carried over from the previous run.
  - Cancellation discarded the history of nodes that had already run, and could rewrite a finished run as `cancelled`.
  - The client had no reconnection.
  - The tests used executors that finished instantly or after fixed sleeps, so they could not tell correct behavior from broken behavior.
- **Correction.**
  - The scheduler now emits each event through an `onEvent` callback, and the server's `recordEvent` assigns sequences.
  - A failure skips only its dependents, and the run waits for the other branches.
  - The cursor resets when a different run loads.
  - Cancellation is owned by the scheduler and recorded in the event log.
  - The client gained a reconnecting stream (`runStream.ts`).
  - `createControlledExecutor` replaced the timing-dependent tests.
- **Evidence.** The same probes showed four separate batches at +3, +112, +223 and +334 ms after the fix. The new tests are listed in the README.
- **Confirm (see §6).** Who authored the original integration pass (AI-generated or hand-written)? The session started from it already committed.

### Case B: The AI's own fix had a regression, caught by the new tests

The first version of `recordEvent` did not give `run-created` a sequence number, so the first scheduler event also got sequence 1, and replay from cursor 0 skipped `run-created`. The new lifecycle tests failed immediately (`expected [undefined, 1, 2, …]`). The fix was to assign sequence 1 in `createRun`.

### Case C: AI-written documentation overclaimed

Earlier docs claimed several things that were not true:

- that the UI emits a `run-cancelled` event (nothing emits it),
- that SSE carries run snapshots (it carries individual events),
- that output payloads appear in the inspector (the API never sends any),
- that reconnect recovery works (it was unverified).

They also repeated the iteration list twice and gave wrong test counts. All of this was rewritten against the code. The same review found the CORS blocker, which the docs had never mentioned.

### Case D: An AI design choice was reversed in the final pass

The AI had chosen to report nodes interrupted by cancellation as `node-skipped`, and it flagged this as worth reviewing. In the final pass that choice was replaced:

- `node-cancelled` with `interrupted: true` or `false` now distinguishes **Interrupted** from **Not started**, and both are distinct from dependency **Skipped**.
- Before the change, nodes that never started had no event at all and stayed "Queued" forever after a cancelled run.

### Case E: An invalid verification method was discarded

To test reconnection in a real browser, the AI first killed and restarted the Vite dev server mid-run. The page reset to "Not started" because Vite's HMR client reloads the page when the server comes back, so the test was measuring dev tooling, not the app. It was redone with a TCP relay in front of the API, so that only the upstream connection dropped. The client then showed "Reconnecting…", replayed the six missed events, and finished with no duplicates.

## 4. Decisions made by the candidate

- **Scope:** a small, inspectable editor, not an orchestration platform. Editor state is kept separate from execution state, and validation is a server-side gate.
- **Review before fixes:** an audit must separate what tests prove from what is inferred before anything is changed.
- **Approved fixes:** all six integration findings, then the CORS fix.
- **Proxy over CORS:** a Vite `/api` proxy with no new dependencies, rather than CORS support in the API.
- **Honest sample:** Yes/No branches replaced with a parallel enrich/validate sample, with node names the candidate specified. No conditional engine.
- **Distinct outcomes** for failure and cancellation, preferring accurate events and labels over new state machinery.
- **Documentation:** only claim what was verified, including browser verification.
- **Git:** no AI commits or pushes; the candidate reviews and commits.

## 5. How AI output was verified

- **Probe scripts** (outside the repository) drove the real scheduler, API and store with slow executors, before and after each fix.
- **Repository commands** were run after every change set. Final results:

  | Command | Result |
  |---|---|
  | `npm run test` | Web: 9 files, 34 tests passed. API: 3 files, 30 tests passed. |
  | `npm run typecheck` | Exit 0 |
  | `npm run build` | Exit 0 |

  Earlier baselines: 8 web and 17 API tests before the integration fixes; 24 web and 26 API tests after the CORS fix.
- **Manual `curl`** against the real API through the real Vite proxy: health, validate, an invalid run returning 400, live streaming, replay through `?after` and `Last-Event-ID`, cancel, and a 404.
- **Headless Chrome over the DevTools protocol** against the real stack:
  - the sample running with both branches concurrent;
  - a failed run with an isolated skip and the error shown in the inspector;
  - a cancel with both branches Interrupted and both outputs Not started;
  - an empty-canvas run message;
  - a mid-run connection drop and recovery;
  - zero console errors.

  Screenshots were checked. They revealed three layout bugs, all of which were fixed:
  - unreadable timeline cards;
  - an overflowing inspector summary;
  - an inspector that clipped the Label and Description fields, which could not be scrolled to.

  The driver scripts were throwaway and are not part of the repository.

## 6. Items to confirm before submission

These come from the earlier version of this file. They could not be verified from the recorded session, so the candidate should confirm or remove them.

- **Reconstructed early iterations** (from git history: scaffold, canvas, validation, scheduler, SSE, inspector, layout fixes). Earlier notes said that the AI proposed the initial architecture and wrote the scheduler, and that the developer:
  - defined the scope,
  - asked for invalid-connection feedback,
  - asked for a more realistic sample (later replaced; see §4),
  - asked for layout fixes, including canvas and footer overlap and connector anchoring.
- **Earlier UI correction cases:**
  - unclear run controls,
  - silent rejection of invalid connections,
  - a sample that was too simple,
  - first-screen layout and connector misalignment.

  The code is consistent with these, for example the validation messages in `graphStore.ts`, but the original prompts and the AI output they corrected are not available.
- **Authorship of the first integration pass** (Case A).
