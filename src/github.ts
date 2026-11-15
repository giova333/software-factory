import { Octokit } from '@octokit/rest';
import { repoFullName, type RepoRef } from './types.js';

export interface Issue {
  title: string;
  body: string;
}

export interface Comment {
  author: string;
  body: string;
  createdAt: string;
}

export interface Pull {
  number: number;
  title: string;
  body: string;
  headRef: string;
  headRepo: string; // owner/name
  baseRef: string;
  url: string;
}

export interface ReviewComment {
  author: string;
  path: string;
  line: number | null;
  body: string;
}

/** The slice of the GitHub API the factory needs. Kept small so tests can fake it. */
export interface GitHub {
  getIssue(n: number): Promise<Issue>;
  listIssueComments(n: number): Promise<Comment[]>;
  getPull(n: number): Promise<Pull>;
  getPullDiff(n: number): Promise<string>;
  getReviewBody(pr: number, reviewId: number): Promise<string>;
  listReviewComments(pr: number, reviewId: number): Promise<ReviewComment[]>;
  getPermission(user: string): Promise<string>;
  getDefaultBranch(): Promise<string>;
  reactEyes(target: { commentId?: number; issueNumber?: number }): Promise<void>;
  comment(n: number, body: string): Promise<void>;
  /** An open PR whose head branch (in this repo, not a fork) starts with `prefix`. */
  findOpenPullByHeadPrefix(prefix: string): Promise<Pull | null>;
  createDraftPull(p: { title: string; head: string; base: string; body: string }): Promise<Pull>;
}

function toPull(p: any): Pull {
  return {
    number: p.number,
    title: p.title,
    body: p.body ?? '',
    headRef: p.head.ref,
    headRepo: p.head.repo?.full_name ?? '',
    baseRef: p.base.ref,
    url: p.html_url,
  };
}

export class OctokitGitHub implements GitHub {
  private readonly o: Octokit;
  private readonly r: { owner: string; repo: string };

  constructor(token: string, repo: RepoRef, baseUrl?: string) {
    this.o = new Octokit({ auth: token, baseUrl, userAgent: 'software-factory' });
    this.r = { owner: repo.owner, repo: repo.name };
  }

  async getIssue(n: number): Promise<Issue> {
    const { data } = await this.o.issues.get({ ...this.r, issue_number: n });
    return { title: data.title, body: data.body ?? '' };
  }

  async listIssueComments(n: number): Promise<Comment[]> {
    const data = await this.o.paginate(this.o.issues.listComments, { ...this.r, issue_number: n, per_page: 100 });
    return data.map((c) => ({ author: c.user?.login ?? '', body: c.body ?? '', createdAt: c.created_at }));
  }

  async getPull(n: number): Promise<Pull> {
    const { data } = await this.o.pulls.get({ ...this.r, pull_number: n });
    return toPull(data);
  }

  async getPullDiff(n: number): Promise<string> {
    const res = await this.o.pulls.get({ ...this.r, pull_number: n, mediaType: { format: 'diff' } });
    return res.data as unknown as string;
  }

  async getReviewBody(pr: number, reviewId: number): Promise<string> {
    const { data } = await this.o.pulls.getReview({ ...this.r, pull_number: pr, review_id: reviewId });
    return data.body ?? '';
  }

  async listReviewComments(pr: number, reviewId: number): Promise<ReviewComment[]> {
    const data = await this.o.paginate(this.o.pulls.listCommentsForReview, {
      ...this.r,
      pull_number: pr,
      review_id: reviewId,
      per_page: 100,
    });
    return data.map((c: any) => ({ author: c.user?.login ?? '', path: c.path, line: c.line ?? c.original_line ?? null, body: c.body }));
  }

  async getPermission(user: string): Promise<string> {
    try {
      const { data } = await this.o.repos.getCollaboratorPermissionLevel({ ...this.r, username: user });
      return data.permission;
    } catch (e: any) {
      if (e.status === 404) return 'none';
      throw e;
    }
  }

  async getDefaultBranch(): Promise<string> {
    const { data } = await this.o.repos.get(this.r);
    return data.default_branch;
  }

  async reactEyes(target: { commentId?: number; issueNumber?: number }): Promise<void> {
    if (target.commentId) {
      await this.o.reactions.createForIssueComment({ ...this.r, comment_id: target.commentId, content: 'eyes' });
    } else if (target.issueNumber) {
      await this.o.reactions.createForIssue({ ...this.r, issue_number: target.issueNumber, content: 'eyes' });
    }
  }

  async comment(n: number, body: string): Promise<void> {
    await this.o.issues.createComment({ ...this.r, issue_number: n, body });
  }

  async findOpenPullByHeadPrefix(prefix: string): Promise<Pull | null> {
    const fullName = repoFullName({ owner: this.r.owner, name: this.r.repo });
    const data = await this.o.paginate(this.o.pulls.list, { ...this.r, state: 'open', per_page: 100 });
    const match = data.find((p) => p.head.ref.startsWith(prefix) && p.head.repo?.full_name === fullName);
    return match ? toPull(match) : null;
  }

  async createDraftPull(p: { title: string; head: string; base: string; body: string }): Promise<Pull> {
    const { data } = await this.o.pulls.create({ ...this.r, ...p, draft: true });
    return toPull(data);
  }
}
