import * as vscode from 'vscode';
import {
  DocumentSymbol,
  RichTextKind,
  getCodeFenceLengthAfterLine,
  getCopyLineRange,
  getDocumentSymbols,
  getFormatLineEdits,
  getFoldingRanges,
  getRichTextSpansForLines,
  getTodoCompletion,
  removeCommonIndent,
  toggleTodoLine
} from './snote';

const languageSelector: vscode.DocumentSelector = { language: 'snote' };
const richTextKinds: RichTextKind[] = ['bold', 'italic', 'boldItalic', 'strikethrough', 'inlineCode'];
const richTextRefreshDelayMs = 150;

export function activate(context: vscode.ExtensionContext): void {
  const richTextDecorations = createRichTextDecorationTypes();
  const richTextDecorationManager = new SnoteRichTextDecorationManager(richTextDecorations);

  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(languageSelector, new SnoteFoldingRangeProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(languageSelector, new SnoteDocumentFormattingProvider()),
    vscode.languages.registerCompletionItemProvider(languageSelector, new SnoteCompletionItemProvider(), 'c', '-', ' ', '*', '~', '`'),
    vscode.languages.registerDocumentSymbolProvider(languageSelector, new SnoteDocumentSymbolProvider()),
    vscode.commands.registerTextEditorCommand('snote.toggleTodo', toggleTodoInEditor),
    vscode.commands.registerTextEditorCommand('snote.copyWithoutIndentation', copyWithoutIndentation),
    vscode.window.onDidChangeVisibleTextEditors((editors) => richTextDecorationManager.updateEditors(editors)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined) {
        richTextDecorationManager.updateEditors([editor]);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => richTextDecorationManager.updateDocument(event.document)),
    richTextDecorationManager,
    ...Object.values(richTextDecorations)
  );

  richTextDecorationManager.updateEditors(vscode.window.visibleTextEditors);
}

export function deactivate(): void {}

class SnoteFoldingRangeProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.ProviderResult<vscode.FoldingRange[]> {
    return getFoldingRanges(document.getText()).map(
      (range) => new vscode.FoldingRange(range.start, range.end, vscode.FoldingRangeKind.Region)
    );
  }
}

class SnoteDocumentFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    try {
      const edits = getFormatLineEdits(document.getText(), {
        tabSize: options.tabSize,
        insertSpaces: options.insertSpaces
      });

      if (!edits || edits.length === 0) {
        return [];
      }

      return edits.map((edit) => vscode.TextEdit.replace(document.lineAt(edit.line).range, edit.text));
    } catch (error) {
      console.error('SNote formatter failed.', error);
      return [];
    }
  }
}

class SnoteCompletionItemProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const items: vscode.CompletionItem[] = [];

    const callItem = getCallCompletion(document, position);
    if (callItem !== undefined) {
      items.push(callItem);
    }

    const todoItem = getTodoCompletionItem(document, position);
    if (todoItem !== undefined) {
      items.push(todoItem);
    }

    const richTextItem = getRichTextCompletion(document, position);
    if (richTextItem !== undefined) {
      items.push(richTextItem);
    }

    return items;
  }
}

