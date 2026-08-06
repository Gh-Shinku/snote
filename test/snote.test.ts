import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, getFoldingRanges, getTodoCompletion, isBalanced, parseLine } from '../src/snote';

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
