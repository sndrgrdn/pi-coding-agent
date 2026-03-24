import { describe, test, expect } from "vitest"
import { buildGlobArgs, formatGlobOutput, FILE_LIMIT } from "./glob.ts"

describe("buildGlobArgs", () => {
  test("includes --files flag and search path", () => {
    const args = buildGlobArgs("**/*.ts", "/project")

    expect(args[0]).toBe("--files")
    expect(args[args.length - 1]).toBe("/project")
  })

  test("includes the glob pattern", () => {
    const args = buildGlobArgs("**/*.ts", "/project")

    expect(args).toContain("--glob=**/*.ts")
  })

  test("excludes .git by default", () => {
    const args = buildGlobArgs("**/*", "/project")

    expect(args).toContain("--glob=!.git/*")
  })

  test("includes --hidden for dotfiles", () => {
    const args = buildGlobArgs("**/*", "/project")

    expect(args).toContain("--hidden")
  })
})

describe("formatGlobOutput", () => {
  test("returns no-match message for empty files", () => {
    expect(formatGlobOutput([], "/project", false)).toBe("No files found")
  })

  test("formats paths relative to cwd", () => {
    const files = ["/project/src/index.ts", "/project/lib/utils.ts"]
    const output = formatGlobOutput(files, "/project", false)

    expect(output).toBe("src/index.ts\nlib/utils.ts")
  })

  test("appends limit notice when limit reached", () => {
    const files = ["/project/a.ts"]
    const output = formatGlobOutput(files, "/project", true)

    expect(output).toContain(`${FILE_LIMIT} results limit reached`)
  })

  test("limit notice appears after file list", () => {
    const files = ["/project/a.ts", "/project/b.ts"]
    const output = formatGlobOutput(files, "/project", true)
    const lines = output.split("\n")

    expect(lines[0]).toBe("a.ts")
    expect(lines[1]).toBe("b.ts")
    expect(lines[2]).toBe("")
    expect(lines[3]).toContain("limit reached")
  })
})
