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
