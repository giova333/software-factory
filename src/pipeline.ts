import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAuthorized } from './auth.js';
import { loadConfig, type FactoryConfig } from './config.js';
import { fetchContext, type TaskContext } from './context.js';
import { sandboxEnv, sh } from './exec.js';
import { Git, type GitIdentity } from './git.js';
import type { GitHub } from './github.js';
import type { Harness, HarnessResult } from './harness/index.js';
import { buildPrompt } from './prompts.js';
import { resolveSkills, type SkillSource } from './skills.js';
import type { Job, Logger } from './types.js';

export interface PipelineDeps {
  gh: GitHub;
  log: Logger;
  /** Scratch directory for this run (checkout, skills). */
  workRoot: string;
  /** Where the transcript, prompt and run.json go (uploaded as an Actions artifact). */
  outDir: string;
  repoUrl: string;
  /** Token for git push. Only the factory process uses it. */
  token?: string;
  identity: GitIdentity;
  createHarness: (name: string) => Harness;
  /** Link to this run, shown in replies. */
  runUrl?: string;
  /** Hard allowlist from the workflow; overrides allowed_users in .factory.yml. */
  allowedUsers?: string[];
  skillFetchUrl?: (s: SkillSource) => string;
}

export type RunStatus = 'unauthorized' | 'no-changes' | 'pushed' | 'planned' | 'failed';

export interface RunOutcome {
  status: RunStatus;
  pr?: { number: number; url: string };
  result?: HarnessResult;
  error?: string;
}

interface TestOutcome {
  ran: boolean;
  ok?: boolean;
  code?: number;
  tail?: string;
}

function money(n?: number): string {
  return n === undefined ? 'n/a' : `$${n.toFixed(2)}`;
}

