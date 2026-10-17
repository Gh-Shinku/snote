export type LineKind = 'call' | 'ret' | 'other';

export interface ParsedLine {
  readonly index: number;
  readonly raw: string;
  readonly trimmed: string;
  readonly kind: LineKind;
}

export interface FoldingRange {
  readonly start: number;
  readonly end: number;
}

export interface FormatOptions {
  readonly tabSize: number;
  readonly insertSpaces: boolean;
}

export interface FormatResult {
  readonly text: string;
}

export interface FormatLineEdit {
  readonly line: number;
  readonly text: string;
}

export type RichTextKind = 'bold' | 'italic' | 'boldItalic' | 'strikethrough' | 'inlineCode';

export interface RichTextSpan {
  readonly kind: RichTextKind;
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

const callPattern = /^call\s+.+:\s*$/;
const retPattern = /^ret\s*$/;
const todoPrefixPattern = /^(\s*)(-\s*)$/;
const todoItemPattern = /^(\s*-\s+)\[([ xX])\](.*)$/;

export interface CallHeader {
  readonly title: string;
  readonly todo?: {
    readonly checked: boolean;
    readonly markerStart: number;
  };
}

export function parseCallHeader(raw: string): CallHeader | undefined {
  if (!callPattern.test(raw.trim())) {
    return undefined;
  }

  const match = /^(\s*call\s+)(.+):\s*$/.exec(raw)!;
  const task = /^\[([ xX])\]\s+(\S(?:.*\S)?)\s*$/.exec(match[2]);
  return task === null
    ? { title: match[2] }
    : { title: task[2], todo: { checked: task[1] !== ' ', markerStart: match[1].length } };
}

export function parseLine(raw: string, index: number): ParsedLine {
  const trimmed = raw.trim();

  if (callPattern.test(trimmed)) {
    return { index, raw, trimmed, kind: 'call' };
  }

  if (retPattern.test(trimmed)) {
    return { index, raw, trimmed, kind: 'ret' };
  }

  return { index, raw, trimmed, kind: 'other' };
}

export interface TodoCompletion {
  readonly start: number;
  readonly insertText: string;
}

export type CodeFenceCompletionKind = 'open' | 'close';

export interface CodeFenceCompletion {
  readonly kind: CodeFenceCompletionKind;
  readonly insertText: string;
  readonly snippet: boolean;
}

const codeFenceLinePattern = /^(\s*)(`{1,})$/;
const minimumCodeFenceLength = 3;

export function getCodeFenceCompletion(linePrefix: string, fenceLength: number): CodeFenceCompletion | undefined {
  const match = codeFenceLinePattern.exec(linePrefix);

  if (match === null) {
    return undefined;
  }

  const [, indent, ticks] = match;

  if (fenceLength > 0) {
    // Only offer a closing fence when the typed run is too short to close the
    // block: a run that already closes it needs no help from the editor.
    if (ticks.length >= fenceLength) {
      return undefined;
    }

    return { kind: 'close', insertText: `${indent}${'`'.repeat(fenceLength)}`, snippet: false };
  }

  const fence = '`'.repeat(Math.max(ticks.length, minimumCodeFenceLength));

  // The replacement covers the whole line prefix, including its indentation,
  // because editors may prepend the current line indentation to every snippet
  // line after the first: emitting the indentation explicitly here keeps the
  // closing fence aligned instead of double indented.
  return {
    kind: 'open',
    insertText: `${indent}${fence}\${1:language}\n${indent}\${0}\n${indent}${fence}`,
    snippet: true
  };
}

export function getTodoCompletion(linePrefix: string): TodoCompletion | undefined {
  const match = todoPrefixPattern.exec(linePrefix);

  if (!match) {
    return undefined;
  }

  return { start: 0, insertText: `${match[1]}- [ ] ` };
}

export function toggleTodoLine(raw: string): string | undefined {
  const header = parseCallHeader(raw);
  if (header?.todo !== undefined) {
    const { checked, markerStart } = header.todo;
    return `${raw.slice(0, markerStart + 1)}${checked ? ' ' : 'x'}${raw.slice(markerStart + 2)}`;
  }

  const match = todoItemPattern.exec(raw);

  if (!match) {
    return undefined;
  }

  const [, prefix, box, rest] = match;
  const checked = box === 'x' || box === 'X';
  return `${prefix}[${checked ? ' ' : 'x'}]${rest}`;
}

export type TodoTreeNode = TodoGroup | TodoItem;

export interface TodoGroup {
  readonly kind: 'group';
  readonly title: string;
  readonly line: number;
  readonly character: number;
  readonly children: TodoTreeNode[];
  readonly completed?: boolean;
}

export interface TodoItem {
  readonly kind: 'todo';
  readonly title: string;
  readonly line: number;
  readonly character: number;
  readonly children?: TodoTreeNode[];
}

export function getTodoTree(text: string): TodoTreeNode[] {
  const roots: TodoTreeNode[] = [];
  const stack: Array<TodoTreeNode & { children: TodoTreeNode[] }> = [];
  let fenceLength = 0;

  for (const line of parseDocument(text)) {
    const nextFenceLength = getCodeFenceLengthAfterLine(line.raw, fenceLength);
    const insideFence = fenceLength > 0 || nextFenceLength > 0;
    fenceLength = nextFenceLength;
    if (insideFence) {
      continue;
    }

    const children = stack.length > 0 ? stack[stack.length - 1].children : roots;
    if (line.kind === 'call') {
      const header = parseCallHeader(line.raw)!;
      const block = {
        title: header.title,
        line: line.index,
        character: line.raw.search(/\S/),
        children: []
      };
      const node: TodoTreeNode & { children: TodoTreeNode[] } = header.todo?.checked === false
        ? { ...block, kind: 'todo' }
        : { ...block, kind: 'group', ...(header.todo?.checked ? { completed: true } : {}) };
      children.push(node);
      stack.push(node);
    } else if (line.kind === 'ret') {
      stack.pop();
    } else {
      const match = todoItemPattern.exec(line.raw);
      if (match !== null && match[2] === ' ') {
        children.push({
          kind: 'todo',
          title: match[3].trim(),
          line: line.index,
          character: line.raw.search(/\S/)
        });
      }
    }
  }

  const pruneEmptyGroups = (nodes: TodoTreeNode[]): TodoTreeNode[] => {
    return nodes.flatMap((node): TodoTreeNode[] => {
      if (node.kind === 'todo') {
        return [node.children === undefined ? node : { ...node, children: pruneEmptyGroups(node.children) }];
      }
      const children = pruneEmptyGroups(node.children);
      return children.length > 0 ? [{ ...node, children }] : [];
    });
  };

  return pruneEmptyGroups(roots);
}

export function getCopyLineRange(startLine: number, endLine: number, endCharacter: number): { start: number; end: number } {
  return {
    start: startLine,
    end: endLine > startLine && endCharacter === 0 ? endLine - 1 : endLine
  };
}

export function removeCommonIndent(text: string, tabSize: number): string {
  tabSize = Math.max(1, Math.floor(tabSize));
  const parts = text.split(/(\r\n|\n|\r)/);
  const lines = parts.filter((_, index) => index % 2 === 0);
  const codeGroups: number[][] = [];
  const structuralLines: number[] = [];
  let fenceLength = 0;
  let codeGroup: number[] | undefined;

  lines.forEach((line, index) => {
    const nextFenceLength = getCodeFenceLengthAfterLine(line, fenceLength);
    if (fenceLength > 0 && nextFenceLength > 0) {
      if (codeGroup === undefined) {
        codeGroup = [];
        codeGroups.push(codeGroup);
      }
      codeGroup.push(index);
    } else {
      structuralLines.push(index);
      codeGroup = undefined;
    }
    fenceLength = nextFenceLength;
  });

  const indentWidth = (line: string): number => {
    let width = 0;
    for (const character of line) {
      if (character === ' ') {
        width += 1;
      } else if (character === '\t') {
        width += tabSize - (width % tabSize);
      } else {
        break;
      }
    }
    return width;
  };

  const minimumIndent = (indices: readonly number[]): number => {
    const widths = indices.filter((index) => lines[index].trim().length > 0).map((index) => indentWidth(lines[index]));
    const minimum = widths.reduce((current, width) => Math.min(current, width), Infinity);
    return minimum === Infinity ? 0 : minimum;
  };

  const structuralIndent = minimumIndent(structuralLines);
  const widths = lines.map(() => structuralIndent);
  for (const group of codeGroups) {
    const groupIndent = Math.min(structuralIndent, minimumIndent(group));
    for (const index of group) {
      widths[index] = groupIndent;
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().length === 0) {
      continue;
    }
    let removed = 0;
    let offset = 0;
    let remainingSpaces = '';
    while (offset < lines[index].length && removed < widths[index]) {
      const character = lines[index][offset];
      const next = character === '\t' ? removed + tabSize - (removed % tabSize) : removed + 1;
      if (character !== ' ' && character !== '\t') {
        break;
      }
      if (next > widths[index]) {
        remainingSpaces = ' '.repeat(next - widths[index]);
        offset += 1;
        break;
      }
      removed = next;
      offset += 1;
    }
    parts[index * 2] = remainingSpaces + lines[index].slice(offset);
  }

  return parts.join('');
}

export interface DocumentSymbol {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly children: DocumentSymbol[];
}

interface SymbolNode {
  name: string;
  start: number;
  end: number;
  children: SymbolNode[];
}

export function getDocumentSymbols(text: string): DocumentSymbol[] {
  const symbols: SymbolNode[] = [];
  const stack: SymbolNode[] = [];
  const lines = parseDocument(text);

  for (const line of lines) {
    if (line.kind === 'call') {
      const symbol: SymbolNode = {
        name: line.trimmed.replace(/^call\s+/, '').replace(/:\s*$/, ''),
        start: line.index,
        end: line.index,
        children: []
      };

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(symbol);
      } else {
        symbols.push(symbol);
      }

      stack.push(symbol);
      continue;
    }

    if (line.kind === 'ret') {
      const symbol = stack.pop();
      if (symbol !== undefined) {
        symbol.end = line.index;
      }
    }
  }

