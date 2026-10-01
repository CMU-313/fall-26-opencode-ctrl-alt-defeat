## Onboarding Mode

### What it does
The `/onboard` command generates a plain language overview of a repository's architecture to help new contributors get oriented faster. It uses a hybrid analysis, with some deterministic analysis functions (e.g. counting number of files in a repo), and some non-determinstic LLM guided analysis (driven by a .txt context file for our agent, and determining e.g. what are "important" files).

### How to use it
Simply type `/onboard` into your opencode interface. It'll then automatically run all necessary analysis for you.

### How to test it (manual/user testing)
Because this command has a hybrid implementation, we test rely on determinstic and non-deterministic testing. First, deterministic unit/integration tests. These make sure the commands work on an individual and interconnected basis. Second, we need end-to-end testing in order to actually analyse everything working in conjunction, including the non-deterministic LLM output.

### Automated tests

**Command scaffolding tests** — `packages/opencode/test/command/onboard.test.ts`