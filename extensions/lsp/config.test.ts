import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { getLanguageId, findLanguageForFile, findProjectRoot, loadConfig, type LspConfig } from "./config";
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

describe("findLanguageForFile", () => {
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
