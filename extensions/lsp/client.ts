import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import type { Diagnostic, TextEdit } from "vscode-languageserver-protocol";
import { extname } from "node:path";

function fileUri(absPath: string): string {
  return `file://${absPath}`;
}

/** Apply LSP TextEdits to source text (reverse order to preserve positions). */
function applyEdits(source: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => {
    const ld = b.range.start.line - a.range.start.line;
    return ld !== 0 ? ld : b.range.start.character - a.range.start.character;
  });
  const lines = source.split("\n");
  for (const { range, newText } of sorted) {
    const before = (lines[range.start.line] ?? "").slice(0, range.start.character);
    const after = (lines[range.end.line] ?? "").slice(range.end.character);
    const replacement = (before + newText + after).split("\n");
    lines.splice(range.start.line, range.end.line - range.start.line + 1, ...replacement);
  }
  return lines.join("\n");
}

export class LspClient {
  private proc: ChildProcess | null = null;
  private conn: MessageConnection | null = null;
  private ready = false;
  private dead = false;
  private starting: Promise<boolean> | null = null;
  private versions = new Map<string, number>();
  private diagStore = new Map<string, Diagnostic[]>();
  private diagListeners: Array<(uri: string, diags: Diagnostic[]) => void> = [];

  constructor(
    private command: string,
    private args: string[],
    private rootPath: string,
    private log: (msg: string) => void,
    private extraEnv: Record<string, string> = {},
    private initOptions: Record<string, unknown> = {},
    private languageIds: Record<string, string> = {},
  ) { }

  /** Derive the LSP languageId from a file path using configured languageIds, falling back to extension without dot. */
  private resolveLanguageId(filePath: string): string {
    const ext = extname(filePath);
    return this.languageIds[ext] || ext.slice(1);
  }

  /** Ensure the server is running and initialized. Deduplicates concurrent calls. */
  async ensureStarted(): Promise<boolean> {
    if (this.ready) return true;
    if (this.dead) return false;
    if (this.starting) return this.starting;

    this.starting = this.start()
      .then(() => { this.starting = null; return true; })
      .catch((err: any) => {
        this.log(`LSP start failed (${this.command}): ${err?.message ?? err}`);
        this.dead = true;
        this.starting = null;
        return false;
      });

    return this.starting;
  }

  private async start(): Promise<void> {
    // Resolve the command to an absolute path first so spawn doesn't
    // rely on the (possibly stripped) PATH inside pi's process.
    const resolvedCommand = resolveCommand(this.command, this.rootPath);

    this.proc = spawn(resolvedCommand, this.args, {
      cwd: this.rootPath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.extraEnv },
    });

    // Catch spawn errors (e.g. ENOENT) so they don't crash the host process
    const spawnReady = new Promise<void>((resolve, reject) => {
      this.proc!.on("error", (err) => reject(err));
      this.proc!.on("spawn", () => resolve());
    });
    await spawnReady;

    this.proc.stderr?.on("data", (d) => this.log(`[${this.command} stderr] ${d}`));
    // Prevent ERR_STREAM_DESTROYED from crashing the host when the process dies.
    // vscode-jsonrpc's sendNotification doesn't await the write promise, so a
    // rejected write becomes an unhandled rejection.  We neutralise stdin so the
    // write callback never receives an error once the process is gone.
    this.proc.stdin?.on("error", () => { });
    const stdinRef = this.proc.stdin;
    this.proc.on("exit", (code) => {
      this.log(`LSP ${this.command} exited (code ${code})`);
      this.ready = false;
      // Replace stdin.write with a silent no-op so any in-flight or future
      // vscode-jsonrpc writes resolve without error instead of rejecting.
      if (stdinRef) {
        (stdinRef as any).write = (_data: any, cbOrEnc?: any, cb?: any) => {
          const callback = typeof cbOrEnc === "function" ? cbOrEnc : cb;
          if (callback) callback();
          return false;
        };
      }
      const c = this.conn;
      this.conn = null;
      this.proc = null;
      try { c?.dispose(); } catch { }
    });

    const reader = new StreamMessageReader(this.proc.stdout!);
    const writer = new StreamMessageWriter(this.proc.stdin!);
    this.conn = createMessageConnection(reader, writer);

    // Handle push diagnostics — use raw string to avoid version mismatch
    this.conn.onNotification("textDocument/publishDiagnostics", (params: any) => {
      this.diagStore.set(params.uri, params.diagnostics ?? []);
      for (const fn of this.diagListeners) fn(params.uri, params.diagnostics ?? []);
    });

    // Handle standard server→client requests that many LSP servers send
    this.conn.onRequest("client/registerCapability", () => null);
    this.conn.onRequest("client/unregisterCapability", () => null);
    this.conn.onRequest("workspace/configuration", () => [{}]);
    this.conn.onNotification("window/logMessage", () => { });
    this.conn.onNotification("window/showMessage", () => { });

    this.conn.onError((err) => this.log(`Connection error (${this.command}): ${err[0]?.message ?? err}`));
    this.conn.onClose(() => { this.ready = false; });
    this.conn.listen();

