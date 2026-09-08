import { expect, test } from "bun:test"
import { type Virtualizer } from "@tanstack/solid-virtual"
import { mutationNodesContainElement, observeElementOffsetReconnectAware } from "./observe-element-offset"

test("matches only the scroll element or an ancestor containing it", () => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  const child = document.createElement("div")
  const sibling = document.createElement("div")
  route.append(viewport)
  viewport.append(child)

  expect(mutationNodesContainElement([viewport], viewport)).toBe(true)
  expect(mutationNodesContainElement([route], viewport)).toBe(true)
  expect(mutationNodesContainElement([child, sibling], viewport)).toBe(false)
})

test(
  "reports a divergent native offset once and ignores equal offsets and unrelated mutations",
  async () => {
    const route = document.createElement("section")
    const viewport = document.createElement("div")
    const unrelated = document.createElement("div")
    route.append(viewport)
    document.body.append(route)
    const instance = {
      scrollElement: viewport,
      targetWindow: window,
      scrollOffset: 79_400,
      options: {
        horizontal: false,
        isRtl: false,
        isScrollingResetDelay: 0,
        useScrollendEvent: false,
      },
    } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
    const calls: [number, boolean][] = []
    const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
      calls.push([offset, isScrolling])
      instance.scrollOffset = offset
    })

    document.body.append(unrelated)
    unrelated.remove()
    await frames(2)
    expect(calls).toEqual([])

    route.remove()
    document.body.append(route)
    await waitForCalls(calls, 1)
    expect(calls).toEqual([[0, false]])

    route.remove()
    document.body.append(route)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await frames(3)
    expect(calls).toEqual([[0, false]])

    cleanup?.()
    route.remove()
  },
  // happydom's MutationObserver occasionally never redelivers a notification
  // for a mutation batch that follows closely after a prior one (a library
  // bug, not a logic bug here — verified with a raw MutationObserver outside
  // this helper, ~1-2% of runs even with generous polling). Not something a
  // longer wait can fix since the observer callback just doesn't fire again;
  // retry the whole test instead.
  { retry: 2 },
)

test("keeps checking until stale reset-delay callbacks can no longer win", async () => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 79_400,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 20,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: number[] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset) => {
    calls.push(offset)
    instance.scrollOffset = offset
  })

  route.remove()
  document.body.append(route)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await frames(1)
  expect(instance.scrollOffset).toBe(0)

  instance.scrollOffset = 79_400
  await new Promise((resolve) => setTimeout(resolve, 25))
  await frames(3)

  expect(instance.scrollOffset).toBe(0)
  expect(calls).toEqual([0, 0])
  cleanup?.()
  route.remove()
})

test.each([
  { name: "LTR", isRtl: false, expected: 240 },
  { name: "RTL", isRtl: true, expected: -240 },
])("reports the TanStack horizontal $name offset after reconnect", async ({ isRtl, expected }) => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  viewport.scrollLeft = 240
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 0,
    options: {
      horizontal: true,
      isRtl,
      isScrollingResetDelay: 0,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: [number, boolean][] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
    calls.push([offset, isScrolling])
    instance.scrollOffset = offset
  })

  route.remove()
  document.body.append(route)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await frames(3)

  expect(calls).toEqual([[expected, false]])
  cleanup?.()
  route.remove()
})

test("cleanup suppresses an already queued delegated offset callback", async () => {
  const viewport = document.createElement("div")
  document.body.append(viewport)
  viewport.scrollTop = 100
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 0,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 10,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: [number, boolean][] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) =>
    calls.push([offset, isScrolling]),
  )

  viewport.dispatchEvent(new Event("scroll"))
  cleanup?.()
  await new Promise((resolve) => setTimeout(resolve, 25))

  expect(calls).toEqual([[100, true]])
  viewport.remove()
})

test("cleanup cancels reconnect checks and delegated offset observation", async () => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: window,
    scrollOffset: 0,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 50,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: number[] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset) => calls.push(offset))

  route.remove()
  document.body.append(route)
  await new Promise((resolve) => setTimeout(resolve, 0))
  cleanup?.()
  instance.scrollOffset = 100
  viewport.dispatchEvent(new Event("scroll"))
  await frames(4)

  expect(calls).toEqual([])
  route.remove()
})

async function frames(count: number) {
  for (let index = 0; index < count; index++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

// happydom's MutationObserver notification isn't guaranteed to have flushed
// by the time a fixed `setTimeout(0) + frames(3)` wait resolves, so the very
// first delivery after a reconnect can occasionally still be pending. Poll,
// alternating a real macrotask yield with an animation frame (rAF alone
// doesn't reliably give a pending timer-scheduled notification a turn),
// instead of assuming a fixed wait is enough.
async function waitForCalls(calls: unknown[], count: number, maxIterations = 20) {
  for (let index = 0; index < maxIterations && calls.length < count; index++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await frames(1)
  }
}
