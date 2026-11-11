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
  InsertTextFormat,
  MarkupKind,
  TextDocumentPositionParams,
  InitializeResult,
  InitializeParams,
  Location,
  SignatureHelp,
  SignatureInformation,
  DocumentSymbol,
  SymbolKind,
  ReferenceParams,
  RenameParams,
  WorkspaceEdit,
  TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findDoc, allCompletions, makeNativeDoc, BuiltinDoc, parseUserDefs, userFuncSig } from './builtins';

const connection = createConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
const documents = new TextDocuments(TextDocument);

let minilangPath = 'minilang';
let workspaceFolder: string | undefined;

// User C extensions: `native func name(params);` declared in the edited file.
// These are real functions to the compiler but only exist as C at link time;
// the LSP indexes them so hover/completion work and so the "not registered"
// VM error (which appears when running without a linked extension) can be
// reported against the declaration/call site.
const USER_NATIVE_RE = /^\s*native\s+func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/gm;

/** Language keywords / declaration snippets offered on completion. */
const KEYWORD_SNIPPETS: { label: string; detail: string; insertText: string; snippet: boolean }[] = [
  { label: 'native func', detail: 'declare a C-implemented native function', insertText: 'native func ${1:name}(${2:args});', snippet: true },
  { label: 'require ... from builtin', detail: 'import a C native (sqrt/abs/time/...)', insertText: 'require ${1:sqrt} from builtin;', snippet: true },
  { label: 'require ... from', detail: 'import selected symbols from a syslib module', insertText: 'require ${1:cos} from ${2:math};', snippet: true },
  { label: 'var', detail: 'declare a variable', insertText: 'var ${1:name} = ${2:0};', snippet: true },
  { label: 'func', detail: 'define a function', insertText: 'func ${1:name}(${2:args}) {\n\t$0\n}', snippet: true },
  { label: 'if', detail: 'conditional', insertText: 'if (${1:cond}) {\n\t$0\n}', snippet: true },
  { label: 'while', detail: 'loop', insertText: 'while (${1:cond}) {\n\t$0\n}', snippet: true },
  { label: 'return', detail: 'return from a function', insertText: 'return ${1:0};', snippet: true },
  { label: 'break', detail: 'break out of a while loop', insertText: 'break;', snippet: false },
];

/** Index every `native func` declaration in `text` by base name. */
function userNativeDocs(text: string): Map<string, BuiltinDoc> {
  const out = new Map<string, BuiltinDoc>();
  USER_NATIVE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = USER_NATIVE_RE.exec(text))) {
    const name = m[1];
    if (!out.has(name)) out.set(name, makeNativeDoc(name, m[2]));
  }
  return out;
}

// Parse the toolchain's error output into LSP diagnostics.
//   Parse error line 12: unexpected token
//   Parse error line 7: expected 'func'...
//   Compile error: undefined function 'foo'
//   Parse error: cannot find module 'nope' (searched ...)
//   Parse error: module 'math' has no exported function 'sqrt'
// The first two carry a line number; the others are reported at line 0 (or at
// the first line mentioning the offending identifier, when there is one).
const PARSE_LINE_RE = /Parse error line (\d+):\s*(.*)/g;
const PARSE_NOLINE_RE = /^Parse error:\s*(.*)$/gm;
const COMPILE_RE = /^Compile error:?\s*(.*)$/gm;
const VM_ERROR_RE = /^VM error:\s*(.*)$/gm;
const UNDEFINED_NAME_RE = /(?:undefined function|undefined var|undefined variable|has no exported function|native function)\s+'([^']+)'/;

/** First line of the document mentioning `name` as a whole word, or -1. */
function locateName(text: string, name: string): number {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

/** A diagnostic spanning the whole first line (used for errors without a location). */
function wholeLineDiagnostic(uri: string, message: string): Diagnostic {
  return {
    severity: DiagnosticSeverity.Error,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: Number.MAX_SAFE_INTEGER } },
    message,
    source: 'minilang',
  };
}

function toDiagnostics(uri: string, stderr: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const doc = documents.get(uri);
  if (!doc) return diags;
  const text = doc.getText();

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
  PARSE_NOLINE_RE.lastIndex = 0;
  while ((m = PARSE_NOLINE_RE.exec(stderr))) {
    diags.push(locatedDiagnostic(text, m[1].trim() || 'parse error'));
  }
  COMPILE_RE.lastIndex = 0;
  while ((m = COMPILE_RE.exec(stderr))) {
    diags.push(locatedDiagnostic(text, m[1].trim() || 'compile error'));
  }
  VM_ERROR_RE.lastIndex = 0;
  while ((m = VM_ERROR_RE.exec(stderr))) {
    const msg = m[1].trim() || 'vm error';
    // A declared-but-unlinked native function is expected when running via
    // the C bootstrap VM without a linked extension; make that actionable.
    const hint = /native function/i.test(msg)
      ? `${msg} — run it with \`minilang run -e <file>.mil ext.c\` (or the self-hosted ` +
        `\`run main.mil run -e <file>.mil ext.c\`; both load the C extension), or link it ` +
        `with \`build -e <file>.mil ext.c\`.`
      : msg;
    diags.push(locatedDiagnostic(text, hint));
  }
  return diags;
}

