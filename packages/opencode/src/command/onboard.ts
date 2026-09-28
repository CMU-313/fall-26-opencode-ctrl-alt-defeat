export * as Onboard from "./onboard"

import fs from "fs/promises"
import path from "path"
import { Glob } from "@opencode-ai/core/util/glob"
import { Process } from "@/util/process"

// Deterministic repository facts for the /onboard command. The LLM is bad at counting, so everything
// countable is measured here and injected into the prompt as ground truth.

const MAX_FILES = 100_000
const MAX_FILE_BYTES = 1_000_000
const READ_BATCH = 64
const TOP = 10

const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".scala": "Scala",
  ".swift": "Swift",
  ".m": "Objective-C",
  ".mm": "Objective-C++",
  ".c": "C",
  ".h": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cxx": "C++",
  ".hpp": "C++",
  ".hh": "C++",
  ".cs": "C#",
  ".fs": "F#",
  ".rb": "Ruby",
  ".php": "PHP",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".erl": "Erlang",
  ".hs": "Haskell",
  ".ml": "OCaml",
  ".clj": "Clojure",
  ".dart": "Dart",
  ".lua": "Lua",
  ".r": "R",
  ".jl": "Julia",
  ".pl": "Perl",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".ps1": "PowerShell",
  ".sql": "SQL",
  ".html": "HTML",
  ".htm": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".sass": "SCSS",
  ".less": "Less",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".astro": "Astro",
  ".zig": "Zig",
  ".nix": "Nix",
  ".tf": "HCL",
  ".proto": "Protocol Buffers",
  ".graphql": "GraphQL",
  ".gql": "GraphQL",
  ".sol": "Solidity",
  ".elm": "Elm",
  ".gleam": "Gleam",
}

const FILENAME_LANGUAGES: Record<string, string> = {
  Dockerfile: "Dockerfile",
  Makefile: "Makefile",
}

// Lockfiles, build output, vendored and generated code would otherwise dominate the breakdown.
const EXCLUDED = [
  /(^|\/)(node_modules|bower_components|vendor|third_party|dist|build|out|target|coverage|__pycache__|\.venv|venv|\.next|\.nuxt|\.svelte-kit|Pods|generated|__generated__)\//,
  /(^|\/)(package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|composer\.lock|Gemfile\.lock|flake\.lock)$/,
  /\.min\.(js|css)$/,
  /\.(gen|generated|pb|g)\.[a-z]+$|_pb2\.py$/,
  /\.map$/,
]

const WALK_IGNORED = new Set([".git", "node_modules", "vendor", "dist", "build", "out", "target", ".venv", "venv"])

const TEST = /(^|\/)(test|tests|__tests__|spec|e2e)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/

// Monorepo container directories are summarised one level deeper so each package gets its own row.
const CONTAINERS = new Set(["packages", "apps", "libs", "services", "crates", "modules", "plugins", "tools"])

export async function analyze(dir: string) {
  const listing = await listFiles(dir)
  const attributes = await excludedByAttributes(dir)
  const included = listing.files.filter(
    (file) => !EXCLUDED.some((pattern) => pattern.test(file)) && !attributes.some((glob) => Glob.match(glob, file)),
  )
  const sources = await measureSources(dir, included)
  const lines = sources.reduce((sum, item) => sum + item.lines, 0)

  return {
    files: listing.files.length,
    truncated: listing.truncated,
    excluded: listing.files.length - included.length,
    sourceFiles: sources.length,
    lines,
    languages: languages(sources, lines),
    directories: directories(sources),
    largest: sources
      .toSorted((a, b) => b.lines - a.lines)
      .slice(0, TOP)
      .map((item) => ({ path: item.path, lines: item.lines })),
    tests: sources.filter((item) => TEST.test(item.path)).length,
  }
}

async function listFiles(dir: string) {
  const result = await Process.text(
    ["git", "-c", "core.quotepath=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: dir, nothrow: true },
  )
  const git = result.code === 0
  const files = git ? result.text.split("\0").filter(Boolean) : await walk(dir, "")
  return {
    git,
    truncated: files.length > MAX_FILES,
    files: [...new Set(files)].slice(0, MAX_FILES),
  }
}

async function walk(dir: string, relative: string): Promise<string[]> {
  const entries = await fs.readdir(path.join(dir, relative), { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) return WALK_IGNORED.has(entry.name) ? [] : walk(dir, file)
      return entry.isFile() ? [file] : []
    }),
  )
  return nested.flat()
}

// Honour GitHub linguist overrides so repos that mark their own generated code are measured the way they expect.
async function excludedByAttributes(dir: string) {
  const text = await Bun.file(path.join(dir, ".gitattributes"))
    .text()
    .catch(() => "")
  return text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (parts) =>
        parts.length > 1 &&
        !parts[0].startsWith("#") &&
        parts.slice(1).some((attr) => /^linguist-(generated|vendored|documentation)(=true)?$/.test(attr)),
    )
    .map((parts) => {
      const pattern = parts[0].replace(/^\//, "")
      const anchored = parts[0].includes("/") ? pattern : `**/${pattern}`
      return anchored.endsWith("/") ? `${anchored}**` : anchored
    })
}

async function measureSources(dir: string, files: string[]) {
  const candidates = files.flatMap((file) => {
    const language = LANGUAGES[path.posix.extname(file).toLowerCase()] ?? FILENAME_LANGUAGES[path.posix.basename(file)]
    return language ? [{ path: file, language }] : []
  })
  // Read in bounded batches so large repositories do not exhaust file descriptors.
  const batches = Array.from({ length: Math.ceil(candidates.length / READ_BATCH) }, (_, index) =>
    candidates.slice(index * READ_BATCH, (index + 1) * READ_BATCH),
  )
  const results: ({ path: string; language: string; lines: number } | undefined)[] = []
  for (const batch of batches) results.push(...(await Promise.all(batch.map((item) => measure(dir, item)))))
  return results.filter((item) => item !== undefined)
}

async function measure(dir: string, item: { path: string; language: string }) {
  const file = Bun.file(path.join(dir, item.path))
  // `git ls-files --cached` still lists files deleted from the working tree.
  if (!(await file.exists()) || file.size > MAX_FILE_BYTES) return
  const bytes = await file.bytes().catch(() => undefined)
  if (!bytes || bytes.subarray(0, 8000).includes(0)) return
  const newlines = bytes.reduce((count, byte) => (byte === 10 ? count + 1 : count), 0)
  const lines = bytes.length > 0 && bytes[bytes.length - 1] !== 10 ? newlines + 1 : newlines
  return { ...item, lines }
}

function languages(sources: { language: string; lines: number }[], total: number) {
  const grouped = Map.groupBy(sources, (item) => item.language)
  return [...grouped.entries()]
    .map(([name, items]) => {
      const lines = items.reduce((sum, item) => sum + item.lines, 0)
      return {
        name,
        files: items.length,
        lines,
        percent: total === 0 ? 0 : Math.round((lines / total) * 1000) / 10,
      }
    })
    .toSorted((a, b) => b.lines - a.lines)
}

function directories(sources: { path: string; lines: number }[]) {
  const grouped = Map.groupBy(sources, (item) => {
    const parts = item.path.split("/")
    if (parts.length === 1) return "(root)"
    if (CONTAINERS.has(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}/`
    return `${parts[0]}/`
  })
  return [...grouped.entries()]
    .map(([name, items]) => ({
      path: name,
      files: items.length,
      lines: items.reduce((sum, item) => sum + item.lines, 0),
    }))
    .toSorted((a, b) => b.lines - a.lines)
    .slice(0, 15)
}