function getCallCompletion(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem | undefined {
  const range = getCurrentWordRange(document, position);
  const prefix = document.getText(range);

  if (prefix.length === 0 || !'call'.startsWith(prefix)) {
    return undefined;
  }

  const item = new vscode.CompletionItem('call block', vscode.CompletionItemKind.Snippet);
  item.detail = 'SNote call/ret block';
  item.documentation = 'Insert a nested SNote call block.';
  item.filterText = 'call';
  item.insertText = new vscode.SnippetString('call ${1:title}:\n\t${0}\nret');
  item.preselect = true;
  item.range = range;
  item.sortText = '0000';

  return item;
}

function getTodoCompletionItem(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem | undefined {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const completion = getTodoCompletion(linePrefix);

  if (completion === undefined) {
    return undefined;
  }

  const item = new vscode.CompletionItem('TODO item', vscode.CompletionItemKind.Snippet);
  item.detail = 'SNote TODO item';
  item.documentation = 'Insert a `- [ ]` TODO item.';
  item.filterText = '-';
  item.insertText = completion.insertText;
  item.preselect = true;
  item.range = new vscode.Range(position.line, completion.start, position.line, position.character);
  item.sortText = '0001';

  return item;
}

function getRichTextCompletion(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem | undefined {
  const range = getCurrentWordRange(document, position);
  const marker = document.getText(range);
  const completion = getRichTextCompletionDefinition(marker);

  if (completion === undefined) {
    return undefined;
  }

  const item = new vscode.CompletionItem(completion.label, vscode.CompletionItemKind.Operator);
  item.detail = 'SNote rich text';
  item.documentation = completion.documentation;
  item.filterText = marker;
  item.insertText = new vscode.SnippetString(completion.insertText);
  item.preselect = true;
  item.range = range;
  item.sortText = completion.sortText;

  return item;
}

function getRichTextCompletionDefinition(
  marker: string
): { label: string; documentation: string; insertText: string; sortText: string } | undefined {
  switch (marker) {
    case '*':
      return { label: 'italic', documentation: 'Insert italic text.', insertText: '*${1:text}*', sortText: '0002' };
    case '**':
      return { label: 'bold', documentation: 'Insert bold text.', insertText: '**${1:text}**', sortText: '0002' };
    case '***':
      return {
        label: 'bold italic',
        documentation: 'Insert bold italic text.',
        insertText: '***${1:text}***',
        sortText: '0002'
      };
    case '~':
    case '~~':
      return {
        label: 'strikethrough',
        documentation: 'Insert strikethrough text.',
        insertText: '~~${1:text}~~',
        sortText: '0002'
      };
    case '`':
      return { label: 'inline code', documentation: 'Insert inline code.', insertText: '`${1:code}`', sortText: '0002' };
    default:
      return undefined;
  }
}

class SnoteDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    return getDocumentSymbols(document.getText()).map((symbol) => toVscodeSymbol(symbol, document));
  }
}

function toVscodeSymbol(symbol: DocumentSymbol, document: vscode.TextDocument): vscode.DocumentSymbol {
  const range = new vscode.Range(symbol.start, 0, symbol.end, document.lineAt(symbol.end).text.length);
  const selectionRange = new vscode.Range(symbol.start, 0, symbol.start, document.lineAt(symbol.start).text.length);

  const result = new vscode.DocumentSymbol(symbol.name, '', vscode.SymbolKind.Namespace, range, selectionRange);
  result.children = symbol.children.map((child) => toVscodeSymbol(child, document));
  return result;
}

function toggleTodoInEditor(editor: vscode.TextEditor): void {
  const edit = new vscode.WorkspaceEdit();
  const handledLines = new Set<number>();

  for (const selection of editor.selections) {
    const line = editor.document.lineAt(selection.start.line);
    const toggled = toggleTodoLine(line.text);

    if (toggled !== undefined && !handledLines.has(line.lineNumber)) {
      handledLines.add(line.lineNumber);
      edit.replace(editor.document.uri, line.range, toggled);
    }
  }

  if (handledLines.size > 0) {
    void vscode.workspace.applyEdit(edit);
  }
}

async function copyWithoutIndentation(editor: vscode.TextEditor): Promise<void> {
  const selections = editor.selections.filter((selection) => !selection.isEmpty);
  if (selections.length === 0) {
    void vscode.window.showInformationMessage('Select text to copy without indentation.');
    return;
  }

  const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;
  const separator = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const text = selections
    .map((selection) => {
      const lines = getCopyLineRange(selection.start.line, selection.end.line, selection.end.character);
      const range = new vscode.Range(lines.start, 0, lines.end, editor.document.lineAt(lines.end).text.length);
      return removeCommonIndent(editor.document.getText(range), tabSize);
    })
    .join(separator);
  await vscode.env.clipboard.writeText(text);
}

function getCurrentWordRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
  const linePrefix = document.lineAt(position).text.slice(0, position.character);
  const currentWord = linePrefix.match(/[^\s:]*$/)?.[0] ?? '';
  return new vscode.Range(position.line, position.character - currentWord.length, position.line, position.character);
}

