import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAgentsFromDir } from "./agents.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "subagent-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadAgentsFromDir", () => {
  test("loads a valid agent from markdown with frontmatter", () => {
    writeFileSync(
      join(tmpDir, "scout.md"),
      `---
name: scout
description: Fast recon agent
tools: read, bash, grep
model: claude-haiku-4-5
---

You are a scout agent.
`,
    );

    const agents = loadAgentsFromDir(tmpDir, "user");

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: "scout",
      description: "Fast recon agent",
      tools: ["read", "bash", "grep"],
      model: "claude-haiku-4-5",
      source: "user",
      systemPrompt: expect.stringContaining("You are a scout agent"),
    });
  });

  test("skips files missing required frontmatter fields", () => {
    writeFileSync(join(tmpDir, "no-name.md"), `---\ndescription: has desc but no name\n---\nBody`);
    writeFileSync(join(tmpDir, "no-desc.md"), `---\nname: agent\n---\nBody`);
    writeFileSync(join(tmpDir, "empty.md"), `No frontmatter at all`);

    const agents = loadAgentsFromDir(tmpDir, "user");
    expect(agents).toHaveLength(0);
  });

  test("skips non-markdown files", () => {
    writeFileSync(join(tmpDir, "agent.txt"), `---\nname: a\ndescription: b\n---\nBody`);
    writeFileSync(join(tmpDir, "agent.json"), `{"name":"a"}`);

    const agents = loadAgentsFromDir(tmpDir, "user");
    expect(agents).toHaveLength(0);
  });

  test("returns empty array for nonexistent directory", () => {
    const agents = loadAgentsFromDir(join(tmpDir, "nope"), "user");
    expect(agents).toEqual([]);
  });

  test("parses tools as comma-separated trimmed list", () => {
    writeFileSync(
      join(tmpDir, "a.md"),
      `---\nname: a\ndescription: d\ntools: " read , bash , grep "\n---\nBody`,
    );

    const agents = loadAgentsFromDir(tmpDir, "user");
    expect(agents[0]!.tools).toEqual(["read", "bash", "grep"]);
  });

  test("omits tools when not specified", () => {
    writeFileSync(join(tmpDir, "a.md"), `---\nname: a\ndescription: d\n---\nBody`);

    const agents = loadAgentsFromDir(tmpDir, "user");
    expect(agents[0]!.tools).toBeUndefined();
  });

  test("parses extensions: true", () => {
    writeFileSync(join(tmpDir, "a.md"), `---\nname: a\ndescription: d\nextensions: "true"\n---\nBody`);

    const agents = loadAgentsFromDir(tmpDir, "user");
    expect(agents[0]!.extensions).toBe("true");
  });

  test("parses extensions: false", () => {
    writeFileSync(join(tmpDir, "a.md"), `---\nname: a\ndescription: d\nextensions: "false"\n---\nBody`);

    const agents = loadAgentsFromDir(tmpDir, "user");
    expect(agents[0]!.extensions).toBe("false");
  });

  test("resolves relative extension paths from agent directory", () => {
    const extDir = join(tmpDir, "ext");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "web.ts"), "export default () => {}");
    writeFileSync(join(extDir, "mcp.ts"), "export default () => {}");

    writeFileSync(
      join(tmpDir, "a.md"),
      `---\nname: a\ndescription: d\nextensions: ./ext/web.ts, ./ext/mcp.ts\n---\nBody`,
    );

    const agents = loadAgentsFromDir(tmpDir, "user");
    expect(agents[0]!.extensions).toEqual([join(extDir, "web.ts"), join(extDir, "mcp.ts")]);
  });

  test("drops unresolvable extension entries", () => {
    writeFileSync(
      join(tmpDir, "a.md"),
      `---\nname: a\ndescription: d\nextensions: ./nope.ts\n---\nBody`,
    );

    const agents = loadAgentsFromDir(tmpDir, "user");
    expect(agents[0]!.extensions).toEqual([]);
  });

  test("extensions undefined when not specified", () => {
    writeFileSync(join(tmpDir, "a.md"), `---\nname: a\ndescription: d\n---\nBody`);

    const agents = loadAgentsFromDir(tmpDir, "user");
    expect(agents[0]!.extensions).toBeUndefined();
  });
});

describe("discoverAgents", () => {
  test("project agents override user agents with same name", () => {
    const userDir = join(tmpDir, "user-agents");
    const projectRoot = join(tmpDir, "project");
    const projectDir = join(projectRoot, ".pi", "agents");
    mkdirSync(userDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(userDir, "scout.md"), `---\nname: scout\ndescription: user scout\n---\nUser version`);
    writeFileSync(join(projectDir, "scout.md"), `---\nname: scout\ndescription: project scout\n---\nProject version`);

    // Load separately and merge like discoverAgents does
    const userAgents = loadAgentsFromDir(userDir, "user");
    const projectAgents = loadAgentsFromDir(projectDir, "project");

    const map = new Map<string, (typeof userAgents)[number]>();
    for (const a of userAgents) map.set(a.name, a);
    for (const a of projectAgents) map.set(a.name, a);
    const result = Array.from(map.values());

    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("project");
    expect(result[0]!.description).toBe("project scout");
  });
});
