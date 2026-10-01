import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Command } from "@/command"
import { InstanceBootstrap } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { provideInstanceEffect, tmpdirScoped } from "../fixture/fixture"
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
