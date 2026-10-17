import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Registry, IRawGrammar, StateStack } from 'vscode-textmate';
import { loadWASM, createOnigScanner, createOnigString } from 'vscode-oniguruma';

const grammarPath = resolve(__dirname, '../../syntaxes/snote.tmLanguage.json');
const packageRoot = resolve(__dirname, '../..');
const languages = JSON.parse(readFileSync(resolve(packageRoot, 'highlight-languages.json'), 'utf8')) as Array<{
  id: string;
  aliases: string[];
  grammar: { kind: string; scope: string };
}>;
const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
const bundledGrammars = new Map<string, string>(manifest.contributes.grammars
  .filter((entry: { scopeName: string }) => entry.scopeName.startsWith('source.ocaml'))
  .map((entry: { scopeName: string; path: string }) => [entry.scopeName, entry.path]));
const onigReady = loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));
const mockGrammars: Record<string, IRawGrammar> = {
  'source.ts': {
    scopeName: 'source.ts',
    patterns: [
      { name: 'keyword.control.ts', match: '\\bconst\\b' },
      { name: 'entity.name.test.typescript', match: 'SNOTE_TOKEN' }
    ],
    repository: {} as IRawGrammar['repository']
  },
  'source.python': {
    scopeName: 'source.python',
    patterns: [
      { name: 'keyword.control.python', match: '\\bdef\\b' },
      { name: 'entity.name.test.python', match: 'SNOTE_TOKEN' }
    ],
    repository: {} as IRawGrammar['repository']
  }
};
for (const language of languages) {
  if (language.grammar.kind === 'scope' && mockGrammars[language.grammar.scope] === undefined) {
    mockGrammars[language.grammar.scope] = {
      scopeName: language.grammar.scope,
      patterns: [{ name: `entity.name.test.${language.id}`, match: 'SNOTE_TOKEN' }],
      repository: {} as IRawGrammar['repository']
    };
  }
}

async function loadSnoteGrammar() {
  await onigReady;
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scopeName) => {
      if (scopeName === 'source.snote') {
        return JSON.parse(readFileSync(grammarPath, 'utf8')) as IRawGrammar;
      }
      const bundledPath = bundledGrammars.get(scopeName);
      if (bundledPath !== undefined) {
        return JSON.parse(readFileSync(resolve(packageRoot, bundledPath), 'utf8')) as IRawGrammar;
      }
      return mockGrammars[scopeName] ?? null;
    }
  });
  const grammar = await registry.loadGrammar('source.snote');
  assert.ok(grammar);
  return grammar;
}

test('task block highlighting separates call, checkbox, title, and colon', async () => {
  const grammar = await loadSnoteGrammar();
  for (const box of [' ', 'x', 'X']) {
    const raw = `  call [${box}] fix: login  :  `;
    const { tokens } = grammar.tokenizeLine(raw, null);
    const scopeAt = (offset: number) => tokens.find((token) => token.startIndex <= offset && token.endIndex > offset)!.scopes;
    assert.ok(scopeAt(2).includes('keyword.control.call.snote'));
    assert.ok(scopeAt(7).includes(`punctuation.definition.todo.${box === ' ' ? 'unchecked' : 'checked'}.snote`));
    assert.ok(scopeAt(11).includes('string.unquoted.title.snote'));
    assert.ok(scopeAt(raw.lastIndexOf(':')).includes('punctuation.definition.block.snote'));
  }
  for (const raw of ['call normal:', 'call [ ]:', 'call [ ]   :', 'call [y] invalid:', 'call [x]no separator:']) {
    const { tokens } = grammar.tokenizeLine(raw, null);
    assert.ok(tokens.some((token) => token.scopes.includes('keyword.control.call.snote')));
    assert.ok(!tokens.some((token) => token.scopes.some((scope) => scope.startsWith('punctuation.definition.todo.'))));
  }
});

test('task block highlighting is disabled inside fenced code', async () => {
  const grammar = await loadSnoteGrammar();
  const opening = grammar.tokenizeLine('```snote', null);
  const literal = grammar.tokenizeLine('call [ ] literal:', opening.ruleStack);
  assert.ok(!literal.tokens.some((token) => token.scopes.includes('punctuation.definition.todo.unchecked.snote')));
});

test('fenced code uses the named language grammar and stops at its closing fence', async () => {
  const grammar = await loadSnoteGrammar();

  let stack: StateStack | null = null;
  const lines = [
    '  ````ts',
    '  const value = 1',
    '  ```',
    '  const stillCode = 2',
    '  `````',
    '  ```python',
    '  def name():',
    '  ```',
    '  ```unknown',
    '  const plain = 1',
    '  ```',
    '  ret'
  ];
  const scopes = lines.map((line) => {
    const result = grammar.tokenizeLine(line, stack);
    stack = result.ruleStack;
    return result.tokens.map((token) => token.scopes);
  });

  assert.ok(scopes[1].some((tokenScopes) => tokenScopes.includes('keyword.control.ts')));
  assert.ok(scopes[3].some((tokenScopes) => tokenScopes.includes('keyword.control.ts')));
  assert.ok(scopes[6].some((tokenScopes) => tokenScopes.includes('keyword.control.python')));
  assert.ok(!scopes[9].some((tokenScopes) => tokenScopes.includes('keyword.control.ts')));
  assert.ok(scopes[11].some((tokenScopes) => tokenScopes.includes('keyword.control.ret.snote')));
});

test('OCaml fences use bundled grammar for keywords, strings, and comments', async () => {
  const grammar = await loadSnoteGrammar();
  let stack: StateStack | null = null;
  const lines = [
    '```ocaml',
    'let message = "hello"',
    '(* comment *)',
    '```',
    '```ml',
    'let number = 42',
    '```',
    '```mli',
    'let another = 3',
    '```',
    'ret'
  ];
  const scopes = lines.map((line) => {
    const result = grammar.tokenizeLine(line, stack);
    stack = result.ruleStack;
    return result.tokens.map((token) => token.scopes);
  });

  assert.ok(scopes[1].some((tokenScopes) => tokenScopes.some((scope) => scope.startsWith('keyword.'))));
  assert.ok(scopes[1].some((tokenScopes) => tokenScopes.includes('string.quoted.double.ocaml')));
  assert.ok(scopes[2].some((tokenScopes) => tokenScopes.includes('comment.block.ocaml')));
  assert.ok(scopes[5].some((tokenScopes) => tokenScopes.some((scope) => scope.startsWith('keyword.'))));
  assert.ok(scopes[8].some((tokenScopes) => tokenScopes.some((scope) => scope.startsWith('keyword.'))));
  assert.ok(scopes[10].some((tokenScopes) => tokenScopes.includes('keyword.control.ret.snote')));
});

test('every registered external alias reaches its TextMate grammar', async () => {
  const grammar = await loadSnoteGrammar();
  for (const language of languages) {
    if (language.grammar.kind !== 'scope') {
      continue;
    }
    for (const alias of language.aliases) {
      const opened = grammar.tokenizeLine(`  \`\`\`${alias}`, null);
      const content = grammar.tokenizeLine('SNOTE_TOKEN', opened.ruleStack);
      assert.ok(content.tokens.some((token) => token.scopes.includes(`entity.name.test.${language.id}`)),
        `Missing ${alias} highlighting`);
    }
  }
});
