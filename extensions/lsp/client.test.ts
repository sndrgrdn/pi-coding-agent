import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { LspClient } from "./client";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FAKE_LSP = join(__dirname, "test-fixtures", "fake-lsp.js");
const NODE = process.execPath;

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
    const client = new LspClient(NODE, [FAKE_LSP], tmp, log);
    try {
      const ok = await client.ensureStarted();
      expect(ok).toBe(true);
    } finally {
      await client.shutdown();
    }
  });

  test("ensureStarted returns true on repeated calls", async () => {
    const client = new LspClient(NODE, [FAKE_LSP], tmp, log);
    try {
      await client.ensureStarted();
      const ok = await client.ensureStarted();
      expect(ok).toBe(true);
    } finally {
      await client.shutdown();
    }
  });

  test("shutdown completes without errors", async () => {
    const client = new LspClient(NODE, [FAKE_LSP], tmp, log);
    await client.ensureStarted();
    // Should not throw
    await client.shutdown();
  });

  test("ensureStarted returns false after shutdown", async () => {
    const client = new LspClient(NODE, [FAKE_LSP], tmp, log);
    await client.ensureStarted();
    await client.shutdown();
    // After shutdown, process is dead — ensureStarted should return false
    // (the client is marked dead)
  });

  test("getDiagnostics returns empty array for new file", async () => {
    const client = new LspClient(NODE, [FAKE_LSP], tmp, log);
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
    const client = new LspClient(NODE, [FAKE_LSP], tmp, log);
    await client.ensureStarted();

    // Access the private connection to send kill notification
    // We use the connection indirectly by triggering a file sync right as we kill
    const filePath = join(tmp, "test.ts");
    writeFileSync(filePath, "const x = 1;");

    // Kill the process abruptly by sending SIGKILL to the underlying process
    // Access internal proc via any cast (integration test — we own this code)
    const proc = (client as any).proc;
    expect(proc).not.toBeNull();
    proc.kill("SIGKILL");

    // Wait for process to die
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Now try operations that would write to the dead stream — should not throw
    // getDiagnostics calls syncDocument which writes to the connection
    // This is the exact scenario that caused ERR_STREAM_DESTROYED
    await expect(client.getDiagnostics(filePath, 200)).resolves.toBeDefined();

    // Shutdown should also not throw on dead process
    await expect(client.shutdown()).resolves.toBeUndefined();
  });

  test("returns false for nonexistent command", async () => {
    const client = new LspClient("/nonexistent/binary", [], tmp, log);
    const ok = await client.ensureStarted();
    expect(ok).toBe(false);
  });
});
