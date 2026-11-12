# Hint Mode Traceability

## Requirements

| ID  | Interview evidence                                                                                                                              | Requirement (P4)                                                                                                                                                                                   | Acceptance criteria (P4)                                                                                                                                                             | Changed in P4? | Property                                                                                                                                   | Test                                                                                                                       | Mutants it kills                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| R1  | S-4: “It shouldn't give me the full answer until I disable hint mode.”                                                                          | While hint mode is enabled, every ordinary user prompt must be wrapped with an instruction to provide a hint rather than a complete solution, even when the user explicitly requests the solution. | For every non-empty solution-seeking prompt, the prepared LLM request contains the original context and the hint-only instruction.                                                   | Yes            | Invariant: every generated solution-seeking prompt receives the hint-only instruction. AI-assisted.                                        | `R1: solution requests always receive the hint-only instruction` in `packages/opencode/test/cli/run/hint.property.test.ts` | H1; Stryker wrapper and branch mutants                   |
| R2  | C-1: “Breaking things down and explaining the code line by line.” S-6: “I'd rather have them point me toward a possible race condition.”        | Hint mode must send the complete bug description and code context with an instruction requesting one concise, specific debugging hint.                                                             | For every generated bug description, code snippet, and non-empty prompt-part list, the request exactly matches the shared hint template and preserves every supplied part unchanged. | Yes            | Model / oracle: generated requests are compared with a simple request-template oracle. AI-assisted.                                        | `R2: hint requests agree with the request-template oracle` in `packages/opencode/test/cli/run/hint.property.test.ts`       | H1, H2, H5; Stryker wrapper mutants                      |
| R3  | C-3: “It shouldn't give me the full answer until I disable hint mode.” S-6: “If I turn hint mode off, I'd expect the agent to answer normally.” | Users must be able to toggle hint mode on and off, with normal agent behavior restored when disabled.                                                                                              | Starting disabled, two `/hint` commands restore disabled mode with the correct notices; the next ordinary prompt and all shell-mode prompts remain unwrapped.                        | No             | Round-trip: toggling twice restores normal behavior for every generated prompt. AI-assisted.                                               | `R3: toggling twice restores normal prompt behavior` in `packages/opencode/test/cli/run/hint.property.test.ts`             | H3, H4; Stryker toggle, notice, and shell-bypass mutants |
| R4  | S-5: “Remember what I've already tried and what hasn't worked.” S-6: “I wouldn't want to explain the same bug again.”                           | The agent should retain relevant debugging context and previous attempts when hint mode is toggled off and back on within the same session.                                                        | After a user reports that a suggested fix failed, turning hint mode off and back on preserves that message in the conversation history passed to the LLM.                            | No             | Not property-tested in P4.                                                                                                                 | —                                                                                                                          | None directly                                            |
| R5  | C-4: “If you only slightly change the input... you should still get a similar hint.”                                                            | Rewording a problem or renaming variables without changing the underlying bug must keep the same hint instruction and handler; only the supplied bug context may differ.                           | For every generated pair of distinct variable names, renaming the variable changes only the bug-context portion of the prepared hint request.                                        | Yes            | Metamorphic: a variable rename produces the same transformation in the prepared request and leaves the instruction unchanged. AI-assisted. | `R5: renaming a variable changes only the bug context` in `packages/opencode/test/cli/run/hint.property.test.ts`           | Stryker wrapper mutants                                  |

## Requirement changes

### R1

- **Original (P3):** While hint mode is enabled, the agent must not provide complete solutions, even if the user explicitly requests one.
- **Revised (P4):** While hint mode is enabled, every ordinary user prompt must be wrapped with an instruction to provide a hint rather than a complete solution, even when the user explicitly requests the solution.
- **Why it changed:** The application can control the request sent to the nondeterministic LLM, but it cannot prove that every possible model response will obey it. The revision preserves S-4's need while making the behavior directly checkable.

### R2

- **Original (P3):** Hint mode should provide concise, specific guidance that directs users toward a particular part of their code or a potential issue.
- **Revised (P4):** Hint mode must send the complete bug description and code context with an instruction requesting one concise, specific debugging hint.
- **Why it changed:** “Concise” and “specific” are subjective properties of generated text. The revised requirement preserves the interview need but checks the deterministic request boundary the feature owns.

### R5

- **Original (P3):** Rewording a problem or renaming variables without changing the underlying bug should not significantly change the guidance provided.
- **Revised (P4):** Rewording a problem or renaming variables without changing the underlying bug must keep the same hint instruction and handler; only the supplied bug context may differ.
- **Why it changed:** “Significantly change” cannot be measured reliably across nondeterministic LLM responses. The revision makes the stable part of the behavior checkable while preserving the expectation that equivalent bugs follow the same hint path.

R3 and R4 were kept because their acceptance criteria describe observable session behavior that the implementation can check without judging LLM output.

## Generator choices

- The bug-context generator combines realistic symptoms, multiline code snippets, and surrounding spaces, tabs, or newlines. This reaches trimming boundaries while keeping counterexamples understandable.
- The solution-request generator explicitly asks for exact code before generated bug context, covering the resistance behavior interviewees requested.
- The prompt-parts generator always creates one to three realistic debugging details so a transformation that drops attachments cannot pass vacuously.
- The rename generator chooses two distinct code-like identifiers so the metamorphic change is meaningful and shrunk counterexamples remain readable.

## Run and triage record

All four strengthened properties passed on November 12, 2026 with seed `4242` and fast-check's default 100 runs per property. They made 1,100 assertions, and the `packages/opencode` typecheck also passed.

