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

export function getTodoCompletion(linePrefix: string): TodoCompletion | undefined {
  const match = todoPrefixPattern.exec(linePrefix);

  if (!match) {
    return undefined;
  }

  return { start: 0, insertText: `${match[1]}- [ ] ` };
}

export function toggleTodoLine(raw: string): string | undefined {
  const match = todoItemPattern.exec(raw);

  if (!match) {
    return undefined;
  }

  const [, prefix, box, rest] = match;
  const checked = box === 'x' || box === 'X';
  return `${prefix}[${checked ? ' ' : 'x'}]${rest}`;
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
  return splitLines(text).map((line, index) => parseLine(line, index));
}

export function getRichTextSpans(text: string): RichTextSpan[] {
  return splitLines(text).flatMap((line, index) => getRichTextSpansForLine(line, index));
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

      if (markerEnd > contentStart) {
        return {
          span: { kind, line: lineIndex, start: contentStart, end: markerEnd },
          markerStart,
          nextOffset: markerEnd + close.length
        };
      }

      markerEnd += close.length;
    }
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
  }

  return undefined;
}

export function getFoldingRanges(text: string): FoldingRange[] {
  const stack: number[] = [];
  const ranges: FoldingRange[] = [];

  for (const line of parseDocument(text)) {
    if (line.kind === 'call') {
      stack.push(line.index);
      continue;
    }

    if (line.kind === 'ret') {
      const start = stack.pop();
      if (start !== undefined && line.index > start) {
        ranges.push({ start, end: line.index });
      }
    }
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

  const lines = splitLines(text);
  const indentUnit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
  let depth = 0;

  const formatted = lines.map((raw, index) => {
    const line = parseLine(raw, index);

    if (line.trimmed.length === 0) {
      return '';
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

  return { text: formatted.join('\n') };
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}
