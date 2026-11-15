import type { GitHub } from './github.js';
import type { Job } from './types.js';

const MAX_DIFF = 60_000;
const MAX_THREAD = 40_000;

export interface TaskContext {
  title: string;
  body: string;
  thread: string;
  diff?: string;
  review?: string;
  reviewComments?: string;
  /** Branch the factory works on. */
  branch: string;
  /** Branch new work starts from / PRs target. */
  baseBranch: string;
  /** Existing PR for this work, if any. */
  pr?: { number: number; url: string };
}

export function slugify(s: string, max = 40): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'task';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + `\n\n…(truncated ${s.length - max} characters)`;
}

function renderThread(comments: { author: string; body: string; createdAt: string }[]): string {
  const visible = comments.filter((c) => !c.author.endsWith('[bot]'));
  if (visible.length === 0) return '';
  return truncate(visible.map((c) => `**@${c.author}** (${c.createdAt}):\n${c.body}`).join('\n\n---\n\n'), MAX_THREAD);
}

/** Step 1: gather everything the agent needs about the issue or PR. */
export async function fetchContext(job: Job, gh: GitHub, branchPrefix: string): Promise<TaskContext> {
  const fullName = `${job.repo.owner}/${job.repo.name}`;

  if (!job.isPullRequest) {
    const [issue, comments, base] = await Promise.all([gh.getIssue(job.number), gh.listIssueComments(job.number), gh.getDefaultBranch()]);
    const branch = `${branchPrefix}${job.number}-${slugify(issue.title)}`;
    const existing = await gh.findOpenPullByHead(branch);
    return {
      title: issue.title,
      body: issue.body,
      thread: renderThread(comments),
      branch,
      baseBranch: base,
      pr: existing ? { number: existing.number, url: existing.url } : undefined,
    };
  }

  const pull = await gh.getPull(job.number);
  if (pull.headRepo !== fullName) {
    throw new Error(`PR #${job.number} comes from a fork (${pull.headRepo}); the factory only works on branches in ${fullName}.`);
  }
  const [comments, diff] = await Promise.all([gh.listIssueComments(job.number), gh.getPullDiff(job.number)]);
  const ctx: TaskContext = {
    title: pull.title,
    body: pull.body,
    thread: renderThread(comments),
    diff: truncate(diff, MAX_DIFF),
    branch: pull.headRef,
    baseBranch: pull.baseRef,
    pr: { number: pull.number, url: pull.url },
  };
  if (job.kind === 'review-fix' && job.reviewId) {
    const [review, rc] = await Promise.all([gh.getReviewBody(job.number, job.reviewId), gh.listReviewComments(job.number, job.reviewId)]);
    ctx.review = review;
    ctx.reviewComments = rc.map((c) => `- \`${c.path}${c.line ? `:${c.line}` : ''}\` (@${c.author}): ${c.body}`).join('\n');
  }
  return ctx;
}
