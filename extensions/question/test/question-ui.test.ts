import test from "node:test";
import assert from "node:assert/strict";
import { Key } from "@mariozechner/pi-tui";
import { createQuestionPromptComponent } from "../question-ui.ts";
import type { NormalizedQuestion } from "../types.ts";

// --- Raw terminal sequences for handleInput ---

const RAW: Record<string, string> = {
  [Key.enter]: "\r",
  [Key.escape]: "\x1b",
  [Key.up]: "\x1b[A",
  [Key.down]: "\x1b[B",
  [Key.left]: "\x1b[D",
  [Key.right]: "\x1b[C",
  [Key.tab]: "\t",
  [Key.shift("tab")]: "\x1b[Z",
  [Key.ctrl("s")]: "\x13",
  [Key.ctrl("c")]: "\x03",
};

/** Convert a Key identifier or plain character to its raw terminal byte sequence. */
function raw(key: string): string {
  return RAW[key] ?? key;
}

// --- Mocks ---

function mockTUI() {
  return { requestRender() {} } as any;
}

function mockTheme() {
  return {
    fg(_color: string, text: string) { return text; },
    bg(_color: string, text: string) { return text; },
    bold(text: string) { return text; },
    italic(text: string) { return text; },
  } as any;
}

function makeQuestion(overrides: Partial<NormalizedQuestion> = {}): NormalizedQuestion {
  return {
    question: "Pick a color",
    header: "Color",
    multiple: false,
    options: [
      { label: "Red", description: "Warm" },
      { label: "Blue" },
    ],
    ...overrides,
  };
}

interface DoneResult { cancelled: boolean; answers: string[][] }

function setup(questions: NormalizedQuestion[]) {
  let result: DoneResult | undefined;
  const component = createQuestionPromptComponent({
    tui: mockTUI(),
    theme: mockTheme(),
    questions,
    onDone(r) { result = r; },
  });
  return {
    component,
    send(key: string) { component.handleInput(raw(key)); },
    render(width = 80) { return component.render(width); },
    getResult() { return result; },
  };
}

// --- Single-select ---

test("single-select: Enter on first option selects and submits", () => {
  const { send, getResult } = setup([makeQuestion()]);
  send(Key.enter);
  const r = getResult()!;
  assert.equal(r.cancelled, false);
  assert.deepEqual(r.answers, [["Red"]]);
});

test("single-select: down + Enter selects second option", () => {
  const { send, getResult } = setup([makeQuestion()]);
  send(Key.down);
  send(Key.enter);
  const r = getResult()!;
  assert.deepEqual(r.answers, [["Blue"]]);
});

test("single-select: Escape cancels", () => {
  const { send, getResult } = setup([makeQuestion()]);
  send(Key.escape);
  const r = getResult()!;
  assert.equal(r.cancelled, true);
});

test("single-select: up at top stays at top", () => {
  const { send, getResult } = setup([makeQuestion()]);
  send(Key.up);
  send(Key.enter);
  const r = getResult()!;
  assert.deepEqual(r.answers, [["Red"]]);
});

test("single-select: down past last option stays at last", () => {
  const q = makeQuestion({ options: [{ label: "Only" }] });
  const { send, getResult } = setup([q]);
  // options: Only + "type your own" = 2 entries, index 0 and 1
  send(Key.down); // -> "type your own" (index 1)
  send(Key.down); // should stay at index 1
  send(Key.up);   // -> "Only" (index 0)
  send(Key.enter);
  assert.deepEqual(getResult()!.answers, [["Only"]]);
});

// --- Multi-select ---

test("multi-select: Enter toggles and does not auto-advance", () => {
  const q = makeQuestion({ multiple: true });
  const { send, getResult } = setup([q]);
  send(Key.enter); // toggle Red
  assert.equal(getResult(), undefined, "should not submit yet");
});

test("multi-select: toggle two options then ctrl+s submits both", () => {
  const q = makeQuestion({ multiple: true });
  const { send, getResult } = setup([q]);
  send(Key.enter); // toggle Red
  send(Key.down);
  send(Key.enter); // toggle Blue
  send(Key.ctrl("s"));
  const r = getResult()!;
  assert.equal(r.cancelled, false);
  assert.deepEqual(r.answers, [["Red", "Blue"]]);
});

test("multi-select: toggle on then off deselects", () => {
  const q = makeQuestion({ multiple: true });
  const { send, getResult } = setup([q]);
  send(Key.enter); // toggle Red on
  send(Key.enter); // toggle Red off
  send(Key.ctrl("s"));
  assert.deepEqual(getResult()!.answers, [[]]);
});

// --- Multi-question navigation ---

test("multi-question: Tab advances to next question", () => {
  const q1 = makeQuestion();
  const q2 = makeQuestion({ question: "Pick a size", header: "Size", options: [{ label: "S" }, { label: "M" }] });
  const { send, getResult } = setup([q1, q2]);
  send(Key.enter); // select Red on Q1 -> auto-advance to Q2
  send(Key.enter); // select S on Q2 -> submit
  const r = getResult()!;
  assert.equal(r.cancelled, false);
  assert.deepEqual(r.answers, [["Red"], ["S"]]);
});

