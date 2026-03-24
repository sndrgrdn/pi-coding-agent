# lsp

Pi extension that provides Language Server Protocol (LSP) integration for diagnostics and formatting. Automatically runs diagnostics and formatting after `edit`/`write` tool calls, and exposes a `diagnostics` tool for on-demand checks.

## Tool

### `diagnostics`

Parameters:

- `path` — file path to check (relative to cwd)

Behavior:

- resolves the file against the current working directory
- looks up all matching LSP servers based on file extension
- starts servers lazily on first use, reuses running instances
- returns all diagnostics (errors, warnings, info, hints) with line/column, severity, and source
- returns a message when no LSP server is configured for the file type

## Auto-injection

After every `edit` or `write` tool call, the extension automatically:

1. **Formats** the file via the first matching server that advertises `documentFormattingProvider`
2. **Fetches diagnostics** from all matching servers and appends errors/warnings to the tool result

Only errors and warnings are shown in auto-injection. The `diagnostics` tool shows all severities.

## Configuration

LSP servers are defined as named exports in `config.ts`. Export order determines formatter priority — the first server that is running and has formatting capability wins. If the preferred formatter isn't installed, the next capable server takes over automatically.

### Built-in servers

| Name | Command | Extensions | Root markers |
|------|---------|------------|-------------|
| `oxfmt` | `oxfmt --lsp` | `.ts` `.tsx` `.js` `.jsx` | `package.json` |
| `oxlint` | `oxlint --lsp` | `.ts` `.tsx` `.js` `.jsx` | `package.json` |
| `tsserver` | `typescript-language-server --stdio` | `.ts` `.tsx` `.js` `.jsx` | `tsconfig.json` `package.json` |
| `rubocop` | `bundle exec rubocop --lsp` | `.rb` | `Gemfile` |
| `herb` | `herb-language-server --stdio` | `.erb` | `Gemfile` |

### Adding a new server

1. Install the LSP server binary and ensure it's on `$PATH` (shims from mise/nvm/rbenv work — the extension resolves commands via login shell)
2. Add a named export to `config.ts` and include it in the `loadConfig()` return object
3. The server starts automatically on first file access — no restart needed

```typescript
export const python: ServerConfig = {
  command: "pylsp",
  extensions: [".py"],
  rootMarkers: ["pyproject.toml", "setup.py"],
};
```

### ServerConfig fields

| Field | Type | Description |
|-------|------|-------------|
| `command` | `string` | Full command string, split on spaces when spawning (e.g. `"pylsp"`, `"typescript-language-server --stdio"`) |
| `extensions` | `string[]` | File extensions this server handles, including the dot |
| `rootMarkers` | `string[]` | Files that identify a project root (e.g. `["Gemfile"]`). Walks up from the file to find the nearest match. Falls back to cwd |

### Capability detection

Formatting and diagnostics are auto-detected from the LSP server — no config flags needed:

- **Formatting**: Detected from `documentFormattingProvider` in the server's `initialize` response. First server in export order with this capability formats.
- **Diagnostics**: Detected by tracking `textDocument/publishDiagnostics` push notifications. Servers that have never pushed diagnostics get a short timeout (200ms) to avoid blocking. Known diagnostic servers get the full timeout (2s).

### LanguageIds

The LSP `languageId` is derived automatically from a built-in map. No per-server configuration needed:

| Extension | languageId |
|-----------|-----------|
| `.ts` | `typescript` |
| `.tsx` | `typescriptreact` |
| `.mts` `.cts` | `typescript` |
| `.js` | `javascript` |
| `.jsx` | `javascriptreact` |
| `.mjs` `.cjs` | `javascript` |
| `.rb` | `ruby` |
| `.erb` | `erb` |
| anything else | extension without dot (e.g. `.py` → `py`) |

### Compound extensions

Extensions like `.html.erb` are matched before simple extensions. This lets you route `.html.erb` files to a different server than plain `.html` files.

### Disabling a server

Remove or comment out the export in `config.ts` and remove it from the `loadConfig()` return object.

## Commands

### `/lsp`

Shows LSP extension status: configured servers, running instances, and recent debug logs.

## Architecture

- One `LspClient` instance per (server name, project root) pair
- Clients start lazily on first file access and are reused across calls
- Clients shut down gracefully on `session_shutdown`
- Commands are resolved via login shell to pick up shims (mise, nvm, rbenv)
- Project root is detected by walking up from the file looking for `rootMarkers`
- Auto-injection hooks into `tool_result` for `edit` and `write` tools
- Format applies LSP `textDocument/formatting` edits directly to the file
- Diagnostics use `textDocument/publishDiagnostics` push notifications with a timeout
- Server capabilities stored from `initialize` response for runtime feature detection

## Key files

| File | Purpose |
|------|---------|
| `config.ts` | Server definitions, file→server matching, languageId resolution, project root detection |
| `client.ts` | `LspClient` class: start, format, diagnostics, shutdown, capability detection, command resolution |
| `index.ts` | Extension entry: event hooks, `diagnostics` tool, `/lsp` command |
| `config.test.ts` | Tests for config, matching, languageId, project root |
| `client.test.ts` | Tests for LspClient lifecycle and capabilities |

## Common modifications

**Change formatting options** (tab size, spaces vs tabs): In `client.ts`, find `textDocument/formatting` request — modify `tabSize` and `insertSpaces`.

**Change diagnostic severity filter**: In `index.ts`, `formatDiagnostics` filters to severity ≤ 2 (errors + warnings) for auto-injection. The `diagnostics` tool shows all severities.

**Change diagnostic wait timeout**: In `index.ts`, `getDiagnostics` is called with a timeout in ms (200/2000 for auto-injection, 3000 for the tool). Increase if servers are slow to respond.

**Add LSP capabilities**: In `client.ts`, the `initialize` request sends minimal capabilities. Add to `textDocument` capabilities for features like code actions, hover, completion.

**Add new tool actions** (e.g. go-to-definition, hover): Add methods to `LspClient` following the pattern of `format` and `getDiagnostics`, then expose via new tools or tool parameters in `index.ts`.

### Running tests

```bash
cd ~/.pi/agent/extensions/lsp && bun test
```
