#!/usr/bin/env node
// Minimal LSP server for testing. Responds to initialize, then handles shutdown/exit.
// Also exits if it receives a special "test/kill" notification (to simulate sudden death).

const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = require("vscode-jsonrpc/node");

const reader = new StreamMessageReader(process.stdin);
const writer = new StreamMessageWriter(process.stdout);
const conn = createMessageConnection(reader, writer);

conn.onRequest("initialize", (_params) => {
  return {
    capabilities: {
      textDocumentSync: 1,
      documentFormattingProvider: false,
    },
  };
});

conn.onNotification("initialized", () => { });

conn.onNotification("textDocument/didOpen", () => { });
conn.onNotification("textDocument/didChange", () => { });

// Publish empty diagnostics on didOpen/didChange
conn.onNotification("textDocument/didOpen", (params) => {
  conn.sendNotification("textDocument/publishDiagnostics", {
    uri: params.textDocument.uri,
    diagnostics: [],
  });
});

conn.onRequest("shutdown", () => null);
conn.onNotification("exit", () => {
  process.exit(0);
});

// Special: simulate abrupt death
conn.onNotification("test/kill", () => {
  process.exit(1);
});

conn.listen();
