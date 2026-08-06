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
