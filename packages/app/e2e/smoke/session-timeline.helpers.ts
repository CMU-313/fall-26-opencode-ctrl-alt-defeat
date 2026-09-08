import { expect, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture } from "./session-timeline.fixture"
import { expectSessionTitle } from "../utils/waits"

export type SmokeState = {
  ids: string[]
  visibleIds: string[]
  messageIds: string[]
  visibleMessageIds: string[]
  topVisibleId?: string
  signature: string
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  errorToasts: string[]
  forbiddenText: string[]
}

export type SmokeWindow = Window & {
  __timelineSmokeState?: () => SmokeState
  __timelineSmokeErrorToasts?: string[]
  __timelineSmokeForbiddenText?: string[]
}

export async function configureSmokePage(page: Page, directory: string) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
        },
      }),
    )
  })

  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: {
          local: [{ worktree: directory, expanded: true }],
        },
        lastProject: {
          local: directory,
        },
      }),
    )
  }, directory)

  await page.addInitScript(() => {
    const smoke = window as SmokeWindow
    smoke.__timelineSmokeErrorToasts = []
    smoke.__timelineSmokeForbiddenText = []
    const partSelector = "[data-timeline-part-id], [data-timeline-part-ids]"
    const idsOf = (el: HTMLElement) =>
      [el.dataset.timelinePartId, ...(el.dataset.timelinePartIds?.split(",") ?? [])].filter((id): id is string => !!id)

    smoke.__timelineSmokeState = () => {
      const scroller = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((el) =>
        el.querySelector("[data-timeline-row], [data-session-title]"),
      )
      if (!scroller) {
        return {
          ids: [],
          visibleIds: [],
          messageIds: [],
          visibleMessageIds: [],
          topVisibleId: undefined,
          signature: "",
          scrollTop: 0,
          scrollHeight: 0,
          clientHeight: 0,
          errorToasts: smoke.__timelineSmokeErrorToasts ?? [],
          forbiddenText: smoke.__timelineSmokeForbiddenText ?? [],
        }
      }

      const ids: string[] = []
      const visibleIds: string[] = []
      const scrollerRect = scroller.getBoundingClientRect()
      let topVisibleId: string | undefined
      for (const el of scroller.querySelectorAll<HTMLElement>(partSelector)) {
        const next = idsOf(el)
        ids.push(...next)

        const rect = el.getBoundingClientRect()
        if (rect.bottom >= scrollerRect.top && rect.top <= scrollerRect.bottom) {
          if (!topVisibleId) topVisibleId = next[0]
          visibleIds.push(...next)
        }
      }

      const messageIds: string[] = []
      const visibleMessageIds: string[] = []
      const rows = [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")].map((el) => {
        const rect = el.getBoundingClientRect()
        const id = el.dataset.messageId
        if (id) {
          messageIds.push(id)
          if (rect.bottom >= scrollerRect.top && rect.top <= scrollerRect.bottom) visibleMessageIds.push(id)
        }
        return {
          id,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
        }
      })
      const signature = JSON.stringify({
        top: Math.round(scroller.scrollTop),
        height: Math.round(scroller.scrollHeight),
        rows,
        ids,
      })

      return {
        ids,
        visibleIds,
        messageIds,
        visibleMessageIds,
        topVisibleId,
        signature,
        scrollTop: Math.round(scroller.scrollTop),
        scrollHeight: Math.round(scroller.scrollHeight),
        clientHeight: Math.round(scroller.clientHeight),
        errorToasts: smoke.__timelineSmokeErrorToasts ?? [],
        forbiddenText: smoke.__timelineSmokeForbiddenText ?? [],
      }
    }
    let recordFrame: number | undefined
    const record = () => {
      for (const toast of document.querySelectorAll<HTMLElement>('[data-component="toast"][data-variant="error"]')) {
        const text = toast.textContent?.trim()
        if (text && !smoke.__timelineSmokeErrorToasts!.includes(text)) smoke.__timelineSmokeErrorToasts!.push(text)
      }
      const text = document.body?.textContent ?? ""
      for (const value of ["Load details", "Show earlier steps"]) {
        if (text.includes(value) && !smoke.__timelineSmokeForbiddenText!.includes(value)) {
          smoke.__timelineSmokeForbiddenText!.push(value)
        }
      }
    }
    const start = () => {
      const root = document.documentElement ?? document.body
      if (!root) return
      new MutationObserver(() => {
        if (recordFrame) return
        recordFrame = requestAnimationFrame(() => {
          recordFrame = undefined
          record()
        })
      }).observe(root, { childList: true, subtree: true })
      record()
    }
    if (document.documentElement ?? document.body) start()
    else document.addEventListener("DOMContentLoaded", start, { once: true })
  })
}

export function timelineScroller(page: Page) {
  return page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
}

export async function pointAtTimeline(page: Page) {
  const box = await timelineScroller(page).boundingBox()
  if (!box) throw new Error("Timeline scroller is not visible")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

export async function waitForTimelineStable(page: Page) {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => {
          const a = (window as SmokeWindow).__timelineSmokeState?.().signature ?? ""
          requestAnimationFrame(() => {
            const b = (window as SmokeWindow).__timelineSmokeState?.().signature ?? ""
            requestAnimationFrame(() =>
              resolve(!!a && a === b && b === ((window as SmokeWindow).__timelineSmokeState?.().signature ?? "")),
            )
          })
        })
      }),
  )
}

export async function navigateToSession(page: Page, directory: string, sessionId: string, expectedTitle: string) {
  await page.goto(`/${base64Encode(directory)}/session/${sessionId}`)
  await expectSessionTitle(page, expectedTitle)
}

export async function switchTitlebarSession(page: Page, sessionID: string, title: string) {
  const href = `/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`
  const tab = page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`).first()
  await expect(tab).toBeVisible()
  await tab.click()
  await expectSessionTitle(page, title)
}