/** Line-0 diagnostic, landing on the first line that names the offender. */
function locatedDiagnostic(text: string, message: string): Diagnostic {
  const u = UNDEFINED_NAME_RE.exec(message);
  let line = 0;
  if (u) {
    const found = locateName(text, u[1]);
    if (found >= 0) line = found;
  }
  return {
    severity: DiagnosticSeverity.Error,
    range: { start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } },
    message,
    source: 'minilang',
  };
}

function validate(textDocument: TextDocument): void {
  const uri = textDocument.uri;
  const text = textDocument.getText();

  // Stage the buffer next to the source file so `require` / syslib resolution
  // behaves the same as on disk. Never write into the real source file: the
  // buffer may be dirty, the file may be read-only, and another tool (git, a
  // formatter) may be looking at it.
  let staged: string | undefined;
  const sourcePath = uri.startsWith('file://') ? decodeURIComponent(uri.replace(/^file:\/\//, '')) : '';
  if (sourcePath) {
    staged = path.join(path.dirname(sourcePath), `.minilang-lint-${path.basename(sourcePath)}`);
  } else {
    staged = path.join(os.tmpdir(), `minilang-${path.basename(textDocument.uri) || 'buffer'}.mil`);
  }
  try {
    fs.writeFileSync(staged, text);
  } catch (err) {
    // Cannot even stage (read-only dir / no perms): report it instead of dying.
    connection.sendDiagnostics({ uri, diagnostics: [
      wholeLineDiagnostic(uri, `cannot stage buffer for validation: ${(err as Error).message}`),
    ] });
    return;
  }

  const cwd = sourcePath ? path.dirname(sourcePath) : workspaceFolder ?? process.cwd();
  // syslib resolves via $MINILANG_DIR (or the toolchain dir). In an editor
  // session the toolchain usually inherits it from the shell; fall back to
  // the workspace root when a repo layout (syslib/ beside the sources) is
  // being edited and the variable is unset.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.MINILANG_DIR && workspaceFolder && fs.existsSync(path.join(workspaceFolder, 'syslib'))) {
    env.MINILANG_DIR = workspaceFolder;
  }
  const res = spawnSync(minilangPath, ['run', staged], { cwd, env, encoding: 'utf8' });

  // Make toolchain problems visible instead of silently sending nothing.
  if (res.error) {
    connection.sendDiagnostics({ uri, diagnostics: [
      wholeLineDiagnostic(uri,
        `cannot launch "${minilangPath}" (${res.error.message}). Build the minilang toolchain ` +
        `(minilang-boot) and set minilang.path or add it to PATH.`),
    ] });
    return;
  }
  if (res.signal) {
    connection.sendDiagnostics({ uri, diagnostics: [
      wholeLineDiagnostic(uri,
        `minilang terminated unexpectedly (signal ${res.signal}) while validating this file.`),
    ] });
    return;
  }

  // The toolchain prints nothing on success; only report when it actually errored.
  const err = (res.stderr || '') as string;
  const diags = /error/i.test(err) ? toDiagnostics(uri, err) : [];
  connection.sendDiagnostics({ uri, diagnostics: diags });
  if (staged && staged !== sourcePath) {
    try { fs.unlinkSync(staged); } catch { /* best effort */ }
  }
}

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: 1,
      hoverProvider: true,
      completionProvider: { triggerCharacters: ['.'] },
      definitionProvider: true,
      signatureHelpProvider: { triggerCharacters: ['(', ','] },
      documentSymbolProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
    },
  };
});

connection.onInitialized(() => {
  connection.workspace.getWorkspaceFolders().then((folders: { uri: string }[] | null) => {
    workspaceFolder = folders && folders[0] ? folders[0].uri.replace(/^file:/, '') : undefined;
  });
});

connection.onDidChangeConfiguration((change: { settings?: { minilang?: { path?: string } } }) => {
  const cfg = change.settings?.minilang;
  if (cfg) {
    if (cfg.path) minilangPath = cfg.path;
  }
});

