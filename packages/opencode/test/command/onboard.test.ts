import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Effect, Layer } from "effect"
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
  })
})

describe("Command onboarding", () => {
  it.live("registers the onboard slash command and placeholder flow", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const commands = yield* Command.Service
      const names = (yield* commands.list().pipe(provideInstanceEffect(dir))).map((item) => item.name)

      expect(names).toContain("onboard")

      const onboard = yield* commands.get("onboard").pipe(provideInstanceEffect(dir))

      expect(onboard).toMatchObject({
        name: "onboard",
        source: "command",
      })
      expect(onboard?.description).toContain("onboarding")
      expect(onboard?.template).toContain("placeholder")
    }),
  )
})
