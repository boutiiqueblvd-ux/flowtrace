import type { ExecutionEvent } from './types';

export type RunStreamOutcome = 'finished' | 'aborted' | 'not-found';

export interface RunStreamOptions {
  apiBaseUrl: string;
  runId: string;
  signal: AbortSignal;
  // The highest sequence already applied; used as the resume cursor and to detect gaps.
  getCursor: () => number;
  isFinished: () => boolean;
  onEvent: (event: ExecutionEvent) => void;
  // true when a stream connection opens, false when it drops and a reconnect is scheduled.
  onConnectionChange?: (connected: boolean) => void;
  fetchFn?: typeof fetch;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const MAX_BACKOFF_MS = 5000;

class RunNotFoundError extends Error {}

const defaultWait = (ms: number, signal: AbortSignal) => {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
};

const getSequence = (event: ExecutionEvent) => event.sequence ?? event.id ?? 0;

export const parseSsePayload = (chunk: string, runId: string) => {
  const blocks = chunk.split('\n\n').filter(Boolean);
  const events: ExecutionEvent[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    let payload = '';
    let sequence: number | undefined;

    for (const line of lines) {
      if (line.startsWith('id: ')) {
        const value = Number.parseInt(line.slice(4), 10);
        if (Number.isFinite(value)) {
          sequence = value;
        }
      }

      if (line.startsWith('data: ')) {
        payload += line.slice(6);
      }
    }

    if (!payload) {
      continue;
    }

    try {
      const parsed = JSON.parse(payload) as ExecutionEvent;
      events.push({
        ...parsed,
        runId: parsed.runId ?? runId,
        sequence: typeof parsed.sequence === 'number' ? parsed.sequence : sequence,
        id: typeof parsed.id === 'number' ? parsed.id : sequence,
      });
    } catch (error) {
      console.error('Unable to parse SSE event payload', error, payload);
    }
  }

  return events;
};

// Follows a run's SSE stream until the run finishes, reconnecting from the last applied
// sequence after any disconnect. Events are always delivered in sequence order without gaps:
// if one arrives ahead of the cursor, the missing range is fetched from the replay endpoint first.
export const followRunStream = async (options: RunStreamOptions): Promise<RunStreamOutcome> => {
  const { apiBaseUrl, runId, signal, getCursor, isFinished, onEvent } = options;
  const fetchFn = options.fetchFn ?? fetch;
  const wait = options.wait ?? defaultWait;

  const fetchMissedEvents = async () => {
    const response = await fetchFn(`${apiBaseUrl}/runs/${runId}/events?after=${getCursor()}`, { signal });
    if (response.status === 404) {
      throw new RunNotFoundError();
    }
    if (!response.ok) {
      throw new Error(`Run replay failed with status ${response.status}.`);
    }

    const body = await response.json() as { events: ExecutionEvent[] };
    for (const event of body.events) {
      if (getSequence(event) === getCursor() + 1) {
        onEvent({ ...event, runId: event.runId ?? runId });
      }
    }
  };

  const deliver = async (event: ExecutionEvent) => {
    const sequence = getSequence(event);
    if (sequence > getCursor() + 1) {
      await fetchMissedEvents();
    }

    if (sequence === getCursor() + 1) {
      onEvent(event);
    }
  };

  // Returns true if the connection delivered at least one event.
  const readStreamOnce = async () => {
    const response = await fetchFn(`${apiBaseUrl}/runs/${runId}/stream?after=${getCursor()}`, { signal });
    if (response.status === 404) {
      throw new RunNotFoundError();
    }
    if (!response.ok) {
      throw new Error(`Run stream failed with status ${response.status}.`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Run stream returned no readable body.');
    }
    options.onConnectionChange?.(true);

    const decoder = new TextDecoder();
    let buffer = '';
    let delivered = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return delivered;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        for (const event of parseSsePayload(block, runId)) {
          await deliver(event);
          delivered = true;
        }
      }
    }
  };

  let failures = 0;

  while (!signal.aborted) {
    try {
      if (await readStreamOnce()) {
        failures = 0;
      }
    } catch (error) {
      if (error instanceof RunNotFoundError) {
        return 'not-found';
      }
      if (!signal.aborted) {
        console.warn('Run stream disconnected; reconnecting', error);
      }
    }

    if (signal.aborted) {
      break;
    }

    if (isFinished()) {
      return 'finished';
    }

    failures += 1;
    options.onConnectionChange?.(false);
    await wait(Math.min(MAX_BACKOFF_MS, 250 * 2 ** failures), signal);
  }

  return 'aborted';
};
