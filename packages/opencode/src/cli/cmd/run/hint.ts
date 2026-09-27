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
