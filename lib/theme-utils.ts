import type { ThemeColor } from "@mariozechner/pi-coding-agent"

/** Map thinking level names to their theme color keys. */
const thinkingColorMap: Record<string, ThemeColor> = {
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
}

/** Get the theme color key for a thinking level, falling back to "dim". */
export function getThinkingColor(level: string): ThemeColor {
  return thinkingColorMap[level] ?? "dim"
}
