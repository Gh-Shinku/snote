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
- Completion for `call` blocks
- Auto-complete `- [ ]` TODO items: type `-` (or `- `) at the start of a line and accept the **TODO item** suggestion
- Toggle `- [ ]` / `- [x]` with `Alt+Enter` (command: **SNote: Toggle TODO item**)
- Outline view and breadcrumbs showing the `call` block hierarchy
- Inline rich-text rendering for `**bold**`, `*italic*`, `***bold italic***`, `~~strikethrough~~`, and `` `inline code` ``

## Rich Text

SNote supports Markdown-style inline markers inside note text:

```snote
call rich text:
  This is **bold**, *italic*, ***bold italic***, ~~struck through~~, and `inline code`.
ret
```

The markers stay visible in the editor. The formatter only adjusts indentation
and preserves inline rich-text content as written. Lines inside triple-backtick
code fences, including the fence lines themselves, keep their original whitespace.
Inline rich-text styling is disabled inside these fences.

## Build

```bash
npm install
npm run compile
```

## Package for Installation

Create a `.vsix` extension package:

```bash
npm run package
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

## Release

GitHub Actions publishes a GitHub Release when a tag is pushed.

The tag must match this format:

```text
<package.name>-<package.version>
```

For the current package, that is:

```text
snote-0.0.1
```

Release flow:

```bash
npm test
git tag snote-0.0.1
git push origin snote-0.0.1
```

The workflow validates the tag against `package.json`, packages the extension as
`dist/snote-0.0.1.vsix`, creates a GitHub Release named `snote-0.0.1`, and uploads
the VSIX asset.
