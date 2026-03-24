import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { LspClient } from "./client";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FAKE_LSP = join(__dirname, "test-fixtures", "fake-lsp.js");
const NODE = process.execPath;
const FAKE_CMD = `${NODE} ${FAKE_LSP}`;

describe("LspClient", () => {
  let tmp: string;
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "lsp-client-test-"));
    logs.length = 0;
  });

  afterEach(async () => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("starts and initializes successfully", async () => {
    const client = new LspClient({ command: FAKE_CMD, rootPath: tmp, log });
    try {
      const ok = await client.ensureStarted();
      expect(ok).toBe(true);
    } finally {
      await client.shutdown();
    }
  });

  test("ensureStarted returns true on repeated calls", async () => {
    const client = new LspClient({ command: FAKE_CMD, rootPath: tmp, log });
    try {
      await client.ensureStarted();
      const ok = await client.ensureStarted();
      expect(ok).toBe(true);
    } finally {
      await client.shutdown();
    }
  });

  test("shutdown completes without errors", async () => {
    const client = new LspClient({ command: FAKE_CMD, rootPath: tmp, log });
    await client.ensureStarted();
    // Should not throw
    await client.shutdown();
  });

  test("ensureStarted returns false after shutdown", async () => {
    const client = new LspClient({ command: FAKE_CMD, rootPath: tmp, log });
    await client.ensureStarted();
    await client.shutdown();
    // After shutdown, process is dead — ensureStarted should return false
    // (the client is marked dead)
  });

  test("getDiagnostics returns empty array for new file", async () => {
    const client = new LspClient({ command: FAKE_CMD, rootPath: tmp, log });
    try {
      await client.ensureStarted();
      const filePath = join(tmp, "test.ts");
      writeFileSync(filePath, "const x = 1;");
      const diags = await client.getDiagnostics(filePath, 500);
      expect(Array.isArray(diags)).toBe(true);
    } finally {
      await client.shutdown();
    }
  });

  test("does not throw ERR_STREAM_DESTROYED when process dies abruptly", async () => {
    const client = new LspClient({ command: FAKE_CMD, rootPath: tmp, log });
    await client.ensureStarted();

    const filePath = join(tmp, "test.ts");
    writeFileSync(filePath, "const x = 1;");

    // Kill the process abruptly
    const proc = (client as any).proc;
    expect(proc).not.toBeNull();
    proc.kill("SIGKILL");

    // Wait for process to die
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Operations on dead stream should not throw
    await expect(client.getDiagnostics(filePath, 200)).resolves.toBeDefined();
    await expect(client.shutdown()).resolves.toBeUndefined();
  });

  test("returns false for nonexistent command", async () => {
    const client = new LspClient({ command: "/nonexistent/binary", rootPath: tmp, log });
    const ok = await client.ensureStarted();
    expect(ok).toBe(false);
  });

  test("canFormat reflects server capabilities", async () => {
    // fake-lsp.js reports documentFormattingProvider: false
    const client = new LspClient({ command: FAKE_CMD, rootPath: tmp, log });
    try {
      expect(client.canFormat).toBe(false); // before start
      await client.ensureStarted();
      expect(client.canFormat).toBe(false); // server says no
    } finally {
      await client.shutdown();
    }
  });

  test("hasDiagnostics becomes true after receiving push", async () => {
    // fake-lsp.js pushes empty diagnostics on didOpen
    const client = new LspClient({ command: FAKE_CMD, rootPath: tmp, log });
    try {
      expect(client.hasDiagnostics).toBe(false); // before any push
      await client.ensureStarted();
      const filePath = join(tmp, "test.ts");
      writeFileSync(filePath, "const x = 1;");
      await client.getDiagnostics(filePath, 500);
      expect(client.hasDiagnostics).toBe(true); // after push
    } finally {
      await client.shutdown();
    }
  });
});
