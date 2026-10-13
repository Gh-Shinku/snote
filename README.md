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
- Folding for fenced code blocks
- Whole-document formatting using the editor indentation settings
- Completion for `call` blocks
- Auto-complete `- [ ]` TODO items: type `-` (or `- `) at the start of a line and accept the **TODO item** suggestion
- Toggle `- [ ]` / `- [x]` with `Alt+Enter` (command: **SNote: Toggle TODO item**)
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
