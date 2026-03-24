import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  getLanguageId,
  findLanguagesForFile,
  findProjectRoot,
  loadConfig,
  type LspConfig,
} from "./config";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadConfig", () => {
  test("returns all server entries in export order", () => {
    const config = loadConfig();
    const names = Object.keys(config);
    expect(names).toEqual(["oxfmt", "oxlint", "tsserver", "rubocop", "herb"]);
  });

  test("each entry is a valid ServerConfig", () => {
    const config = loadConfig();
    for (const [name, server] of Object.entries(config)) {
      expect(server.command, `${name}.command`).toBeTypeOf("string");
      expect(server.command.length, `${name}.command`).toBeGreaterThan(0);
      expect(server.extensions, `${name}.extensions`).toBeInstanceOf(Array);
      expect(server.rootMarkers, `${name}.rootMarkers`).toBeInstanceOf(Array);
      expect(server.extensions.length, `${name}.extensions`).toBeGreaterThan(0);
      expect(server.rootMarkers!.length, `${name}.rootMarkers`).toBeGreaterThan(0);
    }
  });

  test("oxfmt handles JS/TS files", () => {
    const config = loadConfig();
    expect(config.oxfmt!.command).toBe("oxfmt --lsp");
    expect(config.oxfmt!.extensions).toEqual([".ts", ".tsx", ".js", ".jsx"]);
  });

  test("tsserver handles JS/TS files", () => {
    const config = loadConfig();
    expect(config.tsserver!.command).toBe("typescript-language-server --stdio");
    expect(config.tsserver!.extensions).toContain(".ts");
  });
});

describe("getLanguageId", () => {
  test("resolves known JS/TS variant extensions", () => {
    expect(getLanguageId("/project/app.ts")).toBe("typescript");
    expect(getLanguageId("/project/app.tsx")).toBe("typescriptreact");
    expect(getLanguageId("/project/app.js")).toBe("javascript");
    expect(getLanguageId("/project/app.jsx")).toBe("javascriptreact");
  });

  test("resolves module variants", () => {
    expect(getLanguageId("/project/app.mts")).toBe("typescript");
    expect(getLanguageId("/project/app.cts")).toBe("typescript");
    expect(getLanguageId("/project/app.mjs")).toBe("javascript");
    expect(getLanguageId("/project/app.cjs")).toBe("javascript");
  });

  test("resolves ruby and erb", () => {
    expect(getLanguageId("/project/app.rb")).toBe("ruby");
    expect(getLanguageId("/project/view.erb")).toBe("erb");
  });

  test("falls back to extension without dot for unmapped extensions", () => {
    expect(getLanguageId("/project/file.py")).toBe("py");
    expect(getLanguageId("/project/file.go")).toBe("go");
    expect(getLanguageId("/project/file.rs")).toBe("rs");
  });
});

const multiServerConfig: LspConfig = {
  typescript: {
    command: "typescript-language-server --stdio",
    extensions: [".ts", ".tsx"],
    rootMarkers: ["tsconfig.json"],
  },
  oxlint: {
    command: "oxlint-language-server",
    extensions: [".ts", ".tsx", ".js"],
    rootMarkers: ["package.json"],
  },
  biome: {
    command: "biome lsp-proxy",
    extensions: [".ts", ".js", ".json"],
    rootMarkers: ["biome.json"],
  },
  ruby: {
    command: "ruby-lsp",
    extensions: [".rb", ".html.erb"],
    rootMarkers: ["Gemfile"],
  },
  erb: {
    command: "erb-lsp",
    extensions: [".erb"],
    rootMarkers: ["Gemfile"],
  },
  disabled_ts: {
    command: "disabled-ts-server",
    extensions: [".ts"],
    rootMarkers: [],
    enabled: false,
  },
};

