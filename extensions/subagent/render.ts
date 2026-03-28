/**
 * Custom TUI rendering for subagent tool calls and results.
 */

import * as os from "node:os";
import { Text } from "@mariozechner/pi-tui";
import type { RunResult, DisplayItem } from "./runner.js";

const COLLAPSED_ITEM_COUNT = 5;

function formatElapsedSeconds(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s`;
  return `${Math.floor(secs / 60)}m${Math.round(secs % 60)}s`;
}

import { getThinkingColor } from "../../lib/theme-utils.js";
import { getModelName } from "../../lib/model-utils.js";

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function formatToolCall(
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
    const elapsed = formatElapsedSeconds((Date.now() - result.startedAt) / 1000);
    const footerParts: string[] = [];
    if (result.model) {
      footerParts.push(fg("text", getModelName(result.model)));
      if (result.thinking && result.thinking !== "off") {
        footerParts.push(` ${fg(getThinkingColor(result.thinking), result.thinking)}`);
      }
      footerParts.push(fg("dim", " · "));
    }
    footerParts.push(fg("text", elapsed));
    const expandHint =
      !options.expanded && displayItems.length > COLLAPSED_ITEM_COUNT
        ? " (ctrl+o to expand)"
        : options.expanded
          ? " (ctrl+o to collapse)"
          : "";
    text += `\n\n${footerParts.join("")}${fg("dim", expandHint)}`;
  }
  return new Text(text, 0, 0);
}