Focused command, run from `packages/opencode`:

```sh
bun test test/cli/run/hint.property.test.ts
```

## Hand-written mutants

The predictions below were recorded before applying any mutant or running Stryker.

| ID  | Requirement targeted | Change                                                                                                                                              | Predicted killer                                                                                                                              | Actual result                                                                                                          |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| H1  | R1                   | `packages/core/src/hint.ts`: changes the shared request from refusing a complete solution to explicitly giving one.                                 | `R1: solution requests always receive the hint-only instruction`, because it requires the exact hint-only prefix.                             | **Killed as predicted** by R1 after one generated case; R2 also failed.                                                |
| H2  | R2                   | `packages/core/src/hint.ts`: stops trimming surrounding whitespace from bug context.                                                                | `R2: hint requests agree with the request-template oracle`, because generated contexts include spaces, tabs, and newlines.                    | **Killed as predicted** by R2 after two generated cases, shrinking to a newline-padded context.                        |
| H3  | R3                   | `packages/opencode/src/cli/cmd/run/hint.ts`: assigns the current enabled state instead of negating it when `/hint` is entered.                      | `R3: toggling twice restores normal prompt behavior`, because the first toggle will remain disabled.                                          | **Killed as predicted** by R3 after one generated case.                                                                |
| H4  | R3                   | `packages/opencode/src/cli/cmd/run/hint.ts`: removes the disabled-mode bypass, so ordinary prompts are still wrapped after hint mode is turned off. | `R3: toggling twice restores normal prompt behavior`, because the post-disable prompt will contain hint instructions.                         | **Killed as predicted** by R3 after one generated case.                                                                |
| H5  | R2                   | `packages/opencode/src/cli/cmd/run/hint.ts`: silently replaces all prompt attachment parts with an empty array while wrapping the text.             | Predicted to survive: the AI-suggested R2 property checks text exactly but generates only `parts: []`, so it cannot observe lost attachments. | **Survived as predicted** initially. After strengthening R2, it was killed after one case and shrank to one text part. |

## Stryker comparison

- **Fast-check seed:** `4242` (`fc.configureGlobal({ seed: 4242 })`).
- **Initial mutation score:** **81.82%** (18 killed, 4 survived, 0 timed out, 22 total).
- **Final mutation score:** **100.00%** (22 killed, 0 survived, 0 timed out).
- **Equivalent mutants excluded:** 0. No final survivor required an equivalence claim, so the adjusted score is also **100.00%** (22 / 22).

### Which hand-written mutants did Stryker never generate, and why?

Stryker did not generate H1 or H2 because the deliberately narrow configuration mutates only `src/cli/cmd/run/hint.ts`, while those two mutants change the shared handler in `packages/core/src/hint.ts`. It also did not generate H5: Stryker performed syntactic replacements on existing branches, literals, and object expressions, but it did not invent the new `parts: []` override needed to model silently dropping attachments. It did generate the essential H3 toggle inversion and behavior equivalent to H4's missing disabled-mode guard.

### Which Stryker survivors were surprising and plausible?

The initial survivors included replacing either enabled/disabled notice with an empty string and weakening the shell-mode guard by replacing `prompt.mode === "shell"` with `false` or an empty-string comparison. I had focused on state and transformed text, so I did not initially consider user feedback or shell isolation. Both are plausible developer mistakes: a copy edit can erase a status message, and a typo in a mode comparison can route shell input through the hint handler.

### What did each approach find that the other did not?

The hand-written mutants exercised semantic failures across package boundaries, including changing the educational instruction in `core` and deliberately deleting attachment context. Stryker systematically explored small condition, literal, and return-shape changes in the scoped entry-point function, revealing the missing notice and shell-mode assertions. Together they covered both user-level failures I could imagine and local implementation edits I would not have selected manually.

## Strengthening and equivalent mutants

R2 now generates one to three non-empty text parts and asserts that the prepared prompt preserves the exact array, which kills H5. R3 now asserts both status notices and verifies that generated shell-mode prompts remain unchanged even while hint mode is enabled, killing all four initial Stryker survivors. No equivalent mutants remained after strengthening, so no exclusions or equivalence arguments were necessary.

## Agent failure case

### Transcript excerpt

**Prompt:**

> “ok can you complete this for me”

This was asked after providing the Project 4 property-testing assignment and the Project 3 requirements. Codex suggested the following R2 oracle while every generated prompt used an empty parts array:

```ts
fc.property(bugContext, (context) => {
  expect(Hint.prompt(context)).toBe(`${request}\n\nBug context:\n${context.trim()}`)
})
```

### Mutant that survived

H5 added `parts: []` after spreading the original prompt. It silently deleted all attached code or debugging details, but every generated input in the original property already had `parts: []`, so all four properties passed.

### Why the property was too weak

The oracle checked the transformed text exactly but did not model the rest of the prompt. This made the assertion strong for string formatting and vacuous for attachments: deleting an empty list is observationally identical to preserving it.

### Strengthened version and evidence

The strengthened generator creates one to three realistic text parts, and R2 checks both the expected hint text and `expect(prompt.parts).toEqual(parts)`. With seed `4242`, H5 failed after the first generated case and shrank to a single part: `{ type: "text", text: "Stack trace: saveWithRetry failed" }`. The final Stryker run then killed all 22 generated mutants for a 100.00% score.

## AI assistance

OpenAI Codex helped draft the R1, R2, R3, and R5 properties, their generators, and this traceability file. I reviewed the requirements against the Project 3 interview evidence and am responsible for the correctness of the submitted properties.
