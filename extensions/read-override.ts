/**
 * Read tool override — transparent box, collapsed shows only path.
 *
 * Delegates execution and expanded rendering to the built-in read tool.
 */

import { type ExtensionAPI, createReadToolDefinition } from "@mariozechner/pi-coding-agent"
import { Text } from "@mariozechner/pi-tui"

export default function(pi: ExtensionAPI) {
  const builtIn = createReadToolDefinition(process.cwd())

  pi.registerTool({
    ...builtIn,
    style: {
      paddingX: 1,
      paddingY: 0,
      pendingBg: null,
      successBg: null,
      errorBg: null,
    },

    renderResult(result, options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0)

      if (context.isError) {
        const first = result.content.find((c) => c.type === "text")
        const msg = first?.type === "text" ? first.text : "Failed"
        text.setText(theme.fg("error", msg))
        return text
      }

      if (!options.expanded) {
        // Collapsed: renderCall already shows the path — only show truncation warning if needed
        const details = (result as any).details
        const truncation = details?.truncation
        if (truncation?.truncated) {
          text.setText(theme.fg("warning", "[truncated]"))
        } else {
          text.setText("")
        }
        return text
      }

      // Expanded: delegate to built-in rendering
      return builtIn.renderResult!(result, options, theme, context)
    },
  })
}
