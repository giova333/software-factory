# factory-sandbox

A minimal repo set up to be worked on by the software factory. Copy this folder into a new
GitHub repo (e.g. `giova333/factory-sandbox`) to try it end to end.

## What makes it a factory repo

| File | Purpose |
| --- | --- |
| `.github/workflows/factory.yml` | Sends issue, comment and review events to the factory's reusable workflow. |
| `.factory.yml` | Harness, model, who may trigger it, setup/test commands, limits. |
| `AGENTS.md` | Repo conventions the agent reads before it starts. |

## One-time setup in GitHub

1. Install the `factory-bot` GitHub App on this repo (contents, issues, pull requests: read and write).
2. Add repository secrets: `ANTHROPIC_API_KEY`, `FACTORY_APP_ID`, `FACTORY_APP_PRIVATE_KEY`.
3. Optional: add the Actions variable `FACTORY_ALLOWED_USERS=giova333`. Unlike the
   `allowed_users` input in the workflow, a PR can't edit it.
4. Create a label named `factory`.

## Try it

Open an issue such as:

> **Add `truncate(text, max)` to src/strings.js**
> Cut text to at most `max` characters and end it with `…` when it was cut. Add tests.

Then add the `factory` label (or comment `/factory build`). The factory reacts 👀, pushes
`factory/<n>-add-truncate…`, opens a draft PR that `Closes #<n>`, and replies with a summary.
On the PR, comment `/factory <instruction>` or request changes in a review to get another commit.
