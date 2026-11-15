import { ClaudeCodeHarness } from './claude-code.js';
import { FakeHarness } from './fake.js';
import type { Harness } from './types.js';

export type { Harness, HarnessResult, HarnessRunInput } from './types.js';

const PLANNED: Record<string, string> = {
  codex: 'v1.1',
  opencode: 'v1.1',
};

export function createHarness(name: string): Harness {
  switch (name) {
    case 'claude-code':
      return new ClaudeCodeHarness();
    case 'fake':
      return new FakeHarness();
    default:
      if (PLANNED[name]) throw new Error(`Harness "${name}" is planned for ${PLANNED[name]} and not available yet.`);
      throw new Error(`Unknown harness "${name}". Available: claude-code, fake.`);
  }
}