describe("findLanguagesForFile", () => {
  test("returns all matching servers for a shared extension", () => {
    const results = findLanguagesForFile(multiServerConfig, "/project/app.ts");
    const names = results.map(([lang]) => lang);
    expect(names).toEqual(["typescript", "oxlint", "biome"]);
  });

  test("preserves config key order", () => {
    const results = findLanguagesForFile(multiServerConfig, "/project/app.js");
    const names = results.map(([lang]) => lang);
    expect(names).toEqual(["oxlint", "biome"]);
  });

  test("compound extensions take priority over simple extensions", () => {
    const results = findLanguagesForFile(multiServerConfig, "/project/view.html.erb");
    const names = results.map(([lang]) => lang);
    // ruby matches via compound .html.erb first, then erb matches via simple .erb
    expect(names[0]).toBe("ruby");
    expect(names).toContain("erb");
  });

  test("excludes disabled servers", () => {
    const results = findLanguagesForFile(multiServerConfig, "/project/app.ts");
    const names = results.map(([lang]) => lang);
    expect(names).not.toContain("disabled_ts");
  });

  test("returns empty array for unrecognized extensions", () => {
    expect(findLanguagesForFile(multiServerConfig, "/project/data.csv")).toEqual([]);
  });

  test("returns empty array for files with no extension", () => {
    expect(findLanguagesForFile(multiServerConfig, "/project/Makefile")).toEqual([]);
  });

  test("returns single match when only one server matches", () => {
    const results = findLanguagesForFile(multiServerConfig, "/project/app.rb");
    expect(results).toHaveLength(1);
    expect(results[0]![0]).toBe("ruby");
  });

  test("each result includes the correct config object", () => {
    const results = findLanguagesForFile(multiServerConfig, "/project/app.ts");
    const tsMatch = results.find(([lang]) => lang === "typescript");
    const oxMatch = results.find(([lang]) => lang === "oxlint");
    expect(tsMatch![1].command).toBe("typescript-language-server --stdio");
    expect(oxMatch![1].command).toBe("oxlint-language-server");
  });

  test("does not duplicate a server matched by both compound and simple", () => {
    // ruby has both .html.erb (compound) and .rb (simple)
    // For a .html.erb file, ruby should only appear once (via compound match)
    const results = findLanguagesForFile(multiServerConfig, "/project/view.html.erb");
    const rubyCount = results.filter(([lang]) => lang === "ruby").length;
    expect(rubyCount).toBe(1);
  });
});

describe("findProjectRoot", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "lsp-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("finds nearest directory containing a root marker", () => {
    // tmp/project/package.json exists
    // tmp/project/src/deep/file.ts is the file
    const projectDir = join(tmp, "project");
    mkdirSync(join(projectDir, "src", "deep"), { recursive: true });
    writeFileSync(join(projectDir, "package.json"), "{}");
    const filePath = join(projectDir, "src", "deep", "file.ts");
    writeFileSync(filePath, "");

    const root = findProjectRoot(filePath, ["package.json"], "/fallback");
    expect(root).toBe(projectDir);
  });

  test("returns fallback when no marker is found", () => {
    const filePath = join(tmp, "orphan", "file.ts");
    mkdirSync(join(tmp, "orphan"), { recursive: true });
    writeFileSync(filePath, "");

    const root = findProjectRoot(filePath, ["package.json"], "/my-fallback");
    expect(root).toBe("/my-fallback");
  });

  test("checks multiple markers", () => {
    mkdirSync(join(tmp, "gems"), { recursive: true });
    writeFileSync(join(tmp, "gems", "Gemfile"), "");
    const filePath = join(tmp, "gems", "app.rb");
    writeFileSync(filePath, "");

    const root = findProjectRoot(filePath, ["package.json", "Gemfile"], "/fallback");
    expect(root).toBe(join(tmp, "gems"));
  });

  test("finds closest marker when nested projects exist", () => {
    // tmp/outer/package.json
    // tmp/outer/inner/package.json  <-- should find this one
    // tmp/outer/inner/src/file.ts
    mkdirSync(join(tmp, "outer", "inner", "src"), { recursive: true });
    writeFileSync(join(tmp, "outer", "package.json"), "{}");
    writeFileSync(join(tmp, "outer", "inner", "package.json"), "{}");
    const filePath = join(tmp, "outer", "inner", "src", "file.ts");
    writeFileSync(filePath, "");

    const root = findProjectRoot(filePath, ["package.json"], "/fallback");
    expect(root).toBe(join(tmp, "outer", "inner"));
  });
});
