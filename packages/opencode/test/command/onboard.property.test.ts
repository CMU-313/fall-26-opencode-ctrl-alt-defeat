import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Onboard } from "../../src/command/onboard"

fc.configureGlobal({ seed: 42 })

async function withTempRepo(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-onboard-prop-"))
  try {
    await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function snapshotFiles(dir: string, rel?: string): Promise<Record<string, string>> {
  const base = rel || ""
  const result: Record<string, string> = {}
  const targetDir = base ? path.join(dir, base) : dir
  const entries = await fs.readdir(targetDir, { withFileTypes: true })
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const relPath = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      const nested = await snapshotFiles(dir, relPath)
      Object.assign(result, nested)
    } else if (entry.isFile()) {
      const content = await fs.readFile(path.join(dir, relPath), "utf8")
      result[relPath] = content
    }
  }
  return result
}

const SAFE_NAMES = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"]

const SOURCE_EXTENSIONS: Array<{ ext: string; language: string }> = [
  { ext: ".ts", language: "TypeScript" },
  { ext: ".py", language: "Python" },
  { ext: ".go", language: "Go" },
  { ext: ".rs", language: "Rust" },
]

const linesContentArb = fc
  .record({
    lineCount: fc.integer({ min: 1, max: 40 }),
    trailingNewline: fc.boolean(),
    brokenSyntax: fc.boolean(),
  })
  .map(({ lineCount, trailingNewline, brokenSyntax }) => {
    const lineText = brokenSyntax ? "function {{{ SYNTAX_ERROR @@@" : "const x = 1;"
    const body = Array.from({ length: lineCount }, (_, i) => `${lineText} // line ${i + 1}`).join("\n")
    return {
      content: trailingNewline ? `${body}\n` : body,
      expectedLines: lineCount,
    }
  })

const dirPrefixArb = fc.oneof(
  fc.constant(""),
  fc.constantFrom("src", "lib", "core", "utils", "cmd"),
  fc
    .tuple(fc.constantFrom("packages", "apps", "services"), fc.constantFrom("web", "api", "cli", "sdk"))
    .map(([container, sub]) => `${container}/${sub}`),
)

interface SourceSpec {
  dir: string
  base: string
  extInfo: { ext: string; language: string }
  fileData: { content: string; expectedLines: number }
}

interface IgnoredSpec {
  ignoredDir: string
  base: string
  fileData: { content: string; expectedLines: number }
}

interface RepoSpec {
  sources: SourceSpec[]
  ignoredDirFiles: IgnoredSpec[]
  docsFiles: string[]
  ciFiles: string[]
  hasLockfile: boolean
  shallowManifests: string[]
  deepManifest: boolean
}

const repoSpecArb: fc.Arbitrary<RepoSpec> = fc.record({
  sources: fc.uniqueArray(
    fc.record({
      dir: dirPrefixArb,
      base: fc.constantFrom(...SAFE_NAMES),
      extInfo: fc.constantFrom(...SOURCE_EXTENSIONS),
      fileData: linesContentArb,
    }),
    {
      minLength: 2,
      maxLength: 16,
      selector: (item) => `${item.dir}/${item.base}${item.extInfo.ext}`,
    },
  ),
  ignoredDirFiles: fc.uniqueArray(
    fc.record({
      ignoredDir: fc.constantFrom("node_modules", "dist", "build", "vendor"),
      base: fc.constantFrom(...SAFE_NAMES),
      fileData: linesContentArb,
    }),
    {
      minLength: 0,
      maxLength: 5,
      selector: (item) => `${item.ignoredDir}/${item.base}.ts`,
    },
  ),
  docsFiles: fc.subarray(["README.md", "CONTRIBUTING.md", "ARCHITECTURE.md", "docs/setup.md", "docs/api.md"], {
    minLength: 0,
    maxLength: 5,
  }),
  ciFiles: fc.subarray([".github/workflows/ci.yml", ".github/workflows/release.yml", ".gitlab-ci.yml"], {
    minLength: 0,
    maxLength: 3,
  }),
  hasLockfile: fc.boolean(),
  shallowManifests: fc.subarray(["package.json", "Cargo.toml", "pyproject.toml", "Makefile"], {
    minLength: 0,
    maxLength: 4,
  }),
  deepManifest: fc.boolean(),
})

