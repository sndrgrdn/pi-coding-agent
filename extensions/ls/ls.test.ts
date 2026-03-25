import { describe, test, expect } from "vitest";
import { buildRgArgs, buildTree, renderTree, IGNORE_PATTERNS, FILE_LIMIT } from "./ls.ts";

describe("buildTree", () => {
  test("groups files into root directory", () => {
    const tree = buildTree(["README.md", "package.json"]);

    expect(tree.filesByDir.get(".")).toEqual(["README.md", "package.json"]);
    expect(tree.dirs.has(".")).toBe(true);
  });

  test("groups files into nested directories", () => {
    const tree = buildTree(["src/index.ts", "src/utils.ts", "test/app.test.ts"]);

    expect(tree.filesByDir.get("src")).toEqual(["index.ts", "utils.ts"]);
    expect(tree.filesByDir.get("test")).toEqual(["app.test.ts"]);
  });

  test("registers all parent directories", () => {
    const tree = buildTree(["src/components/Button.tsx"]);

    expect(tree.dirs.has(".")).toBe(true);
    expect(tree.dirs.has("src")).toBe(true);
    expect(tree.dirs.has("src/components")).toBe(true);
  });

  test("returns empty collections for empty input", () => {
    const tree = buildTree([]);

    expect(tree.dirs.size).toBe(0);
    expect(tree.filesByDir.size).toBe(0);
  });
});

describe("renderTree", () => {
  test("renders flat files at root", () => {
    const tree = buildTree(["b.txt", "a.txt"]);
    const output = renderTree(tree);

    expect(output).toBe("  a.txt\n  b.txt\n");
  });

  test("renders directories before files, both sorted", () => {
    const tree = buildTree(["README.md", "src/index.ts", "lib/utils.ts"]);
    const output = renderTree(tree);

    const lines = output.trimEnd().split("\n");
    expect(lines).toEqual(["  lib/", "    utils.ts", "  src/", "    index.ts", "  README.md"]);
  });

  test("renders deeply nested structure with correct indentation", () => {
    const tree = buildTree(["src/components/Button.tsx", "src/index.ts"]);
    const output = renderTree(tree);

    const lines = output.trimEnd().split("\n");
    expect(lines).toEqual(["  src/", "    components/", "      Button.tsx", "    index.ts"]);
  });

  test("returns empty string for empty tree", () => {
    const tree = buildTree([]);
    const output = renderTree(tree);

    expect(output).toBe("");
  });
});

describe("buildRgArgs", () => {
  test("starts with --files and ends with .", () => {
    const args = buildRgArgs();

    expect(args[0]).toBe("--files");
    expect(args[args.length - 1]).toBe(".");
  });

  test("includes negated globs for all default ignore patterns", () => {
    const args = buildRgArgs();

    for (const pattern of IGNORE_PATTERNS) {
      expect(args).toContain(`!${pattern}*`);
    }
  });

  test("appends custom ignore patterns", () => {
    const args = buildRgArgs(["*.log", "fixtures/"]);

    expect(args).toContain("!*.log");
    expect(args).toContain("!fixtures/");
  });

  test("places custom ignores after default ignores but before .", () => {
    const args = buildRgArgs(["custom/"]);
    const customIdx = args.indexOf("!custom/");
    const dotIdx = args.indexOf(".");

    expect(customIdx).toBeGreaterThan(0);
    expect(customIdx).toBeLessThan(dotIdx);
  });
});
