import type { ResolvedSkill } from '../skills.js';
import type { Logger } from '../types.js';

export interface HarnessRunInput {
  workspace: string;
  prompt: string;
  model: string;
  maxTurns: number;
  timeoutMs: number;
  /** Environment for the harness process. Never contains GitHub credentials. */
  env: Record<string, string>;
  log: Logger;
}

export interface HarnessResult {
  ok: boolean;
  /** Final message from the agent, posted back to GitHub. */
  summary: string;
  /** Raw output, uploaded as a run artifact. */
  transcript: string;
  costUsd?: number;
  turns?: number;
}

/**
 * A headless coding-agent CLI. Adapters only build the command line and place instructions/skills
 * where their harness looks. They never touch git remotes or the GitHub API.
 */
export interface Harness {
  readonly name: string;
  /**
   * Place skills and instructions in the workspace. Returns the workspace-relative paths it created,
   * which the factory excludes from commits.
   */
  prepare(workspace: string, skills: ResolvedSkill[]): Promise<string[]>;
  run(input: HarnessRunInput): Promise<HarnessResult>;
}
