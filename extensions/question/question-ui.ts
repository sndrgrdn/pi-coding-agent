import type { Theme } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth, type TUI, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { normalizeAnswerSelection, replaceAnswerSelection } from "./helpers.ts";
import {
  OTHER_OPTION_DISPLAY_LABEL,
  OTHER_OPTION_LABEL,
  type NormalizedQuestion,
} from "./types.ts";

interface QuestionPromptComponentInput {
  tui: TUI;
  theme: Theme;
  questions: NormalizedQuestion[];
  onDone(result: { cancelled: boolean; answers: string[][] }): void;
}

export function createQuestionPromptComponent(input: QuestionPromptComponentInput) {
  return new QuestionPromptComponent(input);
}

class QuestionPromptComponent {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly questions: NormalizedQuestion[];
  private readonly onDone: QuestionPromptComponentInput["onDone"];
  private readonly editor: Editor;
  private suppressEditorChange = false;
  private currentQuestionIndex = 0;
  private currentOptionIndex = 0;
  private editingOther = false;
  private readonly selected = new Map<number, Set<string>>();
  private readonly customValues = new Map<number, string>();
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor({ tui, theme, questions, onDone }: QuestionPromptComponentInput) {
    this.tui = tui;
    this.theme = theme;
    this.questions = questions;
    this.onDone = onDone;
    this.editor = new Editor(tui, this.getEditorTheme());
    this.editor.disableSubmit = true;
    this.editor.onChange = () => {
      if (this.suppressEditorChange) return;
      this.customValues.set(this.currentQuestionIndex, this.editor.getText());
      this.syncCurrentAnswers();
      this.refresh();
    };
  }

  private getEditorTheme(): EditorTheme {
    return {
      borderColor: (value) => this.theme.fg("accent", value),
      selectList: {
        selectedPrefix: (value) => this.theme.fg("accent", value),
        selectedText: (value) => this.theme.fg("accent", value),
        description: (value) => this.theme.fg("muted", value),
        scrollInfo: (value) => this.theme.fg("dim", value),
        noMatch: (value) => this.theme.fg("warning", value),
      },
    };
  }

  private getCurrentQuestion() {
    return this.questions[this.currentQuestionIndex];
  }

  private isCurrentQuestionMultiple() {
    return this.getCurrentQuestion().multiple === true;
  }

  private getOptionCount() {
    return this.getCurrentQuestion().options.length + 1;
  }

  private isOtherSelected(index: number) {
    return this.selected.get(index)?.has(OTHER_OPTION_LABEL) === true;
  }

  private getSelected(index: number) {
    let selected = this.selected.get(index);
    if (!selected) {
      selected = new Set<string>();
      this.selected.set(index, selected);
    }
    return selected;
  }

  private setEditorText(text: string) {
    this.suppressEditorChange = true;
    try {
      this.editor.setText(text);
    } finally {
      this.suppressEditorChange = false;
    }
  }

  private syncEditorForCurrentQuestion() {
    this.setEditorText(this.customValues.get(this.currentQuestionIndex) ?? "");
  }

  private syncCurrentAnswers() {
    const selected = this.getSelected(this.currentQuestionIndex);
    const custom = this.customValues.get(this.currentQuestionIndex) ?? "";
    const predefinedOptions = this.getCurrentQuestion().options.map((option) => option.label);
    replaceAnswerSelection(selected, selected, custom, predefinedOptions);
  }

