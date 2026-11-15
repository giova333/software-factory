import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeHarness } from '../src/harness/claude-code.js';
import { parseSkillSource, resolveSkills } from '../src/skills.js';
import { git, makeOrigin } from './helpers.js';

const SHA = 'a'.repeat(40);
const quiet = { info: () => {}, warn: () => {} };

describe('parseSkillSource', () => {
  it('accepts a pinned source', () => {
    expect(parseSkillSource(`github:mattpocock/skills@${SHA}#skills/productivity/grilling`)).toMatchObject({
      owner: 'mattpocock',
      repo: 'skills',
      sha: SHA,
      path: 'skills/productivity/grilling',
    });
  });
  it.each(['github:mattpocock/skills@main#skills', 'github:mattpocock/skills@v1.0.0', `github:a/b@${SHA.slice(0, 7)}`, `github:a/b@${SHA}#../etc`])(
    'rejects %s',
    (raw) => expect(() => parseSkillSource(raw)).toThrow(),
  );
});

describe('resolveSkills + ClaudeCodeHarness.prepare', () => {
  it('fetches a pinned commit, finds every SKILL.md under the path, and places them in .claude/skills', async () => {
    const { bare } = makeOrigin({
      'skills/productivity/grilling/SKILL.md': '---\nname: grilling\n---\n',
      'skills/engineering/tdd/SKILL.md': '---\nname: tdd\n---\n',
      'skills/engineering/tdd/ref.md': 'extra',
      'README.md': 'x',
    });
    const sha = git(bare, 'rev-parse', 'main');
    const work = mkdtempSync(join(tmpdir(), 'skills-'));
    const skills = await resolveSkills([`github:me/skills@${sha}#skills`], join(work, 'skills'), work, quiet, () => `file://${bare}`);
    expect(skills.map((s) => s.name).sort()).toEqual(['grilling', 'tdd']);

    const ws = mkdtempSync(join(tmpdir(), 'ws-'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(ws, 'AGENTS.md'), '# rules');
    const created = await new ClaudeCodeHarness().prepare(ws, skills);
    expect(created.sort()).toEqual(['.claude/skills/grilling', '.claude/skills/tdd', 'CLAUDE.md']);
    expect(existsSync(join(ws, '.claude/skills/tdd/ref.md'))).toBe(true);
  });
});
