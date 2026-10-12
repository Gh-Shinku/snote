import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Registry, IRawGrammar, StateStack } from 'vscode-textmate';
import { loadWASM, createOnigScanner, createOnigString } from 'vscode-oniguruma';

const grammarPath = resolve(__dirname, '../../syntaxes/snote.tmLanguage.json');
const mockGrammars: Record<string, IRawGrammar> = {
  'source.ts': {
    scopeName: 'source.ts',
    patterns: [{ name: 'keyword.control.ts', match: '\\bconst\\b' }],
    repository: {} as IRawGrammar['repository']
  },
  'source.python': {
    scopeName: 'source.python',
    patterns: [{ name: 'keyword.control.python', match: '\\bdef\\b' }],
    repository: {} as IRawGrammar['repository']
  }
};

test('fenced code uses the named language grammar and stops at its closing fence', async () => {
  await loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));

  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scopeName) => {
      if (scopeName === 'source.snote') {
        return JSON.parse(readFileSync(grammarPath, 'utf8')) as IRawGrammar;
      }
      return mockGrammars[scopeName] ?? null;
    }
  });
  const grammar = await registry.loadGrammar('source.snote');
  assert.ok(grammar);

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
