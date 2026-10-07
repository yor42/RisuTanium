## What and why

<!-- What changes, and the problem it solves. -->

## Checks

- [ ] `pnpm check` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] A bug fix has a test that fails without the fix
- [ ] Upstream compatibility holds: a `.bin` backup, character, module, preset or plugin from upstream RisuAI still works, and what this fork exports still imports upstream
- [ ] If it touches saving, the save format or storage, the change is described above and the risk to existing data is explained
- [ ] No secrets, keys or personal data are included
- [ ] Comments describe what must stay true, not the history of the change
