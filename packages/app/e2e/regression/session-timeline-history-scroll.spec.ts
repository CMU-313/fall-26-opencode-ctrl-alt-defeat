import { expect, test, type Page } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import {
  configureSmokePage,
  pointAtTimeline,
  timelineScroller,
  navigateToSession,
  waitForTimelineStable,
  type SmokeState,
  type SmokeWindow,
} from "../smoke/session-timeline.helpers"
import { trackPageErrors, expectNoSmokeErrors } from "../utils/errors"
import { mockOpenCodeServer } from "../utils/mock-server"
import { APP_READY_TIMEOUT, expectAppVisible } from "../utils/waits"

// Moved out of e2e/smoke/session-timeline.spec.ts: these two cases scroll through
// the full seeded history (up to ~600 scroll steps / 331 timeline parts) and take
// tens of seconds each, so they run in the nightly regression suite instead of on
// every push. See e2e/smoke/session-timeline.spec.ts for the fast checks that stayed.
const forbiddenText = ["Load details", "Show earlier steps"]

test.describe("regression: session timeline history scroll", () => {
  test.setTimeout(240_000)

  test("keeps the visible message fixed while prepending history", async ({ page }) => {
    const requests: { before?: string; phase: "start" | "end"; at: number }[] = []
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
      messageDelay: 3_000,
      onMessages: (input) => requests.push({ before: input.before, phase: input.phase, at: performance.now() }),
    })
    await configureSmokePage(page, fixture.directory)

    await navigateToSession(page, fixture.directory, fixture.targetID, fixture.expected.targetTitle)
    await waitForTimelineStable(page)
    const scroller = timelineScroller(page)
    await pointAtTimeline(page)
    const deadline = Date.now() + 120_000
    while (!requests.some((request) => request.before && request.phase === "start")) {
      if (Date.now() >= deadline) throw new Error("Timed out scrolling to the history boundary")
      await page.mouse.wheel(0, -240)
      await page.waitForTimeout(20)
    }
    expect(requests.some((request) => request.before && request.phase === "end")).toBe(false)
    for (let index = 0; index < 12; index++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(20)
    }
    const keys = await scroller.evaluate((element) => {
      const view = element.getBoundingClientRect()
      return [...element.querySelectorAll<HTMLElement>("[data-timeline-part-id]")]
        .filter((row) => {
          const rect = row.getBoundingClientRect()
          return rect.bottom > view.top && rect.top < view.bottom
        })
        .map((row) => row.dataset.timelinePartId)
        .filter((id): id is string => !!id)
        .slice(0, 3)
    })
    expect(keys.length).toBeGreaterThan(0)
    const positions = () =>
      scroller.evaluate((element, keys) => {
        const top = element.getBoundingClientRect().top
        return Object.fromEntries(
          keys.map((key) => {
            const row = element.querySelector<HTMLElement>(`[data-timeline-part-id="${key}"]`)
            if (!row) throw new Error(`Missing stable timeline key: ${key}`)
            return [key, Math.round((row.getBoundingClientRect().top - top) * devicePixelRatio) / devicePixelRatio]
          }),
        )
      }, keys)
    const before = await positions()
    expect(requests.some((request) => request.before && request.phase === "end")).toBe(false)

    await expect.poll(() => requests.some((request) => request.before && request.phase === "end")).toBe(true)
    await waitForTimelineStable(page)
    await expect.poll(positions).toEqual(before)
  })

  test("renders seeded timeline in order while paging through history", async ({ page }) => {
    const errors = trackPageErrors(page)
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
    })
    await configureSmokePage(page, fixture.directory)

    await selectHomeProject(page, fixture.project.name)
    await navigateToSession(page, fixture.directory, fixture.sourceID, fixture.expected.sourceTitle)
    await expectSessionReady(page)
    await navigateToSession(page, fixture.directory, fixture.targetID, fixture.expected.targetTitle)
    const expectedPartIDs = fixture.expected.targetPartIDs
    const expectedMessageIDs = fixture.expected.targetMessageIDs
    await expectSessionTimelineReady(page, expectedPartIDs, expectedMessageIDs, errors)
    await expectCanScrollToStart(page, expectedPartIDs, expectedMessageIDs, errors)

    const shell = page.locator(`[data-timeline-part-id="${fixture.expected.expandedShellPartID}"]`)
    const shellTrigger = shell.locator('[data-slot="collapsible-trigger"]')
    const shellSubtitle = shell.locator('[data-slot="basic-tool-tool-subtitle"]')
    await expect(shellSubtitle).toHaveCount(0)
    await expect(shell.locator('[data-slot="bash-pre"]')).toContainText("$ bun typecheck")
    await shellTrigger.click()
    await expect(shellTrigger).toHaveAttribute("aria-expanded", "false")
    await expect(shellSubtitle).toHaveText("bun typecheck")
    await shellTrigger.click()
    await expect(shellTrigger).toHaveAttribute("aria-expanded", "true")
    await expect(shellSubtitle).toHaveCount(0)
  })
})

