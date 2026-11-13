# Traceability: Gio Talavera (gnt)

**Target feature:** onboarding command — 

packages/opencode/src/command/index.ts, 

packages/opencode/src/command/onboard.ts, 

packages/opencode/src/command/template/onboard.txt, 

packages/opencode/test/command/onboard.test.ts, 


## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | S-3, C-2: It shouldn’t be beyond a certain length (~3 paragraphs), or have a separate mode for long versions. | onboarding command should default to generating concise .md report containing deterministic repository information w/ no more than 3 paragraphs of explanation text | generated report includes the required deterministic repo information and at most three explanation paragraphs, excluding headings and repository statistics | Yes | Invariant: saved report retains measured facts and has at most three explanation paragraphs | `packages/opencode/test/command/onboard.property.test.ts` — tests prefixed `R1:` | H1 |
| R2 | C-2: ... "separate mode for long versions", S-3: "should have arguments that let... specify... length" | The command should take arguments for a custom modifiers for adding more detail | The command takes an argument that makes the output more verbose (should also negate conciseness length requirement) | No | | | None (no property) |
| R3 | S-5, C-5 | Deterministic outputs (LoC, number of files, etc.) should always stay same between runs, unless changed | For every run, the deterministic outputs are the exact same, unless the corresponding deterministic info changed, in which case it should exactly correspond. | No | Model/oracle + metamorphic: independent counts; unchanged repeats; add/edit/delete/restore | `packages/opencode/test/command/onboard.property.test.ts` — tests prefixed `R3:` | H2, H3 |
| R4 | S-7: “should be a title section with date/time stamp… to let us know how up to date it is” | each generated onboarding report md doc should contain title plus timestamp indicating when the report was generated | Every generated .md report contains nonempty title plus valid timestamp corresponding to current execution of the command | Yes | Invariant: nonempty title and exact controlled execution timestamp | `packages/opencode/test/command/onboard.property.test.ts` — tests prefixed `R4:` | H4 |
| R5 | C-3: “besides .md file saving info, none of the files should change” S-4/S-5 “lots of AI… tries to do seemingly logical next step [like fixing code]. It should only give onboarding guide” O-3 | The code should never be updated after calling the command, by either deterministic functionalities or the AI / LLM | There are no diffs after the running the command besides the .md file | No | Invariant: complete path/byte snapshots; reject report symlink | `packages/opencode/test/command/onboard.property.test.ts` — tests prefixed `R5:`; command integration: `packages/opencode/test/session/prompt.test.ts` — `R5: onboard command ignores unsolicited mutation tool calls` | H5 |

Properties written or suggested by opencode or another AI tool: R1, R3, R4, R5 (Codex assisted with all four properties, generators, implementation changes, and test triage). Previous assistance: R1, R4 (helped revise, though I did write these entirely without AI in P3. Also, AI helped convert my words into markdown [word for word])

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R1 | The output of the of the onboarding command should be concise and less than a certain length, unless otherwise specified | onboarding command should default to generating concise .md report containing deterministic repository information w/ no more than 3 paragraphs of explanation text | clarification that maximum report length is three explanatory paragraphs while excluding deterministic statistics and headings from limit, making the requirement objectively testable |
| R4 | There should be a title section with date and time stamp to let user know version | each generated onboarding report md doc should contain title plus timestamp indicating when the report was generated | more specific wording / clarified that every generated report should contain a title and timestamp corresponding to its generation. |

## R5 coverage boundary

The generated snapshot properties exercise `Onboard.generate`, not the complete command. A separate integration regression invokes `SessionPrompt.command` with the real LLM adapter and a local HTTP provider fixture. It verifies that the provider receives no tools and that unsolicited write, edit, and shell deletion calls leave all repository files except the root `ONBOARDING.md` unchanged, even with session permissions allowing all tools. This covers the built-in command; custom command overrides, malicious plugins/providers, and concurrent external filesystem changes are outside this guarantee. Codex assisted with this integration regression as well.

## Hand-written mutants

All five patches were manually applied and tested by the author, who confirmed that each corresponding property test failed.

| Mutant | Requirement | Mutation | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R1 | Changed the default explanation paragraph limit from 3 to 4. | `R1: saved default report enforces three explanation paragraphs and retains measured facts` | Killed |
| H2 | R3 | Changed line-counting logic to count only newline characters, incorrectly undercounting files without a trailing newline. | `R3: measurements repeat exactly and follow repository content changes` | Killed |
| H3 | R3 | Removed `dist` from both the `EXCLUDED` directory pattern and `WALK_IGNORED` list, causing otherwise eligible build-output files inside `dist/` to be included in repository measurements. | `R3: measurements repeat exactly and follow repository content changes` | Killed |
| H4 | R4 | Replaced the generated timestamp with a fixed timestamp (`new Date(0).toISOString()`), making reports display an incorrect execution time. | `R4: saved reports contain a nonempty title and the exact execution timestamp` | Killed |
| H5 | R5 | Removed the file safety check that rejects non-regular or multiply linked report files, potentially allowing unsafe report writes. | `R5: refuses a report symlink rather than changing its target` | Killed |
