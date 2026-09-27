import { describe, expect, test } from "bun:test"
import { hintPrompt, MissingHintContextError, prepareHintPrompt } from "@/cli/cmd/run/hint"
import type { RunPrompt } from "@/cli/cmd/run/types"

const request = "Give one concise debugging hint that helps identify the next step without solving the bug outright."

describe("run hint", () => {
  test("builds a hint request from bug context", () => {
    expect(hintPrompt("  The save button throws after a retry.  ")).toBe(
      `${request}\n\nBug context:\nThe save button throws after a retry.`,
    )
  })

  test("rejects missing bug context with a clear error", () => {
    expect(() => hintPrompt("   ")).toThrow(MissingHintContextError)
    expect(() => hintPrompt(undefined)).toThrow("No bug context available. Describe the bug before asking for a hint.")
  })

  test("routes /hint through the shared handler using the latest user context", () => {
    const prompt: RunPrompt = {
      text: "/hint",
      parts: [],
      command: { name: "hint", arguments: "" },
    }
    const history: RunPrompt[] = [
      { text: "The first bug", parts: [] },
      { text: "ignored shell command", parts: [], mode: "shell" },
      { text: "The current bug", parts: [] },
    ]

    expect(prepareHintPrompt(prompt, history)).toEqual({
      prompt: {
        text: hintPrompt("The current bug"),
        parts: [],
      },
    })
  })

  test("returns a non-throwing error for /hint without session context", () => {
    const prompt: RunPrompt = {
      text: "/hint",
      parts: [],
      command: { name: "hint", arguments: "" },
    }

    expect(prepareHintPrompt(prompt, [])).toEqual({
      error: "No bug context available. Describe the bug before asking for a hint.",
    })
  })
})
