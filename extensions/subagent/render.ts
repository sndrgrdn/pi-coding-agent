/**
 * Custom TUI rendering for subagent tool calls and results.
 */

import * as os from "node:os";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
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

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** `verb <pattern> in <path>` — shared by grep / find / glob */
const PATTERN_IN_PATH: Record<string, { defaultPattern: string; slashWrap?: boolean }> = {
  grep: { defaultPattern: "", slashWrap: true },
  find: { defaultPattern: "*" },
  glob: { defaultPattern: "..." },
};

export function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  fg: (color: any, text: string) => string,
): string {
  const pinPath = PATTERN_IN_PATH[toolName];
  if (pinPath) {
    const pattern = (args.pattern as string) || pinPath.defaultPattern;
    const rawPath = (args.path || ".") as string;
    const accent = pinPath.slashWrap ? `/${pattern}/` : pattern;
    return (
      fg("muted", `${toolName} `) + fg("accent", accent) + fg("dim", ` in ${shortenPath(rawPath)}`)
    );
  }

  switch (toolName) {
    case "bash": {
      const command = (args.command as string) || "...";
      const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
      return fg("muted", "$ ") + fg("toolOutput", preview);
    }
    case "read": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const filePath = shortenPath(rawPath);
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      let text = fg("accent", filePath);
      if (offset !== undefined || limit !== undefined) {
        const start = offset ?? 1;
        const end = limit !== undefined ? start + limit - 1 : "";
        text += fg("warning", `:${start}${end ? `-${end}` : ""}`);
      }
      return fg("muted", "read ") + text;
    }
    case "ls": {
      const rawPath = (args.path || ".") as string;
      return fg("muted", "ls ") + fg("accent", shortenPath(rawPath));
    }
    default: {
      const str = JSON.stringify(args);
      const preview = str.length > 50 ? `${str.slice(0, 50)}...` : str;
      return fg("accent", toolName) + fg("dim", ` ${preview}`);
    }
  }
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
  if (skipped > 0) text += fg("muted", `... ${skipped} earlier items\n`);
  for (const item of toShow) {
    if (item.type === "text") {
      const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
      text += `${fg("toolOutput", preview)}\n`;
    } else {
      text += `${fg("muted", "→ ") + formatToolCall(item.name, item.args, fg)}\n`;
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
  finalOutput: string,
  options: RenderResultOptions,
  theme: any,
): Text | Container {
  if (!result) {
    return new Text(theme.fg("muted", "(no output)"), 0, 0);
  }

  const fg = theme.fg.bind(theme);
  const isError =
    result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
  const icon = options.isPartial
    ? theme.fg("warning", "⏳")
    : isError
      ? theme.fg("error", "✗")
      : theme.fg("success", "✓");

  if (options.expanded) {
    const container = new Container();
    let header = `${icon} ${fg("toolTitle", theme.bold(result.agent))}`;
    if (isError && result.stopReason) header += ` ${fg("error", `[${result.stopReason}]`)}`;
    container.addChild(new Text(header, 0, 0));

    if (isError && result.errorMessage) {
      container.addChild(new Text(fg("error", `Error: ${result.errorMessage}`), 0, 0));
    }

    container.addChild(new Spacer(1));
    container.addChild(new Text(fg("muted", "─── Task ───"), 0, 0));
    container.addChild(new Text(fg("dim", result.task), 0, 0));

    container.addChild(new Spacer(1));
    container.addChild(new Text(fg("muted", "─── Output ───"), 0, 0));

    if (displayItems.length === 0 && !finalOutput) {
      container.addChild(new Text(fg("muted", "(no output)"), 0, 0));
    } else {
      for (const item of displayItems) {
        if (item.type === "toolCall") {
          container.addChild(
            new Text(fg("muted", "→ ") + formatToolCall(item.name, item.args, fg), 0, 0),
          );
        }
      }
      if (finalOutput) {
        container.addChild(new Spacer(1));
        const mdTheme = getMarkdownTheme();
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
      }
    }

    const usageStr = formatUsage(result.usage, result.model, result.thinking);
    if (usageStr) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(fg("dim", usageStr), 0, 0));
    }
    return container;
  }

  // Collapsed view
  let text = `${icon} ${fg("toolTitle", theme.bold(result.agent))}`;
  if (isError && result.stopReason) text += ` ${fg("error", `[${result.stopReason}]`)}`;
  if (isError && result.errorMessage) {
    text += `\n${fg("error", `Error: ${result.errorMessage}`)}`;
  } else if (displayItems.length === 0) {
    text += options.isPartial
      ? `\n\n${fg("muted", "(running...)")}`
      : `\n\n${fg("muted", "(no output)")}`;
  } else {
    text += `\n\n${renderDisplayItems(displayItems, fg, false, COLLAPSED_ITEM_COUNT)}`;
    if (displayItems.length > COLLAPSED_ITEM_COUNT)
      text += `\n${fg("muted", "(Ctrl+O to expand)")}`;
  }

  if (result.startedAt) {
    const secs = (Date.now() - result.startedAt) / 1000;
    const elapsed =
      secs < 60 ? `${secs.toFixed(1)}s` : `${Math.floor(secs / 60)}m${Math.round(secs % 60)}s`;
    text += `\n\n${fg("dim", elapsed)}`;
  }
  return new Text(text, 0, 0);
}
