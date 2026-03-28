import type { ToolDefinition } from "@mariozechner/pi-coding-agent"
import { Text } from "@mariozechner/pi-tui"
import { Type } from "@sinclair/typebox"
import { normalizeQuestions, summarizeAnswers } from "./helpers.ts"
import { createQuestionPromptComponent } from "./question-ui.ts"
import {
  OTHER_OPTION_DISPLAY_LABEL,
  type QuestionInput,
  type QuestionResultDetails,
} from "./types.ts"

const OptionSchema = Type.Object({
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(Type.String({ description: "Optional explanation for this option" })),
})

const QuestionSchema = Type.Object({
  question: Type.String({ description: "Complete question to ask the user" }),
  header: Type.String({ description: "Short label for progress tabs" }),
  options: Type.Array(OptionSchema, { description: "Available predefined options" }),
  multiple: Type.Optional(
    Type.Boolean({ description: "Allow selecting multiple answers for this question" }),
  ),
})

const QuestionParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    description:
      "Questions to ask. Questions are single-select by default and support a custom answer; set multiple=true to allow selecting more than one option.",
    minItems: 1,
  }),
})

export function createQuestionTool(): ToolDefinition<typeof QuestionParams, QuestionResultDetails> {
  return {
    name: "question",
    label: "Question",
    description:
      "Ask the user one or more questions. Questions are single-select by default, support a type-your-own-answer option, and can allow multiple selections when multiple=true. Use this to clarify requirements or gather choices during execution.",
    promptSnippet:
      "Ask one or more user questions with single-select by default, optional multiple selection, and a type-your-own-answer option.",
    promptGuidelines: [
      "Use this tool when you need clarification, preferences, or implementation choices from the user.",
      "Questions are single-select by default; set multiple=true only when the user should choose more than one option.",
      "Every question supports entering a custom answer; do not simulate user answers yourself.",
    ],
    parameters: QuestionParams,
    style: {
      paddingX: 1,
      paddingY: 0,
      pendingBg: null,
      successBg: null,
      errorBg: null,
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        const details: QuestionResultDetails = {
          cancelled: true,
          questions: params.questions.map((question) => ({
            question: question.question,
            header: question.header,
            options: [
              ...question.options.map((option) => option.label),
              OTHER_OPTION_DISPLAY_LABEL,
            ],
            multiple: question.multiple === true,
          })),
          answers: [],
        }
        return {
          content: [{ type: "text", text: "Error: question requires interactive UI mode" }],
          details,
        }
      }

      const questions = normalizeQuestions(params.questions as QuestionInput[])
      const result = await ctx.ui.custom<{ cancelled: boolean; answers: string[][] }>(
        (tui, theme, _kb, done) =>
          createQuestionPromptComponent({ tui, theme, questions, onDone: done }),
      )

      const details: QuestionResultDetails = {
        cancelled: result.cancelled,
        questions: questions.map((question) => ({
          question: question.question,
          header: question.header,
          options: [...question.options.map((option) => option.label), OTHER_OPTION_DISPLAY_LABEL],
          multiple: question.multiple,
        })),
        answers: result.answers,
      }

      if (result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled the question prompt." }],
          details,
        }
      }

      const summary = summarizeAnswers(questions, result.answers)
      return {
        content: [{ type: "text", text: `User answered: ${summary}` }],
        details,
      }
    },
    renderCall(args, theme) {
      const count = Array.isArray(args.questions) ? args.questions.length : 0
      return new Text(
        theme.fg("toolTitle", theme.bold("question ")) +
          theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`),
        0,
        0,
      )
    },
    renderResult(result, _options, theme, context) {
      if (context.isError) {
        const msg = result.content.find((c: any) => c.type === "text")?.text || "Failed"
        return new Text(theme.fg("error", msg), 0, 0)
      }
      const details = result.details as QuestionResultDetails | undefined
      if (!details) {
        const part = result.content.find((item) => item.type === "text")
        return new Text(part?.type === "text" ? part.text : "", 0, 0)
      }
      if (details.cancelled) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0)
      }
      const lines = details.questions.map((question, index) => {
        const answers = details.answers[index] ?? []
        const value = answers.length > 0 ? answers.join(", ") : "Unanswered"
        return `${theme.fg("accent", question.header)}: ${theme.fg("muted", value)}`
      })
      return new Text(lines.join("\n"), 0, 0)
    },
  }
}
