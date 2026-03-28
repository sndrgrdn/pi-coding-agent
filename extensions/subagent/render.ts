/**
 * Custom TUI rendering for subagent tool calls and results.
 */

import * as os from "node:os";
import { Text } from "@mariozechner/pi-tui";
import type { RunResult, UsageStats, DisplayItem } from "./runner.js";

const COLLAPSED_ITEM_COUNT = 5;

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsage(usage: UsageStats, model?: string, thinking?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
  if (thinking && thinking !== "off") parts.push(thinking);
  return parts.join(" ");
}

import { getThinkingColor } from "../../lib/theme-utils.js";
import { getModelName } from "../../lib/model-utils.js";

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  fg: (color: any, text: string) => string,
): string {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return fg("dim", toolName);

  const parts = entries.map(([k, v]) => {
    const val = typeof v === "string" ? shortenPath(v) : JSON.stringify(v);
    return entries.length === 1 ? val : `${k}=${val}`;
  });
  return fg("dim", `${toolName} ${parts.join(" ")}`);
}

function renderDisplayItems(
  items: DisplayItem[],
  fg: (color: any, text: string) => string,
  expanded: boolean,
  limit?: number,
): string {
  const toShow = limit ? items.slice(-limit) : items;
  const skipped = limit && items.length > limit ? items.length - limit : 0;
  let text = "";
  if (skipped > 0) text += fg("dim", `... ${skipped} earlier items\n`);
  for (const item of toShow) {
    if (item.type === "text") {
      const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
      text += `${fg("toolOutput", preview)}\n`;
    } else {
      text += `${fg("toolOutput", "→ ") + formatToolCall(item.name, item.args, fg)}\n`;
    }
  }
  return text.trimEnd();
}

export interface RenderResultOptions {
  expanded: boolean;
  isPartial: boolean;
}

export function renderResult(
  result: RunResult | undefined,
  displayItems: DisplayItem[],
  options: RenderResultOptions,
  theme: any,
): Text {
  if (!result) {
    return new Text(theme.fg("dim", "(no output)"), 0, 0);
  }

  const fg = theme.fg.bind(theme);
  const isError =
    result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
  const limit = options.expanded ? undefined : COLLAPSED_ITEM_COUNT;

  // Body
  let text = "\n";
  if (isError && result.errorMessage) {
    text += fg("error", `Error: ${result.errorMessage}`);
  } else if (displayItems.length === 0) {
    text += options.isPartial ? fg("dim", "(running...)") : fg("dim", "(no output)");
  } else {
    text += renderDisplayItems(displayItems, fg, options.expanded, limit);
  }

  // Footer
  if (result.startedAt) {
    const secs = (Date.now() - result.startedAt) / 1000;
    const elapsed =
      secs < 60 ? `${secs.toFixed(1)}s` : `${Math.floor(secs / 60)}m${Math.round(secs % 60)}s`;
    let info = "";
    if (result.model) {
      const name = getModelName(result.model);
      info += fg("text", name);
      if (result.thinking && result.thinking !== "off") {
        const color = getThinkingColor(result.thinking);
        info += ` ${fg(color, result.thinking)}`;
      }
      info += fg("dim", " · ");
    }
    info += fg("text", elapsed);
    let expand = "";
    if (!options.expanded && displayItems.length > COLLAPSED_ITEM_COUNT) {
      expand = " (ctrl+o to expand)";
    } else if (options.expanded) {
      expand = " (ctrl+o to collapse)";
    }
    text += `\n\n${info}${fg("dim", expand)}`;
  }
  return new Text(text, 0, 0);
}
