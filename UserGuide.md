# User Guide

## Hint mode

Hint mode asks OpenCode to provide concise debugging guidance without giving away a complete solution. It is available in the standard terminal interface, the mini terminal interface, and as a one-time CLI option.

### Interactive use

Start the standard interface from the repository root:

```bash
bun dev
```

Enter `/hint` to enable hint mode. OpenCode displays a confirmation, and each subsequent prompt is sent as a hint request. Enter `/hint` again to disable the mode. Hint mode applies only to the current session.

The same workflow is available in the mini interface:

```bash
bun dev -- --mini
```

### One-time CLI use

Pass a bug description to `run --hint` to request one hint without enabling an interactive mode:

```bash
bun dev -- run --hint "The save button crashes after retrying"
```

Calling `run --hint` without a bug description exits with a clear error instead of sending an empty request.

### Manual verification

1. Run `bun dev`, enter `/hint`, and confirm that the enabled message appears.
2. Submit a bug description and confirm that the response gives guidance rather than a complete solution.
3. Enter `/hint` again and confirm that the disabled message appears.
4. Repeat the toggle flow with `bun dev -- --mini`.
5. Run `bun dev -- run --hint` without a description and confirm that the missing-context error appears.

Successful model responses require a configured provider. OpenCode-hosted free-tier models may reject requests from development builds, but the automated CLI tests use a local test provider.

### Automated tests

The focused tests are located at:

- `packages/opencode/test/cli/run/hint.test.ts`: shared prompt construction, missing CLI context, hint-mode enable/disable behavior, and prompt transformation.
- `packages/opencode/test/cli/run/runtime.queue.test.ts`: mode status messages are displayed without sending a model request or closing the session.
- `packages/opencode/test/cli/run/run-process.test.ts`: end-to-end `run --hint` behavior with and without bug context.
- `packages/opencode/test/cli/help/help-snapshots.test.ts`: documents and protects the public `--hint` CLI option.
- `packages/tui/test/hint.test.ts`: standard-TUI session isolation, enable/disable state, new-session handoff, and prompt transformation.

Run the focused verification from `packages/opencode`:

```bash
bun test test/cli/run/hint.test.ts test/cli/run/runtime.queue.test.ts
bun test test/cli/run/run-process.test.ts
bun test test/cli/help/help-snapshots.test.ts
bun typecheck
```

Then verify the shared core and TUI packages:

```bash
cd ../core && bun typecheck
cd ../tui && bun test test/hint.test.ts && bun typecheck
```

Together, these tests cover the shared handler, both mode transitions, transformed prompts, queue behavior, CLI argument handling, validation errors, and the documented command-line interface.
