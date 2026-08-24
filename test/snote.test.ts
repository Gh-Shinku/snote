import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDocument,
  getDocumentSymbols,
  getFoldingRanges,
  getRichTextSpans,
  getTodoCompletion,
  isBalanced,
  parseLine,
  toggleTodoLine
} from '../src/snote';

test('parseLine identifies call, ret, and other lines', () => {
  assert.equal(parseLine('  call project title:', 0).kind, 'call');
  assert.equal(parseLine('  ret', 1).kind, 'ret');
  assert.equal(parseLine('  plain note', 2).kind, 'other');
});

test('getFoldingRanges returns nested matched ranges', () => {
  const text = [
    'call outer:',
    '  call inner:',
    '  ret',
    'ret'
  ].join('\n');

  assert.deepEqual(getFoldingRanges(text), [
    { start: 0, end: 3 },
    { start: 1, end: 2 }
  ]);
});

test('getFoldingRanges returns independent sibling ranges', () => {
  const text = [
    'call one:',
    'ret',
    'call two:',
    'ret'
  ].join('\n');

  assert.deepEqual(getFoldingRanges(text), [
    { start: 0, end: 1 },
    { start: 2, end: 3 }
  ]);
});

test('getFoldingRanges ignores unmatched lines', () => {
  const text = [
    'ret',
    'call open:',
    'call closed:',
    'ret'
  ].join('\n');

  assert.deepEqual(getFoldingRanges(text), [
    { start: 2, end: 3 }
  ]);
});

test('isBalanced detects balanced and unbalanced documents', () => {
  assert.equal(isBalanced('call x:\nret'), true);
  assert.equal(isBalanced('call x:'), false);
  assert.equal(isBalanced('ret'), false);
});

test('getTodoCompletion completes a dash at line start', () => {
  assert.deepEqual(getTodoCompletion('-'), { start: 0, insertText: '- [ ] ' });
  assert.deepEqual(getTodoCompletion('- '), { start: 0, insertText: '- [ ] ' });
  assert.deepEqual(getTodoCompletion('  - '), { start: 0, insertText: '  - [ ] ' });
});

test('getTodoCompletion returns undefined outside todo context', () => {
  assert.equal(getTodoCompletion(''), undefined);
  assert.equal(getTodoCompletion(' '), undefined);
  assert.equal(getTodoCompletion('plain note'), undefined);
  assert.equal(getTodoCompletion('-x'), undefined);
  assert.equal(getTodoCompletion('- [ ] done'), undefined);
  assert.equal(getTodoCompletion('call task:'), undefined);
});

test('toggleTodoLine toggles unchecked and checked items', () => {
  assert.equal(toggleTodoLine('- [ ] write tests'), '- [x] write tests');
  assert.equal(toggleTodoLine('  - [x] done'), '  - [ ] done');
  assert.equal(toggleTodoLine('- [X] done'), '- [ ] done');
});

test('toggleTodoLine returns undefined for non-todo lines', () => {
  assert.equal(toggleTodoLine('- [] empty'), undefined);
  assert.equal(toggleTodoLine('plain note'), undefined);
  assert.equal(toggleTodoLine('call task:'), undefined);
});

test('getDocumentSymbols builds a nested tree', () => {
  const text = [
    'call outer:',
    '  call inner:',
    '  ret',
    'ret'
  ].join('\n');

  const symbols = getDocumentSymbols(text);
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].name, 'outer');
  assert.equal(symbols[0].start, 0);
  assert.equal(symbols[0].end, 3);
  assert.equal(symbols[0].children.length, 1);
  assert.equal(symbols[0].children[0].name, 'inner');
  assert.equal(symbols[0].children[0].start, 1);
  assert.equal(symbols[0].children[0].end, 2);
});

test('getDocumentSymbols handles siblings and unclosed blocks', () => {
  const text = [
    'call one:',
    'ret',
    'call two:',
    '  call nested:',
    '  ret'
  ].join('\n');

  const symbols = getDocumentSymbols(text);
  assert.equal(symbols.length, 2);
  assert.deepEqual(symbols.map((s) => s.name), ['one', 'two']);
  assert.equal(symbols[0].end, 1);
  assert.equal(symbols[1].end, 4);
  assert.equal(symbols[1].children.length, 1);
  assert.equal(symbols[1].children[0].name, 'nested');
  assert.equal(symbols[1].children[0].end, 4);
});

test('getRichTextSpans identifies bold text', () => {
  assert.deepEqual(getRichTextSpans('plain **bold** text'), [
    { kind: 'bold', line: 0, start: 8, end: 12 }
  ]);
});

test('getRichTextSpans identifies italic text', () => {
  assert.deepEqual(getRichTextSpans('plain *italic* text'), [
    { kind: 'italic', line: 0, start: 7, end: 13 }
  ]);
});

test('getRichTextSpans identifies bold italic text', () => {
  assert.deepEqual(getRichTextSpans('plain ***both*** text'), [
    { kind: 'boldItalic', line: 0, start: 9, end: 13 }
  ]);
});

test('getRichTextSpans identifies strikethrough text', () => {
  assert.deepEqual(getRichTextSpans('plain ~~deleted~~ text'), [
    { kind: 'strikethrough', line: 0, start: 8, end: 15 }
  ]);
});

test('getRichTextSpans identifies inline code', () => {
  assert.deepEqual(getRichTextSpans('plain `code` text'), [
    { kind: 'inlineCode', line: 0, start: 7, end: 11 }
  ]);
});

test('getRichTextSpans does not parse markers inside inline code', () => {
  assert.deepEqual(getRichTextSpans('plain `**code**` text'), [
    { kind: 'inlineCode', line: 0, start: 7, end: 15 }
  ]);
});

test('getRichTextSpans ignores unclosed markers', () => {
  assert.deepEqual(getRichTextSpans('plain **bold text'), []);
  assert.deepEqual(getRichTextSpans('plain *italic text'), []);
  assert.deepEqual(getRichTextSpans('plain `code text'), []);
});

test('getRichTextSpans identifies multiple spans across lines', () => {
  assert.deepEqual(getRichTextSpans('one **bold** and *italic*\nnext ~~done~~ and `code`'), [
    { kind: 'bold', line: 0, start: 6, end: 10 },
    { kind: 'italic', line: 0, start: 18, end: 24 },
    { kind: 'strikethrough', line: 1, start: 7, end: 11 },
    { kind: 'inlineCode', line: 1, start: 19, end: 23 }
  ]);
});

test('formatDocument canonicalizes indentation with spaces', () => {
  const text = [
    ' call outer:  ',
    'call inner:',
    '      ret',
    ' ret'
  ].join('\n');

  assert.equal(
    formatDocument(text, { tabSize: 2, insertSpaces: true })?.text,
    [
      'call outer:',
      '  call inner:',
      '  ret',
      'ret'
    ].join('\n')
  );
});

test('formatDocument canonicalizes indentation with tabs', () => {
  const text = [
    'call outer:',
    'call inner:',
    'ret',
    'ret'
  ].join('\n');

  assert.equal(
    formatDocument(text, { tabSize: 4, insertSpaces: false })?.text,
    [
      'call outer:',
      '\tcall inner:',
      '\tret',
      'ret'
    ].join('\n')
  );
});

test('formatDocument returns undefined for unbalanced documents', () => {
  assert.equal(formatDocument('call open:', { tabSize: 2, insertSpaces: true }), undefined);
  assert.equal(formatDocument('ret', { tabSize: 2, insertSpaces: true }), undefined);
});
