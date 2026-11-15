# software-factory

A minimal software factory. GitHub issues, PR comments and PR reviews go in, and a headless coding agent's commits and pull requests come out.

Design doc: https://claude.ai/artifact/NpLUQPhrBLzmJfmATf5dCT

## What triggers it

| Trigger | What the factory does |
| --- | --- |
| Issue labelled `factory`, or `/factory build [extra instruction]` on an issue | Implements the issue and opens a draft PR (`Closes #n`) from `factory/<n>-<slug>` |
| `/factory plan` on an issue or PR | Posts an implementation plan and changes nothing |
| `/factory <instruction>` on a PR | Pushes a commit to that PR's branch |
| A "changes requested" review on a PR whose branch is `factory/*` | Addresses the review and pushes |

Flags: `/factory --harness <name> --model <id> ...` override the config for one run.

Each run reacts 👀 when it starts, then replies with a summary, the test result, the cost and a link to the run log.

## How it works

The logic lives in one TypeScript CLI (`factory run --event event.json`) shipped as a container image. v1 runs it from GitHub Actions. v2 runs the same image as a Tekton task.

1. **Fetch context**: the issue or PR, the comment thread, the diff and any review comments.
2. **Resolve skills**: pinned sources from `.factory.yml` are fetched at their exact commit and placed where the harness looks.
3. **Run the harness**: a prompt template per trigger (`src/prompts/`, overridable in `.factory/prompts/`) is passed to a headless agent CLI through an adapter (`src/harness/`).
4. **Commit and push**: done by the factory with the GitHub App token. The harness never sees that token.
5. **Reply on GitHub**.

Security notes:
- `.factory.yml` is always read from the default branch, so a PR cannot widen its own allowlist.
- The harness and the repo's `setup`/`test` commands run with a minimal environment: `PATH`, `HOME`, the model key, and nothing else.
- PRs from forks are refused.
- Comments and reviews from bots are ignored, which prevents loops.

## Layout

```
src/
  cli.ts            entry point: event → job → pipeline
  triggers.ts       event parsing and the /factory command grammar
  pipeline.ts       the five steps
  context.ts        step 1
  skills.ts         step 2 (github:<owner>/<repo>@<sha>#<path>)
  harness/          adapters: claude-code, fake (codex, opencode in v1.1)
  git.ts            clone, branch, commit, push (token passed per command only)
  github.ts         the small GitHub API surface, behind an interface
  config.ts         .factory.yml with defaults
  prompts/          one template per trigger + shared rules
test/               event fixtures, a fake GitHub and the fake harness; runs the whole pipeline against local git repos
.github/workflows/  factory.yml (reusable), image.yml (GHCR), ci.yml
examples/           what a target repo adds: workflow + .factory.yml
```

## Develop

```bash
npm install
npm test          # 34 tests, no network or model needed
npm run build
node dist/cli.js run --event test/fixtures/issues-labeled.json --event-name issues   # needs FACTORY_GITHUB_TOKEN
```

## Set up the POC

1. **Push this repo** to `github.com/giova333/software-factory`. `image.yml` then publishes `ghcr.io/giova333/software-factory:main`. In the package settings, set its visibility to **public**, or the target repo can't pull it.
2. **Create a GitHub App** (Settings → Developer settings → GitHub Apps), for example `factory-bot`:
   - Webhook: off.
   - Repository permissions: Contents **read/write**, Issues **read/write**, Pull requests **read/write**, Metadata read.
   - Install it on the sandbox repo only. Note the App ID and generate a private key.
3. **Create a sandbox repo** and add:
   - [`examples/factory.yml`](examples/factory.yml) → `.github/workflows/factory.yml`
   - [`examples/.factory.yml`](examples/.factory.yml) → `.factory.yml`, adjusting `setup` and `test`
   - Secrets: `ANTHROPIC_API_KEY`, `FACTORY_APP_ID`, `FACTORY_APP_PRIVATE_KEY`
   - A `factory` label
4. Open an issue and add the `factory` label.

## Roadmap

- **v1** (this): GitHub Actions with Claude Code.
- **v1.1**: Codex and OpenCode adapters.
- **v2**: Kubernetes and Tekton (EventListener → Triggers → PipelineRun), skills from an OCI registry via `oras pull`, and the same image as the agent pod.
