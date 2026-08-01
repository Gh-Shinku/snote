# AGENTS.md

## Project

This repository contains a VS Code extension for the `snote` language.

The language uses nested `call <title>:` / `ret` pairs for hierarchical notes.

## Development

- Keep parser and formatter behavior in `src/snote.ts` testable without VS Code APIs.
- Keep VS Code provider wiring in `src/extension.ts`.
- Run `npm test` before completing changes when TypeScript or language behavior changes.
- Use `npm run compile` for a quick TypeScript verification.

## Commit Message Style

Use this format:

```text
[type] description
```

Allowed types:

```text
feat | fix | refactor | docs | test | chore
```

Example:

```text
[feat] add user profile page
```
