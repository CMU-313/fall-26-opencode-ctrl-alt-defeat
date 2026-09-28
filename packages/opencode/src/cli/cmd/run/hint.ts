import { Hint } from "@opencode-ai/core/hint"
import type { RunPrompt } from "./types"

export function prepareHintPrompt(prompt: RunPrompt, enabled: boolean) {
  if (prompt.command?.name === "hint") {
    const next = !enabled
    return {
      enabled: next,
      notice: next ? "Hint mode enabled. Future responses will provide hints only." : "Hint mode disabled.",
    }
  }
  if (!enabled || prompt.mode === "shell" || prompt.command) return { prompt }
  return {
    prompt: {
      ...prompt,
      text: Hint.prompt(prompt.text),
    },
  }
}
