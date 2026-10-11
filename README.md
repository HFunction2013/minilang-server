# minilang-server

Language Server Protocol (LSP) implementation for the [minilang](https://github.com/HFunction2013/minilang-compiler) language.

Spun out of the `minilang-vscode` extension. The VS Code extension hosts this
server; it can also be used by any LSP client (Neovim, Zed, Emacs, …).

## Features

- **Live diagnostics** — shells out to the real `minilang` toolchain and maps
  `Parse error line N` / `Compile error` to diagnostics as you type.
- **Hover** — docs for builtins, syslib functions and C-native methods.
- **Completion** — builtins, `math.*` / `string.*` / `list.*` / `json.*` /
  `io.*` / `rand.*` names, and the native methods (`sqrt`, `time`, …).

## Requirements

A built `minilang` binary from
[`minilang-boot`](https://github.com/HFunction2013/minilang-boot). Point the
client setting `minilang.path` at it, or have `minilang` on `PATH`.

## Build

```bash
npm install
npm run build
node out/server.js        # speaks LSP over stdio
```

## Test

```bash
npm test                  # builds, then runs test/e2e.js against a real minilang binary
```

The e2e test spawns the server over stdio and asserts the diagnostics it sends
for syntax errors, undefined names, missing modules, circular requires, a clean
file, and a missing toolchain binary. It also verifies that validating a dirty
buffer never writes into the real source file (the server validates a staging
copy and cleans up after itself).

## License

MIT.
