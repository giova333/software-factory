import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeHarness } from '../src/harness/claude-code.js';
import { placeSkills, shimInstructions } from '../src/harness/shared.js';
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

describe('placeSkills and shimInstructions', () => {
  it('a skill the repo already defines wins over a pinned one', async () => {
    const src = mkdtempSync(join(tmpdir(), 'skill-src-'));
    for (const name of ['tdd', 'grilling']) {
      mkdirSync(join(src, name));
      writeFileSync(join(src, name, 'SKILL.md'), `pinned ${name}`);
    }
    const ws = mkdtempSync(join(tmpdir(), 'ws-'));
    mkdirSync(join(ws, '.claude/skills/tdd'), { recursive: true });
    writeFileSync(join(ws, '.claude/skills/tdd/SKILL.md'), 'repo tdd');
    const skills = ['tdd', 'grilling'].map((name) => ({ name, source: 's', dir: join(src, name) }));
    const created = await placeSkills(ws, '.claude/skills', skills);
    expect(created).toEqual(['.claude/skills/grilling']);
    expect(readFileSync(join(ws, '.claude/skills/tdd/SKILL.md'), 'utf8')).toBe('repo tdd');
  });

  it('does not overwrite an existing CLAUDE.md', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-'));
    writeFileSync(join(ws, 'AGENTS.md'), '# rules');
    writeFileSync(join(ws, 'CLAUDE.md'), '# mine');
    expect(await shimInstructions(ws, 'CLAUDE.md', '@AGENTS.md\n')).toEqual([]);
    expect(readFileSync(join(ws, 'CLAUDE.md'), 'utf8')).toBe('# mine');
  });

  it('does nothing without AGENTS.md', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-'));
    expect(await shimInstructions(ws, 'CLAUDE.md', '@AGENTS.md\n')).toEqual([]);
    expect(existsSync(join(ws, 'CLAUDE.md'))).toBe(false);
  });
});