  private toggleCurrentOption(): "toggled" | "editing-other" {
    const selected = this.getSelected(this.currentQuestionIndex);
    const question = this.getCurrentQuestion();
    const otherIndex = question.options.length;
    const multiple = this.isCurrentQuestionMultiple();

    if (this.currentOptionIndex === otherIndex) {
      if (selected.has(OTHER_OPTION_LABEL)) {
        selected.delete(OTHER_OPTION_LABEL);
        this.customValues.set(this.currentQuestionIndex, "");
        this.setEditorText("");
        this.editingOther = false;
      } else {
        if (!multiple) {
          selected.clear();
        }
        selected.add(OTHER_OPTION_LABEL);
        this.editingOther = true;
        this.syncEditorForCurrentQuestion();
      }
      this.syncCurrentAnswers();
      return this.editingOther ? "editing-other" : "toggled";
    }

    const label = question.options[this.currentOptionIndex]?.label;
    if (!label) return "toggled";

    if (multiple) {
      if (selected.has(label)) selected.delete(label);
      else selected.add(label);
    } else {
      selected.clear();
      this.customValues.set(this.currentQuestionIndex, "");
      this.setEditorText("");
      selected.add(label);
    }
    this.editingOther = false;
    this.syncCurrentAnswers();
    return "toggled";
  }

  private collectAnswers(): string[][] {
    return this.questions.map((question, index) => {
      const selected = this.getSelected(index);
      const custom = this.customValues.get(index) ?? "";
      return normalizeAnswerSelection(
        Array.from(selected),
        custom,
        question.options.map((option) => option.label),
      );
    });
  }

  private finish(cancelled: boolean) {
    if (!cancelled) this.syncCurrentAnswers();
    this.onDone({ cancelled, answers: this.collectAnswers() });
  }

  private advanceOrSubmit() {
    if (this.currentQuestionIndex >= this.questions.length - 1) {
      this.finish(false);
      return;
    }
    this.moveQuestion(1);
  }

  private moveQuestion(direction: -1 | 1) {
    const next = this.currentQuestionIndex + direction;
    if (next < 0 || next >= this.questions.length) return;
    this.syncCurrentAnswers();
    this.currentQuestionIndex = next;
    this.currentOptionIndex = 0;
    this.editingOther = false;
    this.syncEditorForCurrentQuestion();
  }

  private refresh() {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.tui.requestRender();
  }