documents.onDidChangeContent((e: { document: TextDocument }) => validate(e.document));
documents.onDidOpen((e: { document: TextDocument }) => validate(e.document));

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
  // Builtin/syslib metadata first, then native funcs declared in this file.
  const d = findDoc(word) ?? userNativeDocs(text).get(word);
  if (!d) return null;
  return { contents: { language: 'minilang', value: `\`${d.signature}\`\n\n${d.doc}` } };
});

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  const userNatives = doc ? Array.from(userNativeDocs(doc.getText()).values()) : [];
  const items: { label: string; doc: BuiltinDoc }[] = [
    ...allCompletions(),
    ...userNatives.map((d) => ({ label: d.name, doc: d })),
  ];
  const fnItems = items.map((c): CompletionItem => ({
    label: c.label,
    kind: c.label.includes('.') ? CompletionItemKind.Module : CompletionItemKind.Function,
    detail: c.doc.detail,
    documentation: { value: c.doc.doc, kind: MarkupKind.Markdown },
    insertText: c.label,
  }));
  const kwItems: CompletionItem[] = KEYWORD_SNIPPETS.map((k) => ({
    label: k.label,
    kind: k.snippet ? CompletionItemKind.Snippet : CompletionItemKind.Keyword,
    detail: k.detail,
    documentation: { value: k.detail, kind: MarkupKind.Markdown },
    insertText: k.insertText,
    insertTextFormat: k.snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
  }));
  // User-declared functions and variables in this buffer.
  const userItems: CompletionItem[] = [];
  if (doc) {
    const { funcs, vars } = parseUserDefs(doc.getText());
    for (const f of funcs) {
      userItems.push({
        label: f.name,
        kind: CompletionItemKind.Function,
        detail: `user function (line ${f.line + 1})`,
        documentation: { value: `\`${userFuncSig(f)}\``, kind: MarkupKind.Markdown },
        insertText: f.name,
      });
    }
    for (const v of vars) {
      userItems.push({
        label: v.name,
        kind: CompletionItemKind.Variable,
        detail: `user variable (line ${v.line + 1})`,
        insertText: v.name,
      });
    }
  }
  return [...fnItems, ...userItems, ...kwItems];
});

// ---- Definition: jump to the declaration ----------------------------------

connection.onDefinition((params: TextDocumentPositionParams): Location[] | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const text = doc.getText();
  const offset = doc.offsetAt(params.position);
  const isWordChar = (c: string) => /[A-Za-z0-9_.]/.test(c);
  let start = offset, end = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  const word = text.slice(start, end);
  if (!word) return null;

  // 1) User declarations in this buffer.
  const { funcs, vars } = parseUserDefs(text);
  const nativeLines = userNativeDocs(text);
  for (const f of funcs) {
    if (f.name === word || word.endsWith(`.${f.name}`)) {
      return [{ uri: doc.uri, range: {
        start: { line: f.line, character: 0 },
        end: { line: f.line, character: Number.MAX_SAFE_INTEGER } } }];
    }
  }
  for (const v of vars) {
    if (v.name === word) {
      return [{ uri: doc.uri, range: {
        start: { line: v.line, character: 0 },
        end: { line: v.line, character: Number.MAX_SAFE_INTEGER } } }];
    }
  }
  // 2) syslib modules: jump to syslib/<mod>.mil (and the declared function when
  //    the word is module.func).
  const modMatch = /^([a-z]\w*)\.(\w+)$/.exec(word);
  if (modMatch && workspaceFolder) {
    const syslibDir = path.join(workspaceFolder, 'syslib');
    const modFile = path.join(syslibDir, `${modMatch[1]}.mil`);
    if (fs.existsSync(modFile)) {
      let line = 0;
      try {
        const src = fs.readFileSync(modFile, 'utf8');
        const lines = src.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (new RegExp(`func\\s+${modMatch[2]}\\s*\\(`).test(lines[i])) { line = i; break; }
        }
      } catch { /* keep line 0 */ }
      return [{ uri: `file://${modFile}`, range: {
        start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } } }];
    }
  }
  return null;
});

// ---- Signature help -------------------------------------------------------

interface SigTarget {
  label: string;
  activeParam: number;
}

/** Walk backwards from the cursor to find the call `name(` being typed. */
function findCallAt(text: string, offset: number): SigTarget | null {
  let depth = 0;
  let i = offset - 1;
  let commaCount = -1;
  while (i >= 0) {
    const c = text[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        // Found the opening paren of the call. Back up over the name.
        let s = i;
        while (s > 0 && /[A-Za-z0-9_.]/.test(text[s - 1])) s--;
        const name = text.slice(s, i);
        if (!name) return null;
        return { label: name, activeParam: Math.max(0, commaCount) };
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      commaCount++;
    } else if (c === ';' || c === '{' || c === '}') {
      break; // left the expression
    }
    i--;
  }
  return null;
}

