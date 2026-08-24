import * as vscode from 'vscode';
import {
  DocumentSymbol,
  RichTextKind,
  formatDocument,
  getDocumentSymbols,
  getFoldingRanges,
  getRichTextSpans,
  getTodoCompletion,
  toggleTodoLine
} from './snote';

const languageSelector: vscode.DocumentSelector = { language: 'snote' };
const richTextKinds: RichTextKind[] = ['bold', 'italic', 'boldItalic', 'strikethrough', 'inlineCode'];

export function activate(context: vscode.ExtensionContext): void {
  const richTextDecorations = createRichTextDecorationTypes();
  const richTextDecorationManager = new SnoteRichTextDecorationManager(richTextDecorations);

  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(languageSelector, new SnoteFoldingRangeProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(languageSelector, new SnoteDocumentFormattingProvider()),
    vscode.languages.registerCompletionItemProvider(languageSelector, new SnoteCompletionItemProvider(), 'c', '-', ' '),
    vscode.languages.registerDocumentSymbolProvider(languageSelector, new SnoteDocumentSymbolProvider()),
    vscode.commands.registerTextEditorCommand('snote.toggleTodo', toggleTodoInEditor),
    vscode.window.onDidChangeVisibleTextEditors((editors) => richTextDecorationManager.updateEditors(editors)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined) {
        richTextDecorationManager.updateEditor(editor);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => richTextDecorationManager.updateDocument(event.document)),
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
    const result = formatDocument(document.getText(), {
      tabSize: options.tabSize,
      insertSpaces: options.insertSpaces
    });

    if (!result) {
      void vscode.window.showWarningMessage('SNote format skipped: unbalanced call/ret pairs.');
      return [];
    }

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    return [vscode.TextEdit.replace(fullRange, result.text)];
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

function getCurrentWordRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
  const linePrefix = document.lineAt(position).text.slice(0, position.character);
  const currentWord = linePrefix.match(/[^\s:]*$/)?.[0] ?? '';
  return new vscode.Range(position.line, position.character - currentWord.length, position.line, position.character);
}

type RichTextDecorationTypes = Record<RichTextKind, vscode.TextEditorDecorationType>;

class SnoteRichTextDecorationManager {
  constructor(private readonly decorations: RichTextDecorationTypes) {}

  updateEditors(editors: readonly vscode.TextEditor[]): void {
    for (const editor of editors) {
      this.updateEditor(editor);
    }
  }

  updateDocument(document: vscode.TextDocument): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === document) {
        this.updateEditor(editor);
      }
    }
  }

  updateEditor(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== 'snote') {
      this.clearEditor(editor);
      return;
    }

    const ranges = createRichTextDecorationRanges();

    for (const span of getRichTextSpans(editor.document.getText())) {
      ranges[span.kind].push(new vscode.Range(span.line, span.start, span.line, span.end));
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
