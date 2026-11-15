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

The logic lives in one TypeScript CLI (`factory run --event event.json --event-name issues --token-stdin`) shipped as a container image. v1 runs it from GitHub Actions. v2 runs the same image as a Tekton task.

1. **Fetch context**: the issue or PR, the comment thread, the diff and any review comments.
2. **Resolve skills**: pinned sources from `.factory.yml` are fetched at their exact commit and placed where the harness looks.
3. **Run the harness**: a prompt template per trigger (`src/prompts/`, overridable in `.factory/prompts/`) is passed to a headless agent CLI through an adapter (`src/harness/`).
4. **Commit and push**: done by the factory with the GitHub App token. The harness never sees that token.
5. **Reply on GitHub**.

Security notes:
- `.factory.yml` and the prompt templates (`.factory/prompts/`) are always read from the default branch, so a PR cannot widen its own allowlist or rewrite the agent's rules.
- The harness and the repo's `setup`/`test` commands run with a minimal environment: `PATH`, `HOME`, the model key, and nothing else.
- The GitHub token reaches the factory on stdin (`factory run --token-stdin`), never through the container environment. The agent runs as the same uid as the factory, so anything in the factory's environment is readable from `/proc/1/environ`. `FACTORY_GITHUB_TOKEN` still works as a fallback for local development, but only the stdin path keeps the token out of `/proc`.
- No child process of the factory inherits a GitHub token. Git runs with hooks and fsmonitor disabled, fetches from and pushes to the repo URL directly (not the `origin` remote), and `.git/config` is restored to the factory's copy before every git command, so whatever the agent writes under `.git/` cannot run code with the token or redirect the push.
- The hard allowlist belongs in the `FACTORY_ALLOWED_USERS` Actions variable (repo or org), which a PR cannot edit. The `allowed_users` workflow input overrides it.
- The allowlist limits who can **trigger** runs. It is not a trust boundary for secrets: anyone with write access can already change workflows and use the repo's secrets directly.
- PRs from forks are refused.
- Comments and reviews from bots are ignored, which prevents loops.
- The `fake` harness is refused unless `FACTORY_ENABLE_FAKE_HARNESS=1`, so `/factory --harness fake` cannot skip the agent in production.

Limits:
- `limits.timeout_minutes` (default 30) bounds the whole run. Setup, the agent and the tests each get only the time that is left. The reusable workflow's job timeout is 60 minutes, so the factory hits its own deadline first and posts a failure reply.
- One run at a time per issue or PR (an Actions concurrency group). GitHub keeps at most **one** pending run per group: if a third event arrives while one run is in progress and another is waiting, the waiting one is cancelled. There is no queue. Re-send a dropped trigger (comment again, or remove and re-add the label).
- Renaming an issue keeps its branch and PR: the factory reuses the open PR whose branch starts with `factory/<n>-`.

## Layout

```
src/
  cli.ts            entry point: event → job → pipeline
  triggers.ts       event parsing and the /factory command grammar
  pipeline.ts       the five steps
  context.ts        step 1
  skills.ts         step 2 (github:<owner>/<repo>@<sha>#<path>)
  harness/          adapters: claude-code, fake for dry runs (codex, opencode in v1.1)
  git.ts            clone, branch, commit, push (token passed per command only)
  github.ts         the small GitHub API surface, behind an interface
  config.ts         .factory.yml with defaults
  fsutil.ts         small filesystem helpers
  prompts/          one template per trigger + shared rules
test/               event fixtures, a fake GitHub and the fake harness; runs the whole pipeline against local git repos
.github/workflows/  factory.yml (reusable), image.yml (GHCR), ci.yml
examples/           what a target repo adds: workflow + .factory.yml
```

## Develop

```bash
npm install
npm test          # 55 tests, no network or model needed
npm run build
# token on stdin (the production path); FACTORY_GITHUB_TOKEN in the env also works locally
printf '%s' "$TOKEN" | node dist/cli.js run --token-stdin --event test/fixtures/issues-labeled.json --event-name issues
```

The CLI takes everything from flags or `FACTORY_*` variables (`--event`/`FACTORY_EVENT_PATH`, `--event-name`/`FACTORY_EVENT_NAME`, `--server-url`/`FACTORY_SERVER_URL`, `--api-url`/`FACTORY_API_URL`) and assumes nothing about GitHub Actions. The server URL defaults to `https://github.com` and the API URL to `https://api.github.com`.

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
   - Variable: `FACTORY_ALLOWED_USERS` (Settings → Secrets and variables → Actions → Variables), e.g. `giova333`. This is the hard allowlist; a PR cannot change it.
   - A `factory` label
4. Open an issue and add the `factory` label.

## Roadmap

- **v1** (this): GitHub Actions with Claude Code.
- **v1.1**: Codex and OpenCode adapters.
- **v2**: Kubernetes and Tekton (EventListener → Triggers → PipelineRun), skills from an OCI registry via `oras pull`, and the same image as the agent pod.
