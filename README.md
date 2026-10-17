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

Add a checkbox after `call` to give a task its own scope:

```snote
call [ ] Fix login:
  Refresh expired tokens before retrying requests.
  - [ ] Add a regression test
  call [x] Investigate the cause:
    The refresh logic is missing.
  ret
ret
```

Task blocks accept `[ ]`, `[x]`, or `[X]` followed by whitespace and a nonempty
title. They nest, fold, and format like ordinary `call` blocks. Use **call TODO
block** completion when typing `c` or `call` to insert a task block. The ordinary
**call block** suggestion remains the default.

`Alt+Enter` toggles a task block's checkbox without changing its body or any
child tasks; it also continues to toggle single-line `- [ ]` items. TODOs inside
code fences are treated as code and cannot be toggled. Outline and breadcrumbs
retain the checkbox in task block titles.

The **SNote TODO** sidebar shows each unfinished task block once, with any child
tasks beneath it. Click its title to jump to the block header. A completed task
block is hidden unless it contains unfinished descendants, in which case its
title remains as a context group marked **已完成**. Empty or invalid task markers
remain ordinary `call` titles. Existing `call [ ] Title:` headings are interpreted
as tasks without rewriting the file.

## Features

- Syntax highlighting for `call`, titles, `:`, and `ret`
- Folding for matched `call` / `ret` blocks hides the body while keeping both the `call` header and its matching `ret` visible. Empty blocks have no fold control. This also applies to task blocks.
- Folding for fenced code blocks
- Whole-document formatting using the editor indentation settings
- Completion for ordinary `call` blocks and `call [ ]` task blocks
- Completion for fenced code blocks: type one, two, or three backticks at the start of a line and accept the **code block** suggestion to insert a block with a language label and its closing fence. Inside a block, a backtick run that is too short for the opening fence offers the matching **close code block** suggestion. Marker, TODO, and `call` suggestions are suppressed inside code blocks, and inline code has no completion.
- Auto-complete `- [ ]` TODO items: type `-` (or `- `) at the start of a line and accept the **TODO item** suggestion
- Toggle `- [ ]` / `- [x]` and `call [ ]` / `call [x]` with `Alt+Enter` (command: **SNote: Toggle TODO item**)
- Browse unfinished TODOs in the Explorer sidebar's **SNote TODO** view, grouped by their `call` hierarchy. Click an item to jump to its source line, including inside folded blocks. The view follows the current SNote document and updates as you edit, toggle, or undo, including unsaved changes and untitled documents. Completed items and TODOs inside code fences are excluded; groups without unfinished items are hidden. Top-level TODOs appear at the root.
- Copy the complete lines covered by a selection with their common indentation removed using **SNote: Copy Without Indentation** from the Command Palette. The command includes each line's leading whitespace even when the selection starts after it, and preserves nested indentation and indentation within fenced code.
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

Add a language name after the opening fence to highlight code using VS Code's
existing TextMate grammars. For example:

````snote
call example:
  ```typescript
  const answer: number = 42;
  ```
ret
````

Supported language labels include JavaScript/JSX, TypeScript/TSX, Python,
JSON, Bash, HTML, CSS, SQL, Go, Rust, Java, C, C++, YAML, Markdown, and
OCaml (`ocaml`, `ml`, `mli`). OCaml highlighting is included with SNote.
Unrecognized labels remain plain code. Highlighting depends on the matching
language grammar being available in VS Code, except for bundled grammars such
as OCaml.

### Add a code language

Add one entry to [highlight-languages.json](highlight-languages.json). Every
entry declares an `id`, `aliases` accepted after the opening fence, and a
`grammar` source. Use `kind: "scope"` to reuse an existing VS Code TextMate
scope, or `kind: "bundled"` with a `files` list to package your own TextMate
grammar and any scopes it includes. `vscodeLanguageId` is optional; it enables
embedded-language editor behavior when that language ID is available. Both
grammar sources use the same registry and generated fence rules.

```json
{
  "id": "example",
  "aliases": ["example", "ex"],
  "grammar": { "kind": "scope", "scope": "source.example" },
  "vscodeLanguageId": "example"
}
```

After changing the registry, run `npm run generate:highlight` and commit the
generated grammar and `package.json` changes. `npm run check:highlight` verifies
that generated files are current. For a bundled grammar, place its JSON files
under `syntaxes/`, include any dependent scopes in `files`, and retain its
license and upstream attribution.

## Build

```bash
npm install
npm run compile
```

Run parser and highlighting tests with `npm test`. To also run the TODO view
checks in an isolated Extension Development Host, use PowerShell:

```powershell
npm run compile
code --disable-extensions --disable-workspace-trust --user-data-dir "$PWD/.vscode-test/user-data" --extensions-dir "$PWD/.vscode-test/extensions" --extensionDevelopmentPath "$PWD" --extensionTestsPath "$PWD/out/test/extension-host"
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

## License

SNote is licensed under the [MIT License](LICENSE). The bundled OCaml grammar
retains its separate [ISC License](syntaxes/vendor/ocaml/LICENSE).
