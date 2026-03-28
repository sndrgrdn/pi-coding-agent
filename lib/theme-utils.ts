import fs from "node:fs"
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent"

/** Default background for editor panel and question UI when theme doesn't define editorPanelBg. */
export const DEFAULT_PANEL_BG = "#3a3a4a"

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

// ── Theme vars ──────────────────────────────────────────────

/** Cached theme vars, invalidated by file path or mtime change. */
let varsCache: { path: string; mtimeMs: number; vars: Record<string, unknown> } | undefined

function readThemeVars(path: string): Record<string, unknown> {
  try {
    const mtimeMs = fs.statSync(path).mtimeMs
    if (varsCache?.path === path && varsCache.mtimeMs === mtimeMs) return varsCache.vars
    const json = JSON.parse(fs.readFileSync(path, "utf-8"))
    const vars = (json?.vars as Record<string, unknown>) ?? {}
    varsCache = { path, mtimeMs, vars }
    return vars
  } catch {
    return {}
  }
}

/** Read a custom var from the active theme's JSON file. Returns the hex string or the fallback. */
export function getThemeVar(theme: Theme, key: string, fallback: string): string {
  const path = theme.sourcePath
  if (!path) return fallback
  const vars = readThemeVars(path)
  const value = vars[key]
  return typeof value === "string" && value.startsWith("#") ? value : fallback
}

// ── Hex → ANSI ──────────────────────────────────────────────

/** Convert "#rrggbb" to an ANSI 24-bit background escape code. */
export function hexToBg(hex: string): string {
  const h = hex.replace("#", "")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `\x1b[48;2;${r};${g};${b}m`
}

/** Convert "#rrggbb" to an ANSI 24-bit foreground escape code. */
export function hexToFg(hex: string): string {
  const h = hex.replace("#", "")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `\x1b[38;2;${r};${g};${b}m`
}
