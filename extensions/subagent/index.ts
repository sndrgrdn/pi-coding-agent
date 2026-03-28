/**
 * Subagent extension.
 *
 * Provides a `subagent` tool that spawns agent definitions in isolated
 * subprocesses. Agent definitions (markdown + frontmatter) live in
 * ~/.pi/agent/agents/ (user) and .pi/agents/ (project).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { discoverAgents, findAgent } from "./agents.js";
import {
  type RunResult,
  type CallerDefaults,
  runAgent,
  getFinalOutput,
  getDisplayItems,
} from "./runner.js";
import { renderResult } from "./render.js";

interface SubagentDetails {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  result: RunResult | null;
}

const SubagentParams = Type.Object({
  agent: Type.String({
    description: "Name of the agent to invoke (matches filename in agents/ dir, e.g. 'explore')",
  }),
  task: Type.String({
    description: "Task to delegate — be specific about what the agent should do",
  }),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for the agent (default: current project root)",
    }),
  ),
});

/** Build the task tool description, dynamically listing discovered agents. */
export function buildTaskDescription(agents: { name: string; description?: string }[]): string {
  const agentList = agents
    .map((a) => `- ${a.name}: ${a.description ?? "No description."}`)
    .join("\n");

  return [
    "Launch a new agent to handle tasks autonomously in an isolated context window.",
    "",
    "Available agents:",
    agentList,
    "",
    "When to use the Task tool:",
    "- Complex multi-step tasks that benefit from focused context",
    "- Codebase exploration and research across many files",
    "- Parallel independent work units (launch multiple agents concurrently in a single message)",
    "- Code changes that can be done independently from the main conversation",
    "",
    "When NOT to use the Task tool:",
    "- Reading a specific file — use Read directly",
    "- Searching for a specific symbol or pattern in 2-3 files — use Grep or Read directly",
    "- Finding files by name — use Glob directly",
    "- Simple single-step tasks you can do faster yourself",
    "",
    "Usage notes:",
    "1. Launch multiple agents concurrently whenever possible; use a single message with multiple tool calls",
    "2. Each invocation starts with a fresh context. Your prompt should be a detailed, self-contained task description. Specify exactly what the agent should return in its final message.",
    "3. Clearly tell the agent whether you expect it to write code or just research, and how to verify its work (e.g., test commands).",
    "4. The agent's result is not visible to the user. Summarize it for them.",
    "5. The agent's outputs should generally be trusted.",
  ].join("\n");
}

export default function (pi: ExtensionAPI) {
  const taskDescription = buildTaskDescription(discoverAgents(process.cwd()));

  pi.registerTool({
    name: "task",
    label: "Task",
    description: taskDescription,
    promptSnippet:
      "Spin up a focused task with isolated context. Use task_list to see available agents.",
    promptGuidelines: [
      "Use task for any focused work: exploration, analysis, code changes, review, research, or multi-step tasks.",
      "Use task(agent='explore') for fast read-only codebase search — finding files, grepping patterns, understanding structure.",
      "Use task(agent='general') for tasks that need code changes, bash commands, or complex multi-step work.",
      "Launch multiple tasks in parallel when they're independent (e.g., exploring different parts of a codebase, or making changes to unrelated files).",
      "Tasks have their own context window — results are a compressed summary, not raw file contents.",
      "Be specific in the task description so the agent knows exactly what to investigate or produce.",
      "Clearly tell the agent whether you expect it to write code or just research, and how to verify its work (e.g., relevant test commands).",
      "The agent's result is not visible to the user — summarize the outcome for them.",
    ],
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agent = findAgent(ctx.cwd, params.agent);

      if (!agent) {
        const available = discoverAgents(ctx.cwd);
        const names = available.map((a) => `"${a.name}"`).join(", ") || "none";
        return {
          content: [
            { type: "text", text: `Unknown agent: "${params.agent}". Available: ${names}` },
          ],
          details: { agent: params.agent, agentSource: "unknown" as const, result: null },
        };
      }

      const cwd = params.cwd ?? ctx.cwd;

      const callerDefaults: CallerDefaults = {
        model: ctx.model?.id,
        thinking: pi.getThinkingLevel(),
      };

      const onProgress = (partial: RunResult) => {
        onUpdate?.({
          content: [{ type: "text", text: getFinalOutput(partial.messages) || "(running...)" }],
          details: { agent: agent.name, agentSource: agent.source, result: partial },
        });
      };

      const result = await runAgent(agent, params.task, cwd, signal, onProgress, callerDefaults);

      const isError =
        result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
      if (isError) {
        const errorMsg =
          result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
        return {
          content: [
            {
              type: "text",
              text: `Agent "${agent.name}" ${result.stopReason || "failed"}: ${errorMsg}`,
            },
          ],
          details: { agent: agent.name, agentSource: agent.source, result },
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
        details: { agent: agent.name, agentSource: agent.source, result },
      };
    },

    renderCall(args, theme) {
      let text =
        theme.fg("toolTitle", theme.bold("task ")) + theme.fg("accent", args.agent || "...");
      if (args.cwd) text += theme.fg("dim", ` in ${args.cwd}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial && !context.state?._timer) {
        if (!context.state) context.state = {};
        context.state._timer = setInterval(() => context.invalidate(), 300);
      }
      if (!isPartial && context.state?._timer) {
        clearInterval(context.state._timer);
        context.state._timer = null;
      }

      const details = result.details as SubagentDetails | undefined;
      const runResult = details?.result ?? null;

      if (!runResult) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }

      const displayItems = getDisplayItems(runResult.messages);
      return renderResult(runResult, displayItems, { expanded, isPartial }, theme);
    },
  });

  pi.registerTool({
    name: "task_list",
    label: "List Agents",
    description:
      "List all available task agent definitions from ~/.pi/agent/agents/ and .pi/agents/.",
    promptSnippet: "List available task agents.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const discovered = discoverAgents(ctx.cwd);

      if (discovered.length === 0) {
        return {
          content: [{ type: "text", text: "No agent definitions found." }],
          details: { agents: [] },
        };
      }

      const lines = discovered.map((a) => {
        const badge = a.source === "project" ? " (project)" : "";
        const desc = a.description ? ` — ${a.description}` : "";
        const model = a.model ? ` [${a.model}]` : "";
        const tools = a.tools ? ` tools: ${a.tools.join(", ")}` : "";
        return `• ${a.name}${badge}${model}${desc}${tools}`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { agents: discovered },
      };
    },

    renderResult(result, _opts, theme) {
      const details = result.details as any;
      const listed = details?.agents ?? [];
      if (listed.length === 0) {
        return new Text(theme.fg("dim", "No agent definitions found."), 0, 0);
      }
      const lines = listed.map((a: any) => {
        const badge = a.source === "project" ? theme.fg("accent", " (project)") : "";
        const desc = a.description ? theme.fg("dim", ` — ${a.description}`) : "";
        const model = a.model ? theme.fg("dim", ` [${a.model}]`) : "";
        return `  ${theme.fg("toolTitle", theme.bold(a.name))}${badge}${model}${desc}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
