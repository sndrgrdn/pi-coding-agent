import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";

export interface LanguageConfig {
  command: string;
  args: string[];
  extensions: string[];
  format: boolean;
  diagnostics: boolean;
  enabled?: boolean;
  /** Files that mark a project root (e.g. ["Gemfile"], ["tsconfig.json","package.json"]) */
  rootMarkers?: string[];
  /** Extra env vars merged into spawn environment */
  env?: Record<string, string>;
  /** Passed as initializationOptions during LSP initialize */
  initOptions?: Record<string, unknown>;
  /** Maps file extension to LSP languageId (e.g. {".tsx": "typescriptreact"}). Falls back to extension without dot. */
  languageIds?: Record<string, string>;
}

export type LspConfig = Record<string, LanguageConfig>;

const GLOBAL_CONFIG = join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".pi",
  "agent",
  "lsp.json",
);

function readJson(path: string): LspConfig | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function loadConfig(cwd: string): LspConfig {
  const global = readJson(GLOBAL_CONFIG) ?? {};
  const project = readJson(join(cwd, ".pi", "lsp.json")) ?? {};
  // Project entries override global per-language
  return { ...global, ...project };
}

/** Match a file path to ALL matching language configs. Compound extensions (.html.erb) checked first. */
export function findLanguagesForFile(
  config: LspConfig,
  filePath: string,
): [string, LanguageConfig][] {
  const results: [string, LanguageConfig][] = [];
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

/** @deprecated Use findLanguagesForFile instead. */
export function findLanguageForFile(
  config: LspConfig,
  filePath: string,
): [string, LanguageConfig] | null {
  const matches = findLanguagesForFile(config, filePath);
  return matches[0] ?? null;
}

/** Derive the LSP languageId from a file path, consulting config's languageIds map first. */
export function getLanguageId(config: LspConfig, filePath: string): string {
  const ext = extname(filePath);
  const matches = findLanguagesForFile(config, filePath);
  for (const [, lc] of matches) {
    if (lc.languageIds?.[ext]) return lc.languageIds[ext];
  }
  // Fallback: extension without dot
  return ext.slice(1);
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