  const lastIndex = lines.length - 1;
  for (const symbol of stack) {
    symbol.end = lastIndex;
  }

  return symbols;
}

export function parseDocument(text: string): ParsedLine[] {
  let fenceLength = 0;

  return splitLines(text).map((raw, index) => {
    const trimmed = raw.trim();
    const nextFenceLength = getCodeFenceLengthAfterLine(trimmed, fenceLength);
    if (fenceLength > 0 || nextFenceLength > 0) {
      fenceLength = nextFenceLength;
      return { index, raw, trimmed, kind: 'other' };
    }

    return parseLine(raw, index);
  });
}

export function getRichTextSpans(text: string): RichTextSpan[] {
  return getRichTextSpansForLines(splitLines(text), 0);
}

export function getRichTextSpansForLines(
  lines: readonly string[],
  startLine: number,
  initialFenceLength = 0
): RichTextSpan[] {
  const spans: RichTextSpan[] = [];
  let fenceLength = initialFenceLength;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const nextFenceLength = getCodeFenceLengthAfterLine(trimmed, fenceLength);
    if (fenceLength === 0 && nextFenceLength === 0) {
      spans.push(...getRichTextSpansForLine(line, startLine + index));
    }
    fenceLength = nextFenceLength;
  });

  return spans;
}

