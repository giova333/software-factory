export type JobKind = 'build' | 'plan' | 'instruct' | 'review-fix';

export interface RepoRef {
  owner: string;
  name: string;
}

/** `owner/name`. */
export function repoFullName(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

/** Every branch the factory creates starts with this. The example workflow's pre-filter must match it. */
export const BRANCH_PREFIX = 'factory/';

/** A unit of work derived from one GitHub event. */
export interface Job {
  kind: JobKind;
  repo: RepoRef;
  /** Issue number (build/plan on an issue) or PR number (instruct/review-fix, or plan on a PR). */
  number: number;
  isPullRequest: boolean;
  actor: string;
  /** Free text after `/factory`, if any. */
  instruction?: string;
  /** Per-run overrides from slash-command flags. */
  harness?: string;
  model?: string;
  /** Comment that triggered the job, used for the 👀 reaction. */
  commentId?: number;
  reviewId?: number;
}

export type ParseResult = { job: Job } | { skip: string };

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}
