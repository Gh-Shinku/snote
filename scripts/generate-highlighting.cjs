const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
const registry = readJson('highlight-languages.json');
const baseGrammar = readJson('syntaxes/snote.base.tmLanguage.json');
const manifest = readJson('package.json');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateRegistry(languages) {
  assert(Array.isArray(languages), 'highlight-languages.json must contain an array');
  const ids = new Set();
  const aliases = new Set();
  const bundledScopes = new Set();

  for (const language of languages) {
    assert(/^[a-z][a-z0-9-]*$/.test(language.id), `Invalid language id: ${language.id}`);
    assert(!ids.has(language.id), `Duplicate language id: ${language.id}`);
    ids.add(language.id);
    assert(Array.isArray(language.aliases) && language.aliases.length > 0, `Missing aliases: ${language.id}`);

    for (const alias of language.aliases) {
      assert(/^[a-z0-9_+#.-]+$/i.test(alias), `Invalid alias: ${alias}`);
      const normalized = alias.toLowerCase();
      assert(!aliases.has(normalized), `Duplicate alias: ${alias}`);
      aliases.add(normalized);
    }

    const grammar = language.grammar;
    assert(grammar && ['scope', 'bundled'].includes(grammar.kind), `Invalid grammar kind: ${language.id}`);
    assert(/^[a-z][\w.-]+$/i.test(grammar.scope), `Invalid grammar scope: ${language.id}`);
    if (language.vscodeLanguageId !== undefined) {
      assert(typeof language.vscodeLanguageId === 'string' && language.vscodeLanguageId.length > 0,
        `Invalid VS Code language ID: ${language.id}`);
    }

    if (grammar.kind === 'bundled') {
      assert(Array.isArray(grammar.files) && grammar.files.some((file) => file.scope === grammar.scope),
        `Bundled grammar must include its main scope: ${language.id}`);
      for (const file of grammar.files) {
        assert(typeof file.path === 'string' && file.path.startsWith('./syntaxes/'),
          `Invalid bundled grammar path: ${language.id}`);
        assert(!bundledScopes.has(file.scope), `Duplicate bundled scope: ${file.scope}`);
        bundledScopes.add(file.scope);
        const grammarFile = readJson(file.path);
        assert(grammarFile.scopeName === file.scope, `Scope mismatch in ${file.path}`);
      }
    }
  }
}

function fencedPattern(language) {
  const aliases = language.aliases.map(escapeRegex).join('|');
  return {
    name: 'markup.fenced_code.block.snote',
    begin: '^\\s*(`{3,})\\s*(?i:(' + aliases + '))(?:\\s+[^`]*)?$',
    end: '^\\s*(\\1`*)\\s*$',
    beginCaptures: {
      '1': { name: 'punctuation.definition.fence.begin.snote' },
      '2': { name: 'fenced_code.block.language.snote' }
    },
    endCaptures: { '1': { name: 'punctuation.definition.fence.end.snote' } },
    contentName: `meta.embedded.block.${language.id}`,
    patterns: [{ include: language.grammar.scope }]
  };
}

function writeOrCheck(relativePath, value) {
  const target = path.join(root, relativePath);
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    assert(fs.readFileSync(target, 'utf8') === expected,
      `${relativePath} is out of date; run npm run generate:highlight`);
  } else if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== expected) {
    fs.writeFileSync(target, expected);
  }
}

validateRegistry(registry);
assert(baseGrammar.scopeName === 'source.snote', 'Unexpected base grammar scope');
assert(!baseGrammar.repository.fencedCode, 'Base grammar must not contain generated fence patterns');

const fallback = {
  name: 'markup.fenced_code.block.snote',
  begin: '^\\s*(`{3,})[^`]*$',
  end: '^\\s*(\\1`*)\\s*$',
  beginCaptures: { '1': { name: 'punctuation.definition.fence.begin.snote' } },
  endCaptures: { '1': { name: 'punctuation.definition.fence.end.snote' } },
  contentName: 'markup.raw.block.snote'
};
const grammar = {
  ...baseGrammar,
  patterns: [{ include: '#fencedCode' }, ...baseGrammar.patterns],
  repository: {
    fencedCode: { patterns: [...registry.map(fencedPattern), fallback] },
    ...baseGrammar.repository
  }
};

const snoteGrammar = {
  language: 'snote',
  scopeName: 'source.snote',
  path: './syntaxes/snote.tmLanguage.json',
  embeddedLanguages: Object.fromEntries(registry
    .filter((language) => language.vscodeLanguageId !== undefined)
    .map((language) => [`meta.embedded.block.${language.id}`, language.vscodeLanguageId]))
};
const bundledGrammars = registry.flatMap((language) => language.grammar.kind === 'bundled'
  ? language.grammar.files.map((file) => ({ scopeName: file.scope, path: file.path }))
  : []);
manifest.contributes.grammars = [snoteGrammar, ...bundledGrammars];

writeOrCheck('syntaxes/snote.tmLanguage.json', grammar);
writeOrCheck('package.json', manifest);