async function materializeRepo(dir: string, spec: RepoSpec, reverseOrder: boolean = false): Promise<void> {
  const sources = reverseOrder ? [...spec.sources].reverse() : spec.sources
  for (const src of sources) {
    const relPath = src.dir ? `${src.dir}/${src.base}${src.extInfo.ext}` : `${src.base}${src.extInfo.ext}`
    const fullPath = path.join(dir, relPath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, src.fileData.content, "utf8")
  }

  for (const ign of spec.ignoredDirFiles) {
    const relPath = `${ign.ignoredDir}/${ign.base}.ts`
    const fullPath = path.join(dir, relPath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, ign.fileData.content, "utf8")
  }

  const docs = reverseOrder ? [...spec.docsFiles].reverse() : spec.docsFiles
  for (const doc of docs) {
    const fullPath = path.join(dir, doc)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, "# Doc\n", "utf8")
  }

  const cis = reverseOrder ? [...spec.ciFiles].reverse() : spec.ciFiles
  for (const ci of cis) {
    const fullPath = path.join(dir, ci)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, "name: CI\n", "utf8")
  }

  if (spec.hasLockfile) {
    await fs.writeFile(path.join(dir, "package-lock.json"), '{"lockfileVersion": 3}\n', "utf8")
  }

  const manifests = reverseOrder ? [...spec.shallowManifests].reverse() : spec.shallowManifests
  for (const manifest of manifests) {
    const content =
      manifest === "package.json"
        ? JSON.stringify({ name: "fixture", scripts: { test: "bun test", build: "bun run build" } })
        : "# manifest\n"
    await fs.writeFile(path.join(dir, manifest), content, "utf8")
  }

  if (spec.deepManifest) {
    const deepPath = path.join(dir, "a/b/c/Cargo.toml")
    await fs.mkdir(path.dirname(deepPath), { recursive: true })
    await fs.writeFile(deepPath, "[package]\nname = 'deep'\n", "utf8")
  }
}

