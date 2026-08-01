# SNote

VS Code language support for `.snote` files.

## Syntax

```snote
call project:
  call task:
  ret
ret
```

The language is a hierarchy of `call <title>:` and `ret` pairs.

## Features

- Syntax highlighting for `call`, titles, `:`, and `ret`
- Folding for matched `call` / `ret` blocks
- Whole-document formatting using the editor indentation settings
- A basic `call` block snippet

## Build

```bash
npm install
npm run compile
```

## Package for Installation

Create a `.vsix` extension package:

```bash
npx @vscode/vsce package
```

This creates a file like:

```text
snote-0.0.1.vsix
```

Install it with the VS Code CLI:

```bash
code --install-extension snote-0.0.1.vsix
```

Or install it from VS Code:

1. Open the Extensions panel.
2. Click `...`.
3. Choose `Install from VSIX...`.
4. Select the generated `.vsix` file.