async function expectCanScrollToStart(
  page: Page,
  expectedPartIDs: string[],
  expectedMessageIDs: string[],
  errors: string[],
) {
  await pointAtTimeline(page)
  const seenParts = new Set<string>()
  const seenMessages = new Set<string>()
  const samples: TraversalSample[] = []
  let current = await timelineState(page)
  let unchangedAtTop = 0

  for (let attempt = 0; attempt < 600; attempt++) {
    collectSeen(current, seenParts, seenMessages)
    samples.push(sampleTraversal(current, seenParts.size, seenMessages.size))
    expectNoSmokeErrors(errors, current.errorToasts, current.forbiddenText)
    expectOrderedIDs(expectedPartIDs, current.ids, "mounted part")
    expectOrderedIDs(expectedPartIDs, current.visibleIds, "visible part")
    expectOrderedIDs(expectedMessageIDs, unique(current.messageIds), "mounted message")
    expectOrderedIDs(expectedMessageIDs, unique(current.visibleMessageIds), "visible message")

    if (
      current.scrollTop <= 1 &&
      seenParts.size === expectedPartIDs.length &&
      seenMessages.size === expectedMessageIDs.length
    ) {
      expectCompleteScroll(current, expectedPartIDs, expectedMessageIDs, seenParts, seenMessages, samples)
      return
    }

    const before = current
    const changed = await scrollTimelineUp(page, current)
    current = await timelineState(page)
    if (!changed && current.signature === before.signature && current.scrollTop <= 1) unchangedAtTop++
    else unchangedAtTop = 0
    if (unchangedAtTop >= 2) break
  }

  collectSeen(current, seenParts, seenMessages)
  samples.push(sampleTraversal(current, seenParts.size, seenMessages.size))
  expectCompleteScroll(current, expectedPartIDs, expectedMessageIDs, seenParts, seenMessages, samples)
}

async function timelineState(page: Page) {
  return page.evaluate(
    () =>
      (window as SmokeWindow).__timelineSmokeState?.() ?? {
        ids: [],
        visibleIds: [],
        messageIds: [],
        visibleMessageIds: [],
        topVisibleId: undefined,
        signature: "",
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        errorToasts: [],
        forbiddenText: [],
      },
  )
}

async function scrollTimelineUp(page: Page, before: SmokeState) {
  return page.evaluate(
    (prev) =>
      new Promise<boolean>((resolve) => {
        const scroller = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((el) =>
          el.querySelector("[data-timeline-row], [data-session-title]"),
        )
        if (!scroller) {
          resolve(false)
          return
        }

        scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -1, deltaMode: 0 }))
        scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.max(80, Math.round(scroller.clientHeight * 0.45)))

        const read = () => (window as SmokeWindow).__timelineSmokeState?.().signature ?? ""
        let frames = 0
        let stableFrames = 0
        let last = ""
        let changed = false
        const check = () => {
          const current = read()
          if (current !== prev) changed = true
          if (current === last) stableFrames++
          else {
            stableFrames = 0
            last = current
          }
          if (changed && stableFrames >= 2) {
            resolve(true)
            return
          }
          frames++
          if (frames >= 30) {
            resolve(changed)
            return
          }
          requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      }),
    before.signature,
  )
}