  handleInput(data: string) {
    if (this.editingOther) {
      if (matchesKey(data, Key.escape)) {
        this.editingOther = false;
        this.syncCurrentAnswers();
        this.refresh();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        this.editingOther = false;
        this.syncCurrentAnswers();
        this.advanceOrSubmit();
        this.refresh();
        return;
      }
      if (matchesKey(data, Key.tab)) {
        this.editingOther = false;
        this.moveQuestion(1);
        this.refresh();
        return;
      }
      if (matchesKey(data, Key.shift("tab"))) {
        this.editingOther = false;
        this.moveQuestion(-1);
        this.refresh();
        return;
      }
      if (matchesKey(data, Key.ctrl("s"))) {
        this.editingOther = false;
        this.finish(false);
        return;
      }
      this.editor.handleInput(data);
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.finish(true);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.currentOptionIndex = Math.max(0, this.currentOptionIndex - 1);
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.currentOptionIndex = Math.min(this.getOptionCount() - 1, this.currentOptionIndex + 1);
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      this.moveQuestion(1);
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
      this.moveQuestion(-1);
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const result = this.toggleCurrentOption();
      if (!this.isCurrentQuestionMultiple() && result !== "editing-other") {
        this.advanceOrSubmit();
      }
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.ctrl("s"))) {
      this.finish(false);
      return;
    }
  }

  invalidate() {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const lines: string[] = [];
    const question = this.getCurrentQuestion();
    const contentWidth = Math.max(40, width - 2);
    const multiple = this.isCurrentQuestionMultiple();
    const add = (value = "") => lines.push(truncateToWidth(value, contentWidth));

    const progress = this.questions
      .map((item, index) => {
        const isActive = index === this.currentQuestionIndex;
        const answered = this.collectAnswers()[index]?.length > 0;
        const bullet = answered ? "■" : "□";
        const label = ` ${bullet} ${item.header} `;
        return isActive
          ? this.theme.bg("selectedBg", this.theme.fg("text", label))
          : this.theme.fg(answered ? "success" : "muted", label);
      })
      .join(" ");

    // Wrap text, prefixing continuation lines with `prefix`.
    const wrap = (text: string, prefix = "") => {
      const wrapWidth = Math.max(20, contentWidth - prefix.length);
      for (const line of wrapTextWithAnsi(text, wrapWidth)) {
        lines.push(prefix + line);
      }
    };
    // Wrap text, but only indent continuation lines (first line is already prefixed).
    const wrapHanging = (text: string, hangIndent: string) => {
      const wrapped = wrapTextWithAnsi(text, contentWidth);
      for (let i = 0; i < wrapped.length; i++) {
        lines.push(i === 0 ? wrapped[i] : hangIndent + wrapped[i]);
      }
    };

    add(progress);
    add();
    wrap(this.theme.bold(question.question));
    add();

    // multi: "▶ ✔ " = 4 chars indent; single: "▶ 1. " = 5 chars indent
    const indent = multiple ? "    " : "     ";

    question.options.forEach((option: NormalizedQuestion["options"][number], index: number) => {
      const selected = this.getSelected(this.currentQuestionIndex).has(option.label);
      const active = this.currentOptionIndex === index;
      wrapHanging(this.renderOptionLine(option.label, index, active, selected, multiple), indent);
      if (option.description) {
        wrap(this.theme.fg("muted", option.description), indent);
      }
    });

    const otherIndex = question.options.length;
    const otherSelected = this.isOtherSelected(this.currentQuestionIndex);
    const otherActive = this.currentOptionIndex === otherIndex;
    const otherDisplayLabel = this.theme.italic(OTHER_OPTION_DISPLAY_LABEL);
    wrapHanging(this.renderOptionLine(otherDisplayLabel, otherIndex, otherActive, otherSelected, multiple), indent);

    const customValue = this.customValues.get(this.currentQuestionIndex)?.trim() ?? "";
    if (otherSelected || this.editingOther) {
      add(`${indent}${this.theme.fg("muted", "Custom answer:")}`);
      if (this.editingOther) {
        for (const line of this.renderEditor(contentWidth, indent)) add(line);
      } else {
        add(`${indent}${customValue || this.theme.fg("dim", "(empty)")}`);
      }
    }

    add();
    const key = (value: string) => this.theme.fg("accent", value);
    const action = (value: string) => this.theme.fg("muted", value);
    const divider = this.theme.fg("dim", "·");
    add(
      [
        key("⇆"),
        action("tab"),
        divider,
        key("↑↓"),
        action("select"),
        divider,
        key("enter"),
        action(multiple ? "toggle" : "confirm"),
        divider,
        key("ctrl+s"),
        action("submit"),
        divider,
        key("esc"),
        action("dismiss"),
      ].join(" "),
    );
    if (this.editingOther) {
      add(
        this.theme.fg(
          "dim",
          `Editing ${this.theme.italic(OTHER_OPTION_DISPLAY_LABEL)}: type freely, Enter accepts, Esc stops editing.`,
        ),
      );
    }
    add();

    this.cachedWidth = width;
    this.cachedLines = lines.map((line) => line + " ".repeat(Math.max(0, width - visibleWidth(line))));
    return this.cachedLines;
  }

  private renderOptionLine(label: string, index: number, active: boolean, selected: boolean, multiple: boolean): string {
    const prefix = active ? this.theme.fg("accent", "▶") : " ";
    const styledLabel = active ? this.theme.fg("accent", label) : label;
    if (multiple) {
      const check = selected ? this.theme.fg("success", "✔") : this.theme.fg("muted", "○");
      return `${prefix} ${check} ${styledLabel}`;
    }
    const number = `${index + 1}.`;
    if (selected) {
      return `${prefix} ${this.theme.fg("success", number)} ${this.theme.fg("success", label)}`;
    }
    return `${prefix} ${this.theme.fg(active ? "accent" : "muted", number)} ${styledLabel}`;
  }

  private renderEditor(width: number, indent: string): string[] {
    const editorWidth = Math.max(20, width - indent.length - 1);
    const rendered = this.editor.render(editorWidth);
    return rendered.map((line) => `${indent}${line}`);
  }
}
