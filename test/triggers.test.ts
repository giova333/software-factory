import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCommand, parseEvent } from '../src/triggers.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('parseCommand', () => {
  it('ignores non-commands', () => {
    expect(parseCommand('looks good')).toBeNull();
    expect(parseCommand('/factoryx')).toBeNull();
    expect(parseCommand(null)).toBeNull();
  });
  it('treats bare /factory as build', () => {
    expect(parseCommand('/factory')).toEqual({ verb: 'build', text: '' });
  });
  it('parses flags, verbs and free text', () => {
    expect(parseCommand('/factory --harness codex --model=m1 plan keep it small')).toEqual({ verb: 'plan', text: 'keep it small', harness: 'codex', model: 'm1' });
    expect(parseCommand('/factory rename foo to bar')).toEqual({ verb: 'text', text: 'rename foo to bar' });
  });
});

describe('parseEvent', () => {
  it('issue labelled factory → build', () => {
    const r = parseEvent('issues', fixture('issues-labeled'));
    expect(r).toEqual({ job: expect.objectContaining({ kind: 'build', number: 1, isPullRequest: false, actor: 'giova333' }) });
  });
  it('other labels are skipped', () => {
    const p = fixture('issues-labeled');
    p.label.name = 'bug';
    expect(parseEvent('issues', p)).toHaveProperty('skip');
  });
  it('/factory build on an issue → build with flags and instruction', () => {
    const r = parseEvent('issue_comment', fixture('issue-comment-build'));
    expect(r).toEqual({ job: expect.objectContaining({ kind: 'build', harness: 'fake', instruction: 'use plain JS', commentId: 101 }) });
  });
  it('/factory <text> on a PR → instruct', () => {
    const r = parseEvent('issue_comment', fixture('pr-comment'));
    expect(r).toEqual({ job: expect.objectContaining({ kind: 'instruct', number: 7, isPullRequest: true, instruction: 'rename the function to greet' }) });
  });
  it('bare /factory on a PR is skipped', () => {
    const p = fixture('pr-comment');
    p.comment.body = '/factory';
    expect(parseEvent('issue_comment', p)).toHaveProperty('skip');
  });
  it('bot comments are ignored to avoid loops', () => {
    const p = fixture('pr-comment');
    p.comment.user = { login: 'factory-bot[bot]', type: 'Bot' };
    expect(parseEvent('issue_comment', p)).toHaveProperty('skip');
  });
  it('changes requested on a factory branch → review-fix', () => {
    const r = parseEvent('pull_request_review', fixture('review-changes-requested'));
    expect(r).toEqual({ job: expect.objectContaining({ kind: 'review-fix', number: 7, reviewId: 303 }) });
  });
  it('reviews on non-factory branches are skipped', () => {
    const p = fixture('review-changes-requested');
    p.pull_request.head.ref = 'feature/x';
    expect(parseEvent('pull_request_review', p)).toHaveProperty('skip');
  });
  it('approvals are skipped', () => {
    const p = fixture('review-changes-requested');
    p.review.state = 'approved';
    expect(parseEvent('pull_request_review', p)).toHaveProperty('skip');
  });
});
