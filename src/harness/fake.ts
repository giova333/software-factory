import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolvedSkill } from '../skills.js';
import type { Harness, HarnessResult, HarnessRunInput } from './types.js';

/**
 * Scripted harness for tests and dry runs: appends the first line of the prompt to FACTORY_FAKE.md
 * (or does nothing when `edit` is false) and returns a canned summary. No model is called.
 */
export class FakeHarness implements Harness {
  readonly name = 'fake';
  readonly calls: HarnessRunInput[] = [];

  constructor(private readonly opts: { edit?: boolean; summary?: string } = {}) {}

  async prepare(_workspace: string, _skills: ResolvedSkill[]): Promise<string[]> {
    return [];
  }

  async run(input: HarnessRunInput): Promise<HarnessResult> {
    this.calls.push(input);
    if (this.opts.edit ?? true) {
      const firstLine = input.prompt.split('\n').find((l) => l.trim()) ?? '';
      await appendFile(join(input.workspace, 'FACTORY_FAKE.md'), `- ${firstLine}\n`);
    }
    return { ok: true, summary: this.opts.summary ?? 'Fake harness made a scripted edit.', transcript: input.prompt, costUsd: 0, turns: 1 };
  }
}
