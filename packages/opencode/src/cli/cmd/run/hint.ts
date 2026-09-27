import type { RunPrompt } from "./types"

const REQUEST = "Give one concise debugging hint that helps identify the next step without solving the bug outright."

export class MissingHintContextError extends Error {
  constructor() {
    super("No bug context available. Describe the bug before asking for a hint.")
    this.name = "MissingHintContextError"
  }
}

export function hintPrompt(context: string | undefined) {
  const bug = context?.trim()
  if (!bug) throw new MissingHintContextError()

  return `${REQUEST}\n\nBug context:\n${bug}`
}

export function prepareHintPrompt(prompt: RunPrompt, history: RunPrompt[]) {
  if (prompt.command?.name !== "hint") return { prompt }

  try {
    const context = history.findLast((item) => item.mode !== "shell" && item.text.trim())
    return {
      prompt: {
        text: hintPrompt(context?.text),
        parts: [],
      },
    }
  } catch (error) {
    if (error instanceof MissingHintContextError) return { error: error.message }
    throw error
  }
}
