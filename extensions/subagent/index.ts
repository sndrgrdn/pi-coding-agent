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
import { type RunResult, runAgent, getFinalOutput, getDisplayItems } from "./runner.js";
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

export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "task",
    label: "Task",
    description:
      "Spin up an isolated task with its own context window, tools, and model. " +
      "Use for any focused work: codebase exploration, analysis, review, research, or gathering context before making changes. " +
      "Tasks run in parallel when independent. " +
      "Agent definitions live in ~/.pi/agent/agents/*.md (use task_list to discover them). " +
      'Example: use the "explore" agent to understand a codebase area before making changes.',
    promptSnippet:
      "Spin up a focused task with isolated context. Use task_list to see available agents.",
    promptGuidelines: [
      "Use task for any focused work: exploration, analysis, review, research, or gathering context.",
      "Default to task(agent='explore') for understanding code before making changes — don't manually read dozens of files.",
      "Tasks have their own context window — results are a compressed summary, not raw file contents.",
      "Be specific in the task description so the agent knows exactly what to investigate or produce.",
      "Launch multiple tasks in parallel when they're independent (e.g., exploring different parts of a codebase).",
    ],
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agent = findAgent(ctx.cwd, params.agent);

      if (!agent) {
        const available = discoverAgents(ctx.cwd);
        const names = available.map((a) => `"${a.name}"`).join(", ") || "none";
        return {
          content: [{ type: "text", text: `Unknown agent: "${params.agent}". Available: ${names}` }],
          details: { agent: params.agent, agentSource: "unknown" as const, result: null },
        };
      }

      const cwd = params.cwd ?? ctx.cwd;

      const onProgress = (partial: RunResult) => {
        onUpdate?.({
          content: [{ type: "text", text: getFinalOutput(partial.messages) || "(running...)" }],
          details: { agent: agent.name, agentSource: agent.source, result: partial },
        });
      };

      const result = await runAgent(agent, params.task, cwd, signal, onProgress);

      const isError = result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
      if (isError) {
        const errorMsg = result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
        return {
          content: [{ type: "text", text: `Agent "${agent.name}" ${result.stopReason || "failed"}: ${errorMsg}` }],
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
      let text = theme.fg("toolTitle", theme.bold("task ")) + theme.fg("accent", args.agent || "...");
      if (args.cwd) text += theme.fg("dim", ` in ${args.cwd}`);
      if (args.task) {
        const preview = args.task.length > 80 ? `${args.task.slice(0, 80)}...` : args.task;
        text += `\n  ${theme.fg("dim", preview)}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as SubagentDetails | undefined;
      const runResult = details?.result ?? null;

      if (!runResult) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }

      const displayItems = getDisplayItems(runResult.messages);
      const finalOutput = getFinalOutput(runResult.messages);
      return renderResult(runResult, displayItems, finalOutput, { expanded, isPartial }, theme);
    },
  });

  pi.registerTool({
    name: "task_list",
    label: "List Agents",
    description: "List all available task agent definitions from ~/.pi/agent/agents/ and .pi/agents/.",
    promptSnippet: "List available task agents.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const agents = discoverAgents(ctx.cwd);

      if (agents.length === 0) {
        return {
          content: [{ type: "text", text: "No agent definitions found." }],
          details: { agents: [] },
        };
      }

      const lines = agents.map((a) => {
        const badge = a.source === "project" ? " (project)" : "";
        const desc = a.description ? ` — ${a.description}` : "";
        const model = a.model ? ` [${a.model}]` : "";
        const tools = a.tools ? ` tools: ${a.tools.join(", ")}` : "";
        return `• ${a.name}${badge}${model}${desc}${tools}`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { agents },
      };
    },

    renderResult(result, _opts, theme) {
      const details = result.details as any;
      const agents = details?.agents ?? [];
      if (agents.length === 0) {
        return new Text(theme.fg("dim", "No agent definitions found."), 0, 0);
      }
      const lines = agents.map((a: any) => {
        const badge = a.source === "project" ? theme.fg("accent", " (project)") : "";
        const desc = a.description ? theme.fg("dim", ` — ${a.description}`) : "";
        const model = a.model ? theme.fg("dim", ` [${a.model}]`) : "";
        return `  ${theme.fg("toolTitle", theme.bold(a.name))}${badge}${model}${desc}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
