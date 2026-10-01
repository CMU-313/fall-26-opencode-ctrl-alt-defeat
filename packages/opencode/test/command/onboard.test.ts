import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Command } from "@/command"
import { Onboard } from "@/command/onboard"
import { InstanceBootstrap } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { provideInstanceEffect, tmpdir, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const noopBootstrap = Layer.succeed(
  InstanceBootstrap.Service,
  InstanceBootstrap.Service.of({ run: Effect.void }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Command.node, InstanceStore.node, CrossSpawnSpawner.node]), [
    [InstanceStore.bootstrapNode, noopBootstrap],
  ]),
)

async function seed(dir: string) {
  const files: Record<string, string | Uint8Array> = {
    "README.md": "# Fixture\n",
    "package.json": JSON.stringify({ name: "fixture", scripts: { test: "bun test", build: "bun run build.ts" } }),
    "bun.lock": "lock\n".repeat(500),
    ".gitattributes": "src/generated.ts linguist-generated\n",
    ".github/workflows/ci.yml": "name: ci\n",
    "Makefile": ".PHONY: lint\nVERSION := 1\nlint:\n\techo lint\n",
    "src/index.ts": "export const a = 1\nexport const b = 2\nexport const c = 3\n",
    "src/util.ts": "export const d = 4",
    "src/generated.ts": "export const generated = true\n".repeat(100),
    "src/client.gen.ts": "export const client = true\n".repeat(100),
    "src/index.test.ts": "test('x', () => {})\n",
    "scripts/tool.py": "print('a')\nprint('b')\n",
    "dist/bundle.js": "console.log(1)\n".repeat(100),
    "src/blob.js": new Uint8Array([1, 0, 2, 10]),
    "packages/web/src/app.ts": "export const app = 1\n",
  }
  await Promise.all(Object.entries(files).map(([file, content]) => Bun.write(path.join(dir, file), content)))
  await $`git add -A && git commit -m seed`.cwd(dir).quiet()
  await Bun.write(path.join(dir, "src/util.ts"), "export const d = 5")
  await $`git commit -am update`.cwd(dir).quiet()
}

