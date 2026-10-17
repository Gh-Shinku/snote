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

## Git Delivery

For implementation, fixes, or configuration changes, complete Git delivery as part of the task. Do not apply this workflow to questions, analysis, or read-only work.

- Make atomic commits by logical work unit and follow the repository's existing commit-message style.
- Inspect staged changes and run required validation before committing.
- Preserve unrelated changes. Do not overwrite, discard, or commit them without authorization.
- Respect branch protection and review requirements. Fix failures caused by the task; report blockers that require user action or external changes.
- Do not force-push, rewrite shared history, delete repositories, publish releases, create tags, or deploy unless separately requested.
- Work and commit on `main`; synchronize with `origin` before editing. Use a task branch or PR only when requested or repository rules require it.
- At delivery, push task commits to `origin/main`, satisfy required checks, and report commit and push status or any blocker.
