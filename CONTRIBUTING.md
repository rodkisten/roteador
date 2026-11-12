# Contributing to Roteador

Thanks for helping make Roteador better!

## Before opening a PR

1. Create a focused feature branch; do not push directly to `main`.
2. Add or update tests for behavior changes.
3. Run `pnpm build`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint`, and `pnpm format:check`.
4. **Update the README in the same PR whenever you add, remove or change a public feature.**
   - Add a runnable recipe under **Recipes & use cases**.
   - Update the **Features** status table and **API reference**.
   - Update **Behavior and limitations** and **Roadmap**, when relevant.
   - Keep the **Contents** links correct.
5. Mention any breaking change and migration steps in the PR description.

## Documentation conventions

- Write documentation in English for the public API.
- Prefer complete, small TypeScript examples that match exported APIs.
- Never describe planned behavior as released.
- Distinguish repository features from published npm versions.
- Do not include real tokens, account identifiers, or production credentials.
- Keep examples compatible with the standard Fetch API.

## Pull request checklist

- [ ] Tests cover the change
- [ ] Build and typecheck pass
- [ ] Lint and formatting pass
- [ ] README recipes and API reference updated (or not applicable, with reason)
- [ ] Roadmap/status accurately reflects implementation
- [ ] No secrets or generated build artifacts committed
