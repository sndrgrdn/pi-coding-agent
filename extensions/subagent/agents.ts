/**
 * Agent discovery and configuration.
 * Loads agent definitions from ~/.pi/agent/agents/ and .pi/agents/
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  /** "false" (default) = --no-extensions, "true" = all, or comma-separated paths */
  extensions?: "true" | "false" | string[];
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

/**
 * Resolve an extension entry to an absolute path.
 * Supports:
 * - Bare names: "glob" → <agentDir>/extensions/glob/index.ts (or .js)
 * - Relative paths: "./ext/foo.ts" → resolved from agent file dir
 * - Absolute paths: passed through
 */
function resolveExtensionPath(entry: string, agentDir: string, cwd: string): string | null {
  // Absolute path — use as-is
  if (path.isAbsolute(entry)) {
    return fs.existsSync(entry) ? entry : null;
  }

  // Relative path (starts with ./ or ../) — resolve from agent file dir
  if (entry.startsWith("./") || entry.startsWith("../")) {
    const resolved = path.resolve(agentDir, entry);
    return fs.existsSync(resolved) ? resolved : null;
  }

  // Bare name — search extension directories (global, then project-local)
  const extensionDirs = [
    path.join(getAgentDir(), "extensions"),
    path.join(cwd, ".pi", "extensions"),
  ];

  for (const dir of extensionDirs) {
    // Try dir/<name>/index.ts, dir/<name>/index.js, dir/<name>.ts, dir/<name>.js
    for (const candidate of [
      path.join(dir, entry, "index.ts"),
      path.join(dir, entry, "index.js"),
      path.join(dir, `${entry}.ts`),
      path.join(dir, `${entry}.js`),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function resolveExtensionNames(entries: string[], agentDir: string, cwd: string): string[] {
  const resolved: string[] = [];
  for (const entry of entries) {
    const p = resolveExtensionPath(entry, agentDir, cwd);
    if (p) resolved.push(p);
  }
  return resolved;
}

function parseExtensions(value: string | undefined): AgentConfig["extensions"] {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === "true" || trimmed === "false") return trimmed;
  return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
}

export function loadAgentsFromDir(dir: string, source: "user" | "project", cwd?: string): AgentConfig[] {
  const agents: AgentConfig[] = [];
  if (!fs.existsSync(dir)) return agents;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);

    const extensions = parseExtensions(frontmatter.extensions);
    const resolvedExtensions = Array.isArray(extensions)
      ? resolveExtensionNames(extensions, dir, cwd ?? process.cwd())
      : extensions;

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      extensions: resolvedExtensions,
      systemPrompt: body,
      source,
      filePath,
    });
  }

  return agents;
}

function findProjectAgentsDir(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, ".pi", "agents");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch { }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function discoverAgents(cwd: string): AgentConfig[] {
  const userDir = path.join(getAgentDir(), "agents");
  const projectDir = findProjectAgentsDir(cwd);

  const map = new Map<string, AgentConfig>();
  for (const a of loadAgentsFromDir(userDir, "user", cwd)) map.set(a.name, a);
  if (projectDir) {
    for (const a of loadAgentsFromDir(projectDir, "project", cwd)) map.set(a.name, a);
  }
  return Array.from(map.values());
}

export function findAgent(cwd: string, name: string): AgentConfig | undefined {
  return discoverAgents(cwd).find((a) => a.name === name);
}
