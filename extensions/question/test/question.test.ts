import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAnswerSelection,
  normalizeQuestions,
  replaceAnswerSelection,
  summarizeAnswers,
} from "../helpers.ts";
import { OTHER_OPTION_LABEL } from "../types.ts";

test("normalizeQuestions trims question fields and defaults multiple to false", () => {
  const questions = normalizeQuestions([
    {
      question: "  Which targets?  ",
      header: "  Targets  ",
      options: [{ label: "  iOS  ", description: "  Mobile  " }],
    },
    {
      question: "Pick extras",
      header: "Extras",
      multiple: true,
      options: [{ label: "Docs" }],
    },
  ]);

  assert.equal(questions[0].question, "Which targets?");
  assert.equal(questions[0].header, "Targets");
  assert.equal(questions[0].multiple, false);
  assert.deepEqual(questions[0].options, [{ label: "iOS", description: "Mobile" }]);
  assert.equal(questions[1].multiple, true);
});

test("normalizeAnswerSelection removes sentinel and appends custom value", () => {
  assert.deepEqual(normalizeAnswerSelection(["A", OTHER_OPTION_LABEL], "Custom", ["A", "B"]), ["A", "Custom"]);
  assert.deepEqual(normalizeAnswerSelection([OTHER_OPTION_LABEL], "  ", ["A", "B"]), []);
});

test("normalizeAnswerSelection drops stale incremental _other_ edits", () => {
  assert.deepEqual(
    normalizeAnswerSelection(["TypeScript", "t", "te", "tec", OTHER_OPTION_LABEL], "tech equipment", ["TypeScript", "Rust"]),
    ["TypeScript", "tech equipment"],
  );
});

test("summarizeAnswers formats unanswered and selected values", () => {
  const result = summarizeAnswers(
    [
      { question: "Which targets?", header: "Targets", options: [] },
      { question: "Need docs?", header: "Docs", options: [], multiple: true },
    ],
    [["iOS"], ["API", "CLI"]],
  );

  assert.equal(result, '"Which targets?"="iOS", "Need docs?"="API, CLI"');
});

test("replaceAnswerSelection mutates the same Set instance in place", () => {
  const selected = new Set<string>();
  const reference = selected;

  replaceAnswerSelection(selected, [], "", ["Alpha", "Beta"]);
  selected.add("Alpha");
  replaceAnswerSelection(selected, Array.from(selected), "", ["Alpha", "Beta"]);

  assert.equal(selected, reference);
  assert.deepEqual(Array.from(selected), ["Alpha"]);
});

test("replaceAnswerSelection keeps custom sentinel while returning final custom text", () => {
  const selected = new Set<string>([OTHER_OPTION_LABEL]);

  replaceAnswerSelection(selected, Array.from(selected), "hello", ["Alpha", "Beta"]);

  assert.deepEqual(Array.from(selected), ["hello", OTHER_OPTION_LABEL]);
});

// --- Edge cases for normalizeAnswerSelection ---

test("normalizeAnswerSelection returns empty for empty values and empty custom", () => {
  assert.deepEqual(normalizeAnswerSelection([], "", ["A", "B"]), []);
});

test("normalizeAnswerSelection returns empty for only sentinel and empty custom", () => {
  assert.deepEqual(normalizeAnswerSelection([OTHER_OPTION_LABEL], "", ["A", "B"]), []);
});

test("normalizeAnswerSelection deduplicates custom matching a predefined option", () => {
  // custom text happens to match a predefined label already selected
  assert.deepEqual(normalizeAnswerSelection(["Alpha", OTHER_OPTION_LABEL], "Alpha", ["Alpha", "Beta"]), ["Alpha"]);
});

test("normalizeAnswerSelection custom only (no predefined selected)", () => {
  assert.deepEqual(normalizeAnswerSelection([OTHER_OPTION_LABEL], "my answer", ["X", "Y"]), ["my answer"]);
});

test("normalizeAnswerSelection ignores values not in predefined options", () => {
  assert.deepEqual(normalizeAnswerSelection(["Ghost", "A"], "", ["A", "B"]), ["A"]);
});

test("normalizeAnswerSelection with empty predefined options list", () => {
  // all predefined values get filtered, only custom survives
  assert.deepEqual(normalizeAnswerSelection(["A", OTHER_OPTION_LABEL], "custom", []), ["custom"]);
  assert.deepEqual(normalizeAnswerSelection(["A"], "", []), []);
});

// --- Edge cases for normalizeQuestions ---

test("normalizeQuestions strips undefined description to undefined", () => {
  const [q] = normalizeQuestions([
    { question: "Q", header: "H", options: [{ label: "L" }] },
  ]);
  assert.deepEqual(q.options, [{ label: "L", description: undefined }]);
});

test("normalizeQuestions handles empty options array", () => {
  const [q] = normalizeQuestions([
    { question: "Q", header: "H", options: [] },
  ]);
  assert.deepEqual(q.options, []);
});

// --- Edge cases for summarizeAnswers ---

test("summarizeAnswers shows Unanswered for missing answer entries", () => {
  const result = summarizeAnswers(
    [{ question: "Q1", header: "H1", options: [] }],
    [], // no answers at all
  );
  assert.equal(result, '"Q1"="Unanswered"');
});

test("summarizeAnswers shows Unanswered for empty answer array", () => {
  const result = summarizeAnswers(
    [{ question: "Q1", header: "H1", options: [] }],
    [[]], // answer entry exists but empty
  );
  assert.equal(result, '"Q1"="Unanswered"');
});

test("summarizeAnswers handles single answer", () => {
  const result = summarizeAnswers(
    [{ question: "Color?", header: "Color", options: [] }],
    [["Blue"]],
  );
  assert.equal(result, '"Color?"="Blue"');
});

// --- Edge cases for replaceAnswerSelection ---

test("replaceAnswerSelection clears stale values when custom is removed", () => {
  const selected = new Set<string>(["old-custom", OTHER_OPTION_LABEL]);

  replaceAnswerSelection(selected, selected, "", ["Alpha", "Beta"]);

  // old-custom is not predefined and custom is empty, so set should be empty
  assert.deepEqual(Array.from(selected), []);
});

test("replaceAnswerSelection preserves predefined + custom together", () => {
  const selected = new Set<string>(["Alpha", OTHER_OPTION_LABEL]);

  replaceAnswerSelection(selected, selected, "extra", ["Alpha", "Beta"]);

  assert.deepEqual(Array.from(selected), ["Alpha", "extra", OTHER_OPTION_LABEL]);
});
