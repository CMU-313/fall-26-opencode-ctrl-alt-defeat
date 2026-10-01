## Onboarding Mode

### What it does

The `/onboard` command generates a plain language overview of a repository's
architecture to help new contributors get oriented faster.

### How to use it

[Replace with the real current usage instructions — what the finished command
actually outputs now]

### How to test it (manual/user testing)

[Replace with steps to verify the real output]

### Automated tests

**Command scaffolding tests** — `packages/opencode/test/command/onboard.test.ts`

## Hint Mode

### What it does

The `/hint` command toggles a session mode that asks OpenCode to provide concise
debugging guidance instead of complete solutions. The `run --hint` flag provides
the same behavior for a single CLI request.

### How to use it

Run `bun dev` or `bun dev -- --mini`, then enter `/hint` to enable hint mode.
Enter `/hint` again to disable it. For a one-time hint, run:

```bash
bun dev -- run --hint "Describe the bug here"
```

### How to test it (manual/user testing)

1. Enter `/hint` and confirm that OpenCode reports that hint mode is enabled.
2. Submit a bug description and confirm that the response provides guidance
   rather than a complete solution.
3. Enter `/hint` again and confirm that hint mode is disabled.
4. Run `bun dev -- run --hint` without a description and confirm that it exits
   with a clear missing-context error.

### Automated tests

**Shared handler and mini-mode tests** — `packages/opencode/test/cli/run/hint.test.ts`

**Interactive queue tests** — `packages/opencode/test/cli/run/runtime.queue.test.ts`

**CLI subprocess tests** — `packages/opencode/test/cli/run/run-process.test.ts`

**Standard TUI session-mode tests** — `packages/tui/test/hint.test.ts`
