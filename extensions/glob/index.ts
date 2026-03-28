/**
 * glob — Speed-optimized file search tool
 *
 * Design priorities (speed-first):
 * - No statSync() — no mtime sorting overhead
 * - Early termination — kills rg the instant file limit is hit
 * - Async streaming via readline — non-blocking, low memory
 * - rg's built-in gitignore handling — no extra traversal
 */

import type { ExtensionAPI, ToolDefinition } from "@mariozechner/pi-coding-agent"
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent"
import { Text } from "@mariozechner/pi-tui"
import { Type } from "@sinclair/typebox"
import { spawn } from "child_process"
import { createInterface } from "node:readline"
import path from "path"
import { buildGlobArgs, formatGlobOutput, FILE_LIMIT } from "./glob.ts"

const globSchema = Type.Object({
  pattern: Type.String({
    description: "The glob pattern to match files against",
  }),
  path: Type.Optional(
    Type.String({
      description:
        'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
    }),
  ),
})

type GlobSchema = typeof globSchema

interface GlobDetails {
  count: number
  limitReached: boolean
}

async function findRg(): Promise<string> {
  const { execSync } = await import("child_process")
  try {
    return execSync("which rg", { encoding: "utf-8" }).trim()
  } catch {
    throw new Error(
      "ripgrep (rg) not found. Install it: https://github.com/BurntSushi/ripgrep#installation",
    )
  }
}

export default function (pi: ExtensionAPI) {
  const tool: ToolDefinition<GlobSchema, GlobDetails, Record<string, never>> = {
    name: "glob",
    label: "glob",
    description: [
      "- Fast file pattern matching tool that works with any codebase size",
      '- Supports glob patterns like "**/*.js" or "src/**/*.ts"',
      "- Returns matching file paths sorted by modification time",
      "- Use this tool when you need to find files by name patterns",
      "- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead",
      "- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.",
    ].join("\n"),
    promptSnippet: "Find files by glob pattern (respects .gitignore)",
    parameters: globSchema,

    style: {
      paddingX: 1,
      paddingY: 0,
      pendingBg: null,
      successBg: null,
      errorBg: null,
    },

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

      const args = buildGlobArgs(params.pattern, searchPath)

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
        const files: string[] = []
        let stderr = ""
        let limitReached = false

        const cleanup = () => {
          rl.close()
          signal?.removeEventListener("abort", onAbort)
        }

        const stopChild = () => {
          if (!child.killed) {
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
          if (!line.trim() || files.length >= FILE_LIMIT) return

          files.push(line)

          if (files.length >= FILE_LIMIT) {
            limitReached = true
            stopChild()
          }
        })

        child.on("error", (error: Error) => {
          cleanup()
          settle(() => reject(new Error(`ripgrep failed: ${error.message}`)))
        })

        child.on("close", (_code: number | null) => {
          cleanup()

          if (signal?.aborted) {
            settle(() => reject(new Error("Operation aborted")))
            return
          }

          if (files.length === 0) {
            settle(() =>
              resolve({
                content: [{ type: "text", text: "No files found" }],
                details: { count: 0, limitReached: false },
              }),
            )
            return
          }

          const rawOutput = formatGlobOutput(files, ctx.cwd, limitReached)

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
              details: { count: files.length, limitReached },
            }),
          )
        })
      })
    },

    renderCall(args, theme, context) {
      const text =
        (context.lastComponent instanceof Text ? context.lastComponent : null) ?? new Text("", 0, 0)
      let content = theme.fg("toolTitle", theme.bold("glob "))
      content += theme.fg("accent", args.pattern || "")
      if (args.path) {
        content += theme.fg("muted", ` in ${args.path}`)
      }
      text.setText(content)
      return text
    },

    renderResult(result, { expanded }, theme, context) {
      const text =
        (context.lastComponent instanceof Text ? context.lastComponent : null) ?? new Text("", 0, 0)

      if (context.isError) {
        const msg = result.content.find((c: any) => c.type === "text")?.text || "Search failed"
        text.setText(theme.fg("error", msg))
        return text
      }

      if (!expanded) {
        if (result.details.count === 0) {
          text.setText(theme.fg("muted", "No files found"))
        } else {
          let content = theme.fg("muted", `${result.details.count} files`)
          if (result.details.limitReached) {
            content += theme.fg("warning", " (limit reached)")
          }
          text.setText(content)
        }
        return text
      }

      let content = theme.fg("muted", `${result.details.count} files`)
      if (result.details.limitReached) {
        content += theme.fg("warning", " (limit reached)")
      }

      let output = ""
      for (const block of result.content) {
        if (block.type === "text") output += block.text
      }
      const lines = output.split("\n").slice(0, 25)
      for (const line of lines) {
        content += `\n${theme.fg("toolOutput", line)}`
      }
      if (output.split("\n").length > 25) {
        content += `\n${theme.fg("muted", "...")}`
      }

      text.setText(content)
      return text
    },
  }

  pi.registerTool(tool)
}