type RichTextDecorationTypes = Record<RichTextKind, vscode.TextEditorDecorationType>;

class SnoteRichTextDecorationManager {
  private readonly pendingEditors = new Set<vscode.TextEditor>();
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(private readonly decorations: RichTextDecorationTypes) {}

  dispose(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    this.pendingEditors.clear();
  }

  updateEditors(editors: readonly vscode.TextEditor[]): void {
    for (const editor of editors) {
      this.scheduleEditor(editor);
    }
  }

  updateDocument(document: vscode.TextDocument): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === document) {
        this.scheduleEditor(editor);
      }
    }
  }

  updateEditor(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== 'snote') {
      this.clearEditor(editor);
      return;
    }

    const ranges = createRichTextDecorationRanges();
    const visibleLineRanges = getVisibleLineRanges(editor);

    if (visibleLineRanges.length === 0) {
      for (const kind of richTextKinds) {
        editor.setDecorations(this.decorations[kind], ranges[kind]);
      }
      return;
    }

    let fenceLength = 0;
    let nextLine = 0;
    for (const visibleRange of visibleLineRanges) {
      for (; nextLine < visibleRange.start; nextLine += 1) {
        fenceLength = getCodeFenceLengthAfterLine(editor.document.lineAt(nextLine).text, fenceLength);
      }

      const lines: string[] = [];

      for (let line = visibleRange.start; line <= visibleRange.end; line += 1) {
        lines.push(editor.document.lineAt(line).text);
      }

      for (const span of getRichTextSpansForLines(lines, visibleRange.start, fenceLength)) {
        ranges[span.kind].push(new vscode.Range(span.line, span.start, span.line, span.end));
      }

      for (const line of lines) {
        fenceLength = getCodeFenceLengthAfterLine(line, fenceLength);
      }
      nextLine = visibleRange.end + 1;
    }

    for (const kind of richTextKinds) {
      editor.setDecorations(this.decorations[kind], ranges[kind]);
    }
  }

  private clearEditor(editor: vscode.TextEditor): void {
    for (const kind of richTextKinds) {
      editor.setDecorations(this.decorations[kind], []);
    }
  }

  private scheduleEditor(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== 'snote') {
      this.clearEditor(editor);
      return;
    }

    this.pendingEditors.add(editor);

    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      const editors = [...this.pendingEditors];
      this.pendingEditors.clear();
      this.refreshTimer = undefined;

      for (const pendingEditor of editors) {
        this.updateEditor(pendingEditor);
      }
    }, richTextRefreshDelayMs);
  }
}

function getVisibleLineRanges(editor: vscode.TextEditor): Array<{ start: number; end: number }> {
  return editor.visibleRanges.map((range) => {
    return {
      start: range.start.line,
      end: Math.min(range.end.line, editor.document.lineCount - 1)
    };
  });
}

function createRichTextDecorationTypes(): RichTextDecorationTypes {
  return {
    bold: vscode.window.createTextEditorDecorationType({
      fontWeight: 'bold',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    }),
    italic: vscode.window.createTextEditorDecorationType({
      fontStyle: 'italic',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    }),
    boldItalic: vscode.window.createTextEditorDecorationType({
      fontStyle: 'italic',
      fontWeight: 'bold',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    }),
    strikethrough: vscode.window.createTextEditorDecorationType({
      textDecoration: 'line-through',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    }),
    inlineCode: vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('textCodeBlock.background'),
      border: '1px solid',
      borderColor: new vscode.ThemeColor('editorWidget.border'),
      borderRadius: '3px',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    })
  };
}

function createRichTextDecorationRanges(): Record<RichTextKind, vscode.Range[]> {
  return {
    bold: [],
    italic: [],
    boldItalic: [],
    strikethrough: [],
    inlineCode: []
  };
}
