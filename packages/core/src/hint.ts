const REQUEST = "Give one concise debugging hint that helps identify the next step without solving the bug outright."

export namespace Hint {
  export class MissingContextError extends Error {
    constructor() {
      super("No bug context available. Describe the bug before asking for a hint.")
      this.name = "MissingContextError"
    }
  }

  export function prompt(context: string | undefined) {
    const bug = context?.trim()
    if (!bug) throw new MissingContextError()

    return `${REQUEST}\n\nBug context:\n${bug}`
  }
}
