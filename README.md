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

## License

MIT.
