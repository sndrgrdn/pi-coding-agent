import path from "path"

export const FILE_LIMIT = 100

/** Build ripgrep arguments for file pattern matching. */
export function buildGlobArgs(pattern: string, searchPath: string): string[] {
  return ["--files", "--hidden", "--glob=!.git/*", `--glob=${pattern}`, searchPath]
}

/** Format file paths as relative to cwd, with limit notice if needed. */
export function formatGlobOutput(files: string[], cwd: string, limitReached: boolean): string {
  if (files.length === 0) return "No files found"

  const outputLines = files.map((f) => path.relative(cwd, f))

  if (limitReached) {
    outputLines.push("")
    outputLines.push(`[${FILE_LIMIT} results limit reached. Use a more specific pattern or path.]`)
  }

  return outputLines.join("\n")
}
