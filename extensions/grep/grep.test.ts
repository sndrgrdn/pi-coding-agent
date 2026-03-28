import { describe, test, expect } from "vitest"
import {
  buildGrepArgs,
  parseGrepLine,
  truncateLineText,
  formatGrepOutput,
  MATCH_LIMIT,
  MAX_LINE_LENGTH,
} from "./grep.ts"

describe("parseGrepLine", () => {
  test("parses a valid rg output line", () => {
    const match = parseGrepLine("/src/index.ts|42|const x = 1")

    expect(match).toEqual({
      filePath: "/src/index.ts",
      lineNum: 42,
      lineText: "const x = 1",
    })
  })

  test("returns null for empty line", () => {
    expect(parseGrepLine("")).toBeNull()
  })

  test("returns null when missing first separator", () => {
    expect(parseGrepLine("no separators here")).toBeNull()
  })

  test("returns null when missing second separator", () => {
    expect(parseGrepLine("/file|noline")).toBeNull()
  })

  test("returns null when line number is not a number", () => {
    expect(parseGrepLine("/file|abc|text")).toBeNull()
  })

  test("handles pipes in the match text", () => {
    const match = parseGrepLine("/file.ts|10|a | b | c")

    expect(match).toEqual({
      filePath: "/file.ts",
      lineNum: 10,
      lineText: "a | b | c",
    })
  })
})

describe("truncateLineText", () => {
  test("returns short lines unchanged", () => {
    expect(truncateLineText("short")).toBe("short")
  })

  test("returns lines at exactly the limit unchanged", () => {
    const line = "x".repeat(MAX_LINE_LENGTH)
    expect(truncateLineText(line)).toBe(line)
  })

  test("truncates lines exceeding the limit", () => {
    const line = "x".repeat(MAX_LINE_LENGTH + 50)
    const result = truncateLineText(line)

    expect(result).toHaveLength(MAX_LINE_LENGTH + "... [truncated]".length)
    expect(result.endsWith("... [truncated]")).toBe(true)
  })
})

describe("formatGrepOutput", () => {
  test("returns no-match message for empty matches", () => {
    expect(formatGrepOutput([], "/project", false)).toBe("No files found")
  })

  test("groups matches by file with relative paths", () => {
    const matches = [
      { filePath: "/project/src/a.ts", lineNum: 1, lineText: "hello" },
      { filePath: "/project/src/a.ts", lineNum: 5, lineText: "world" },
      { filePath: "/project/src/b.ts", lineNum: 3, lineText: "foo" },
    ]

    const output = formatGrepOutput(matches, "/project", false)
    const lines = output.split("\n")

    expect(lines).toEqual(["src/a.ts:", "  1: hello", "  5: world", "", "src/b.ts:", "  3: foo"])
  })

  test("appends limit notice when limit reached", () => {
    const matches = [{ filePath: "/project/f.ts", lineNum: 1, lineText: "x" }]
    const output = formatGrepOutput(matches, "/project", true)

    expect(output).toContain(`${MATCH_LIMIT} matches limit reached`)
  })
})

describe("buildGrepArgs", () => {
  test("includes pattern and search path", () => {
    const args = buildGrepArgs("TODO", "/project")

    expect(args).toContain("TODO")
    expect(args[args.length - 1]).toBe("/project")
  })

  test("includes --glob for include filter", () => {
    const args = buildGrepArgs("TODO", "/project", "*.ts")

    expect(args).toContain("--glob")
    expect(args).toContain("*.ts")
  })

  test("omits --glob when no include filter", () => {
    const args = buildGrepArgs("TODO", "/project")

    expect(args).not.toContain("--glob")
  })

  test("uses field-match-separator pipe", () => {
    const args = buildGrepArgs("pattern", "/p")

    expect(args).toContain("--field-match-separator=|")
  })
})
