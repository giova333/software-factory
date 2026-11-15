import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAuthorized } from './auth.js';
import { loadConfig, type FactoryConfig } from './config.js';
import { fetchContext, type TaskContext } from './context.js';
import { sandboxEnv, sh } from './exec.js';
import { Git, type GitIdentity } from './git.js';
import type { GitHub } from './github.js';
import type { Harness, HarnessResult } from './harness/index.js';
import { loadPromptTemplate, renderPrompt } from './prompts.js';
import { resolveSkills, type SkillSource } from './skills.js';
import { repoFullName, type Job, type Logger } from './types.js';

export interface PipelineDeps {
  gh: GitHub;
  log: Logger;
  /** Scratch directory for this run (checkout, skills). */
  workRoot: string;
  /** Where the transcript, prompt and run.json go. */
  outDir: string;
  repoUrl: string;
  /** Token for git push. Only the factory process uses it. */
  token?: string;
  identity: GitIdentity;
  createHarness: (name: string) => Harness;
  /** Link to this run, shown in replies. */
  runUrl?: string;
  /** Hard allowlist from the runtime; overrides allowed_users in .factory.yml. */
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

function formatUsd(n?: number): string {
  return n === undefined ? 'n/a' : `$${n.toFixed(2)}`;
}

/** The parts of every reply that do not change during a run. */
interface ReplyContext {
  job: Job;
  harness: string;
  model: string;
  runUrl?: string;
}

function formatReply(
  c: ReplyContext,
  p: {
    ok: boolean;
    result?: HarnessResult;
    pr?: { number: number; url: string };
    changed?: boolean;
    tests?: TestOutcome;
    error?: string;
  },
): string {
  const head = [
    `**Factory run** ${p.ok ? '✅' : '⚠️'}`,
    `harness \`${c.harness}\``,
    `model \`${c.model}\``,
    p.result?.turns !== undefined ? `${p.result.turns} turns` : undefined,
    `cost ${formatUsd(p.result?.costUsd)}`,
    c.runUrl ? `[run log](${c.runUrl})` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const lines = [head, ''];
  if (p.error) {
    lines.push(`The run failed: ${p.error}`);
    return lines.join('\n');
  }
  if (c.job.kind !== 'plan') {
    if (p.pr && c.job.kind === 'build') lines.push(`Pull request: ${p.pr.url}`);
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

function promptVars(job: Job, ctx: TaskContext, cfg: FactoryConfig): Record<string, string | undefined> {
  return {
    repo: repoFullName(job.repo),
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

/** What run.json holds: written once config is resolved, then updated with the outcome. */
interface RunRecord {
  job: Job;
  harness: string;
  model: string;
  config: FactoryConfig;
  skills: string[];
  startedAt: string;
  finishedAt?: string;
  status?: RunStatus;
  costUsd?: number;
  turns?: number;
  error?: string;
}

/** A run whose config is resolved, before any work starts. */
interface Run {
  job: Job;
  deps: PipelineDeps;
  git: Git;
  workspace: string;
  cfg: FactoryConfig;
  reply: ReplyContext;
  /** Prompt template, loaded from the default branch before the work branch is checked out. */
  template: string;
  /** Epoch ms by which the whole run must be done: start + limits.timeout_minutes. */
  deadline: number;
  record: RunRecord;
  result?: HarnessResult;
}

async function writeRunRecord(run: Run): Promise<void> {
  await writeFile(join(run.deps.outDir, 'run.json'), JSON.stringify(run.record, null, 2));
}

/** Milliseconds left before the run deadline; throws if there are none left for `step`. */
function timeLeft(run: Run, step: string): number {
  const ms = run.deadline - Date.now();
  if (ms <= 0) throw new Error(`the run deadline (${run.cfg.limits.timeout_minutes} min) passed before ${step}`);
  return ms;
}

/**
 * Clone the default branch and resolve everything that must come from it: config (never read from
 * a PR branch the requester could edit) and the prompt template (so a PR cannot rewrite the agent's rules).
 */
async function resolveRun(job: Job, deps: PipelineDeps, startedAt: number): Promise<Run> {
  const workspace = join(deps.workRoot, 'repo');
  const git = new Git(workspace, deps.repoUrl, deps.token, deps.identity);
  await git.clone(await deps.gh.getDefaultBranch());
  const cfg = await loadConfig(workspace);
  if (deps.allowedUsers && deps.allowedUsers.length > 0) cfg.allowed_users = deps.allowedUsers;
  const reply: ReplyContext = { job, harness: job.harness ?? cfg.harness, model: job.model ?? cfg.model, runUrl: deps.runUrl };
  const run: Run = {
    job,
    deps,
    git,
    workspace,
    cfg,
    reply,
    template: await loadPromptTemplate(job.kind, workspace),
    deadline: startedAt + cfg.limits.timeout_minutes * 60_000,
    record: { job, harness: reply.harness, model: reply.model, config: cfg, skills: cfg.skills, startedAt: new Date(startedAt).toISOString() },
  };
  await writeRunRecord(run);
  return run;
}

interface Work {
  ctx: TaskContext;
  startSha: string;
  result: HarnessResult;
  tests: TestOutcome;
}

/** Steps 1–3 (context, skills, harness), plus setup before and tests after. */
/** Upper bound for the repo's setup command, within the run deadline. */
const SETUP_TIMEOUT_MS = 10 * 60_000;

async function doWork(run: Run): Promise<Work> {
  const { job, deps, git, workspace, cfg } = run;

  // 1. Fetch context
  const ctx = await fetchContext(job, deps.gh);
  if (job.kind !== 'plan' || job.isPullRequest) {
    const state = await git.checkoutWorkBranch(ctx.branch, ctx.baseBranch);
    deps.log.info(`working on ${ctx.branch} (${state})`);
  }
  const startSha = await git.head();

  // 2. Resolve skills
  const harness = deps.createHarness(run.reply.harness);
  const skills = await resolveSkills(cfg.skills, join(deps.workRoot, 'skills'), deps.workRoot, deps.log, deps.skillFetchUrl);
  run.record.skills = skills.map((s) => s.source);
  await git.exclude(await harness.prepare(workspace, skills));

  const env = sandboxEnv();
  if (cfg.setup && job.kind !== 'plan') {
    deps.log.info(`setup: ${cfg.setup}`);
    // Setup gets its own cap so a stalled download can't eat the whole run before the agent starts.
    const capMs = Math.min(SETUP_TIMEOUT_MS, timeLeft(run, 'setup'));
    const s = await sh(cfg.setup, { cwd: workspace, env, timeoutMs: capMs });
    if (s.timedOut) {
      const why = capMs < SETUP_TIMEOUT_MS
        ? `ran past the run deadline (${cfg.limits.timeout_minutes} min)`
        : `timed out after ${SETUP_TIMEOUT_MS / 60_000} min`;
      throw new Error(`setup command ${why}. Last output:\n${(s.stdout + s.stderr).slice(-1500)}`);
    }
    if (s.code !== 0) throw new Error(`setup command failed (exit ${s.code}): ${s.stderr.slice(-1500)}`);
  }

  // 3. Run the harness
  const prompt = renderPrompt(run.template, promptVars(job, ctx, cfg));
  await writeFile(join(deps.outDir, 'prompt.md'), prompt);
  const result = await harness.run({ workspace, prompt, model: run.reply.model, maxTurns: cfg.limits.max_turns, timeoutMs: timeLeft(run, 'the harness'), env, log: deps.log });
  run.result = result;
  await writeFile(join(deps.outDir, 'transcript.txt'), result.transcript);

  // Verify (informational; the agent was asked to keep tests green)
  let tests: TestOutcome = { ran: false };
  if (cfg.test && job.kind !== 'plan') {
    const t = await sh(cfg.test, { cwd: workspace, env, timeoutMs: Math.min(15 * 60_000, timeLeft(run, 'tests')) });
    tests = { ran: true, ok: t.code === 0, code: t.code, tail: (t.stdout + t.stderr).slice(-3000) };
  }
  return { ctx, startSha, result, tests };
}

/** Steps 4–5: commit, push, open the PR, reply. A plan only replies. */
async function publish(run: Run, w: Work): Promise<RunOutcome> {
  const { job, deps, git } = run;
  const { ctx, startSha, result, tests } = w;

  if (job.kind === 'plan') {
    await deps.gh.comment(job.number, formatReply(run.reply, { ok: result.ok, result }));
    return { status: 'planned', result };
  }

  // 4. Commit and push
  if (await git.hasUncommitted()) {
    await git.commitAll(`factory: ${ctx.title} (#${job.number})\n\n${job.kind}${job.instruction ? `: ${job.instruction}` : ''}${deps.runUrl ? `\n\nFactory-Run: ${deps.runUrl}` : ''}`);
  }
  const changed = (await git.head()) !== startSha;
  let pr = ctx.pr;
  if (changed) {
    await git.push(ctx.branch);
    deps.log.info(`pushed ${ctx.branch}\n${await git.diffStat(startSha)}`);
    if (!pr && job.kind === 'build') {
      const created = await deps.gh.createDraftPull({
        title: ctx.title,
        head: ctx.branch,
        base: ctx.baseBranch,
        body: `Closes #${job.number}\n\n${result.summary}\n\n---\n_Opened by the software factory${deps.runUrl ? ` · [run log](${deps.runUrl})` : ''}_`,
      });
      pr = { number: created.number, url: created.url };
    }
  }

  // 5. Reply
  await deps.gh.comment(job.number, formatReply(run.reply, { ok: result.ok && (tests.ok ?? true), result, pr, changed, tests }));
  return { status: changed ? 'pushed' : 'no-changes', pr, result };
}

/** Authorize the actor, then work and publish; any failure becomes a failure reply. */
async function execute(run: Run): Promise<RunOutcome> {
  const { job, deps } = run;
  if (!(await isAuthorized(job.actor, run.cfg, deps.gh))) {
    deps.log.warn(`@${job.actor} is not allowed to trigger the factory; skipping silently.`);
    return { status: 'unauthorized' };
  }
  await deps.gh.reactEyes(job.commentId ? { commentId: job.commentId } : { issueNumber: job.number }).catch((e) => deps.log.warn(`reaction failed: ${e}`));

  try {
    return await publish(run, await doWork(run));
  } catch (e: any) {
    const error = String(e?.message ?? e).slice(0, 2000);
    deps.log.warn(`run failed: ${error}`);
    await deps.gh
      .comment(job.number, formatReply(run.reply, { ok: false, result: run.result, error }))
      .catch((ce) => deps.log.warn(`failure comment failed: ${ce}`));
    return { status: 'failed', result: run.result, error };
  }
}

/** Run one job end to end: resolve config and authorize, then work, then publish. */
export async function runJob(job: Job, deps: PipelineDeps): Promise<RunOutcome> {
  const startedAt = Date.now();
  await mkdir(deps.outDir, { recursive: true });
  const run = await resolveRun(job, deps, startedAt);
  let outcome: RunOutcome = { status: 'failed', error: 'the run stopped unexpectedly' };
  try {
    outcome = await execute(run);
    return outcome;
  } catch (e: any) {
    outcome = { status: 'failed', result: run.result, error: String(e?.message ?? e).slice(0, 2000) };
    throw e;
  } finally {
    Object.assign(run.record, {
      finishedAt: new Date().toISOString(),
      status: outcome.status,
      costUsd: outcome.result?.costUsd,
      turns: outcome.result?.turns,
      error: outcome.error,
    });
    await writeRunRecord(run);
  }
}