describe("Onboard property-based tests (Project 4)", () => {
  test("R1: onboarding analysis and template resolution never modify, create, or delete repo files", async () => {
    await fc.assert(
      fc.asyncProperty(repoSpecArb, async (spec) => {
        await withTempRepo(async (dir) => {
          await materializeRepo(dir, spec)
          const before = await snapshotFiles(dir)

          const stats = await Onboard.analyze(dir)
          const rendered = Onboard.render(stats)
          const prompt = await new Onboard.Template(dir)

          const after = await snapshotFiles(dir)
          expect(after).toEqual(before)
          expect(prompt).toContain(rendered)
        })
      }),
      { numRuns: 25 },
    )
  })

  test("R2: repeated onboarding analysis and rendering on an unchanged repo is deterministic and order-invariant", async () => {
    await fc.assert(
      fc.asyncProperty(repoSpecArb, async (spec) => {
        await withTempRepo(async (dirA) => {
          await withTempRepo(async (dirB) => {
            await materializeRepo(dirA, spec, false)
            await materializeRepo(dirB, spec, true)

            const statsA1 = await Onboard.analyze(dirA)
            const statsA2 = await Onboard.analyze(dirA)
            const statsB = await Onboard.analyze(dirB)

            expect(statsA2).toEqual(statsA1)
            expect(statsB).toEqual(statsA1)
            expect(Onboard.render(statsB)).toBe(Onboard.render(statsA1))
          })
        })
      }),
      { numRuns: 25 },
    )
  })

  test("R3: git history section accurately reflects repository commit metadata and filters hot files to included paths", async () => {
    const gitScenarioArb = fc.record({
      commitsOnMainFile: fc.integer({ min: 1, max: 4 }),
      touchOnceFile: fc.boolean(),
      isGitRepo: fc.boolean(),
    })

    await fc.assert(
      fc.asyncProperty(gitScenarioArb, async (scenario) => {
        await withTempRepo(async (dir) => {
          const mainFile = path.join(dir, "src/index.ts")
          await fs.mkdir(path.dirname(mainFile), { recursive: true })
          await fs.writeFile(mainFile, "export const v = 0;\n", "utf8")

          if (!scenario.isGitRepo) {
            const stats = await Onboard.analyze(dir)
            expect(stats.git).toBeUndefined()
            expect(Onboard.render(stats)).toContain("- not a git repository")
            return
          }

          const runGit = async (args: string[]) => {
            const proc = Bun.spawn(["git", ...args], {
              cwd: dir,
              stdout: "ignore",
              stderr: "ignore",
            })
            await proc.exited
          }

          await runGit(["init"])
          await runGit(["config", "user.email", "test@example.com"])
          await runGit(["config", "user.name", "Test User"])

          for (let i = 1; i <= scenario.commitsOnMainFile; i++) {
            await fs.writeFile(mainFile, `export const v = ${i};\n`, "utf8")
            await runGit(["add", "src/index.ts"])
            await runGit(["commit", "-m", `commit ${i}`])
          }

          if (scenario.touchOnceFile) {
            const onceFile = path.join(dir, "src/once.ts")
            await fs.writeFile(onceFile, "export const once = true;\n", "utf8")
            await runGit(["add", "src/once.ts"])
            await runGit(["commit", "-m", "touch once"])
          }

          const expectedCommits = scenario.commitsOnMainFile + (scenario.touchOnceFile ? 1 : 0)
          const stats = await Onboard.analyze(dir)
          const markdown = Onboard.render(stats)

          expect(stats.git).toBeDefined()
          expect(stats.git!.commits).toBe(expectedCommits)
          expect(stats.git!.contributors).toBe(1)
          expect(stats.git!.first).toMatch(/^\d{4}-\d{2}-\d{2}$/)
          expect(stats.git!.last).toMatch(/^\d{4}-\d{2}-\d{2}$/)
          expect(markdown).toContain(`- Commits on HEAD: ${expectedCommits}`)

          expect(stats.git!.hot.some((h) => h.path === "src/once.ts")).toBe(false)
          if (scenario.commitsOnMainFile > 1) {
            expect(stats.git!.hot).toContainEqual({
              path: "src/index.ts",
              changes: scenario.commitsOnMainFile,
            })
          } else {
            expect(stats.git!.hot).toEqual([])
          }
        })
      }),
      { numRuns: 12 },
    )
  })

  test("R4: onboarding output enforces size bounds on largest files, directories, manifest depth, and rendered lists", async () => {
    const boundStressArb = fc.record({
      sourceCount: fc.integer({ min: 1, max: 16 }),
      dirCount: fc.integer({ min: 1, max: 18 }),
      docCount: fc.integer({ min: 0, max: 35 }),
      hasDeepManifest: fc.boolean(),
    })

    await fc.assert(
      fc.asyncProperty(boundStressArb, async ({ sourceCount, dirCount, docCount, hasDeepManifest }) => {
        await withTempRepo(async (dir) => {
          for (let i = 0; i < sourceCount; i++) {
            const folder = `dir_${i % dirCount}`
            const filePath = path.join(dir, folder, `file_${i}.ts`)
            await fs.mkdir(path.dirname(filePath), { recursive: true })
            const lines = Array.from({ length: i + 1 }, () => "const a = 1;").join("\n")
            await fs.writeFile(filePath, lines, "utf8")
          }

          for (let d = 0; d < docCount; d++) {
            const docPath = path.join(dir, "docs", `guide_${String(d).padStart(2, "0")}.md`)
            await fs.mkdir(path.dirname(docPath), { recursive: true })
            await fs.writeFile(docPath, "# Guide\n", "utf8")
          }

          if (hasDeepManifest) {
            const deepManifest = path.join(dir, "packages/a/b/package.json")
            await fs.mkdir(path.dirname(deepManifest), { recursive: true })
            await fs.writeFile(deepManifest, "{}", "utf8")
          }

          const stats = await Onboard.analyze(dir)
          const markdown = Onboard.render(stats)

          expect(stats.largest.length).toBeLessThanOrEqual(10)
          expect(stats.directories.length).toBeLessThanOrEqual(15)
          for (let i = 1; i < stats.largest.length; i++) {
            expect(stats.largest[i - 1].lines).toBeGreaterThanOrEqual(stats.largest[i].lines)
          }
          expect(stats.manifests.every((m) => m.split("/").length <= 3)).toBe(true)

          if (docCount > 30) {
            expect(markdown).toContain(`- …and ${docCount - 30} more`)
          } else {
            expect(markdown).not.toContain("…and ")
          }
        })
      }),
      { numRuns: 20 },
    )
  })

  test("R5 (Oracle): analyzer counts match ground-truth repository model", async () => {
    await fc.assert(
      fc.asyncProperty(repoSpecArb, async (spec) => {
        await withTempRepo(async (dir) => {
          await materializeRepo(dir, spec)
          await fs.writeFile(path.join(dir, "oversized.ts"), "x".repeat(1_000_005), "utf8")
          await fs.writeFile(path.join(dir, "binary.ts"), Buffer.from([10, 0, 10, 65]))

          const stats = await Onboard.analyze(dir)

          const makefileCount = spec.shallowManifests.includes("Makefile") ? 1 : 0
          const expectedSourceFiles = spec.sources.length + makefileCount
          const expectedLines =
            spec.sources.reduce((sum: number, s: SourceSpec) => sum + s.fileData.expectedLines, 0) + makefileCount

          expect(stats.sourceFiles).toBe(expectedSourceFiles)
          expect(stats.lines).toBe(expectedLines)

          const expectedDirMap = new Map<string, { files: number; lines: number }>()
          for (const s of spec.sources) {
            const relPath = s.dir ? `${s.dir}/${s.base}${s.extInfo.ext}` : `${s.base}${s.extInfo.ext}`
            const parts = relPath.split("/")
            const dirKey =
              parts.length === 1
                ? "(root)"
                : ["packages", "apps", "services"].includes(parts[0]) && parts.length > 2
                  ? `${parts[0]}/${parts[1]}/`
                  : `${parts[0]}/`
            const cur = expectedDirMap.get(dirKey) ?? { files: 0, lines: 0 }
            expectedDirMap.set(dirKey, { files: cur.files + 1, lines: cur.lines + s.fileData.expectedLines })
          }
          if (makefileCount > 0) {
            const cur = expectedDirMap.get("(root)") ?? { files: 0, lines: 0 }
            expectedDirMap.set("(root)", { files: cur.files + 1, lines: cur.lines + 1 })
          }
          const expectedDirs = [...expectedDirMap.entries()]
            .map(([p, v]) => ({ path: p, files: v.files, lines: v.lines }))
            .toSorted(
              (a, b) =>
                b.lines - a.lines ||
                Number(a.path === "(root)") - Number(b.path === "(root)") ||
                (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
            )
            .slice(0, 15)

          expect(stats.directories).toEqual(expectedDirs)
          expect(stats.manifests).toEqual(
            [...spec.shallowManifests].toSorted((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)),
          )
        })
      }),
      { numRuns: 25 },
    )
  })
})