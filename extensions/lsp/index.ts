import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { type LspConfig, type LanguageConfig, loadConfig, findLanguageForFile, findProjectRoot } from "./config";
import { LspClient } from "./client";
import type { Diagnostic } from "vscode-languageserver-protocol";

const SEVERITY: Record<number, string> = { 1: "Error", 2: "Warning", 3: "Info", 4: "Hint" };

function formatDiagnostics(diags: Diagnostic[], filePath: string): string {
  // Only errors & warnings
  const relevant = diags.filter((d) => d.severity != null && d.severity <= 2);
  if (relevant.length === 0) return "";
  const lines = relevant.map((d) => {
    const sev = SEVERITY[d.severity ?? 1];
    const ln = d.range.start.line + 1;
    const ch = d.range.start.character + 1;
    const src = d.source ? ` [${d.source}]` : "";
    return `  ${sev} (line ${ln}:${ch})${src}: ${d.message}`;
  });
  return `LSP diagnostics for ${basename(filePath)}:\n${lines.join("\n")}`;
}

export default function(pi: ExtensionAPI) {
  let config: LspConfig = {};
  const clients = new Map<string, LspClient>();
  const debugLog: string[] = [];

  function log(msg: string) {
    debugLog.push(`[lsp] ${new Date().toISOString()} ${msg}`);
    // Keep last 200 lines
    if (debugLog.length > 200) debugLog.splice(0, debugLog.length - 200);
  }

  async function getClient(lang: string, lc: LanguageConfig, filePath: string, fallbackCwd: string): Promise<LspClient | null> {
    const markers = lc.rootMarkers ?? [];
    const root = markers.length > 0
      ? findProjectRoot(filePath, markers, fallbackCwd)
      : fallbackCwd;
    const key = `${lang}:${root}`;
    let client = clients.get(key);
    if (!client) {
      client = new LspClient(lc.command, lc.args, root, log, lc.env ?? {}, lc.initOptions ?? {}, lc.languageIds ?? {});
      clients.set(key, client);
    }
    const ok = await client.ensureStarted();
    return ok ? client : null;
  }

  // --- Session lifecycle ---

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);
    const langs = Object.keys(config).filter((k) => config[k]?.enabled !== false);
    if (langs.length > 0) {
      log(`Loaded LSP config: ${langs.join(", ")}`);
    }
  });

  pi.on("session_shutdown", async () => {
    for (const client of clients.values()) {
      await client.shutdown();
    }
    clients.clear();
  });

  // --- Auto format + diagnostics after edit/write ---

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    if (event.isError) return;

    const rawPath = (event.input as any)?.path;
    if (!rawPath) return;

    const filePath = resolve(ctx.cwd, rawPath.replace(/^@/, ""));
    if (!existsSync(filePath)) return;

    const match = findLanguageForFile(config, filePath);
    if (!match) return;

    const [lang, lc] = match;
    const notes: string[] = [];

    try {
      const client = await Promise.race([
        getClient(lang, lc, filePath, ctx.cwd),
        new Promise<null>((r) => setTimeout(() => r(null), 15000)),
      ]);
      if (!client) return;

      // Format
      if (lc.format) {
        const changed = await client.format(filePath);
        if (changed) {
          notes.push("Note: file was auto-formatted by LSP after this change. Re-read before further edits.");
        }
      }

      // Diagnostics
      if (lc.diagnostics) {
        const diags = await client.getDiagnostics(filePath, 2000);
        const text = formatDiagnostics(diags, filePath);
        if (text) notes.push(text);
      }
    } catch (err: any) {
      log(`tool_result hook error: ${err?.message ?? err}`);
    }

    if (notes.length > 0) {
      return {
        content: [...event.content, { type: "text" as const, text: "\n" + notes.join("\n") }],
      };
    }
  });

  // --- Diagnostics tool ---

  pi.registerTool({
    name: "diagnostics",
    label: "LSP Diagnostics",
    description:
      "Get language server diagnostics (errors, warnings) for a file. Uses the project's configured LSP servers.",
    promptSnippet: "Get LSP diagnostics (type errors, warnings) for any file",
    promptGuidelines: [
      "Use the diagnostics tool to check for errors after making multiple changes.",
      "Diagnostics are also auto-injected after edit/write, so you don't always need to call this explicitly.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "File path to check (relative to cwd)" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const filePath = resolve(ctx.cwd, params.path.replace(/^@/, ""));

      if (!existsSync(filePath)) {
        return { content: [{ type: "text", text: `File not found: ${params.path}` }], details: {} };
      }

      const match = findLanguageForFile(config, filePath);
      if (!match) {
        return { content: [{ type: "text", text: `No LSP server configured for ${basename(filePath)}.` }], details: {} };
      }

      const [lang, lc] = match;
      if (!lc.diagnostics) {
        return { content: [{ type: "text", text: `Diagnostics disabled for ${lang} in config.` }], details: {} };
      }

      try {
        const client = await getClient(lang, lc, filePath, ctx.cwd);
        if (!client) {
          return { content: [{ type: "text", text: `LSP server for ${lang} failed to start.` }], details: {} };
        }

        const diags = await client.getDiagnostics(filePath, 3000);
        if (diags.length === 0) {
          return { content: [{ type: "text", text: "No diagnostics found." }], details: {} };
        }

        // Show all severities for explicit tool calls
        const lines = diags.map((d) => {
          const sev = SEVERITY[d.severity ?? 1];
          const ln = d.range.start.line + 1;
          const ch = d.range.start.character + 1;
          const src = d.source ? ` [${d.source}]` : "";
          return `  ${sev} (line ${ln}:${ch})${src}: ${d.message}`;
        });

        return { content: [{ type: "text", text: `Diagnostics for ${params.path}:\n${lines.join("\n")}` }], details: {} };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error getting diagnostics: ${err?.message ?? err}` }], details: {} };
      }
    },
  });

  // --- Debug command ---

  pi.registerCommand("lsp", {
    description: "Show LSP extension status and recent logs",
    handler: async (_args, ctx) => {
      const langs = Object.entries(config).filter(([, lc]) => lc.enabled !== false);
      const status = langs.map(([lang, lc]) => {
        const running = [...clients.entries()].find(([k]) => k.startsWith(`${lang}:`));
        const label = running ? `running (${running[0].split(":").slice(1).join(":")})` : "idle";
        return `  ${lang}: ${lc.command} ${lc.args.join(" ")} [${label}]`;
      });

      const msg = [
        `LSP servers (${langs.length} configured):`,
        ...status,
        "",
        `Recent logs (last 10):`,
        ...debugLog.slice(-10),
      ].join("\n");

      ctx.ui.notify(msg, "info");
    },
  });
}
