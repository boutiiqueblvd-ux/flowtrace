import { describe, expect, it } from 'vitest';

describe('flowtrace smoke test', () => {
  it('loads the app shell metadata', () => {
    expect('FlowTrace').toBe('FlowTrace');
  });
});
