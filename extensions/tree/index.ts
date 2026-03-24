import type { ExtensionAPI, ToolDefinition } from "@mariozechner/pi-coding-agent"
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent"
import type { TruncationResult } from "@mariozechner/pi-coding-agent"
import { Text } from "@mariozechner/pi-tui"
import { Type } from "@sinclair/typebox"
import * as path from "node:path"
import { buildRgArgs, buildTree, renderTree, FILE_LIMIT } from "./tree.ts"

const treeSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
  ignore: Type.Optional(Type.Array(Type.String(), { description: "Extra glob patterns to ignore" })),
})

type TreeSchema = typeof treeSchema

interface TreeDetails {
  count: number
  truncatedFiles: boolean
  truncation?: TruncationResult
}

export default function(pi: ExtensionAPI) {
  const tool: ToolDefinition<TreeSchema, TreeDetails, Record<string, never>> = {
    name: "tree",
    label: "tree",
    description:
      `List files and directories as an indented tree. Uses ripgrep to respect .gitignore. ` +
      `Common directories (node_modules, .git, dist, build, etc.) are excluded by default. ` +
      `You can add extra ignore patterns via the \`ignore\` parameter. ` +
      `Output is truncated to ${FILE_LIMIT} files or ${DEFAULT_MAX_BYTES / 1024}KB.`,
    promptSnippet: "List files as an indented tree (ripgrep-powered, respects .gitignore)",

    parameters: treeSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const searchPath = path.resolve(ctx.cwd, params.path || ".")
      const rgArgs = buildRgArgs(params.ignore)

      const result = await pi.exec("rg", rgArgs, { cwd: searchPath, signal, timeout: 15000 })

      if (result.code !== 0 && !result.stdout.trim()) {
        if (result.code === 1) {
          return {
            content: [{ type: "text" as const, text: "(empty directory)" }],
            details: { count: 0, truncatedFiles: false },
          }
        }
        throw new Error(`rg failed (exit ${result.code}): ${result.stderr}`)
      }

      const files = result.stdout.trim().split("\n").filter(Boolean)
      const truncatedFiles = files.length > FILE_LIMIT
      const limitedFiles = files.slice(0, FILE_LIMIT)

      const tree = buildTree(limitedFiles)
      let output = `${searchPath}/\n` + renderTree(tree)

      const truncation = truncateHead(output, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      })

      output = truncation.content

      const notices: string[] = []
      if (truncatedFiles) {
        notices.push(`${FILE_LIMIT} file limit reached`)
      }
      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} output limit reached`)
      }
      if (notices.length > 0) {
        output += `\n\n[Truncated: ${notices.join(". ")}]`
      }

      return {
        content: [{ type: "text" as const, text: output }],
        details: {
          count: limitedFiles.length,
          truncatedFiles,
          truncation: truncation.truncated ? truncation : undefined,
        },
      }
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent instanceof Text ? context.lastComponent : null) ?? new Text("", 0, 0)
      const displayPath = args?.path ? args.path.replace(process.env.HOME || "", "~") : "."
      let content = `${theme.fg("toolTitle", theme.bold("tree"))} ${theme.fg("accent", displayPath)}`
      if (args?.ignore?.length) {
        content += theme.fg("muted", ` (ignoring ${args.ignore.length} extra patterns)`)
      }
      text.setText(content)
      return text
    },

    renderResult(result, { expanded }, theme, context) {
      const text = (context.lastComponent instanceof Text ? context.lastComponent : null) ?? new Text("", 0, 0)

      let output = ""
      for (const block of result.content) {
        if (block.type === "text") {
          output += block.text
        }
      }
      output = output.trim()

      if (!output) {
        text.setText(theme.fg("muted", "(empty)"))
        return text
      }

      const lines = output.split("\n")
      const maxLines = expanded ? lines.length : 30
      const displayLines = lines.slice(0, maxLines)
      const remaining = lines.length - maxLines

      let content = displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")
      if (remaining > 0) {
        content += `\n${theme.fg("muted", `... (${remaining} more lines)`)}`
      }

      if (result.details.count > 0) {
        content += `\n${theme.fg("dim", `${result.details.count} files`)}`
      }

      text.setText(content)
      return text
    },
  }

  pi.registerTool(tool)
}
