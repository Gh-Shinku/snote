import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDocument,
  getCodeFenceCompletion,
  getCopyLineRange,
  getDocumentSymbols,
  getFormatLineEdits,
  getFoldingRanges,
  getRichTextSpans,
  getRichTextSpansForLines,
  getTodoCompletion,
  getTodoTree,
  isBalanced,
  parseLine,
  removeCommonIndent,
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

test('getFoldingRanges includes code fences inside and beside call blocks', () => {
  const text = [
    'call outer:',
    '  ```typescript',
    '  call code:',
    '  ret',
    '  ```',
    'ret',
    '```python',
    'print(1)',
    '```'
  ].join('\n');

  assert.deepEqual(getFoldingRanges(text), [
    { start: 0, end: 5 },
    { start: 1, end: 4 },
    { start: 6, end: 8 }
  ]);
});

test('getFoldingRanges keeps a long fence open until a matching close', () => {
  const text = ['````', 'code', '```', 'more code', '`````', 'ret'].join('\n');
  assert.deepEqual(getFoldingRanges(text), [{ start: 0, end: 4 }]);
});

test('getFoldingRanges folds an unclosed code fence to the last line', () => {
  assert.deepEqual(getFoldingRanges('```js\nconst value = 1;\nmore code'), [
    { start: 0, end: 2 }
  ]);
  assert.deepEqual(getFoldingRanges('```js'), []);
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

test('getCodeFenceCompletion opens a three backtick fence at line start', () => {
  assert.deepEqual(getCodeFenceCompletion('```', 0), {
    kind: 'open',
    insertText: '```${1:language}\n${0}\n```',
    snippet: true
  });
});

test('getCodeFenceCompletion opens a fence from one or two backticks', () => {
  assert.deepEqual(getCodeFenceCompletion('`', 0), {
    kind: 'open',
    insertText: '```${1:language}\n${0}\n```',
    snippet: true
  });
  assert.deepEqual(getCodeFenceCompletion('``', 0), {
    kind: 'open',
    insertText: '```${1:language}\n${0}\n```',
    snippet: true
  });
});

test('getCodeFenceCompletion keeps the indentation of an indented fence', () => {
  assert.deepEqual(getCodeFenceCompletion('\t\t````', 0), {
    kind: 'open',
    insertText: '\t\t````${1:language}\n\t\t${0}\n\t\t````',
    snippet: true
  });
});

test('getCodeFenceCompletion ignores non-fence backticks', () => {
  assert.equal(getCodeFenceCompletion('plain ```', 0), undefined);
  assert.equal(getCodeFenceCompletion('```typescript', 0), undefined);
  assert.equal(getCodeFenceCompletion('`typescript`', 0), undefined);
  assert.equal(getCodeFenceCompletion('', 0), undefined);
});

test('getCodeFenceCompletion closes a longer fence', () => {
  assert.deepEqual(getCodeFenceCompletion('```', 4), {
    kind: 'close',
    insertText: '````',
    snippet: false
  });
  assert.deepEqual(getCodeFenceCompletion('  ```', 5), {
    kind: 'close',
    insertText: '  `````',
    snippet: false
  });
});

test('getCodeFenceCompletion ignores fences that already close the block', () => {
  assert.equal(getCodeFenceCompletion('```', 3), undefined);
  assert.equal(getCodeFenceCompletion('`````', 3), undefined);
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

test('getTodoTree returns only unfinished items with their source positions', () => {
  const text = [
    '- [ ] first',
    '  - [x] completed',
    '- [X] also completed',
    '\t- [ ] **second**  ',
    '- [] invalid',
    '* [ ] unsupported',
    'plain - [ ] text',
    '-[ ] invalid',
    '- [ ]   '
  ].join('\n');
  assert.deepEqual(getTodoTree(text), [
    { kind: 'todo', title: 'first', line: 0, character: 0 },
    { kind: 'todo', title: '**second**', line: 3, character: 1 },
    { kind: 'todo', title: '', line: 8, character: 0 }
  ]);
});

test('getTodoTree preserves hierarchy and interleaved source order while pruning empty branches', () => {
  const text = [
    '- [ ] root before',
    'call outer:',
    '  - [ ] before child',
    '  call empty:',
    '    - [x] done',
    '  ret',
    '  call inner:',
    '    - [ ] nested',
    '  ret',
    '  - [ ] after child',
    'ret',
    '- [ ] root after',
    'call no tasks:',
    '  call empty descendant:',
    '  ret',
    'ret'
  ].join('\n');
  assert.deepEqual(getTodoTree(text), [
    { kind: 'todo', title: 'root before', line: 0, character: 0 },
    {
      kind: 'group', title: 'outer', line: 1, character: 0,
      children: [
        { kind: 'todo', title: 'before child', line: 2, character: 2 },
        {
          kind: 'group', title: 'inner', line: 6, character: 2,
          children: [{ kind: 'todo', title: 'nested', line: 7, character: 4 }]
        },
        { kind: 'todo', title: 'after child', line: 9, character: 2 }
      ]
    },
    { kind: 'todo', title: 'root after', line: 11, character: 0 }
  ]);
});

test('getTodoTree retains ancestor groups and distinguishes duplicate group titles', () => {
  const text = 'call same:\n  call same:\n    - [ ] nested\n  ret\nret\ncall same:\n- [ ] sibling\nret';
  assert.deepEqual(getTodoTree(text), [
    {
      kind: 'group', title: 'same', line: 0, character: 0,
      children: [{
        kind: 'group', title: 'same', line: 1, character: 2,
        children: [{ kind: 'todo', title: 'nested', line: 2, character: 4 }]
      }]
    },
    {
      kind: 'group', title: 'same', line: 5, character: 0,
      children: [{ kind: 'todo', title: 'sibling', line: 6, character: 0 }]
    }
  ]);
});

test('getTodoTree ignores TODOs and structural markers in fenced code', () => {
  const text = [
    'call real:',
    '  ````snote',
    'ret',
    'call fake:',
    '- [ ] literal',
    '```',
    '- [ ] still literal',
    '  `````',
    '  - [ ] real task',
    'ret',
    '```',
    '- [ ] also literal',
    '```',
    '- [ ] root task'
  ].join('\n');
  assert.deepEqual(getTodoTree(text), [
    {
      kind: 'group', title: 'real', line: 0, character: 0,
      children: [{ kind: 'todo', title: 'real task', line: 8, character: 2 }]
    },
    { kind: 'todo', title: 'root task', line: 13, character: 0 }
  ]);
});

test('getTodoTree ignores an unclosed fence through end of file', () => {
  assert.deepEqual(getTodoTree('- [ ] before\n```js\n- [ ] literal\nret'), [
    { kind: 'todo', title: 'before', line: 0, character: 0 }
  ]);
});

test('getTodoTree tolerates unmatched ret and unclosed call blocks', () => {
  assert.deepEqual(getTodoTree('ret\n- [ ] root\ncall open:\n  - [ ] child'), [
    { kind: 'todo', title: 'root', line: 1, character: 0 },
    {
      kind: 'group', title: 'open', line: 2, character: 0,
      children: [{ kind: 'todo', title: 'child', line: 3, character: 2 }]
    }
  ]);
});

test('getTodoTree supports LF, CRLF, and CR line endings', () => {
  for (const separator of ['\n', '\r\n', '\r']) {
    assert.deepEqual(getTodoTree(['call title:', '\t- [ ] 中文任务', 'ret', ''].join(separator)), [
      {
        kind: 'group', title: 'title', line: 0, character: 0,
        children: [{ kind: 'todo', title: '中文任务', line: 1, character: 1 }]
      }
    ]);
  }
});

test('getTodoTree returns no nodes for empty documents or completed branches', () => {
  for (const text of ['', '\n', '- [x] done', 'call empty:\nret', 'call done:\n- [X] done\nret']) {
    assert.deepEqual(getTodoTree(text), []);
  }
});

test('removeCommonIndent preserves nested structure and line endings', () => {
  const text = '    call task:\r\n        detail\r\n    ret\r\n';
  assert.equal(removeCommonIndent(text, 4), 'call task:\r\n    detail\r\nret\r\n');
  assert.equal(removeCommonIndent('  first\n  \n    second', 2), 'first\n  \n  second');
});

test('getCopyLineRange includes complete selected lines without an extra boundary line', () => {
  assert.deepEqual(getCopyLineRange(0, 3, 5), { start: 0, end: 3 });
  assert.deepEqual(getCopyLineRange(0, 4, 0), { start: 0, end: 3 });
  assert.deepEqual(getCopyLineRange(2, 2, 0), { start: 2, end: 2 });
});

test('removeCommonIndent uses visual columns for mixed tabs and spaces', () => {
  assert.equal(removeCommonIndent('\tcall task:\n    ret', 4), 'call task:\nret');
  assert.equal(removeCommonIndent('  first\n\tsecond', 4), 'first\n  second');
});

test('removeCommonIndent preserves relative indentation inside code fences', () => {
  const text = [
    '    call example:',
    '    ```python',
    'print("top level")',
    '  if ready:',
    '    print("nested")',
    '    ```',
    '    ret'
  ].join('\n');

  assert.equal(removeCommonIndent(text, 4), [
    'call example:',
    '```python',
    'print("top level")',
    '  if ready:',
    '    print("nested")',
    '```',
    'ret'
  ].join('\n'));

  assert.equal(removeCommonIndent('    ```python\n  if ready:\n    print(1)\n    ```', 4),
    '```python\nif ready:\n  print(1)\n```');
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

test('getRichTextSpans does not style backticks in code fences', () => {
  const text = [
    'before `inline`',
    '  ```typescript',
    '  **literal** and `literal`',
    '  ```',
    'after `inline`'
  ].join('\n');

  assert.deepEqual(getRichTextSpans(text), [
    { kind: 'inlineCode', line: 0, start: 8, end: 14 },
    { kind: 'inlineCode', line: 4, start: 7, end: 13 }
  ]);
  assert.deepEqual(getRichTextSpans('text ``` and `inline`'), [
    { kind: 'inlineCode', line: 0, start: 14, end: 20 }
  ]);
});

test('getRichTextSpansForLines respects a fence opened before the visible lines', () => {
  assert.deepEqual(getRichTextSpansForLines(['**literal**', '```', '*italic*'], 5, 3), [
    { kind: 'italic', line: 7, start: 1, end: 7 }
  ]);
});

test('a shorter backtick run does not close a longer code fence', () => {
  const text = ['````', '```', '**literal**', '````', '**bold**'].join('\n');
  assert.deepEqual(getRichTextSpans(text), [
    { kind: 'bold', line: 4, start: 2, end: 6 }
  ]);
  assert.deepEqual(getFormatLineEdits(text, { tabSize: 2, insertSpaces: true }), []);
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

test('getRichTextSpans ignores incomplete markers while typing', () => {
  for (const text of ['*', '**', '***', '~~', '`', '********']) {
    assert.deepEqual(getRichTextSpans(text), []);
  }
});

test('getRichTextSpans identifies multiple spans across lines', () => {
  assert.deepEqual(getRichTextSpans('one **bold** and *italic*\nnext ~~done~~ and `code`'), [
    { kind: 'bold', line: 0, start: 6, end: 10 },
    { kind: 'italic', line: 0, start: 18, end: 24 },
    { kind: 'strikethrough', line: 1, start: 7, end: 11 },
    { kind: 'inlineCode', line: 1, start: 19, end: 23 }
  ]);
});

test('getRichTextSpansForLines offsets line numbers', () => {
  assert.deepEqual(getRichTextSpansForLines(['**bold**', '`code`'], 10), [
    { kind: 'bold', line: 10, start: 2, end: 6 },
    { kind: 'inlineCode', line: 11, start: 1, end: 5 }
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

test('getFormatLineEdits returns no edits for already formatted documents', () => {
  const text = [
    'call outer:',
    '  call inner:',
    '  ret',
    'ret'
  ].join('\n');

  assert.deepEqual(getFormatLineEdits(text, { tabSize: 2, insertSpaces: true }), []);
});

test('formatDocument preserves whitespace-only blank lines', () => {
  const text = [
    'call outer:',
    '    ',
    'ret'
  ].join('\n');

  assert.equal(formatDocument(text, { tabSize: 2, insertSpaces: true })?.text, text);
  assert.deepEqual(getFormatLineEdits(text, { tabSize: 2, insertSpaces: true }), []);
});

test('formatDocument preserves fenced code and resumes indentation after it', () => {
  const text = [
    ' call outer:  ',
    '   ```typescript',
    ' call ignored:',
    '\t  ret  ',
    '   ```',
    'plain text',
    ' ret'
  ].join('\n');

  assert.equal(formatDocument(text, { tabSize: 2, insertSpaces: true })?.text, [
    'call outer:',
    '   ```typescript',
    ' call ignored:',
    '\t  ret  ',
    '   ```',
    '  plain text',
    'ret'
  ].join('\n'));
  assert.deepEqual(getFormatLineEdits(text, { tabSize: 2, insertSpaces: true }), [
    { line: 0, text: 'call outer:' },
    { line: 5, text: '  plain text' },
    { line: 6, text: 'ret' }
  ]);
  assert.equal(isBalanced(text), true);
});

test('formatDocument preserves an unclosed code fence through end of file', () => {
  const text = '```\n  ret\n  call ignored:';
  assert.equal(formatDocument(text, { tabSize: 2, insertSpaces: true })?.text, text);
  assert.deepEqual(getFormatLineEdits('```\n ret\n```', { tabSize: 2, insertSpaces: true }), []);
});

test('getFormatLineEdits returns only changed lines', () => {
  const text = [
    'call outer:',
    'call inner:',
    '  ret',
    'ret'
  ].join('\n');

  assert.deepEqual(getFormatLineEdits(text, { tabSize: 2, insertSpaces: true }), [
    { line: 1, text: '  call inner:' }
  ]);
});

test('getFormatLineEdits returns multiple changed lines', () => {
  const text = [
    ' call outer:  ',
    'call inner:',
    '      ret',
    ' ret'
  ].join('\n');

  assert.deepEqual(getFormatLineEdits(text, { tabSize: 2, insertSpaces: true }), [
    { line: 0, text: 'call outer:' },
    { line: 1, text: '  call inner:' },
    { line: 2, text: '  ret' },
    { line: 3, text: 'ret' }
  ]);
});

test('getFormatLineEdits returns undefined for unbalanced documents', () => {
  assert.equal(getFormatLineEdits('call open:', { tabSize: 2, insertSpaces: true }), undefined);
  assert.equal(getFormatLineEdits('ret', { tabSize: 2, insertSpaces: true }), undefined);
});

test('getFormatLineEdits handles saved rich text sample without full-document changes', () => {
  const text = [
    'call project:',
    '    call task one:',
    '        call what can i say:',
    '',
    '        ret',
    '',
    '    ret',
    '    call task two:',
    '        call detail:',
    '        ret',
    '    ret',
    '',
    '    - [ ] ssss',
    '    - [x] sss',
    '',
    '    *aaaaa*',
    '    **bbbbbb**',
    '    ~~aaaaaa~~',
    '    `code`',
    'ret'
  ].join('\n');

  assert.deepEqual(getFormatLineEdits(text, { tabSize: 4, insertSpaces: true }), []);
  assert.equal(getFormatLineEdits(text, { tabSize: 2, insertSpaces: true })?.length, 14);
  assert.deepEqual(getRichTextSpans(text), [
    { kind: 'italic', line: 15, start: 5, end: 10 },
    { kind: 'bold', line: 16, start: 6, end: 12 },
    { kind: 'strikethrough', line: 17, start: 6, end: 12 },
    { kind: 'inlineCode', line: 18, start: 5, end: 9 }
  ]);
});

test('getFormatLineEdits handles nested rich text sample with whitespace-only line', () => {
  const text = [
    'call project:',
    '    call task one:',
    '        call what can i say:',
    '',
    '        ret',
    '',
    '    ret',
    '    call task two:',
    '        call detail:',
    '        ret',
    '    ret',
    '',
    '    - [ ] ssss',
    '    - [x] sss',
    '',
    '    *aaaaa*',
    '    **bbbbbb**',
    '    ~~aaaaaa~~',
    '    `code`',
    '',
    '',
    '    call sss:',
    '        **bbbbbb**',
    '',
    '        ',
    '    ret',
    'ret'
  ].join('\n');

  assert.deepEqual(getFormatLineEdits(text, { tabSize: 4, insertSpaces: true }), []);
  assert.deepEqual(getRichTextSpans(text), [
    { kind: 'italic', line: 15, start: 5, end: 10 },
    { kind: 'bold', line: 16, start: 6, end: 12 },
    { kind: 'strikethrough', line: 17, start: 6, end: 12 },
    { kind: 'inlineCode', line: 18, start: 5, end: 9 },
    { kind: 'bold', line: 22, start: 10, end: 16 }
  ]);
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