describe("Onboard.analyze", () => {
  test("measures languages, exclusions, tests, scripts, and history", async () => {
    await using dir = await tmpdir({ git: true, init: seed })
    const stats = await Onboard.analyze(dir.path)

    expect(stats.files).toBe(15)
    // bun.lock, dist/bundle.js, the .gen.ts file, and the linguist-generated file are excluded.
    expect(stats.excluded).toBe(4)
    // The binary src/blob.js is skipped when measuring.
    expect(stats.sourceFiles).toBe(6)
    expect(stats.lines).toBe(3 + 1 + 1 + 2 + 1 + 4)
    expect(stats.languages.map((item) => item.name)).toEqual(["TypeScript", "Makefile", "Python"])
    expect(stats.languages[0]).toMatchObject({ files: 4, lines: 6, percent: 50 })
    expect(stats.tests).toBe(1)
    expect(stats.directories.map((item) => item.path)).toContain("packages/web/")
    expect(stats.manifests).toEqual(["Makefile", "package.json"])
    expect(stats.scripts.map((item) => `${item.source}:${item.name}`)).toEqual([
      "package.json:test",
      "package.json:build",
      "Makefile:lint",
    ])
    expect(stats.ci).toEqual([".github/workflows/ci.yml"])
    expect(stats.docs).toEqual(["README.md"])
    expect(stats.git).toMatchObject({ commits: 3, contributors: 1 })
    expect(stats.git?.hot).toEqual([{ path: "src/util.ts", changes: 2 }])
  })

  test("falls back to walking the directory outside git", async () => {
    await using dir = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "main.go"), "package main\n")
        await Bun.write(path.join(dir, "node_modules/dep/index.js"), "module.exports = 1\n")
      },
    })
    const stats = await Onboard.analyze(dir.path)

    expect(stats.files).toBe(1)
    expect(stats.languages.map((item) => item.name)).toEqual(["Go"])
    expect(stats.git).toBeUndefined()
    expect(Onboard.render(stats)).toContain("not a git repository")
  })

  test("returns empty facts and renders them for an empty repository", async () => {
    await using dir = await tmpdir()
    const stats = await Onboard.analyze(dir.path)

    expect(stats).toEqual({
      files: 0,
      truncated: false,
      excluded: 0,
      sourceFiles: 0,
      lines: 0,
      languages: [],
      directories: [],
      largest: [],
      tests: 0,
      manifests: [],
      scripts: [],
      ci: [],
      docs: [],
      git: undefined,
    })
    expect(Onboard.render(stats)).toBe(
      [
        "### Size",
        "- Files in repository (git-tracked plus untracked, respecting .gitignore): 0",
        "- Excluded as lockfiles, build output, vendored or generated: 0",
        "- Source files in a recognised language: 0",
        "- Lines of source code: 0",
        "- Test files: 0 (0% of source files)",
        "",
        "### Language breakdown (share of source lines)",
        "_none_",
        "",
        "### Where the code lives (directories by source lines)",
        "_none_",
        "",
        "### Largest source files",
        "_none_",
        "",
        "### Manifests and toolchain files",
        "- none found",
        "",
        "### Declared scripts and task targets",
        "- none found",
        "",
        "### CI configuration",
        "- none found",
        "",
        "### Documentation files",
        "- none found",
        "",
        "### Git history",
        "- not a git repository",
      ].join("\n"),
    )
  })

  test("returns empty facts when the repository path does not exist", async () => {
    await using dir = await tmpdir()
    const stats = await Onboard.analyze(path.join(dir.path, "missing"))

    expect(stats).toMatchObject({
      files: 0,
      truncated: false,
      excluded: 0,
      sourceFiles: 0,
      lines: 0,
      languages: [],
      directories: [],
      largest: [],
      tests: 0,
      manifests: [],
      scripts: [],
      ci: [],
      docs: [],
      git: undefined,
    })
  })

  test("skips tracked files that have been deleted", async () => {
    await using dir = await tmpdir({
      git: true,
      init: async (directory) => {
        await Bun.write(path.join(directory, "src/missing.py"), "print('tracked')\n")
        await $`git add -A && git commit -m seed`.cwd(directory).quiet()
        await fs.unlink(path.join(directory, "src/missing.py"))
      },
    })
    const stats = await Onboard.analyze(dir.path)

    expect(stats.files).toBe(1)
    expect(stats.excluded).toBe(0)
    expect(stats.sourceFiles).toBe(0)
    expect(stats.languages).toEqual([])
  })

  test("recognizes Python manifests and test files", async () => {
    await using dir = await tmpdir({
      init: async (directory) => {
        await Bun.write(path.join(directory, "pyproject.toml"), "[project]\nname = 'fixture'\n")
        await Bun.write(path.join(directory, "app.py"), "def main():\n    return 1\n")
        await Bun.write(path.join(directory, "tests/test_app.py"), "def test_main(): pass\n")
      },
    })
    const stats = await Onboard.analyze(dir.path)

    expect(stats.languages).toEqual([{ name: "Python", files: 2, lines: 3, percent: 100 }])
    expect(stats.tests).toBe(1)
    expect(stats.manifests).toEqual(["pyproject.toml"])
  })

  test("includes hidden files but skips ignored directories in a large, deep tree", async () => {
    await using dir = await tmpdir({
      init: async (directory) => {
        const deep = path.join(directory, "src", ...Array.from({ length: 24 }, (_, index) => `level-${index}`))
        await Promise.all([
          Bun.write(path.join(directory, ".hidden.ts"), "export const hidden = true\n"),
          Bun.write(path.join(directory, ".config/settings.py"), "print('config')"),
          Bun.write(path.join(directory, "node_modules/dep/index.js"), "module.exports = 1\n"),
          Bun.write(path.join(directory, ".git/ignored.ts"), "export const ignored = true\n"),
          Bun.write(path.join(directory, "vendor/ignored.py"), "print('ignored')\n"),
          Bun.write(path.join(directory, "dist/ignored.ts"), "export const ignored = true\n"),
          ...Array.from({ length: 120 }, (_, index) =>
            Bun.write(path.join(deep, `file-${index}.ts`), "export const value = 1\n"),
          ),
        ])
      },
    })
    const first = await Onboard.analyze(dir.path)
    const second = await Onboard.analyze(dir.path)

    expect(first).toEqual(second)
    expect(first.files).toBe(122)
    expect(first.sourceFiles).toBe(122)
    expect(first.lines).toBe(122)
    expect(first.languages).toEqual([
      { name: "TypeScript", files: 121, lines: 121, percent: 99.2 },
      { name: "Python", files: 1, lines: 1, percent: 0.8 },
    ])
    expect(first.directories).toEqual([
      { path: "src/", files: 120, lines: 120 },
      { path: ".config/", files: 1, lines: 1 },
      { path: "(root)", files: 1, lines: 1 },
    ])
    expect(first.largest).toHaveLength(10)
  })

  test("returns sensible defaults for an unrecognized repository", async () => {
    await using dir = await tmpdir({
      init: async (directory) => {
        await Bun.write(path.join(directory, "notes.txt"), "plain text\n")
      },
    })
    const stats = await Onboard.analyze(dir.path)

    expect(stats.files).toBe(1)
    expect(stats.sourceFiles).toBe(0)
    expect(stats.languages).toEqual([])
    expect(stats.manifests).toEqual([])
    expect(stats.scripts).toEqual([])
  })

  test("renders populated facts in a stable Markdown format", async () => {
    await using dir = await tmpdir({
      init: async (directory) => {
        await Bun.write(path.join(directory, "README.md"), "# Fixture\n")
        await Bun.write(
          path.join(directory, "package.json"),
          JSON.stringify({ scripts: { test: "bun test" } }),
        )
        await Bun.write(path.join(directory, "index.ts"), "export const value = 1\n")
      },
    })
    const stats = await Onboard.analyze(dir.path)
    const output = Onboard.render(stats)

    expect(output).toBe(
      [
        "### Size",
        "- Files in repository (git-tracked plus untracked, respecting .gitignore): 3",
        "- Excluded as lockfiles, build output, vendored or generated: 0",
        "- Source files in a recognised language: 1",
        "- Lines of source code: 1",
        "- Test files: 0 (0% of source files)",
        "",
        "### Language breakdown (share of source lines)",
        "| Language | Files | Lines | Share |",
        "| --- | --- | --- | --- |",
        "| TypeScript | 1 | 1 | 100% |",
        "",
        "### Where the code lives (directories by source lines)",
        "| Directory | Files | Lines |",
        "| --- | --- | --- |",
        "| `(root)` | 1 | 1 |",
        "",
        "### Largest source files",
        "| File | Lines |",
        "| --- | --- |",
        "| `index.ts` | 1 |",
        "",
        "### Manifests and toolchain files",
        "- `package.json`",
        "",
        "### Declared scripts and task targets",
        "- `package.json` → `test`: `bun test`",
        "",
        "### CI configuration",
        "- none found",
        "",
        "### Documentation files",
        "- `README.md`",
        "",
        "### Git history",
        "- not a git repository",
      ].join("\n"),
    )
  })
})

