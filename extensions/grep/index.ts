/**
 * grep — Speed-optimized grep tool (overrides built-in)
 *
 * Design priorities (speed-first):
 * - rg text mode (`-nH`), not `--json` — no JSON.parse() per line
 * - No file re-reads — match text comes directly from rg output
 * - No statSync() — no mtime sorting overhead
 * - Early termination — kills rg the instant match limit is hit
 * - Streaming via readline — low memory, processes during execution
 * - Grouped-by-file output — avoids repeating long paths (token-efficient)
 */

import type { ExtensionAPI, ToolDefinition } from "@mariozechner/pi-coding-agent"
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent"
import { Text } from "@mariozechner/pi-tui"
import { Type } from "@sinclair/typebox"
import { spawn } from "child_process"
import { createInterface } from "node:readline"
import path from "path"
import {
  buildGrepArgs,
  parseGrepLine,
  formatGrepOutput,
  MATCH_LIMIT,
  type Match,
} from "./grep.ts"

const grepSchema = Type.Object({
  pattern: Type.String({
    description: "Regex pattern to search for in file contents",
  }),
  path: Type.Optional(
    Type.String({
      description: "Directory to search in. Defaults to the current working directory.",
    }),
  ),
  include: Type.Optional(
    Type.String({
      description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
    }),
  ),
})

type GrepSchema = typeof grepSchema

interface GrepDetails {
  matches: number
  limitReached: boolean
}

async function findRg(): Promise<string> {
  const { execSync } = await import("child_process")
  try {
    return execSync("which rg", { encoding: "utf-8" }).trim()
  } catch {
    throw new Error("ripgrep (rg) not found. Install it: https://github.com/BurntSushi/ripgrep#installation")
  }
}

export default function(pi: ExtensionAPI) {
  const tool: ToolDefinition<GrepSchema, GrepDetails, Record<string, never>> = {
    name: "grep",
    label: "grep",
    description: [
      "Fast content search tool that works with any codebase size.",
      "Searches file contents using regular expressions.",
      'Supports full regex syntax (e.g. "log.*Error", "function\\s+\\w+").',
      'Filter files by pattern with the include parameter (e.g. "*.js", "*.{ts,tsx}").',
      "Returns matches grouped by file with line numbers.",
      `Output is capped at ${MATCH_LIMIT} matches.`,
      "When doing open-ended search requiring multiple rounds, use the task tool instead.",
    ].join("\n"),
    promptSnippet: "Search file contents for patterns, grouped by file (respects .gitignore)",
    parameters: grepSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!params.pattern) {
        throw new Error("pattern is required")
      }

      const rgPath = await findRg()
      const searchPath = params.path
        ? path.isAbsolute(params.path)
          ? params.path
          : path.resolve(ctx.cwd, params.path)
        : ctx.cwd

      const args = buildGrepArgs(params.pattern, searchPath, params.include)

      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"))
          return
        }

        let settled = false
        const settle = (fn: () => void) => {
          if (!settled) {
            settled = true
            fn()
          }
        }

        const child = spawn(rgPath, args, {
          stdio: ["ignore", "pipe", "pipe"],
        })

        const rl = createInterface({ input: child.stdout! })
        const matches: Match[] = []
        let stderr = ""
        let limitReached = false
        let killedDueToLimit = false

        const cleanup = () => {
          rl.close()
          signal?.removeEventListener("abort", onAbort)
        }

        const stopChild = (dueToLimit = false) => {
          if (!child.killed) {
            killedDueToLimit = dueToLimit
            child.kill()
          }
        }

        const onAbort = () => {
          stopChild()
        }
        signal?.addEventListener("abort", onAbort, { once: true })

        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString()
        })

        rl.on("line", (line: string) => {
          if (matches.length >= MATCH_LIMIT) return

          const match = parseGrepLine(line)
          if (!match) return

          matches.push(match)

          if (matches.length >= MATCH_LIMIT) {
            limitReached = true
            stopChild(true)
          }
        })

        child.on("error", (error: Error) => {
          cleanup()
          settle(() => reject(new Error(`ripgrep failed: ${error.message}`)))
        })

        child.on("close", (code: number | null) => {
          cleanup()

          if (signal?.aborted) {
            settle(() => reject(new Error("Operation aborted")))
            return
          }

          // Exit codes: 0=matches, 1=no matches, 2=errors with partial results
          if (!killedDueToLimit && code !== 0 && code !== 1 && code !== 2) {
            settle(() => reject(new Error(`ripgrep failed: ${stderr}`)))
            return
          }

          if (matches.length === 0) {
            settle(() =>
              resolve({
                content: [{ type: "text", text: "No files found" }],
                details: { matches: 0, limitReached: false },
              }),
            )
            return
          }

          const rawOutput = formatGrepOutput(matches, ctx.cwd, limitReached)

          const truncation = truncateHead(rawOutput, {
            maxLines: Number.MAX_SAFE_INTEGER,
            maxBytes: DEFAULT_MAX_BYTES,
          })

          let output = truncation.content
          if (truncation.truncated) {
            output += `\n\n[Output truncated to ${formatSize(DEFAULT_MAX_BYTES)}]`
          }

          settle(() =>
            resolve({
              content: [{ type: "text", text: output }],
              details: { matches: matches.length, limitReached },
            }),
          )
        })
      })
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent instanceof Text ? context.lastComponent : null) ?? new Text("", 0, 0)
      let content = theme.fg("toolTitle", theme.bold("grep "))
      content += theme.fg("accent", `/${args.pattern || ""}/`)
      if (args.path) {
        content += theme.fg("muted", ` in ${args.path}`)
      }
      if (args.include) {
        content += theme.fg("dim", ` (${args.include})`)
      }
      text.setText(content)
      return text
    },

    renderResult(result, { expanded }, theme, context) {
      const text = (context.lastComponent instanceof Text ? context.lastComponent : null) ?? new Text("", 0, 0)

      if (result.details.matches === 0) {
        text.setText(theme.fg("dim", "No matches found"))
        return text
      }

      let content = theme.fg("success", `${result.details.matches} matches`)
      if (result.details.limitReached) {
        content += theme.fg("warning", " (limit reached)")
      }

      if (expanded) {
        let output = ""
        for (const block of result.content) {
          if (block.type === "text") output += block.text
        }
        const lines = output.split("\n").slice(0, 30)
        for (const line of lines) {
          content += `\n${theme.fg("toolOutput", line)}`
        }
        if (output.split("\n").length > 30) {
          content += `\n${theme.fg("muted", "...")}`
        }
      }

      text.setText(content)
      return text
    },
  }

  pi.registerTool(tool)
}
