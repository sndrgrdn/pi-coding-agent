import { OTHER_OPTION_LABEL, type QuestionInput, type NormalizedQuestion } from "./types.ts"

export function normalizeQuestions(input: QuestionInput[]): NormalizedQuestion[] {
  return input.map((question) => ({
    question: question.question.trim(),
    header: question.header.trim(),
    multiple: question.multiple === true,
    options: question.options.map((option) => ({
      label: option.label.trim(),
      description: option.description?.trim() || undefined,
    })),
  }))
}

export function summarizeAnswers(questions: QuestionInput[], answers: string[][]): string {
  return questions
    .map((question, index) => {
      const selections = answers[index] ?? []
      const value = selections.length > 0 ? selections.join(", ") : "Unanswered"
      return `${JSON.stringify(question.question)}=${JSON.stringify(value)}`
    })
    .join(", ")
}

export function normalizeAnswerSelection(
  values: string[],
  customValue: string,
  predefinedOptions: string[],
): string[] {
  const trimmedCustom = customValue.trim()
  const predefined = new Set(predefinedOptions)
  const base = values.filter((value) => value !== OTHER_OPTION_LABEL && predefined.has(value))
  if (!trimmedCustom) return base
  if (base.includes(trimmedCustom)) return base
  return [...base, trimmedCustom]
}

export function replaceAnswerSelection(
  target: Set<string>,
  values: Iterable<string>,
  customValue: string,
  predefinedOptions: string[],
): void {
  const normalized = normalizeAnswerSelection(Array.from(values), customValue, predefinedOptions)
  target.clear()
  for (const value of normalized) target.add(value)
  if (customValue.trim().length > 0) {
    target.add(OTHER_OPTION_LABEL)
  }
}
