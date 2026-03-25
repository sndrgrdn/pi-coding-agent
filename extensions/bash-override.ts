/**
 * Enhanced Bash Tool — overrides built-in bash with workdir + description params.
 *
 * Ported from opencode's bash tool (bash.ts + bash.txt).
 * Uses pi's built-in bash execution and rendering under the hood.
 */

import {
  type ExtensionAPI,
  createBashToolDefinition,
  createLocalBashOperations,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const extendedBashSchema = Type.Object({
  command: Type.String({ description: "The command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Optional timeout in seconds" })),
  workdir: Type.Optional(
    Type.String({
      description:
        "The working directory to run the command in. Defaults to the current project directory. Use this instead of 'cd' commands.",
    }),
  ),
  description: Type.String({
    description:
      "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
  }),
});

// Full tool description ported from opencode bash.txt, adapted for pi.
const DESCRIPTION = `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

All commands run in the current working directory by default. Use the \`workdir\` parameter if you need to run a command in a different directory. AVOID using \`cd <directory> && <command>\` patterns - use \`workdir\` instead.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`ls\` to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use \`ls foo\` to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., rm "path with spaces/file.txt")
   - Examples of proper quoting:
     - mkdir "/Users/name/My Documents" (correct)
     - mkdir /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in seconds.
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds 2000 lines or 50KB, it will be truncated and the full output will be written to a file. You can use Read with offset/limit to read specific sections or Grep to search the full content. Do NOT use \`head\`, \`tail\`, or other truncation commands to limit output; the full output will already be captured to a file for more precise searching.

  - Avoid using Bash with the \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
    - Communication: Output text directly (NOT echo/printf)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
    - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., \`git add . && git commit -m "message" && git push\`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.
    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - AVOID using \`cd <directory> && <command>\`. Use the \`workdir\` parameter to change directories instead.
    <good-example>
    Use workdir="/foo/bar" with command: pytest tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>
`;

export default function (pi: ExtensionAPI) {
  const ops = createLocalBashOperations();

  pi.registerTool({
    name: "bash",
    label: "Bash",
    description: DESCRIPTION,
    promptSnippet: "Execute bash commands with optional workdir and description",
    parameters: extendedBashSchema,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const effectiveCwd = params.workdir || ctx.cwd;
      const bashDef = createBashToolDefinition(effectiveCwd, { operations: ops });
      return bashDef.execute(
        toolCallId,
        { command: params.command, timeout: params.timeout },
        signal,
        onUpdate,
        ctx,
      );
    },

    renderCall(args: any, theme: any, context: any) {
      const state = context.state;
      if (context.executionStarted && state.startedAt === undefined) {
        state.startedAt = Date.now();
        state.endedAt = undefined;
      }

      const text = context.lastComponent ?? new Text("", 0, 0);
      const command = args?.command;
      const commandDisplay = command ? command : theme.fg("toolOutput", "...");

      let line = theme.fg("toolTitle", theme.bold(`$ ${commandDisplay}`));
      if (args?.timeout) line += theme.fg("muted", ` (timeout ${args.timeout}s)`);
      if (args?.workdir) line += theme.fg("muted", ` in ${args.workdir}`);

      if (args?.description) {
        line = theme.fg("muted", `# ${args.description}`) + "\n" + line;
      }

      text.setText(line);
      return text;
    },

    // renderResult omitted → falls back to built-in bash rendering
    // (streaming output, truncation warnings, timing display)
  });
}
