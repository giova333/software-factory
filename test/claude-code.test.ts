import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeHarness } from '../src/harness/claude-code.js';

const quiet = { info: () => {}, warn: () => {} };

function stub(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-stub-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const input = (ws: string) => ({ workspace: ws, prompt: 'do it', model: 'm', maxTurns: 3, timeoutMs: 10_000, env: { PATH: process.env.PATH! }, log: quiet });

describe('ClaudeCodeHarness.run', () => {
  it('passes the prompt on stdin and parses the JSON result', async () => {
    const bin = stub(`p=$(cat); echo '{"type":"result","is_error":false,"result":"done: '"$p"' args='"$*"'","total_cost_usd":0.42,"num_turns":5}'`);
    const ws = mkdtempSync(join(tmpdir(), 'ws-'));
    const r = await new ClaudeCodeHarness(bin).run(input(ws));
    expect(r).toMatchObject({ ok: true, costUsd: 0.42, turns: 5 });
    expect(r.summary).toContain('done: do it');
    expect(r.summary).toContain('--max-turns 3');
    expect(r.summary).toContain('--dangerously-skip-permissions');
  });

  it('marks API errors as not ok', async () => {
    const bin = stub(`echo '{"type":"result","is_error":true,"result":"Invalid API key","num_turns":1}'`);
    const r = await new ClaudeCodeHarness(bin).run(input(mkdtempSync(join(tmpdir(), 'ws-'))));
    expect(r).toMatchObject({ ok: false, summary: 'Invalid API key' });
  });

  it('reports a crash without JSON', async () => {
    const bin = stub(`echo boom >&2; exit 2`);
    const r = await new ClaudeCodeHarness(bin).run(input(mkdtempSync(join(tmpdir(), 'ws-'))));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('exited 2');
  });
});
