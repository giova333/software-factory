export type JobKind = 'build' | 'plan' | 'instruct' | 'review-fix';

export interface RepoRef {
  owner: string;
  name: string;
}

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
