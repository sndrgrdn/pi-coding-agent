import path from "path"

export const MATCH_LIMIT = 100
export const MAX_LINE_LENGTH = 500

export interface Match {
  filePath: string
  lineNum: number
  lineText: string
}

/** Build ripgrep arguments for content search. */
export function buildGrepArgs(pattern: string, searchPath: string, include?: string): string[] {
  const args = [
    "-nH",
    "--hidden",
    "--no-messages",
    "--field-match-separator=|",
    "--regexp",
    pattern,
  ]
  if (include) {
    args.push("--glob", include)
  }
  args.push(searchPath)
  return args
}

/** Parse a single rg output line (file|line|text format) into a Match, or null if invalid. */
export function parseGrepLine(line: string): Match | null {
  if (!line) return null

  const sepIdx = line.indexOf("|")
  if (sepIdx === -1) return null
  const filePath = line.substring(0, sepIdx)

  const sepIdx2 = line.indexOf("|", sepIdx + 1)
  if (sepIdx2 === -1) return null
  const lineNumStr = line.substring(sepIdx + 1, sepIdx2)

  const lineNum = parseInt(lineNumStr, 10)
  if (isNaN(lineNum)) return null

  const lineText = line.substring(sepIdx2 + 1)
  return { filePath, lineNum, lineText }
}

/** Truncate a single line to MAX_LINE_LENGTH, appending ellipsis if needed. */
export function truncateLineText(text: string): string {
  if (text.length <= MAX_LINE_LENGTH) return text
  return text.substring(0, MAX_LINE_LENGTH) + "... [truncated]"
}

/** Format matches into grouped-by-file output with relative paths. */
export function formatGrepOutput(matches: Match[], cwd: string, limitReached: boolean): string {
  if (matches.length === 0) return "No files found"

  const outputLines: string[] = []
  let currentFile = ""

  for (const match of matches) {
    if (currentFile !== match.filePath) {
      if (currentFile !== "") outputLines.push("")
      currentFile = match.filePath
      outputLines.push(`${path.relative(cwd, match.filePath)}:`)
    }
    outputLines.push(`  ${match.lineNum}: ${truncateLineText(match.lineText)}`)
  }

  if (limitReached) {
    outputLines.push("")
    outputLines.push(`[${MATCH_LIMIT} matches limit reached. Refine pattern or path for more.]`)
  }

  return outputLines.join("\n")
}
