import { exec } from '../exec.js';
import type { ResolvedSkill } from '../skills.js';
import { placeSkills, shimInstructions } from './shared.js';
import type { Harness, HarnessResult, HarnessRunInput } from './types.js';

/** Claude Code in headless print mode (`claude -p`). */
export class ClaudeCodeHarness implements Harness {
  readonly name = 'claude-code';

  constructor(private readonly bin = 'claude') {}

  async prepare(workspace: string, skills: ResolvedSkill[]): Promise<string[]> {
    return [
      ...(await placeSkills(workspace, '.claude/skills', skills)),
      // Claude Code reads CLAUDE.md; `@AGENTS.md` imports the neutral file.
      ...(await shimInstructions(workspace, 'CLAUDE.md', '@AGENTS.md\n')),
    ];
  }

  async run(input: HarnessRunInput): Promise<HarnessResult> {
    const args = [
      '-p',
      '--output-format', 'json',
      '--model', input.model,
      '--max-turns', String(input.maxTurns),
      // The run happens in a disposable container with no GitHub credentials.
      '--dangerously-skip-permissions',
    ];
    input.log.info(`claude ${args.join(' ')}`);
    const res = await exec(this.bin, args, {
      cwd: input.workspace,
      env: input.env,
      input: input.prompt,
      timeoutMs: input.timeoutMs,
      check: false,
    });
    const transcript = `${res.stdout}\n--- stderr ---\n${res.stderr}`;
    if (res.timedOut) return { ok: false, summary: `Claude Code timed out after ${Math.round(input.timeoutMs / 60000)} min.`, transcript };
    try {
      const out = JSON.parse(res.stdout.trim().split('\n').pop() ?? '');
      return {
        ok: res.code === 0 && !out.is_error,
        summary: String(out.result ?? '').trim() || '(no summary)',
        transcript,
        costUsd: typeof out.total_cost_usd === 'number' ? out.total_cost_usd : undefined,
        turns: typeof out.num_turns === 'number' ? out.num_turns : undefined,
      };
    } catch {
      return { ok: false, summary: `Claude Code exited ${res.code} without a JSON result.\n\n${res.stderr.slice(-2000)}`, transcript };
    }
  }
}