describe("Command onboarding", () => {
  test("loads the onboarding prompt from its text resource", async () => {
    const resource = await Bun.file(new URL("../../src/command/template/onboard.txt", import.meta.url)).text()

    expect(Onboard.PROMPT).toBe(resource)
    expect(resource).toContain("${path}/ONBOARDING.md")
    expect(resource).toContain("${facts}")
  })

  it.live("registers the onboard subtask with measured facts in its prompt", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true, init: (dir) => Effect.promise(() => seed(dir)) })
      const commands = yield* Command.Service
      const onboard = yield* commands.get("onboard").pipe(provideInstanceEffect(dir))

      expect(onboard).toMatchObject({ name: "onboard", source: "command", subtask: true, hints: ["$ARGUMENTS"] })
      expect(onboard?.description).toContain("ONBOARDING.md")

      const template = yield* Effect.promise(async () => onboard?.template ?? "")
      expect(template).toContain(`${dir}/ONBOARDING.md`)
      expect(template).toContain("| TypeScript | 4 | 6 | 50% |")
      expect(template).not.toContain("${facts}")
    }),
  )

  it.live("keeps the command list JSON-encodable without scanning the repository", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const commands = yield* Command.Service
      const list = yield* commands.list().pipe(provideInstanceEffect(dir))

      // Mirrors the command.list HTTP response encoding, which rejects non-JSON template values.
      expect(() => Schema.encodeUnknownSync(Schema.toCodecJson(Schema.Array(Command.Info)))(list)).not.toThrow()
    }),
  )
})
