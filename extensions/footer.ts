/**
 * Input Panel Extension
 *
 * Layout:
 *   [bg]  (blank line)
 *   [bg]  typing area
 *   [bg]  (blank line)
 *   [bg]  model · thinking          tokens pct (cost)
 *   ▀▀▀▀  half-block floor
 *   ~/path (branch)          ctrl+t think  ctrl+l model
 */

import type { AssistantMessage } from "@mariozechner/pi-ai"
import { getThinkingColor } from "../lib/theme-utils.js"
import { CustomEditor } from "@mariozechner/pi-coding-agent"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { getKeybindings, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui"
import type { Keybinding } from "@mariozechner/pi-tui"

// ── Helpers ─────────────────────────────────────────────────

type BgTheme = {
  bg: (color: any, text: string) => string
}

const ANSI_SGR_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[^m]*m`, "g")

function stripAnsi(s: string): string {
  return s.replace(ANSI_SGR_REGEX, "")
}

function extractBgCode(theme: BgTheme, color: any): string {
  const probe = "\x00"
  const wrapped = theme.bg(color, probe)
  const probeIndex = wrapped.indexOf(probe)
  return probeIndex === -1 ? "" : wrapped.substring(0, probeIndex)
}

function bgToFg(bgCode: string): string {
  return bgCode.replace("\x1b[48;", "\x1b[38;")
}

function applyBg(line: string, bgCode: string, width: number): string {
  const patched = line
    .replaceAll("\x1b[0m", "\x1b[0m" + bgCode)
    .replaceAll("\x1b[m", "\x1b[m" + bgCode)
    .replaceAll("\x1b[49m", "\x1b[49m" + bgCode)
  const w = visibleWidth(line)
  const pad = Math.max(0, width - w)
  return bgCode + patched + " ".repeat(pad)
}

function fitInfoLine(left: string, right: string, width: number): string {
  if (width <= 0) {
    return ""
  }

  const minGap = 1
  const leftWidth = visibleWidth(left)
  const rightWidth = visibleWidth(right)

  if (leftWidth + minGap + rightWidth <= width) {
    const gap = width - leftWidth - rightWidth
    return left + " ".repeat(gap) + right
  }

  if (rightWidth >= width) {
    return truncateToWidth(right, width)
  }

  const availableLeft = Math.max(0, width - minGap - rightWidth)
  const truncatedLeft = availableLeft > 0 ? truncateToWidth(left, availableLeft) : ""
  if (visibleWidth(truncatedLeft) === 0) {
    return truncateToWidth(right, width)
  }

  const gap = Math.max(minGap, width - visibleWidth(truncatedLeft) - rightWidth)
  return truncatedLeft + " ".repeat(gap) + right
}

function fmtTokens(n: number): string {
  return n.toLocaleString("en-US")
}

function shortCwd(): string {
  let pwd = process.cwd()
  const home = process.env.HOME || process.env.USERPROFILE
  if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`
  return pwd
}

// ── Editor ──────────────────────────────────────────────────

class MinimalEditor extends CustomEditor {
  private surfaceTheme: BgTheme
  public infoLine: (width: number) => string = () => ""

  constructor(tui: any, theme: any, kb: any, surfaceTheme: BgTheme) {
    super(tui, theme, kb, { paddingX: 1 })
    this.surfaceTheme = surfaceTheme
  }

  override render(width: number): string[] {
    const lines = super.render(width)
    const bg = extractBgCode(this.surfaceTheme, "selectedBg")
    const floorFg = bgToFg(bg)
    const result: string[] = []

    for (const line of lines) {
      const raw = stripAnsi(line).trim()
      if (/^─+$/.test(raw)) {
        result.push(bg + " ".repeat(width))
      } else {
        result.push(applyBg(line, bg, width))
      }
    }

    // Append: spacer (only when autocomplete visible) + model info line (inside box) + half-block floor
    const px = this.getPaddingX?.() ?? 2
    const innerWidth = Math.max(0, width - px * 2)
    if (this.isShowingAutocomplete()) {
      result.push(bg + " ".repeat(width))
    }

    const info = truncateToWidth(this.infoLine(innerWidth), innerWidth, "")
    result.push(applyBg(" ".repeat(px) + info, bg, width))
    result.push(floorFg + "▀".repeat(width))
    return result
  }
}

// ── Extension ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const uiTheme = ctx.ui.theme

    // ── Editor ────────────────────────────────────────────
    const infoLine = (innerWidth: number): string => {
      if (innerWidth <= 0) {
        return ""
      }

      let totalCost = 0
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type === "message" && entry.message.role === "assistant") {
          totalCost += (entry.message as AssistantMessage).usage.cost.total
        }
      }

      const usage = ctx.getContextUsage()
      const tokens = usage?.tokens ?? null
      const pctVal = usage?.percent ?? null
      const tokensStr = tokens === null ? "?" : fmtTokens(tokens)
      const pctStr = pctVal === null ? "?" : `${Math.round(pctVal)}%`
      const cost = `$${totalCost.toFixed(2)}`

      const modelId = ctx.model?.name ?? ctx.model?.id ?? "no model"
      const level = pi.getThinkingLevel()
      const hasThinking = ctx.model?.reasoning

      const levelColored = uiTheme.fg(getThinkingColor(level), level)

      const dot = uiTheme.fg("dim", " · ")
      const showThinking = hasThinking && level !== "off"
      const left = showThinking
        ? uiTheme.fg("text", modelId) + dot + levelColored
        : uiTheme.fg("text", modelId)

      let pctColored: string
      if (pctVal === null) pctColored = uiTheme.fg("dim", pctStr)
      else if (pctVal > 90) pctColored = uiTheme.fg("error", pctStr)
      else if (pctVal > 70) pctColored = uiTheme.fg("warning", pctStr)
      else pctColored = uiTheme.fg("dim", pctStr)

      const right =
        uiTheme.fg("dim", `${tokensStr} `) + pctColored + uiTheme.fg("dim", ` (${cost})`)

      return fitInfoLine(left, right, innerWidth)
    }

    ctx.ui.setEditorComponent((tui, editorTheme, kb) => {
      const e = new MinimalEditor(tui, editorTheme, kb, uiTheme)
      e.infoLine = infoLine
      return e
    })

    // ── Footer: path + hints ──────────────────────────────
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender())

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const branch = footerData.getGitBranch()
          const cwd = shortCwd()
          const pathStr = branch ? `${cwd} (${branch})` : cwd

          const kb = getKeybindings()
          const hintFor = (binding: Keybinding, label: string) => {
            const key = kb.getKeys(binding)[0]
            return key
              ? theme.fg("accent", key) + " " + theme.fg("muted", label)
              : theme.fg("muted", label)
          }
          const hints = [
            hintFor("app.thinking.cycle", "thinking"),
            hintFor("app.model.select", "models"),
          ].join("  ")
          const hintsW = visibleWidth(hints)

          const pathPart = theme.fg("muted", pathStr)
          const pW = visibleWidth(pathPart)
          const gap = width - pW - hintsW
          const row =
            gap >= 2
              ? pathPart + " ".repeat(gap) + hints
              : " ".repeat(Math.max(0, width - hintsW)) + hints

          return [truncateToWidth(row, width)]
        },
      }
    })
  })
}
