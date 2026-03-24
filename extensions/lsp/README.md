# lsp

Pi extension that provides Language Server Protocol (LSP) integration for diagnostics and formatting. Automatically runs diagnostics and formatting after `edit`/`write` tool calls, and exposes a `diagnostics` tool for on-demand checks.

## Tool

### `diagnostics`

Parameters:

- `path` — file path to check (relative to cwd)

Behavior:

- resolves the file against the current working directory
- looks up the matching LSP server from config based on file extension
- starts the server lazily on first use, reuses running instances
- returns all diagnostics (errors, warnings, info, hints) with line/column, severity, and source
- returns a message when no LSP server is configured for the file type

## Auto-injection

After every `edit` or `write` tool call, the extension automatically:

1. **Formats** the file via LSP if `format: true` for that language
2. **Fetches diagnostics** and appends errors/warnings to the tool result if `diagnostics: true`

Only errors and warnings are shown in auto-injection. The `diagnostics` tool shows all severities.

## Configuration

LSP servers are configured in JSON files. Two levels are merged (project overrides global per-language):

- **Global**: `~/.pi/agent/lsp.json`
- **Project**: `<project-root>/.pi/lsp.json`

### Adding a new language

1. Install the LSP server binary and ensure it's on `$PATH` (shims from mise/nvm/rbenv work — the extension resolves commands via login shell)
2. Add an entry to `~/.pi/agent/lsp.json` (global) or `<project>/.pi/lsp.json` (project-only)
3. The server starts automatically on first file access — no restart needed

Entry format — each top-level key is a language name:

```json
{
  "python": {
    "command": "pylsp",
    "args": [],
    "extensions": [".py"],
    "rootMarkers": ["pyproject.toml", "setup.py"],
    "format": true,
    "diagnostics": true,
    "languageIds": {
      ".py": "python"
    }
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | `string` | yes | LSP server binary name or absolute path |
| `args` | `string[]` | yes | CLI arguments (most servers need `["--stdio"]`) |
| `extensions` | `string[]` | yes | File extensions this server handles, including the dot |
| `rootMarkers` | `string[]` | no | Files that identify a project root (e.g. `["Gemfile"]`). Walks up from the file to find the nearest match. Falls back to cwd |
| `format` | `boolean` | yes | Enable auto-formatting via LSP after edit/write |
| `diagnostics` | `boolean` | yes | Enable diagnostics via LSP |
| `enabled` | `boolean` | no | Set to `false` to disable without removing the entry. Default: `true` |
| `languageIds` | `Record<string, string>` | no | Maps file extension to LSP `languageId` string. Falls back to extension without dot (e.g. `.py` → `"py"`) |
| `env` | `Record<string, string>` | no | Extra environment variables merged into the server's spawn environment |
| `initOptions` | `Record<string, unknown>` | no | Passed as `initializationOptions` during the LSP `initialize` handshake |

### languageIds

The LSP protocol requires a `languageId` string when opening documents via `textDocument/didOpen`. This doesn't always match the file extension:

| Extension | Correct languageId | Without config |
|-----------|-------------------|----------------|
| `.tsx` | `typescriptreact` | `tsx` ✗ |
| `.jsx` | `javascriptreact` | `jsx` ✗ |
| `.rb` | `ruby` | `rb` ✗ |
| `.py` | `python` | `py` ✗ |
| `.go` | `go` | `go` ✓ |
| `.rs` | `rust` | `rs` ✗ |
| `.erb` | `erb` | `erb` ✓ |

When the fallback (`extension without dot`) doesn't produce the correct value, add a `languageIds` entry. Some LSP servers are lenient, but many reject documents with wrong languageIds.

### Compound extensions

Extensions like `".html.erb"` are matched before simple extensions. This lets you route `.html.erb` files to a different server than plain `.html` files:

```json
{
  "erb": {
    "command": "herb-language-server",
    "args": ["--stdio"],
    "extensions": [".erb", ".html.erb"],
    "languageIds": { ".erb": "erb" }
  }
}
```

### Disabling a language

Set `enabled: false` to temporarily disable without removing:

```json
{
  "ruby": {
    "enabled": false,
    "command": "ruby-lsp",
    "args": [],
    "extensions": [".rb"]
  }
}
```

### Full example

Current `~/.pi/agent/lsp.json`:

```json
{
  "ruby": {
    "command": "ruby-lsp",
    "args": [],
    "extensions": [".rb"],
    "rootMarkers": ["Gemfile"],
    "format": true,
    "diagnostics": true,
    "languageIds": { ".rb": "ruby" }
  },
  "typescript": {
    "command": "typescript-language-server",
    "args": ["--stdio"],
    "extensions": [".ts", ".tsx", ".js", ".jsx"],
    "rootMarkers": ["tsconfig.json", "package.json"],
    "format": true,
    "diagnostics": true,
    "languageIds": {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".jsx": "javascriptreact"
    }
  },
  "erb": {
    "command": "herb-language-server",
    "args": ["--stdio"],
    "extensions": [".erb"],
    "rootMarkers": ["Gemfile"],
    "format": true,
    "diagnostics": true,
    "languageIds": { ".erb": "erb" }
  }
}
```

## Commands

### `/lsp`

Shows LSP extension status: configured languages, running servers, and recent debug logs.

## Architecture

- One `LspClient` instance per (language, project root) pair
- Clients start lazily on first file access and are reused across calls
- Clients shut down gracefully on `session_shutdown`
- Commands are resolved via login shell to pick up shims (mise, nvm, rbenv)
- Project root is detected by walking up from the file looking for `rootMarkers`
- Auto-injection hooks into `tool_result` for `edit` and `write` tools
- Format applies LSP `textDocument/formatting` edits directly to the file
- Diagnostics use `textDocument/publishDiagnostics` push notifications with a timeout

## Modifying functionality

The extension is a standard pi extension with npm dependencies (`vscode-jsonrpc`, `vscode-languageserver-protocol`).

### Key files

| File | Purpose |
|------|---------|
| `~/.pi/agent/extensions/lsp/index.ts` | Extension entry: event hooks, `diagnostics` tool, `/lsp` command |
| `~/.pi/agent/extensions/lsp/client.ts` | `LspClient` class: start, format, diagnostics, shutdown, command resolution |
| `~/.pi/agent/extensions/lsp/config.ts` | Config loading, file→language matching, languageId resolution, project root detection |
| `~/.pi/agent/lsp.json` | Global LSP server configuration |
| `~/.pi/agent/extensions/lsp/config.test.ts` | Tests for config, matching, languageId, project root |
| `~/.pi/agent/extensions/lsp/client.test.ts` | Tests for LspClient lifecycle |

### Common modifications

**Change formatting options** (tab size, spaces vs tabs): In `client.ts`, find `textDocument/formatting` request — modify `tabSize` and `insertSpaces`.

**Change diagnostic severity filter**: In `index.ts`, `formatDiagnostics` filters to severity ≤ 2 (errors + warnings) for auto-injection. The `diagnostics` tool shows all severities.

**Change diagnostic wait timeout**: In `index.ts`, `getDiagnostics` is called with a timeout in ms (2000 for auto-injection, 3000 for the tool). Increase if servers are slow to respond.

**Add LSP capabilities**: In `client.ts`, the `initialize` request sends minimal capabilities. Add to `textDocument` capabilities for features like code actions, hover, completion.

**Add new tool actions** (e.g. go-to-definition, hover): Add methods to `LspClient` following the pattern of `format` and `getDiagnostics`, then expose via new tools or tool parameters in `index.ts`.

### Running tests

```bash
cd ~/.pi/agent/extensions/lsp && bun test
```
