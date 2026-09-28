import { describe, expect, test } from "bun:test"
import { Hint } from "@opencode-ai/core/hint"
import { prepareHintPrompt } from "@/cli/cmd/run/hint"
import type { RunPrompt } from "@/cli/cmd/run/types"

const request = "Give one concise debugging hint that helps identify the next step without solving the bug outright."

describe("run hint", () => {
  test("builds a hint request from bug context", () => {
    expect(Hint.prompt("  The save button throws after a retry.  ")).toBe(
      `${request}\n\nBug context:\nThe save button throws after a retry.`,
    )
  })

  test("rejects missing bug context with a clear error", () => {
    expect(() => Hint.prompt("   ")).toThrow(Hint.MissingContextError)
    expect(() => Hint.prompt(undefined)).toThrow(
      "No bug context available. Describe the bug before asking for a hint.",
    )
  })

  test("enables hint mode through /hint", () => {
    const prompt: RunPrompt = {
      text: "/hint",
      parts: [],
      command: { name: "hint", arguments: "" },
    }
    expect(prepareHintPrompt(prompt, false)).toEqual({
      enabled: true,
      notice: "Hint mode enabled. Future responses will provide hints only.",
    })
  })

  test("routes prompts through the shared handler while hint mode is enabled", () => {
    expect(prepareHintPrompt({ text: "The current bug", parts: [] }, true)).toEqual({
      prompt: {
        text: Hint.prompt("The current bug"),
        parts: [],
      },
    })
  })

  test("disables hint mode when /hint is invoked again", () => {
    const prompt: RunPrompt = {
      text: "/hint",
      parts: [],
      command: { name: "hint", arguments: "" },
    }

    expect(prepareHintPrompt(prompt, true)).toEqual({ enabled: false, notice: "Hint mode disabled." })
  })
})