function expectOrderedIDs(expected: string[], actual: string[], label: string) {
  expect(actual.length, `${label} ids should not be empty`).toBeGreaterThan(0)
  const actualSet = new Set(actual)
  expect(actual, `${label} ids`).toEqual(expected.filter((id) => actualSet.has(id)))
}

function unique(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function collectSeen(state: SmokeState, seenParts: Set<string>, seenMessages: Set<string>) {
  for (const id of state.ids) seenParts.add(id)
  for (const id of state.visibleIds) seenParts.add(id)
  for (const id of state.messageIds) seenMessages.add(id)
  for (const id of state.visibleMessageIds) seenMessages.add(id)
}

type TraversalSample = ReturnType<typeof sampleTraversal>

function sampleTraversal(state: SmokeState, seenParts: number, seenMessages: number) {
  return {
    seenParts,
    seenMessages,
    mounted: state.ids.length,
    visible: state.visibleIds.length,
    mountedMessages: unique(state.messageIds).length,
    visibleMessages: unique(state.visibleMessageIds).length,
    top: state.scrollTop,
    height: state.scrollHeight,
    first: state.ids[0],
    last: state.ids.at(-1),
    topVisible: state.topVisibleId,
    visibleFirst: state.visibleIds[0],
    visibleLast: state.visibleIds.at(-1),
  }
}

function sampleSummary(samples: TraversalSample[]) {
  return samples
    .filter((_, index) => index % Math.max(1, Math.floor(samples.length / 8)) === 0 || index === samples.length - 1)
    .map(
      (sample, index) =>
        `${index}: seenParts=${sample.seenParts} seenMessages=${sample.seenMessages} mounted=${sample.mounted}/${sample.mountedMessages} visible=${sample.visible}/${sample.visibleMessages} top=${sample.top}/${sample.height} first=${sample.first} last=${sample.last} topVisible=${sample.topVisible} visible=${sample.visibleFirst}..${sample.visibleLast}`,
    )
    .join("\n")
}

async function expectSessionTimelineReady(
  page: Page,
  expectedPartIDs: string[],
  expectedMessageIDs: string[],
  errors: string[],
) {
  await waitForTimelineStable(page)
  for (const text of forbiddenText) await expect(page.getByText(text)).toHaveCount(0)
  const currentState = await timelineState(page)
  expectNoSmokeErrors(errors, currentState.errorToasts, currentState.forbiddenText)
  expectOrderedIDs(expectedPartIDs, currentState.ids, "mounted part")
  expectOrderedIDs(expectedPartIDs, currentState.visibleIds, "visible part")
  expectOrderedIDs(expectedMessageIDs, unique(currentState.messageIds), "mounted message")
  expectOrderedIDs(expectedMessageIDs, unique(currentState.visibleMessageIds), "visible message")
}

function expectCompleteScroll(
  state: SmokeState,
  expectedPartIDs: string[],
  expectedMessageIDs: string[],
  seenParts: Set<string>,
  seenMessages: Set<string>,
  samples: TraversalSample[],
) {
  expect(state.scrollTop, `timeline should reach the start\n${sampleSummary(samples)}`).toBeLessThanOrEqual(1)
  expect(
    expectedPartIDs.filter((id) => !seenParts.has(id)),
    `missing visible timeline parts\n${sampleSummary(samples)}`,
  ).toEqual([])
  expect(
    expectedMessageIDs.filter((id) => !seenMessages.has(id)),
    `missing visible messages\n${sampleSummary(samples)}`,
  ).toEqual([])
  expect(new Set(expectedPartIDs).size).toBe(expectedPartIDs.length)
  expect(new Set(expectedMessageIDs).size).toBe(expectedMessageIDs.length)
  expect(expectedPartIDs.length).toBe(331)
}

async function selectHomeProject(page: Page, projectName: string) {
  await page.goto("/")
  const row = page
    .locator('[data-component="home-project-row"]')
    .filter({ hasText: new RegExp(projectName, "i") })
    .first()
  await expectAppVisible(row)
  await row.click()
  await expect(row).toHaveAttribute("data-selected", "", { timeout: APP_READY_TIMEOUT })
  await expect(page).toHaveURL(/\/$/)
}

async function expectSessionReady(page: Page) {
  await expectAppVisible(page.getByRole("textbox", { name: "Prompt" }))
}
