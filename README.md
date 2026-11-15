# software-factory

Label a GitHub issue, and an AI coding agent implements it and opens a pull request.
Comment on the PR or request changes, and it pushes a fix.

📐 [Architecture diagrams](https://giova333.github.io/software-factory/)

## How you use it

| You do this | The factory does this |
| --- | --- |
| Add the `factory` label to an issue (or comment `/factory build`) | Implements it and opens a draft PR that closes the issue |
| Comment `/factory plan` | Posts a plan and changes nothing |
| Comment `/factory <instruction>` on its PR | Pushes a commit doing that |
| Request changes in a review on its PR | Addresses the review and pushes |

It reacts 👀 when it starts, and replies when done with a summary, the test result, the cost and a link to the run.

## How it works

A GitHub Actions workflow in your repo calls this repo's reusable workflow, which runs the factory's container image. For each event the factory:

1. reads the issue or PR and its comments,
2. fetches any skills listed in the config,
3. runs a headless coding agent (Claude Code today; Codex and OpenCode later),
4. commits and pushes the result itself,
5. replies on GitHub.

The agent never gets the GitHub token: only the factory can push. The config and prompts are read from the default branch, so a PR can't change its own rules.

## Add it to a repo

[`example-target-repo/`](example-target-repo) is a complete, minimal example. A repo needs:

1. **`.github/workflows/factory.yml`**: forwards events to the factory ([example](example-target-repo/.github/workflows/factory.yml)).
2. **`.factory.yml`**: which agent and model to use, who may trigger it, how to install and test ([example](example-target-repo/.factory.yml)).
3. **Secrets**: `ANTHROPIC_API_KEY`, `FACTORY_APP_ID`, `FACTORY_APP_PRIVATE_KEY`.
4. **A `factory` label.**
5. Optional: an Actions variable `FACTORY_ALLOWED_USERS` (e.g. `giova333`), a list of who may trigger runs that a PR can't edit.

### One-time setup

- **GitHub App.** Create one (e.g. `factory-bot`) with webhooks off and read/write access to Contents, Issues and Pull requests. Install it on your target repos. Its ID and private key are the two `FACTORY_APP_*` secrets.
- **Image.** Pushing to `main` publishes `ghcr.io/giova333/software-factory:main`.
- **Private factory repo?** Allow access in Settings → Actions → General → Access, and give target repos read access to the image package. Target repos must be private too.
- **Docs site.** Set Settings → Pages → Source to "GitHub Actions".

## `.factory.yml`

```yaml
harness: claude-code        # the agent CLI
model: claude-sonnet-5-5
allowed_users: [giova333]   # empty = anyone with write access
skills: []                  # e.g. github:mattpocock/skills@<commit-sha>#skills/engineering/tdd
setup: npm ci               # run before the agent
test: npm test              # the agent must keep this green
limits:
  timeout_minutes: 30
  max_turns: 60
```

All keys are optional. Skills must be pinned to a full commit SHA.

## Limits worth knowing

- One run at a time per issue or PR. If several events pile up, only the newest waiting one survives, so just re-send a trigger if one was dropped.
- PRs from forks and comments from bots are ignored.

## Develop

```bash
npm install
npm test        # runs offline, no model needed
npm run build
```

Code is in `src/`: `triggers.ts` parses events, `pipeline.ts` runs the steps, `harness/` holds the agent adapters, and `prompts/` holds one prompt per trigger.

## Roadmap

- **v1** (now): GitHub Actions + Claude Code
- **v1.1**: Codex and OpenCode
- **v2**: Kubernetes + Tekton, with skills pulled from an OCI registry
