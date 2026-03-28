import { describe, expect, test } from "vitest"
import { getThinkingColor } from "./theme-utils.js"

describe("getThinkingColor", () => {
  test("returns color for minimal thinking level", () => {
    expect(getThinkingColor("minimal")).toBe("thinkingMinimal")
  })

  test("returns color for low thinking level", () => {
    expect(getThinkingColor("low")).toBe("thinkingLow")
  })

  test("returns color for medium thinking level", () => {
    expect(getThinkingColor("medium")).toBe("thinkingMedium")
  })

  test("returns color for high thinking level", () => {
    expect(getThinkingColor("high")).toBe("thinkingHigh")
  })

  test("returns color for xhigh thinking level", () => {
    expect(getThinkingColor("xhigh")).toBe("thinkingXhigh")
  })

  test("returns dim for unknown thinking level", () => {
    expect(getThinkingColor("unknown")).toBe("dim")
  })

  test("returns dim for empty string", () => {
    expect(getThinkingColor("")).toBe("dim")
  })
})
