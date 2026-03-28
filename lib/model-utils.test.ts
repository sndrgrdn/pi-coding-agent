import { describe, expect, test } from "vitest";
import { getModelName } from "./model-utils.js";

describe("getModelName", () => {
  test("resolves bare model ID to display name", () => {
    expect(getModelName("claude-sonnet-4-6")).toBe("Claude Sonnet 4.6");
  });

  test("resolves provider-prefixed ID", () => {
    expect(getModelName("anthropic/claude-haiku-4-5")).toBe("Claude Haiku 4.5");
  });

  test("resolves dated model ID", () => {
    expect(getModelName("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
  });

  test("returns raw ID for unknown models", () => {
    expect(getModelName("some-custom/model")).toBe("some-custom/model");
  });
});
