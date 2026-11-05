## Onboarding Mode

### What it does
The `/onboard` command generates a plain language overview of a repository's architecture to help new contributors get oriented faster. It uses a hybrid analysis, with some deterministic analysis functions (e.g. counting number of files in a repo), and some non-determinstic LLM guided analysis (driven by a .txt context file for our agent, and determining e.g. what are "important" files).

### How to use it
Simply type `/onboard` into your opencode interface. It'll then automatically run all necessary analysis for you.

### How to test it (manual/user testing)
Because this command has a hybrid implementation, testing has two parts. Automated tests can verify deterministic command behavior without calling a real LLM. Manual end-to-end testing is needed to verify the repository analysis together with the non-deterministic LLM output.

### Automated tests

Run the focused test from `packages/opencode`:

```sh
bun test test/command/onboard.test.ts
```

The current **command scaffolding test** in `packages/opencode/test/command/onboard.test.ts` checks that `/onboard` is listed, has the expected command source and onboarding description, and exposes the placeholder template. It does not test measured repository facts or invoke the LLM.

For manual end-to-end testing, run `/onboard` in a repository and inspect the generated `ONBOARDING.md`. This checks the integrated analysis and LLM-generated guide, whose contents can vary between runs.

## Hint Mode

### What it does
The /hint command toggles a session mode that asks OpenCode to provide concise debugging guidance instead of complete solutions. The run --hint flag provides the same hint behavior for a single CLI request.

### How to use it
Type /hint in the standard or mini OpenCode interface to enable hint mode. All subsequent prompts in that session will request hints until /hint is entered again to disable it.

For a one-time CLI hint, run: `bun dev -- run --hint "Describe the bug here"`

### How to test it 
Run bun dev or bun dev -- --mini, enter /hint, and confirm that the enabled message appears. Submit a bug description and verify that the response provides guidance rather than a complete solution, then enter /hint again and confirm that the mode is disabled.

To test CLI validation, run: `bun dev -- run --hint`
It should exit with a clear missing-context error instead of sending an empty request.

### Automated tests
Run the focused tests:
```sh
cd packages/opencode
bun test test/cli/run/hint.test.ts test/cli/run/runtime.queue.test.ts
bun test test/cli/run/run-process.test.ts
```

cd ../tui
bun test test/hint.test.ts
These tests cover shared hint-prompt generation, missing CLI context, enabling and disabling hint mode, prompt transformation, status messages, session isolation, and end-to-end CLI behavior.
