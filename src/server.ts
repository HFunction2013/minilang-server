#!/usr/bin/env node
/**
 * minilang-server — a Language Server Protocol implementation for minilang.
 *
 * It shells out to the real `minilang` toolchain (built from minilang-boot) to
 * produce diagnostics, and serves hover / completion from the builtin + syslib
 * metadata. Talks LSP over stdio; the VS Code extension (minilang-vscode) is
 * the client.
 */
import {
  createConnection,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  Hover,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  InitializeResult,
  InitializeParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findDoc, allCompletions } from './builtins';

const connection = createConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
const documents = new TextDocuments(TextDocument);

let minilangPath = 'minilang';
let workspaceFolder: string | undefined;

// Parse the toolchain's error output into LSP diagnostics.
//   Parse error line 12: unexpected token
//   Parse error line 7: expected 'func'...
//   Compile error: undefined function 'foo'
const PARSE_LINE_RE = /Parse error line (\d+):\s*(.*)/g;
const COMPILE_RE = /Compile error:?\s*(.*)/g;

function toDiagnostics(uri: string, stderr: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const doc = documents.get(uri);
  if (!doc) return diags;

  let m: RegExpExecArray | null;
  PARSE_LINE_RE.lastIndex = 0;
  while ((m = PARSE_LINE_RE.exec(stderr))) {
    const line = Math.max(0, Number(m[1]) - 1);
    diags.push({
      severity: DiagnosticSeverity.Error,
      range: { start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } },
      message: m[2].trim(),
      source: 'minilang',
    });
  }
  COMPILE_RE.lastIndex = 0;
  while ((m = COMPILE_RE.exec(stderr))) {
    diags.push({
      severity: DiagnosticSeverity.Error,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: Number.MAX_SAFE_INTEGER } },
      message: m[1].trim(),
      source: 'minilang',
    });
  }
  return diags;
}

function validate(textDocument: TextDocument): void {
  const uri = textDocument.uri;
  const text = textDocument.getText();

  // Stage the buffer next to the source file so `require` / syslib resolution
  // behaves the same as on disk.
  let staged: string;
  const sourcePath = uri.startsWith('file://') ? uri.replace(/^file:/, '') : '';
  if (sourcePath) {
    staged = sourcePath;
    fs.writeFileSync(staged, text);
  } else {
    staged = path.join(os.tmpdir(), `minilang-${path.basename(textDocument.uri) || 'buffer'}.mil`);
    fs.writeFileSync(staged, text);
  }

  const cwd = sourcePath ? path.dirname(sourcePath) : workspaceFolder ?? process.cwd();
  const res = spawnSync(minilangPath, ['run', staged], { cwd, encoding: 'utf8' });
  const err = (res.stderr || '') as string;

  // The toolchain prints nothing on success; only report when it actually errored.
  const diags = /error/i.test(err) ? toDiagnostics(uri, err) : [];
  connection.sendDiagnostics({ uri, diagnostics: diags });
}

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: 1,
      hoverProvider: true,
      completionProvider: { triggerCharacters: ['.'] },
    },
  };
});

connection.onInitialized(() => {
  connection.workspace.getWorkspaceFolders().then((folders) => {
    workspaceFolder = folders && folders[0] ? folders[0].uri.replace(/^file:/, '') : undefined;
  });
});

connection.onDidChangeConfiguration((change) => {
  const cfg = change.settings?.minilang;
  if (cfg) {
    if (cfg.path) minilangPath = cfg.path;
  }
});

documents.onDidChangeContent((e) => validate(e.document));
documents.onDidOpen((e) => validate(e.document));

connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const text = doc.getText();
  const offset = doc.offsetAt(params.position);
  // Manually extract the word ([A-Za-z0-9_.]) under the cursor.
  let start = offset;
  let end = offset;
  const isWordChar = (c: string) => /[A-Za-z0-9_.]/.test(c);
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  const word = text.slice(start, end);
  const d = findDoc(word);
  if (!d) return null;
  return { contents: { language: 'minilang', value: `\`${d.signature}\`\n\n${d.doc}` } };
});

connection.onCompletion((_params: TextDocumentPositionParams): CompletionItem[] => {
  return allCompletions().map((c) => ({
    label: c.label,
    kind: c.label.includes('.') ? CompletionItemKind.Module : CompletionItemKind.Function,
    detail: c.doc.detail,
    documentation: { value: c.doc.doc, kind: 'markdown' },
    insertText: c.label,
  }));
});

documents.listen(connection);
connection.listen();