connection.onSignatureHelp((params: TextDocumentPositionParams): SignatureHelp | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const text = doc.getText();
  const target = findCallAt(text, doc.offsetAt(params.position));
  if (!target) return null;
  // Resolve the signature: builtin/native metadata, user native decl, user func.
  let sig: string | null = null;
  const d = findDoc(target.label);
  if (d) sig = d.signature;
  if (!sig) {
    const un = userNativeDocs(text).get(target.label);
    if (un) sig = un.signature;
  }
  if (!sig) {
    const { funcs } = parseUserDefs(text);
    for (const f of funcs) {
      if (f.name === target.label) { sig = userFuncSig(f); break; }
    }
  }
  if (!sig) return null;
  const info: SignatureInformation = {
    label: sig,
    documentation: d ? { value: d.doc, kind: MarkupKind.Markdown } : undefined,
  };
  return { signatures: [info], activeSignature: 0, activeParameter: target.activeParam };
});

// ---- Document symbol outline ---------------------------------------------

connection.onDocumentSymbol((params): DocumentSymbol[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const text = doc.getText();
  const { funcs, vars } = parseUserDefs(text);
  const natives = userNativeDocs(text);
  const out: DocumentSymbol[] = [];
  for (const f of funcs) {
    out.push({
      name: f.name,
      kind: SymbolKind.Function,
      range: { start: { line: f.line, character: 0 }, end: { line: f.line, character: Number.MAX_SAFE_INTEGER } },
      selectionRange: { start: { line: f.line, character: 0 }, end: { line: f.line, character: Number.MAX_SAFE_INTEGER } },
    });
  }
  for (const v of vars) {
    out.push({
      name: v.name,
      kind: SymbolKind.Variable,
      range: { start: { line: v.line, character: 0 }, end: { line: v.line, character: Number.MAX_SAFE_INTEGER } },
      selectionRange: { start: { line: v.line, character: 0 }, end: { line: v.line, character: Number.MAX_SAFE_INTEGER } },
    });
  }
  for (const [name] of natives) {
    const line = locateName(text, name);
    if (line >= 0) {
      out.push({
        name: `${name} (native)`,
        kind: SymbolKind.Event,
        range: { start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } },
        selectionRange: { start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } },
      });
    }
  }
  return out;
});

// ---- References / rename: whole-word occurrences in the buffer ------------

/** All whole-word occurrences of `word` in `text`, as [line, startCol, endCol]. */
function findWordRanges(text: string, word: string): { line: number; start: number; end: number }[] {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${esc}\\b`, 'g');
  const lines = text.split(/\r?\n/);
  const out: { line: number; start: number; end: number }[] = [];
  let lineStart = 0;
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i]))) {
      out.push({ line: i, start: m.index, end: m.index + word.length });
    }
    lineStart += lines[i].length + 1;
  }
  return out;
}

connection.onReferences((params: ReferenceParams): Location[] | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const text = doc.getText();
  const offset = doc.offsetAt(params.position);
  const isWordChar = (c: string) => /[A-Za-z0-9_.]/.test(c);
  let start = offset, end = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  const word = text.slice(start, end);
  if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/.test(word)) return null;
  const base = word.split('.').pop()!;
  return findWordRanges(text, base).map((r) => ({
    uri: doc.uri,
    range: { start: { line: r.line, character: r.start }, end: { line: r.line, character: r.end } },
  }));
});

connection.onPrepareRename((params: TextDocumentPositionParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const text = doc.getText();
  const offset = doc.offsetAt(params.position);
  const isWordChar = (c: string) => /[A-Za-z0-9_.]/.test(c);
  let start = offset, end = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  const word = text.slice(start, end);
  if (!/^[A-Za-z_]\w*$/.test(word)) return null;
  const p = doc.positionAt(start);
  return { start: p, end: doc.positionAt(end) };
});

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const text = doc.getText();
  const offset = doc.offsetAt(params.position);
  const isWordChar = (c: string) => /[A-Za-z0-9_.]/.test(c);
  let start = offset, end = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  const word = text.slice(start, end);
  const newName = params.newName;
  if (!/^[A-Za-z_]\w*$/.test(word) || !/^[A-Za-z_]\w*$/.test(newName)) return null;
  const edits: TextEdit[] = findWordRanges(text, word).map((r) => ({
    range: { start: { line: r.line, character: r.start }, end: { line: r.line, character: r.end } },
    newText: newName,
  }));
  return { changes: { [doc.uri]: edits } };
});

documents.listen(connection);
connection.listen();
