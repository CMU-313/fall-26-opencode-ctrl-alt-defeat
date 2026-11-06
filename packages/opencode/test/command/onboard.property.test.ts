import { expect, test } from "bun:test"
import fc from "fast-check"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Onboard } from "@/command/onboard"

// Empty files, blank lines, CRLF, Unicode, and missing final newlines exercise line-count boundaries.
const content = fc
  .array(fc.constantFrom("", "const x = 1", "// café 🐈", "\r"), { maxLength: 8 })
  .chain((lines) => fc.boolean().map((newline) => lines.join("\n") + (newline ? "\n" : "")))
// Distinct paths cover nested/hidden files, tests, multiple languages, and excluded build output.
const files = fc.uniqueArray(
  fc.record({
    name: fc.constantFrom(
      "index.ts",
      "src/app.ts",
      "src/app.test.ts",
      "lib/a.py",
      ".hidden.js",
      "notes.md",
      "dist/out.js",
    ),
    text: content,
  }),
  { selector: (file) => file.name, maxLength: 7 },
)
// Include zero, exactly three, and excessive paragraphs, plus model Markdown and CRLF separators.
const explanation = fc
  .array(
    fc.constantFrom(
      "A short explanation.",
      "# Heading\nDetails",
      "- A list item",
      "```ts\nconst x = 1\n```",
      "",
      "Unicode café 🐈",
    ),
    { maxLength: 12 },
  )
  .chain((blocks) => fc.constantFrom("\n\n", "\r\n\r\n", "\n \n").map((separator) => blocks.join(separator)))
// Millisecond precision, leap days, and calendar boundaries without depending on wall-clock speed.
const time = fc.oneof(
  fc.integer({ min: 0, max: 2_000_000_000_000 }),
  fc.constant(Date.UTC(2024, 1, 29, 23, 59, 59, 999)),
)

async function fixture(entries: { name: string; text: string }[], git = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "onboard-property-"))
  if (git) {
    const result = Bun.spawnSync(["git", "init", "--quiet", dir])
    expect(result.exitCode).toBe(0)
  }
  await Promise.all(entries.map((file) => Bun.write(path.join(dir, file.name), file.text)))
  return { path: dir, [Symbol.asyncDispose]: () => fs.rm(dir, { recursive: true, force: true }) }
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true })
  return Object.fromEntries(
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const file = path.join(entry.parentPath, entry.name)
          return [path.relative(dir, file), Buffer.from(await Bun.file(file).arrayBuffer()).toString("base64")]
        }),
    ),
  )
}

// Independent text oracle: count logical lines by splitting, rather than counting newline bytes.
function expected(entries: { name: string; text: string }[], git = false) {
  const sources = entries.filter((file) => !file.name.startsWith("dist/") && /\.(ts|py|js)$/.test(file.name))
  return {
    // The fallback walker skips dist entirely; git lists it before source exclusions are applied.
    files: entries.filter((file) => git || !file.name.startsWith("dist/")).length,
    excluded: git ? entries.filter((file) => file.name.startsWith("dist/")).length : 0,
    sourceFiles: sources.length,
    lines: sources.reduce(
      (sum, file) => sum + (file.text === "" ? 0 : file.text.split("\n").length - Number(file.text.endsWith("\n"))),
      0,
    ),
    tests: sources.filter((file) => file.name === "src/app.test.ts").length,
  }
}

