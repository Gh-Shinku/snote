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
