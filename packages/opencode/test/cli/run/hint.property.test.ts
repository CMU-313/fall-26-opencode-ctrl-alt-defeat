import { describe, expect, test } from "bun:test"
import { Hint } from "@opencode-ai/core/hint"
import fc from "fast-check"
import { prepareHintPrompt } from "@/cli/cmd/run/hint"
import type { RunPrompt } from "@/cli/cmd/run/types"

const request = "Give one concise debugging hint that helps identify the next step without solving the bug outright."

// These values deliberately combine realistic symptoms, code fragments, and
// surrounding whitespace so trimming and multiline bug context are exercised.
const bugContext = fc
  .record({
    symptom: fc.constantFrom(
      "The save button crashes after a retry.",
      "The loop skips the last item.",
      "The request hangs after the server disconnects.",
      "The cache returns stale data after an update.",
    ),
    snippet: fc.constantFrom(
      "for (let index = 0; index < items.length; index++)",
      "const result = await saveWithRetry(input)",
      "socket.onclose = () => reconnect()",
      "cache.set(key, nextValue)",
    ),
    padding: fc.constantFrom("", " ", "\n", "\t  "),
  })
  .map((value) => `${value.padding}${value.symptom}\n\nCode:\n${value.snippet}${value.padding}`)

// Requests explicitly asking for an answer cover the boundary interviewees
// cared about: hint mode must resist requests for a complete solution.
const fullSolutionPrompt = bugContext.map((context) => `Give me the complete solution and exact code.\n${context}`)

// A small set of code-like identifiers makes renames meaningful while keeping
// shrinking readable when fast-check reports a counterexample.
const renamedVariable = fc
  .tuple(
    fc.constantFrom("counter", "retryCount", "itemIndex", "response", "result", "cacheEntry"),
    fc.constantFrom("counter", "retryCount", "itemIndex", "response", "result", "cacheEntry"),
  )
  .filter(([original, renamed]) => original !== renamed)

const hintCommand: RunPrompt = {
  text: "/hint",
  parts: [],
  command: { name: "hint", arguments: "" },
}

function preparedText(prompt: RunPrompt) {
  const result = prepareHintPrompt(prompt, true)
  if (!("prompt" in result) || !result.prompt) throw new Error("Expected a prepared prompt")
  return result.prompt.text
}

describe("hint mode properties", () => {
  // R1: While hint mode is enabled, every ordinary user prompt must be wrapped
  // with an instruction to provide a hint rather than a complete solution.
  // Kind: invariant
  test("R1: solution requests always receive the hint-only instruction", () => {
    fc.assert(
      fc.property(fullSolutionPrompt, (context) => {
        const text = preparedText({ text: context, parts: [] })

        expect(text.startsWith(request)).toBe(true)
        expect(text).toContain("without solving the bug outright")
        expect(text).toContain(context.trim())
      }),
    )
  })

  // R2: Given bug context and code, the request sent to the LLM must contain
  // the complete supplied context and the instruction to provide one hint.
  // Kind: model / oracle
  test("R2: hint requests agree with the request-template oracle", () => {
    fc.assert(
      fc.property(bugContext, (context) => {
        expect(Hint.prompt(context)).toBe(`${request}\n\nBug context:\n${context.trim()}`)
      }),
    )
  })

  // R3: Starting disabled, /hint enables hint mode; entering /hint again
  // disables it, and the next prompt is sent without hint instructions.
  // Kind: round-trip
  test("R3: toggling twice restores normal prompt behavior", () => {
    fc.assert(
      fc.property(bugContext, (context) => {
        const enabled = prepareHintPrompt(hintCommand, false)
        const enabledState = "enabled" in enabled ? enabled.enabled : undefined
        if (enabledState !== true) throw new Error("Expected hint mode to be enabled")

        const disabled = prepareHintPrompt(hintCommand, enabledState)
        const disabledState = "enabled" in disabled ? disabled.enabled : undefined
        if (disabledState !== false) throw new Error("Expected hint mode to be disabled")

        expect(prepareHintPrompt({ text: context, parts: [] }, disabledState)).toEqual({
          prompt: { text: context, parts: [] },
        })
      }),
    )
  })

  // R5: Rewording a bug by renaming a variable must use the same hint
  // instruction and handler, with only the supplied bug context changing.
  // Kind: metamorphic
  test("R5: renaming a variable changes only the bug context", () => {
    fc.assert(
      fc.property(renamedVariable, ([original, renamed]) => {
        const context = `Variable ${original} is undefined after retrying.`
        const renamedContext = `Variable ${renamed} is undefined after retrying.`
        const originalText = preparedText({ text: context, parts: [] })
        const renamedText = preparedText({ text: renamedContext, parts: [] })

        expect(renamedText).toBe(originalText.replace(original, renamed))
        expect(renamedText.slice(0, -renamedContext.length)).toBe(originalText.slice(0, -context.length))
      }),
    )
  })
})
