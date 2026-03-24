import { existsSync } from "node:fs";
import { extname, dirname, join } from "node:path";

export interface ServerConfig {
  /** Command string, split on spaces when spawning (e.g. "typescript-language-server --stdio"). */
  command: string;
  extensions: string[];
  rootMarkers: string[];
  /** Set to false to skip this server during matching. */
  enabled?: boolean;
}

export type LspConfig = Record<string, ServerConfig>;

// --- Server definitions (export order = formatter priority) ---

export const oxfmt: ServerConfig = {
  command: "oxfmt --lsp",
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  rootMarkers: ["package.json"],
};

export const oxlint: ServerConfig = {
  command: "oxlint --lsp",
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  rootMarkers: ["package.json"],
};

export const tsserver: ServerConfig = {
  command: "typescript-language-server --stdio",
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  rootMarkers: ["tsconfig.json", "package.json"],
};

export const rubocop: ServerConfig = {
  command: "bundle exec rubocop --lsp",
  extensions: [".rb"],
  rootMarkers: ["Gemfile"],
};

export const herb: ServerConfig = {
  command: "herb-language-server --stdio",
  extensions: [".erb"],
  rootMarkers: ["Gemfile"],
};

export function loadConfig(): LspConfig {
  return { oxfmt, oxlint, tsserver, rubocop, herb };
}

/** Match a file path to ALL matching language configs. Compound extensions (.html.erb) checked first. */
export function findLanguagesForFile(
  config: LspConfig,
  filePath: string,
): [string, ServerConfig][] {
  const results: [string, ServerConfig][] = [];
  const seen = new Set<string>();

  // Compound extensions first (longest match wins)
  for (const [lang, lc] of Object.entries(config)) {
    if (lc.enabled === false) continue;
    for (const ext of lc.extensions) {
      if (ext.includes(".") && filePath.endsWith(ext)) {
        results.push([lang, lc]);
        seen.add(lang);
        break;
      }
    }
  }

  // Simple extension — skip entries already matched by compound
  const ext = extname(filePath);
  if (ext) {
    for (const [lang, lc] of Object.entries(config)) {
      if (lc.enabled === false || seen.has(lang)) continue;
      if (lc.extensions.includes(ext)) {
        results.push([lang, lc]);
      }
    }
  }

  return results;
}

/** Built-in map for extensions whose languageId differs from the bare extension. */
const LANGUAGE_ID_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".rb": "ruby",
  ".erb": "erb",
};

/** Derive the LSP languageId from a file path. Uses built-in map, falls back to extension without dot. */
export function getLanguageId(filePath: string): string {
  const ext = extname(filePath);
  return LANGUAGE_ID_MAP[ext] ?? ext.slice(1);
}

/** Walk up from a file to find the nearest directory containing a root marker. */
export function findProjectRoot(filePath: string, markers: string[], fallback: string): string {
  let dir = dirname(filePath);
  const root = "/";
  while (dir !== root) {
    for (const marker of markers) {
      if (existsSync(join(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fallback;
}
