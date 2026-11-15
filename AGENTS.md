# Agent instructions for software-factory

- TypeScript, ESM, Node 22. Run `npm run typecheck && npm test` before you finish.
- Keep the five pipeline steps runtime-agnostic: nothing in `src/` may assume GitHub Actions. The same image runs under Tekton in v2.
- Harness adapters only build a command line and place skills and instructions. They must never push, call the GitHub API, or receive GitHub tokens.
- New behaviour gets a test in `test/` using the fake GitHub and the fake harness.