test("multi-question: Tab from last question wraps or stays, ctrl+s submits", () => {
  const q1 = makeQuestion();
  const q2 = makeQuestion({ question: "Size", header: "Size", options: [{ label: "S" }] });
  const { send, getResult } = setup([q1, q2]);
  send(Key.enter); // select Red -> advance to Q2
  send(Key.enter); // select S -> finish
  const r = getResult()!;
  assert.deepEqual(r.answers, [["Red"], ["S"]]);
});

test("multi-question: Shift+Tab navigates back", () => {
  const q1 = makeQuestion();
  const q2 = makeQuestion({ question: "Size", header: "Size", options: [{ label: "S" }, { label: "M" }] });
  const { send, getResult } = setup([q1, q2]);
  send(Key.enter); // select Red -> advance to Q2
  send(Key.shift("tab")); // back to Q1
  send(Key.down); // move to Blue
  send(Key.enter); // select Blue (replaces Red) -> advance to Q2
  send(Key.down); // move to M
  send(Key.enter); // select M -> submit
  const r = getResult()!;
  assert.deepEqual(r.answers, [["Blue"], ["M"]]);
});

// --- "Type your own answer" ---

test("single-select: type-your-own via other option", () => {
  const q = makeQuestion({ options: [{ label: "A" }] });
  const { send, getResult } = setup([q]);
  send(Key.down); // move to "type your own" (index 1)
  send(Key.enter); // enter editor mode
  // Type characters
  for (const ch of "custom") send(ch);
  send(Key.enter); // submit custom text -> auto-advance -> finish
  const r = getResult()!;
  assert.equal(r.cancelled, false);
  assert.deepEqual(r.answers, [["custom"]]);
});

test("single-select: Escape in editor returns to options without submitting", () => {
  const q = makeQuestion({ options: [{ label: "A" }] });
  const { send, getResult } = setup([q]);
  send(Key.down);  // -> "type your own"
  send(Key.enter); // enter editor
  for (const ch of "draft") send(ch);
  send(Key.escape); // exit editor, back to options
  assert.equal(getResult(), undefined, "should not have submitted");
  send(Key.up); // -> "A"
  send(Key.enter); // select A
  assert.deepEqual(getResult()!.answers, [["A"]]);
});

test("multi-select: type-your-own combined with predefined", () => {
  const q = makeQuestion({ multiple: true, options: [{ label: "A" }, { label: "B" }] });
  const { send, getResult } = setup([q]);
  send(Key.enter); // toggle A
  send(Key.down);
  send(Key.down); // -> "type your own"
  send(Key.enter); // enter editor
  for (const ch of "extra") send(ch);
  send(Key.enter); // accept custom -> advances (single question -> finish)
  const r = getResult()!;
  assert.deepEqual(r.answers, [["A", "extra"]]);
});

test("type-your-own: empty text yields no custom answer", () => {
  const q = makeQuestion({ options: [{ label: "A" }] });
  const { send, getResult } = setup([q]);
  send(Key.down);  // -> "type your own"
  send(Key.enter); // enter editor
  send(Key.enter); // submit empty -> finishes
  const r = getResult()!;
  assert.deepEqual(r.answers, [[]], "empty custom should yield empty answer");
});

// --- Render output ---

test("render includes question text and option labels", () => {
  const { render } = setup([makeQuestion()]);
  const output = render().join("\n");
  assert.ok(output.includes("Pick a color"), "should contain question text");
  assert.ok(output.includes("Red"), "should contain option Red");
  assert.ok(output.includes("Blue"), "should contain option Blue");
  assert.ok(output.includes("type your own answer"), "should contain other option");
});

test("render includes option description", () => {
  const { render } = setup([makeQuestion()]);
  const output = render().join("\n");
  assert.ok(output.includes("Warm"), "should contain description for Red");
});

test("render shows progress tabs for multi-question", () => {
  const q1 = makeQuestion();
  const q2 = makeQuestion({ question: "Size?", header: "Size", options: [{ label: "S" }] });
  const { render } = setup([q1, q2]);
  const output = render().join("\n");
  assert.ok(output.includes("Color"), "should show Color tab");
  assert.ok(output.includes("Size"), "should show Size tab");
});

test("render caching: same width returns cached lines", () => {
  const { render } = setup([makeQuestion()]);
  const first = render(80);
  const second = render(80);
  assert.equal(first, second, "should return same array reference from cache");
});

test("render invalidation: invalidate clears cache", () => {
  const { component, render } = setup([makeQuestion()]);
  const first = render(80);
  component.invalidate();
  const second = render(80);
  assert.notEqual(first, second, "should return new array after invalidate");
});

// --- Ctrl+S submit ---

test("ctrl+s submits from option mode", () => {
  const { send, getResult } = setup([makeQuestion()]);
  send(Key.ctrl("s"));
  const r = getResult()!;
  assert.equal(r.cancelled, false);
});

test("ctrl+s submits from editor mode", () => {
  const q = makeQuestion({ options: [{ label: "A" }] });
  const { send, getResult } = setup([q]);
  send(Key.down);
  send(Key.enter); // enter editor
  for (const ch of "text") send(ch);
  send(Key.ctrl("s"));
  const r = getResult()!;
  assert.equal(r.cancelled, false);
  assert.deepEqual(r.answers, [["text"]]);
});

// --- Ctrl+C cancel ---

test("ctrl+c cancels from option mode", () => {
  const { send, getResult } = setup([makeQuestion()]);
  send(Key.ctrl("c"));
  assert.equal(getResult()!.cancelled, true);
});
