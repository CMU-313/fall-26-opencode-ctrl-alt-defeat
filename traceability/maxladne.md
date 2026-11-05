# Hint Mode Traceability

## Requirements

| ID  | Interview evidence                                                                                                                              | Requirement (P4)                                                                                                                                                                                   | Acceptance criteria (P4)                                                                                                                                       | Changed in P4? | Property                                                                                                                                   | Test                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| R1  | S-4: “It shouldn't give me the full answer until I disable hint mode.”                                                                          | While hint mode is enabled, every ordinary user prompt must be wrapped with an instruction to provide a hint rather than a complete solution, even when the user explicitly requests the solution. | For every non-empty solution-seeking prompt, the prepared LLM request contains the original context and the hint-only instruction.                             | Yes            | Invariant: every generated solution-seeking prompt receives the hint-only instruction. AI-assisted.                                        | `R1: solution requests always receive the hint-only instruction` in `packages/opencode/test/cli/run/hint.property.test.ts` |
| R2  | C-1: “Breaking things down and explaining the code line by line.” S-6: “I'd rather have them point me toward a possible race condition.”        | Hint mode must send the complete bug description and code context with an instruction requesting one concise, specific debugging hint.                                                             | For every generated bug description and code snippet, the request sent to the LLM exactly matches the shared hint template and preserves the trimmed context.  | Yes            | Model / oracle: generated requests are compared with a simple request-template oracle. AI-assisted.                                        | `R2: hint requests agree with the request-template oracle` in `packages/opencode/test/cli/run/hint.property.test.ts`       |
| R3  | C-3: “It shouldn't give me the full answer until I disable hint mode.” S-6: “If I turn hint mode off, I'd expect the agent to answer normally.” | Users must be able to toggle hint mode on and off, with normal agent behavior restored when disabled.                                                                                              | Starting with hint mode disabled, entering `/hint` enables it. Entering `/hint` again disables it, and the next prompt is sent without hint-mode instructions. | No             | Round-trip: toggling twice restores normal behavior for every generated prompt. AI-assisted.                                               | `R3: toggling twice restores normal prompt behavior` in `packages/opencode/test/cli/run/hint.property.test.ts`             |
| R4  | S-5: “Remember what I've already tried and what hasn't worked.” S-6: “I wouldn't want to explain the same bug again.”                           | The agent should retain relevant debugging context and previous attempts when hint mode is toggled off and back on within the same session.                                                        | After a user reports that a suggested fix failed, turning hint mode off and back on preserves that message in the conversation history passed to the LLM.      | No             | Not property-tested in P4.                                                                                                                 | —                                                                                                                          |
| R5  | C-4: “If you only slightly change the input... you should still get a similar hint.”                                                            | Rewording a problem or renaming variables without changing the underlying bug must keep the same hint instruction and handler; only the supplied bug context may differ.                           | For every generated pair of distinct variable names, renaming the variable changes only the bug-context portion of the prepared hint request.                  | Yes            | Metamorphic: a variable rename produces the same transformation in the prepared request and leaves the instruction unchanged. AI-assisted. | `R5: renaming a variable changes only the bug context` in `packages/opencode/test/cli/run/hint.property.test.ts`           |

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
- The rename generator chooses two distinct code-like identifiers so the metamorphic change is meaningful and shrunk counterexamples remain readable.

## Run and triage record

All four properties passed on November 5, 2026 with fast-check's default 100 runs per property. No counterexample was found, so no production-code or property correction was required. The existing focused hint tests and the `packages/opencode` typecheck also passed.

Focused command, run from `packages/opencode`:

```sh
bun test test/cli/run/hint.property.test.ts
```

## AI assistance

OpenAI Codex helped draft the R1, R2, R3, and R5 properties, their generators, and this traceability file. I reviewed the requirements against the Project 3 interview evidence and am responsible for the correctness of the submitted properties.
