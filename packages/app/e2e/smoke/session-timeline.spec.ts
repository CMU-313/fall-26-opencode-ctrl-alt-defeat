import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture, pageMessages } from "./session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"
import {
  configureSmokePage,
  navigateToSession,
  switchTitlebarSession,
  timelineScroller,
  waitForTimelineStable,
} from "./session-timeline.helpers"

// The two slower checks that used to live here (scroll-to-history-boundary and
// full-timeline paging) moved to e2e/regression/session-timeline-history-scroll.spec.ts
// so every-push smoke stays fast. See test.yml / e2e-regression.yml for how the
// two suites are wired to push vs. nightly.
test.describe("smoke: session timeline", () => {
  test.setTimeout(240_000)

  test("preserves the timeline gap above the composer", async ({ page }) => {
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
    })
    await configureSmokePage(page, fixture.directory)

    await navigateToSession(page, fixture.directory, fixture.targetID, fixture.expected.targetTitle)
    await waitForTimelineStable(page)
    const scroller = timelineScroller(page)
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await waitForTimelineStable(page)

    const spacer = scroller.locator('[data-timeline-row="bottom-spacer"]')
    await expect(spacer).toBeVisible()
    expect(await spacer.evaluate((element) => element.getBoundingClientRect().height)).toBe(64)
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeLessThanOrEqual(1)
  })

  test("paints cached session tabs at the latest message", async ({ page }) => {
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages: (sessionID) => ({ items: fixture.messages[sessionID as keyof typeof fixture.messages] ?? [] }),
    })
    await configureSmokePage(page, fixture.directory)
    await page.addInitScript(
      ({ dirBase64, sourceID, targetID }) => {
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify(
            [sourceID, targetID].map((sessionId) => ({
              type: "session",
              server: "http://127.0.0.1:4096",
              dirBase64,
              sessionId,
            })),
          ),
        )
      },
      { dirBase64: base64Encode(fixture.directory), sourceID: fixture.sourceID, targetID: fixture.targetID },
    )

    await page.goto(`/${base64Encode(fixture.directory)}/session/${fixture.targetID}`)
    await expectSessionTitle(page, fixture.expected.targetTitle)
    await switchTitlebarSession(page, fixture.sourceID, fixture.expected.sourceTitle)

    const destination = fixture.messages[fixture.targetID].map((message) => message.info.id)
    const last = fixture.expected.targetMessageIDs.at(-1)!
    await page.evaluate(
      ({ destination, last }) => {
        const ids = new Set(destination)
        const samples: Array<{ ids: string[]; last: boolean; bottomError?: number }> = []
        const firstPaintNodes = new WeakSet<Node>()
        let firstPaint = false
        let removedFirstPaintNodes = 0
        let running = true
        new MutationObserver((records) => {
          if (!firstPaint || !running) return
          records.forEach((record) =>
            record.removedNodes.forEach((node) => {
              if (firstPaintNodes.has(node)) removedFirstPaintNodes += 1
              if (!(node instanceof Element)) return
              node.querySelectorAll("*").forEach((element) => {
                if (firstPaintNodes.has(element)) removedFirstPaintNodes += 1
              })
            }),
          )
        }).observe(document.documentElement, { childList: true, subtree: true })
        const sample = () => {
          if (!running) return
          setTimeout(() => {
            if (!running) return
            const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
              element.querySelector("[data-timeline-row]"),
            )
            if (root) {
              const view = root.getBoundingClientRect()
              const visible = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
                .filter((element) => {
                  const rect = element.getBoundingClientRect()
                  return rect.bottom > view.top && rect.top < view.bottom
                })
                .map((element) => element.dataset.messageId!)
                .filter((id) => ids.has(id))
              const bottom = root
                .querySelector<HTMLElement>('[data-timeline-row="bottom-spacer"]')
                ?.getBoundingClientRect()
              samples.push({ ids: visible, last: visible.includes(last), bottomError: bottom?.bottom - view.bottom })
              if (!firstPaint && visible.includes(last) && Math.abs((bottom?.bottom ?? Infinity) - view.bottom) <= 1) {
                firstPaint = true
                root.querySelectorAll<HTMLElement>("[data-timeline-key]").forEach((row) => {
                  const rect = row.getBoundingClientRect()
                  if (rect.bottom <= view.top || rect.top >= view.bottom) return
                  firstPaintNodes.add(row)
                  row.querySelectorAll("*").forEach((element) => firstPaintNodes.add(element))
                })
              }
            }
            requestAnimationFrame(sample)
          }, 0)
        }
        ;(
          window as Window & {
            __sessionTabPaint?: { samples: typeof samples; removed: () => number; stop: () => void }
          }
        ).__sessionTabPaint = {
          samples,
          removed: () => removedFirstPaintNodes,
          stop: () => {
            running = false
          },
        }
        requestAnimationFrame(sample)
      },
      { destination, last },
    )

    await switchTitlebarSession(page, fixture.targetID, fixture.expected.targetTitle)
    await page.waitForFunction(() =>
      (
        window as Window & { __sessionTabPaint?: { samples: Array<{ ids: string[] }> } }
      ).__sessionTabPaint?.samples.some((sample) => sample.ids.length > 0),
    )
    await page.waitForTimeout(200)
    const first = await page.evaluate(() => {
      const probe = (
        window as Window & {
          __sessionTabPaint?: {
            samples: Array<{ ids: string[]; last: boolean; bottomError?: number }>
            removed: () => number
            stop: () => void
          }
        }
      ).__sessionTabPaint!
      probe.stop()
      return { first: probe.samples.find((sample) => sample.ids.length > 0), removed: probe.removed() }
    })
    expect(first.first?.last).toBe(true)
    expect(Math.abs(first.first?.bottomError ?? Infinity)).toBeLessThanOrEqual(1)
    expect(first.removed).toBe(0)
  })

  test("paints a cold session tab at the latest message", async ({ page }) => {
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages: (sessionID) => ({ items: fixture.messages[sessionID as keyof typeof fixture.messages] ?? [] }),
    })
    await configureSmokePage(page, fixture.directory)
    await page.addInitScript(
      ({ dirBase64, sourceID, targetID }) => {
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify(
            [sourceID, targetID].map((sessionId) => ({
              type: "session",
              server: "http://127.0.0.1:4096",
              dirBase64,
              sessionId,
            })),
          ),
        )
      },
      { dirBase64: base64Encode(fixture.directory), sourceID: fixture.sourceID, targetID: fixture.targetID },
    )
    await page.goto(`/${base64Encode(fixture.directory)}/session/${fixture.sourceID}`)
    await expectSessionTitle(page, fixture.expected.sourceTitle)
    const last = fixture.expected.targetMessageIDs.at(-1)!
    const destination = fixture.messages[fixture.targetID].map((message) => message.info.id)
    await page.evaluate(
      ({ destination, last }) => {
        const ids = new Set(destination)
        const samples: Array<{ destination: boolean; last: boolean; bottomError?: number }> = []
        const sample = () => {
          const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
            element.querySelector("[data-timeline-row]"),
          )
          if (root) {
            const view = root.getBoundingClientRect()
            const spacer = root
              .querySelector<HTMLElement>('[data-timeline-row="bottom-spacer"]')
              ?.getBoundingClientRect()
            const messages = [...root.querySelectorAll<HTMLElement>("[data-message-id]")].filter((element) => {
              const rect = element.getBoundingClientRect()
              return rect.bottom > view.top && rect.top < view.bottom
            })
            samples.push({
              destination: messages.some((element) => ids.has(element.dataset.messageId!)),
              last: messages.some((element) => element.dataset.messageId === last),
              bottomError: spacer ? spacer.bottom - view.bottom : undefined,
            })
          }
          requestAnimationFrame(() => setTimeout(sample, 0))
        }
        ;(window as Window & { __coldTabSamples?: typeof samples }).__coldTabSamples = samples
        requestAnimationFrame(() => setTimeout(sample, 0))
      },
      { destination, last },
    )

    await switchTitlebarSession(page, fixture.targetID, fixture.expected.targetTitle)
    await page.waitForFunction(() =>
      (window as Window & { __coldTabSamples?: Array<{ destination: boolean }> }).__coldTabSamples?.some(
        (sample) => sample.destination,
      ),
    )
    const result = await page.evaluate(() => {
      const samples = (
        window as Window & {
          __coldTabSamples?: Array<{ destination: boolean; last: boolean; bottomError?: number }>
        }
      ).__coldTabSamples!
      return samples.find((sample) => sample.destination)!
    })
    expect(result.last).toBe(true)
    expect(Math.abs(result.bottomError ?? Infinity)).toBeLessThanOrEqual(1)
  })
})
