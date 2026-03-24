import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { type ServerConfig, loadConfig, findLanguagesForFile, findProjectRoot } from "./config";
import { LspClient } from "./client";
import type { Diagnostic } from "vscode-languageserver-protocol";

const SEVERITY: Record<number, string> = { 1: "Error", 2: "Warning", 3: "Info", 4: "Hint" };

function formatDiagnostics(diags: Diagnostic[], filePath: string, serverName?: string): string {
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
  const header = serverName
    ? `LSP diagnostics for ${basename(filePath)} [${serverName}]:`
    : `LSP diagnostics for ${basename(filePath)}:`;
  return `${header}\n${lines.join("\n")}`;
}

export default function (pi: ExtensionAPI) {
  let config: ReturnType<typeof loadConfig> = {};
  const clients = new Map<string, LspClient>();
  const debugLog: string[] = [];

  function log(msg: string) {
    debugLog.push(`[lsp] ${new Date().toISOString()} ${msg}`);
    // Keep last 200 lines
    if (debugLog.length > 200) debugLog.splice(0, debugLog.length - 200);
  }

  async function getClient(
    lang: string,
    lc: ServerConfig,
    filePath: string,
    fallbackCwd: string,
  ): Promise<LspClient | null> {
    const markers = lc.rootMarkers ?? [];
    const root = markers.length > 0 ? findProjectRoot(filePath, markers, fallbackCwd) : fallbackCwd;
    const key = `${lang}:${root}`;
    let client = clients.get(key);
    if (!client) {
      client = new LspClient({
        command: lc.command,
        rootPath: root,
        log,
      });
      clients.set(key, client);
    }
    const ok = await client.ensureStarted();
    return ok ? client : null;
  }

  // --- Session lifecycle ---

  pi.on("session_start", async (_event, _ctx) => {
    config = loadConfig();
    const langs = Object.keys(config);
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

    const matches = findLanguagesForFile(config, filePath);
    if (matches.length === 0) return;

    const notes: string[] = [];
    let formatted = false;

    for (const [lang, lc] of matches) {
      try {
        const client = await Promise.race([
          getClient(lang, lc, filePath, ctx.cwd),
          new Promise<null>((r) => setTimeout(() => r(null), 15000)),
        ]);
        if (!client) continue;

        // Format: first server with formatting capability wins
        if (client.canFormat && !formatted) {
          const changed = await client.format(filePath);
          if (changed) {
            formatted = true;
            notes.push(
              "Note: file was auto-formatted by LSP after this change. Re-read before further edits.",
            );
          }
        }

        // Diagnostics: all servers; short timeout for servers not yet known to produce diagnostics
        const diagTimeout = client.hasDiagnostics ? 2000 : 200;
        const diags = await client.getDiagnostics(filePath, diagTimeout);
        const text = formatDiagnostics(diags, filePath, matches.length > 1 ? lang : undefined);
        if (text) notes.push(text);
      } catch (err: any) {
        log(`tool_result hook error (${lang}): ${err?.message ?? err}`);
      }
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

      const matches = findLanguagesForFile(config, filePath);
      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `No LSP server configured for ${basename(filePath)}.` }],
          details: {},
        };
      }

      const multiServer = matches.length > 1;
      const sections: string[] = [];
      const errors: string[] = [];

      for (const [lang, lc] of matches) {
        try {
          const client = await getClient(lang, lc, filePath, ctx.cwd);
          if (!client) {
            errors.push(`LSP server for ${lang} failed to start.`);
            continue;
          }

          const diags = await client.getDiagnostics(filePath, 3000);
          if (diags.length === 0) continue;

          // Show all severities for explicit tool calls
          const lines = diags.map((d) => {
            const sev = SEVERITY[d.severity ?? 1];
            const ln = d.range.start.line + 1;
            const ch = d.range.start.character + 1;
            const src = d.source ? ` [${d.source}]` : "";
            return `  ${sev} (line ${ln}:${ch})${src}: ${d.message}`;
          });

          const header = multiServer
            ? `Diagnostics for ${params.path} [${lang}]:`
            : `Diagnostics for ${params.path}:`;
          sections.push(`${header}\n${lines.join("\n")}`);
        } catch (err: any) {
          errors.push(`Error getting diagnostics from ${lang}: ${err?.message ?? err}`);
        }
      }

      if (sections.length === 0 && errors.length === 0) {
        return { content: [{ type: "text", text: "No diagnostics found." }], details: {} };
      }

      const text = [...sections, ...errors].join("\n\n");
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // --- Debug command ---

  pi.registerCommand("lsp", {
    description: "Show LSP extension status and recent logs",
    handler: async (_args, ctx) => {
      const langs = Object.entries(config);
      const status = langs.map(([lang, lc]) => {
        const running = [...clients.entries()].find(([k]) => k.startsWith(`${lang}:`));
        const label = running ? `running (${running[0].split(":").slice(1).join(":")})` : "idle";
        return `  ${lang}: ${lc.command} [${label}]`;
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