export function getCodeFenceLengthAfterLine(line: string, currentLength: number): number {
  const trimmed = line.trim();
  if (currentLength > 0) {
    return /^`+\s*$/.test(trimmed) && getCodeFenceLength(trimmed) >= currentLength ? 0 : currentLength;
  }

  return getCodeFenceLength(trimmed);
}

function getCodeFenceLength(line: string): number {
  const match = /^(`{3,})([^`]*)$/.exec(line.trim());
  return match === null ? 0 : match[1].length;
}

function getRichTextSpansForLine(line: string, lineIndex: number): RichTextSpan[] {
  const spans: RichTextSpan[] = [];
  let offset = 0;

  while (offset < line.length) {
    const next = findNextRichTextSpan(line, lineIndex, offset);

    if (next === undefined) {
      break;
    }

    spans.push(next.span);
    offset = next.nextOffset;
  }

  return spans;
}

function findNextRichTextSpan(
  line: string,
  lineIndex: number,
  offset: number
): { span: RichTextSpan; nextOffset: number } | undefined {
  const candidates = [
    findDelimitedSpan(line, lineIndex, offset, '`', '`', 'inlineCode'),
    findDelimitedSpan(line, lineIndex, offset, '***', '***', 'boldItalic'),
    findDelimitedSpan(line, lineIndex, offset, '**', '**', 'bold'),
    findDelimitedSpan(line, lineIndex, offset, '~~', '~~', 'strikethrough'),
    findItalicSpan(line, lineIndex, offset)
  ].filter((candidate): candidate is { span: RichTextSpan; markerStart: number; nextOffset: number } => {
    return candidate !== undefined;
  });

  return candidates.sort((left, right) => {
    return left.markerStart - right.markerStart || left.nextOffset - right.nextOffset;
  })[0];
}

function findDelimitedSpan(
  line: string,
  lineIndex: number,
  offset: number,
  open: string,
  close: string,
  kind: RichTextKind
): { span: RichTextSpan; markerStart: number; nextOffset: number } | undefined {
  let markerStart = offset;

  while (markerStart < line.length) {
    markerStart = line.indexOf(open, markerStart);

    if (markerStart < 0) {
      return undefined;
    }

    if (kind === 'bold' && line.startsWith('***', markerStart)) {
      markerStart += 3;
      continue;
    }

    if (kind === 'inlineCode' && (line[markerStart - 1] === '`' || line[markerStart + 1] === '`')) {
      markerStart += 1;
      continue;
    }

    const contentStart = markerStart + open.length;
    let markerEnd = contentStart;

    while (markerEnd < line.length) {
      markerEnd = line.indexOf(close, markerEnd);

      if (markerEnd < 0) {
        return undefined;
      }

      if (kind === 'bold' && line.startsWith('***', markerEnd)) {
        markerEnd += 3;
        continue;
      }

      if (kind === 'inlineCode' && (line[markerEnd - 1] === '`' || line[markerEnd + 1] === '`')) {
        markerEnd += 1;
        continue;
      }

      if (markerEnd > contentStart) {
        return {
          span: { kind, line: lineIndex, start: contentStart, end: markerEnd },
          markerStart,
          nextOffset: markerEnd + close.length
        };
      }

      markerEnd += close.length;
    }

    // There is no possible closing marker after contentStart. Returning here
    // also guarantees that an incomplete marker at end-of-line cannot rescan
    // the same markerStart forever while the user is typing.
    return undefined;
  }

  return undefined;
}

function findItalicSpan(
  line: string,
  lineIndex: number,
  offset: number
): { span: RichTextSpan; markerStart: number; nextOffset: number } | undefined {
  let markerStart = offset;

  while (markerStart < line.length) {
    markerStart = line.indexOf('*', markerStart);

    if (markerStart < 0) {
      return undefined;
    }

    if (line.startsWith('**', markerStart)) {
      markerStart += 2;
      continue;
    }

    const contentStart = markerStart + 1;
    let markerEnd = contentStart;

    while (markerEnd < line.length) {
      markerEnd = line.indexOf('*', markerEnd);

      if (markerEnd < 0) {
        return undefined;
      }

      if (!line.startsWith('**', markerEnd) && markerEnd > contentStart) {
        return {
          span: { kind: 'italic', line: lineIndex, start: contentStart, end: markerEnd },
          markerStart,
          nextOffset: markerEnd + 1
        };
      }

      markerEnd += line.startsWith('**', markerEnd) ? 2 : 1;
    }

    // See findDelimitedSpan: an incomplete italic marker must not retry the
    // same start offset indefinitely.
    return undefined;
  }

  return undefined;
}

export function getFoldingRanges(text: string): FoldingRange[] {
  const stack: number[] = [];
  const ranges: FoldingRange[] = [];
  const lines = parseDocument(text);
  let fenceLength = 0;
  let fenceStart: number | undefined;

  for (const line of lines) {
    const nextFenceLength = getCodeFenceLengthAfterLine(line.trimmed, fenceLength);
    const isFenceLine = fenceLength > 0 || nextFenceLength > 0;

    if (fenceLength === 0 && nextFenceLength > 0) {
      fenceStart = line.index;
    } else if (fenceLength > 0 && nextFenceLength === 0 && fenceStart !== undefined) {
      ranges.push({ start: fenceStart, end: line.index });
      fenceStart = undefined;
    }

    fenceLength = nextFenceLength;
    if (isFenceLine) {
      continue;
    }

    if (line.kind === 'call') {
      stack.push(line.index);
      continue;
    }

    if (line.kind === 'ret') {
      const start = stack.pop();
      if (start !== undefined && line.index > start + 1) {
        // Hide only the body so both call and its matching ret stay visible.
        ranges.push({ start, end: line.index - 1 });
      }
    }
  }

  if (fenceStart !== undefined && lines.length - 1 > fenceStart) {
    ranges.push({ start: fenceStart, end: lines.length - 1 });
  }

  return ranges.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function isBalanced(text: string): boolean {
  let depth = 0;

  for (const line of parseDocument(text)) {
    if (line.kind === 'call') {
      depth += 1;
      continue;
    }

    if (line.kind === 'ret') {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }

  return depth === 0;
}

export function formatDocument(text: string, options: FormatOptions): FormatResult | undefined {
  if (!isBalanced(text)) {
    return undefined;
  }

  return { text: getFormattedLines(text, options).join('\n') };
}

export function getFormatLineEdits(text: string, options: FormatOptions): FormatLineEdit[] | undefined {
  if (!isBalanced(text)) {
    return undefined;
  }

  const original = splitLines(text);
  const formatted = getFormattedLines(text, options);
  const edits: FormatLineEdit[] = [];

  for (let index = 0; index < formatted.length; index += 1) {
    if (original[index] !== formatted[index]) {
      edits.push({ line: index, text: formatted[index] });
    }
  }

  return edits;
}

function getFormattedLines(text: string, options: FormatOptions): string[] {
  const lines = parseDocument(text);
  const indentUnit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
  let depth = 0;
  let fenceLength = 0;

  return lines.map((line) => {
    const nextFenceLength = getCodeFenceLengthAfterLine(line.trimmed, fenceLength);
    if (fenceLength > 0 || nextFenceLength > 0) {
      fenceLength = nextFenceLength;
      return line.raw;
    }

    if (line.trimmed.length === 0) {
      return line.raw;
    }

    if (line.kind === 'ret') {
      depth = Math.max(0, depth - 1);
    }

    const next = `${indentUnit.repeat(depth)}${line.trimmed}`;

    if (line.kind === 'call') {
      depth += 1;
    }

    return next;
  });
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}