    // Use raw string method names to avoid vscode-jsonrpc parameterStructures mismatch
    await this.conn.sendRequest("initialize", {
      processId: process.pid,
      capabilities: {
        textDocument: {
          formatting: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
          synchronization: { dynamicRegistration: false, didSave: true },
        },
      },
      rootUri: fileUri(this.rootPath),
      workspaceFolders: [{ uri: fileUri(this.rootPath), name: "workspace" }],
      ...(Object.keys(this.initOptions).length > 0 ? { initializationOptions: this.initOptions } : {}),
    });

    this.conn.sendNotification("initialized", {});
    this.ready = true;
    this.log(`LSP ${this.command} initialized for ${this.rootPath}`);
  }

  /** Sync file content with the server (didOpen or didChange). Returns true if content was updated (didChange). */
  private syncDocument(filePath: string): boolean {
    if (!this.conn) return false;
    const uri = fileUri(filePath);
    const text = readFileSync(filePath, "utf8");

    if (!this.versions.has(uri)) {
      this.versions.set(uri, 1);
      this.conn.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId: this.resolveLanguageId(filePath), version: 1, text },
      });
      return false; // first open, no prior diagnostics to invalidate
    } else {
      const v = this.versions.get(uri)! + 1;
      this.versions.set(uri, v);
      this.conn.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: v },
        contentChanges: [{ text }],
      });
      return true;
    }
  }

  /** Request formatting, apply edits, return whether file changed. */
  async format(filePath: string): Promise<boolean> {
    if (!this.conn || !this.ready) return false;
    this.syncDocument(filePath);
    const uri = fileUri(filePath);

    try {
      const edits = (await Promise.race([
        this.conn.sendRequest("textDocument/formatting", {
          textDocument: { uri },
          options: { tabSize: 2, insertSpaces: true },
        }),
        rejectAfter(5000),
      ])) as TextEdit[] | null;

      if (edits && edits.length > 0) {
        const original = readFileSync(filePath, "utf8");
        const formatted = applyEdits(original, edits);
        if (formatted !== original) {
          writeFileSync(filePath, formatted, "utf8");
          this.diagStore.delete(uri);
          this.syncDocument(filePath);
          return true;
        }
      }
    } catch (err: any) {
      this.log(`Format error (${filePath}): ${err?.message ?? err}`);
    }
    return false;
  }

  /** Get diagnostics for a file, waiting up to `ms` for push notifications. */
  async getDiagnostics(filePath: string, ms = 2000): Promise<Diagnostic[]> {
    if (!this.conn || !this.ready) return [];
    const changed = this.syncDocument(filePath);
    const uri = fileUri(filePath);

    // If the document changed, discard stale diagnostics and wait for fresh ones
    if (changed) {
      this.diagStore.delete(uri);
    }

    const existing = this.diagStore.get(uri);
    if (existing && existing.length > 0) return existing;

    return new Promise<Diagnostic[]>((resolve) => {
      const timer = setTimeout(() => {
        remove();
        resolve(this.diagStore.get(uri) ?? []);
      }, ms);

      const listener = (receivedUri: string, diags: Diagnostic[]) => {
        if (receivedUri === uri) {
          clearTimeout(timer);
          remove();
          resolve(diags);
        }
      };

      const remove = () => {
        const i = this.diagListeners.indexOf(listener);
        if (i >= 0) this.diagListeners.splice(i, 1);
      };

      this.diagListeners.push(listener);
    });
  }

  async shutdown(): Promise<void> {
    const conn = this.conn;
    const proc = this.proc;
    this.ready = false;
    this.conn = null;
    this.proc = null;

    if (conn) {
      // Guard: only attempt graceful shutdown if the process is still alive
      const alive = proc && !proc.killed && proc.exitCode === null;
      if (alive) {
        try {
          await Promise.race([conn.sendRequest("shutdown"), rejectAfter(2000)]);
          conn.sendNotification("exit");
        } catch { }
      }
      try { conn.dispose(); } catch { }
    }
    if (proc && !proc.killed) {
      try { proc.kill(); } catch { }
    }
  }
}

function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms));
}

/**
 * Resolve a command name to an absolute path.
 *
 * Resolution order (mirrors nvim-lspconfig's approach for oxlint/biome):
 *  1. Already absolute → use as-is
 *  2. {projectRoot}/node_modules/.bin/{cmd} → local project binary
 *  3. Login shell `command -v` → global install (mise/nvm/rbenv shims)
 *  4. Bare command name fallback
 */
function resolveCommand(cmd: string, projectRoot?: string): string {
  if (cmd.startsWith("/")) return cmd; // already absolute

  // Walk up from projectRoot checking node_modules/.bin at each level.
  // Handles monorepos / nested package.json where the binary is hoisted.
  if (projectRoot) {
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    const { join, dirname } = require("node:path") as typeof import("node:path");
    let dir = projectRoot;
    while (true) {
      const local = join(dir, "node_modules", ".bin", cmd);
      if (existsSync(local)) return local;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // Fall back to login shell resolution
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const shell = process.env.SHELL || "/bin/sh";
    const resolved = execFileSync(shell, ["-lc", `command -v ${cmd}`], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (resolved && resolved.startsWith("/")) return resolved;
  } catch { }
  return cmd; // fallback to bare name
}
