import { Hint } from "@opencode-ai/core/hint"
import type { RunPrompt } from "./types"

export function prepareHintPrompt(prompt: RunPrompt, history: RunPrompt[]) {
  if (prompt.command?.name !== "hint") return { prompt }

  try {
    const context = history.findLast((item) => item.mode !== "shell" && item.text.trim())
    return {
      prompt: {
        text: Hint.prompt(context?.text),
        parts: [],
      },
    }
  } catch (error) {
    if (error instanceof Hint.MissingContextError) return { error: error.message }
    throw error
  }
}