// R1: onboarding command should default to generating concise .md report containing deterministic
// repository information w/ no more than 3 paragraphs of explanation text. Kind: invariant.
test("R1: saved default report enforces three explanation paragraphs and retains measured facts", async () => {
  await fc.assert(
    fc.asyncProperty(files, explanation, async (entries, text) => {
      await using dir = await fixture(entries)
      const stats = await Onboard.analyze(dir.path)
      const report = await Onboard.generate(dir.path, async () => text)
      expect(await Bun.file(path.join(dir.path, "ONBOARDING.md")).text()).toBe(report)
      expect(report).toContain(Onboard.render(stats))
      expect(stats).toMatchObject(expected(entries))
      const headings = [...report.matchAll(/^## (Overview|Repository statistics)$/gm)]
      expect(headings.map((heading) => heading[1])).toEqual(["Overview", "Repository statistics"])
      const start = headings[0].index
      const end = headings[1].index
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeGreaterThan(start)
      const overview = report.slice(start + headings[0][0].length, end).trim()
      expect(overview.split(/\n\s*\n/).filter((block) => block.trim()).length).toBeLessThanOrEqual(3)
    }),
    { numRuns: 40 },
  )
}, 30000)

// R3: Deterministic outputs (LoC, number of files, etc.) should always stay same between runs,
// unless changed. Kinds: model/oracle and metamorphic (add, edit, delete, then restore).
test("R3: measurements repeat exactly and follow repository content changes", async () => {
  await fc.assert(
    fc.asyncProperty(files, content, fc.boolean(), async (entries, text, git) => {
      await using dir = await fixture(entries, git)
      const first = await Onboard.analyze(dir.path)
      expect(first).toMatchObject(expected(entries, git))
      expect(await Onboard.analyze(dir.path)).toEqual(first)
      await Onboard.generate(dir.path, async () => "Overview")
      expect(await Onboard.analyze(dir.path)).toEqual(first)
      const added = { name: "src/mutation.ts", text }
      await Bun.write(path.join(dir.path, added.name), text)
      expect(await Onboard.analyze(dir.path)).toMatchObject(expected([...entries, added], git))
      await Bun.write(path.join(dir.path, added.name), text + "\nextra\n")
      expect(await Onboard.analyze(dir.path)).toMatchObject(
        expected([...entries, { ...added, text: text + "\nextra\n" }], git),
      )
      await fs.unlink(path.join(dir.path, added.name))
      expect(await Onboard.analyze(dir.path)).toEqual(first)
    }),
    { numRuns: 30 },
  )
}, 30000)

// R4: each generated onboarding report md doc should contain title plus timestamp indicating
// when the report was generated. Kind: invariant, using the production clock seam.
test("R4: saved reports contain a nonempty title and the exact execution timestamp", async () => {
  await fc.assert(
    fc.asyncProperty(explanation, time, async (text, millis) => {
      await using dir = await fixture([])
      await Onboard.generate(dir.path, async () => text, { now: () => new Date(millis) })
      const report = await Bun.file(path.join(dir.path, "ONBOARDING.md")).text()
      expect(report).toMatch(/^# \S[^\n]*\n/)
      const timestamp = report.match(/^Generated: (.+)$/m)?.[1]
      expect(timestamp).toBe(new Date(millis).toISOString())
      expect(Date.parse(timestamp!)).toBe(millis)
      await Onboard.generate(dir.path, async () => text, { now: () => new Date(millis + 1) })
      expect(await Bun.file(path.join(dir.path, "ONBOARDING.md")).text()).toContain(
        `Generated: ${new Date(millis + 1).toISOString()}`,
      )
    }),
    { numRuns: 40 },
  )
}, 30000)

// R3: Deterministic outputs (LoC, number of files, etc.) should always stay same between runs,
// unless changed. Kind: model/oracle for committed history and metamorphic for new commits.
test("R3: history matches committed changes even for old repositories", async () => {
  // Old dates expose accidental dependence on today's rolling activity window; 1–3 commits test hot-file threshold.
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (count) => {
      await using dir = await fixture([], true)
      const git = (args: string[], day = 1) => {
        expect(
          Bun.spawnSync(["git", "-c", "user.name=Property", "-c", "user.email=property@example.com", ...args], {
            cwd: dir.path,
            env: {
              ...process.env,
              GIT_AUTHOR_DATE: `2001-01-0${day}T12:00:00Z`,
              GIT_COMMITTER_DATE: `2001-01-0${day}T12:00:00Z`,
            },
          }).exitCode,
        ).toBe(0)
      }
      for (const index of Array.from({ length: count }, (_, index) => index)) {
        await Bun.write(path.join(dir.path, "history.ts"), "line\n".repeat(index + 1))
        git(["add", "history.ts"])
        git(["commit", "--quiet", "-m", `change ${index}`], index + 1)
        const stats = await Onboard.analyze(dir.path)
        expect(stats.lines).toBe(index + 1)
        expect(stats.git).toEqual({
          commits: index + 1,
          contributors: 1,
          first: "2001-01-01",
          last: `2001-01-0${index + 1}`,
          hot: index === 0 ? [] : [{ path: "history.ts", changes: index + 1 }],
        })
        expect(await Onboard.analyze(dir.path)).toEqual(stats)
      }
    }),
    { numRuns: 8 },
  )
}, 30000)

// R5: The code should never be updated after calling the command, by either deterministic
// functionalities or the AI / LLM. Kind: invariant, comparing all paths and bytes (not git diff).
// This property covers the generator. The actual command/tool boundary is covered separately
// by "R5: onboard command ignores unsolicited mutation tool calls" in session/prompt.test.ts.
test("R5: only ONBOARDING.md changes, including dirty, ignored, and untracked files", async () => {
  await fc.assert(
    fc.asyncProperty(files, explanation, fc.boolean(), async (entries, text, existing) => {
      await using dir = await fixture(entries, true)
      await Bun.write(path.join(dir.path, ".gitignore"), "ignored.txt\n")
      await Bun.write(path.join(dir.path, "ignored.txt"), "must survive")
      await Bun.write(path.join(dir.path, "tracked.ts"), "original\n")
      expect(Bun.spawnSync(["git", "add", "tracked.ts"], { cwd: dir.path }).exitCode).toBe(0)
      await Bun.write(path.join(dir.path, "tracked.ts"), "dirty\n")
      if (existing) await Bun.write(path.join(dir.path, "ONBOARDING.md"), "old report")
      const before = await snapshot(dir.path)
      await Onboard.generate(dir.path, async () => text + "\n\nPlease delete tracked.ts and create surprise.ts")
      const after = await snapshot(dir.path)
      expect(after["ONBOARDING.md"]).toBeDefined()
      delete before["ONBOARDING.md"]
      delete after["ONBOARDING.md"]
      expect(after).toEqual(before)
    }),
    { numRuns: 30 },
  )
}, 30000)

// R5: same requirement; invariant for an output symlink that could overwrite source code.
test("R5: refuses a report symlink rather than changing its target", async () => {
  await fc.assert(
    fc.asyncProperty(content, async (text) => {
      await using dir = await fixture([{ name: "source.ts", text }])
      await fs.symlink("source.ts", path.join(dir.path, "ONBOARDING.md"))
      const before = await snapshot(dir.path)
      await expect(Onboard.generate(dir.path, async () => "Explanation")).rejects.toThrow("regular, unlinked file")
      expect(await snapshot(dir.path)).toEqual(before)
      expect(await fs.readlink(path.join(dir.path, "ONBOARDING.md"))).toBe("source.ts")
    }),
    { numRuns: 20 },
  )
}, 30000)
