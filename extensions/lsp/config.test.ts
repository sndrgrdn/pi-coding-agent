import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { getLanguageId, findLanguageForFile, findLanguagesForFile, findProjectRoot, loadConfig, type LspConfig } from "./config";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const configWithLanguageIds: LspConfig = {
  typescript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    format: true,
    diagnostics: true,
    languageIds: {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".jsx": "javascriptreact",
    },
  },
  ruby: {
    command: "ruby-lsp",
    args: [],
    extensions: [".rb"],
    format: false,
    diagnostics: true,
    languageIds: { ".rb": "ruby" },
  },
  erb: {
    command: "herb-language-server",
    args: ["--stdio"],
    extensions: [".erb"],
    format: true,
    diagnostics: true,
    languageIds: { ".erb": "erb" },
  },
};

describe("getLanguageId", () => {
  test("returns configured language IDs from languageIds map", () => {
    expect(getLanguageId(configWithLanguageIds, "/project/app.ts")).toBe("typescript");
    expect(getLanguageId(configWithLanguageIds, "/project/app.tsx")).toBe("typescriptreact");
    expect(getLanguageId(configWithLanguageIds, "/project/app.rb")).toBe("ruby");
    expect(getLanguageId(configWithLanguageIds, "/project/app.js")).toBe("javascript");
    expect(getLanguageId(configWithLanguageIds, "/project/app.jsx")).toBe("javascriptreact");
    expect(getLanguageId(configWithLanguageIds, "/project/view.erb")).toBe("erb");
  });

  test("falls back to extension without dot for unknown extensions", () => {
    expect(getLanguageId(configWithLanguageIds, "/project/file.py")).toBe("py");
    expect(getLanguageId(configWithLanguageIds, "/project/file.go")).toBe("go");
  });

  test("falls back to extension without dot when languageIds not configured", () => {
    const minimal: LspConfig = {
      python: {
        command: "pylsp",
        args: [],
        extensions: [".py"],
        format: true,
        diagnostics: true,
      },
    };
    expect(getLanguageId(minimal, "/project/app.py")).toBe("py");
  });
});

const testConfig: LspConfig = {
  typescript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx"],
    format: true,
    diagnostics: true,
  },
  ruby: {
    command: "ruby-lsp",
    args: [],
    extensions: [".rb", ".html.erb"],
    format: false,
    diagnostics: true,
  },
  disabled: {
    command: "nope",
    args: [],
    extensions: [".txt"],
    format: false,
    diagnostics: false,
    enabled: false,
  },
};

describe("findLanguageForFile (deprecated, returns first match)", () => {
  test("matches simple extensions to language config", () => {
    const result = findLanguageForFile(testConfig, "/project/app.ts");
    expect(result).not.toBeNull();
    expect(result![0]).toBe("typescript");
    expect(result![1].command).toBe("typescript-language-server");
  });

  test("matches compound extensions before simple ones", () => {
    const result = findLanguageForFile(testConfig, "/project/view.html.erb");
    expect(result).not.toBeNull();
    expect(result![0]).toBe("ruby");
  });

  test("returns null for disabled languages", () => {
    expect(findLanguageForFile(testConfig, "/project/notes.txt")).toBeNull();
  });

  test("returns null for unrecognized extensions", () => {
    expect(findLanguageForFile(testConfig, "/project/data.csv")).toBeNull();
  });

  test("returns null for files with no extension", () => {
    expect(findLanguageForFile(testConfig, "/project/Makefile")).toBeNull();
  });
});

const multiServerConfig: LspConfig = {
  typescript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx"],
    format: true,
    diagnostics: true,
  },
  oxlint: {
    command: "oxlint-language-server",
    args: [],
    extensions: [".ts", ".tsx", ".js"],
    format: false,
    diagnostics: true,
  },
  biome: {
    command: "biome",
    args: ["lsp-proxy"],
    extensions: [".ts", ".js", ".json"],
    format: true,
    diagnostics: true,
  },
  ruby: {
    command: "ruby-lsp",
    args: [],
    extensions: [".rb", ".html.erb"],
    format: false,
    diagnostics: true,
  },
  erb: {
    command: "erb-lsp",
    args: [],
    extensions: [".erb"],
    format: true,
    diagnostics: true,
  },
  disabled_ts: {
    command: "disabled-ts-server",
    args: [],
    extensions: [".ts"],
    format: false,
    diagnostics: true,
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
    expect(tsMatch![1].command).toBe("typescript-language-server");
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

describe("loadConfig", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "lsp-config-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("project config is included when .pi/lsp.json exists", () => {
    mkdirSync(join(tmp, ".pi"), { recursive: true });
    writeFileSync(
      join(tmp, ".pi", "lsp.json"),
      JSON.stringify({
        customlang: {
          command: "custom-lsp",
          args: [],
          extensions: [".custom"],
          format: false,
          diagnostics: true,
        },
      }),
    );

    const config = loadConfig(tmp);
    expect(config.customlang).toBeDefined();
    expect(config.customlang!.command).toBe("custom-lsp");
  });

  test("returns config even when project has no .pi/lsp.json", () => {
    // tmp has no .pi/lsp.json — should still return (at least global config or empty)
    const config = loadConfig(tmp);
    expect(config).toBeDefined();
    expect(typeof config).toBe("object");
  });

  test("project config overrides global config for same language", () => {
    mkdirSync(join(tmp, ".pi"), { recursive: true });
    // Override typescript (which likely exists in global config)
    writeFileSync(
      join(tmp, ".pi", "lsp.json"),
      JSON.stringify({
        typescript: {
          command: "my-custom-ts-server",
          args: ["--custom"],
          extensions: [".ts"],
          format: false,
          diagnostics: false,
        },
      }),
    );

    const config = loadConfig(tmp);
    expect(config.typescript!.command).toBe("my-custom-ts-server");
  });
});