function formatReply(p: {
  ok: boolean;
  job: Job;
  harness: string;
  model: string;
  result?: HarnessResult;
  runUrl?: string;
  pr?: { number: number; url: string };
  changed?: boolean;
  tests?: TestOutcome;
  error?: string;
}): string {
  const head = [
    `**Factory run** ${p.ok ? '✅' : '⚠️'}`,
    `harness \`${p.harness}\``,
    `model \`${p.model}\``,
    p.result?.turns !== undefined ? `${p.result.turns} turns` : undefined,
    `cost ${money(p.result?.costUsd)}`,
    p.runUrl ? `[run log](${p.runUrl})` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const lines = [head, ''];
  if (p.error) {
    lines.push(`The run failed: ${p.error}`);
    return lines.join('\n');
  }
  if (p.job.kind !== 'plan') {
    if (p.pr && p.job.kind === 'build') lines.push(`Pull request: ${p.pr.url}`);
    lines.push(p.changed ? 'Changes were committed and pushed.' : 'No changes were made.');
    if (p.tests?.ran) {
      lines.push(p.tests.ok ? 'Tests: passed.' : `Tests: failed (exit ${p.tests.code}).`);
    }
    lines.push('');
  }
  lines.push(p.result?.summary ?? '');
  if (p.tests?.ran && !p.tests.ok && p.tests.tail) {
    lines.push('', '<details><summary>Test output (tail)</summary>', '', '```', p.tests.tail, '```', '</details>');
  }
  return lines.join('\n');
}

function vars(job: Job, ctx: TaskContext, cfg: FactoryConfig): Record<string, string | undefined> {
  return {
    repo: `${job.repo.owner}/${job.repo.name}`,
    number: String(job.number),
    title: ctx.title,
    body: ctx.body,
    thread: ctx.thread,
    instruction: job.instruction,
    diff: ctx.diff,
    review: ctx.review,
    review_comments: ctx.reviewComments,
    branch: ctx.branch,
    test_hint: cfg.test
      ? `run \`${cfg.test}\` and make sure it passes before you finish. The factory runs it again afterwards.`
      : 'no test command is configured; run whatever checks the repository provides.',
  };
}

/** Run one job end to end: context → skills → harness → commit/push/PR → reply. */
export async function runJob(job: Job, d: PipelineDeps): Promise<RunOutcome> {
  const { gh, log } = d;
  const workspace = join(d.workRoot, 'repo');
  await mkdir(d.outDir, { recursive: true });

  // Read config from the default branch, never from a PR branch the requester could edit.
  const defaultBranch = await gh.getDefaultBranch();
  const git = new Git(workspace, d.repoUrl, d.token, d.identity);
  await git.clone(defaultBranch);
  const cfg = await loadConfig(workspace);
  if (d.allowedUsers && d.allowedUsers.length > 0) cfg.allowed_users = d.allowedUsers;

  if (!(await isAuthorized(job.actor, cfg, gh))) {
    log.warn(`@${job.actor} is not allowed to trigger the factory; skipping silently.`);
    return { status: 'unauthorized' };
  }

  await gh.reactEyes(job.commentId ? { commentId: job.commentId } : { issueNumber: job.number }).catch((e) => log.warn(`reaction failed: ${e}`));

  const harnessName = job.harness ?? cfg.harness;
  const model = job.model ?? cfg.model;
  let result: HarnessResult | undefined;

  try {
    // 1. Fetch context
    const ctx = await fetchContext(job, gh, cfg.branch_prefix);
    if (job.kind !== 'plan' || job.isPullRequest) {
      const state = await git.checkoutWorkBranch(ctx.branch, ctx.baseBranch);
      log.info(`working on ${ctx.branch} (${state})`);
    }
    const startSha = await git.head();

    // 2. Resolve skills
    const harness = d.createHarness(harnessName);
    const skills = await resolveSkills(cfg.skills, join(d.workRoot, 'skills'), d.workRoot, log, d.skillFetchUrl);
    await git.exclude(await harness.prepare(workspace, skills));

    const env = sandboxEnv();
    const timeoutMs = cfg.limits.timeout_minutes * 60_000;
    if (cfg.setup && job.kind !== 'plan') {
      log.info(`setup: ${cfg.setup}`);
      const s = await sh(cfg.setup, { cwd: workspace, env, timeoutMs });
      if (s.code !== 0) throw new Error(`setup command failed (exit ${s.code}): ${s.stderr.slice(-1500)}`);
    }

    // 3. Run the harness
    const prompt = await buildPrompt(job.kind, workspace, vars(job, ctx, cfg));
    await writeFile(join(d.outDir, 'prompt.md'), prompt);
    result = await harness.run({ workspace, prompt, model, maxTurns: cfg.limits.max_turns, timeoutMs, env, log });
    await writeFile(join(d.outDir, 'transcript.txt'), result.transcript);
    await writeFile(
      join(d.outDir, 'run.json'),
      JSON.stringify({ job, harness: harnessName, model, config: cfg, skills: skills.map((s) => s.source), costUsd: result.costUsd, turns: result.turns }, null, 2),
    );

    if (job.kind === 'plan') {
      await gh.comment(job.number, formatReply({ ok: result.ok, job, harness: harnessName, model, result, runUrl: d.runUrl }));
      return { status: 'planned', result };
    }

    // Verify (informational; the agent was asked to keep tests green)
    let tests: TestOutcome = { ran: false };
    if (cfg.test) {
      const t = await sh(cfg.test, { cwd: workspace, env, timeoutMs: 15 * 60_000 });
      tests = { ran: true, ok: t.code === 0, code: t.code, tail: (t.stdout + t.stderr).slice(-3000) };
    }

    // 4. Commit and push
    if (await git.hasUncommitted()) {
      await git.commitAll(`factory: ${ctx.title} (#${job.number})\n\n${job.kind}${job.instruction ? `: ${job.instruction}` : ''}${d.runUrl ? `\n\nFactory-Run: ${d.runUrl}` : ''}`);
    }
    const changed = (await git.head()) !== startSha;
    let pr = ctx.pr;
    if (changed) {
      await git.push(ctx.branch);
      log.info(`pushed ${ctx.branch}\n${await git.diffStat(startSha)}`);
      if (!pr && job.kind === 'build') {
        const created = await gh.createDraftPull({
          title: ctx.title,
          head: ctx.branch,
          base: ctx.baseBranch,
          body: `Closes #${job.number}\n\n${result.summary}\n\n---\n_Opened by the software factory${d.runUrl ? ` · [run log](${d.runUrl})` : ''}_`,
        });
        pr = { number: created.number, url: created.url };
      }
    }

    // 5. Reply
    await gh.comment(job.number, formatReply({ ok: result.ok && (tests.ok ?? true), job, harness: harnessName, model, result, runUrl: d.runUrl, pr, changed, tests }));
    return { status: changed ? 'pushed' : 'no-changes', pr, result };
  } catch (e: any) {
    const error = String(e?.message ?? e).slice(0, 2000);
    log.warn(`run failed: ${error}`);
    await gh
      .comment(job.number, formatReply({ ok: false, job, harness: harnessName, model, result, runUrl: d.runUrl, error }))
      .catch((ce) => log.warn(`failure comment failed: ${ce}`));
    return { status: 'failed', result, error };
  }
}
