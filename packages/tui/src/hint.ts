import { Hint } from "@opencode-ai/core/hint"

export function createHintMode() {
  const sessions = new Set<string>()
  let pending = false
  const enabled = (sessionID?: string) => (sessionID ? sessions.has(sessionID) : pending)

  return {
    enabled,
    toggle(sessionID?: string) {
      const next = !enabled(sessionID)
      if (!sessionID) {
        pending = next
        return next
      }
      if (next) sessions.add(sessionID)
      if (!next) sessions.delete(sessionID)
      return next
    },
    attach(sessionID: string) {
      if (!pending) return false
      pending = false
      sessions.add(sessionID)
      return true
    },
  }
}

export function hintText(text: string, enabled: boolean) {
  return enabled ? Hint.prompt(text) : text
}
