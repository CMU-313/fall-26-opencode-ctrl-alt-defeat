import { describe, expect, test } from "bun:test"
import { Hint } from "@opencode-ai/core/hint"
import { createHintMode, hintText } from "../src/hint"

describe("hint mode", () => {
  test("toggles independently for each existing session", () => {
    const mode = createHintMode()

    expect(mode.toggle("session-one")).toBe(true)
    expect(mode.enabled("session-one")).toBe(true)
    expect(mode.enabled("session-two")).toBe(false)
    expect(mode.toggle("session-one")).toBe(false)
  })

  test("carries pending hint mode into a newly created session", () => {
    const mode = createHintMode()

    expect(mode.toggle()).toBe(true)
    expect(mode.attach("session-new")).toBe(true)
    expect(mode.enabled()).toBe(false)
    expect(mode.enabled("session-new")).toBe(true)
  })

  test("transforms prompts only while hint mode is enabled", () => {
    expect(hintText("Investigate the retry", false)).toBe("Investigate the retry")
    expect(hintText("Investigate the retry", true)).toBe(Hint.prompt("Investigate the retry"))
  })
})
