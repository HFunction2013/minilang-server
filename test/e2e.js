// End-to-end test for the minilang LSP server: spawn out/server.js, open files
// with known errors and assert the diagnostics that come back over stdio.
//
// Usage:
//   npm run build && node test/e2e.js
// The minilang binary is resolved from $MINILANG_BOOT (a built minilang-boot
// directory) or from PATH. The test also proves the server never overwrites
// the real source file (it validates a staging copy instead).
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SERVER = path.resolve(__dirname, '..', 'out', 'server.js');
const BOOT = process.env.MINILANG_BOOT || path.resolve(__dirname, '..', '..', 'minilang-boot');
const CASE = path.join(os.tmpdir(), 'minilang-lsp-e2e-case.mil');
const STAGED = path.join(os.tmpdir(), '.minilang-lint-minilang-lsp-e2e-case.mil');

function startServer(pathOverride) {
  const child = spawn('node', [SERVER], {
    env: { ...process.env, PATH: pathOverride || `${BOOT}:${process.env.PATH}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = Buffer.alloc(0);
  const messages = [];
  child.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const he = buf.indexOf('\r\n\r\n');
      if (he < 0) return;
      const len = Number(/Content-Length: (\d+)/i.exec(buf.slice(0, he).toString())[1]);
      if (buf.length < he + 4 + len) return;
      const body = buf.slice(he + 4, he + 4 + len).toString();
      buf = buf.slice(he + 4 + len);
      messages.push(JSON.parse(body));
    }
  });
  const send = (o) => {
    const b = JSON.stringify(o);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(b)}\r\n\r\n${b}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return { child, messages, send, sleep };
}

const cases = [
  { name: 'syntax error (line 2)', text: 'func main() {\n  var x = ;\n  return 0;\n}\n', expect: ['unexpected token'], line: 1 },
  { name: 'undefined function', text: 'func main() {\n  foo(1);\n  return 0;\n}\n', expect: ["undefined function 'foo'"], line: 1 },
  { name: 'undefined variable', text: 'func main() {\n  var y = zzz;\n  return 0;\n}\n', expect: ["undefined variable 'zzz'"], line: 1 },
  { name: 'missing module (no line number)', text: 'require nope in syslib;\nfunc main() { return 0; }\n', expect: [/cannot find module 'nope'/], line: 0 },
  { name: 'no exported function (no line number)', text: 'require cos from json;\nfunc main() { return 0; }\n', expect: [/has no exported function/], line: 0 },
  { name: 'circular require (no crash)', text: 'require nope in cwd;\nfunc main() { return 0; }\n', expect: [/circular require|cannot find module/], line: 0 },
  { name: 'clean file', text: 'func main() {\n  println "ok";\n  return 0;\n}\n', expect: [], line: -1 },
];

async function main() {
  let pass = 0;
  let fail = 0;
  const check = (ok, label, detail) => {
    if (ok) { console.log(`PASS  ${label}`); pass++; }
    else { console.log(`FAIL  ${label}${detail ? ': ' + detail : ''}`); fail++; }
  };

  fs.writeFileSync(CASE, 'ORIGINAL ON DISK\n');
  const s = startServer();
  const uri = 'file://' + CASE;
  s.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } });
  s.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
  await s.sleep(300);

  for (const c of cases) {
    fs.writeFileSync(CASE, c.text);
    s.send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
      textDocument: { uri, languageId: 'minilang', version: 1, text: c.text },
    } });
    await s.sleep(1200);
    const last = s.messages.filter((m) => m.method === 'textDocument/publishDiagnostics').pop();
    const list = (last && last.params && last.params.diagnostics) || [];
    const texts = list.map((d) => d.message);
    const lines = list.map((d) => d.range.start.line);
    let ok = true;
    if (c.expect.length === 0) ok = list.length === 0;
    else if (list.length !== c.expect.length) ok = false;
    else for (let i = 0; i < c.expect.length; i++) {
      if (!(c.expect[i] instanceof RegExp ? c.expect[i].test(texts[i]) : texts[i] === c.expect[i])) ok = false;
      if (lines[i] !== c.line) ok = false;
    }
    check(ok, c.name, JSON.stringify(list.map((d) => [d.range.start.line, d.message])));
    if (fs.existsSync(STAGED)) check(false, c.name + ' (staging file left behind)', 'see ' + STAGED);
  }

  // The dirty buffer must never be written into the real source file.
  fs.writeFileSync(CASE, 'ORIGINAL ON DISK\n');
  s.send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
    textDocument: { uri, languageId: 'minilang', version: 1, text: 'DIRTY BUFFER\n' },
  } });
  await s.sleep(1200);
  check(fs.readFileSync(CASE, 'utf8') === 'ORIGINAL ON DISK\n',
    'real source file untouched by validation');
  s.child.kill();

  // Missing binary: the server must say so instead of staying silent.
  const s2 = startServer('/usr/bin:/bin');
  const uri2 = 'file://' + CASE;
  s2.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } });
  s2.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
  await s2.sleep(300);
  s2.send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
    textDocument: { uri: uri2, languageId: 'minilang', version: 1, text: 'func main() { var x = ; return 0; }\n' },
  } });
  await s2.sleep(1200);
  const last2 = s2.messages.filter((m) => m.method === 'textDocument/publishDiagnostics').pop();
  const texts2 = ((last2 && last2.params && last2.params.diagnostics) || []).map((d) => d.message);
  check(texts2.some((t) => /cannot launch/.test(t)), 'missing binary reported visibly', JSON.stringify(texts2));
  s2.child.kill();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
