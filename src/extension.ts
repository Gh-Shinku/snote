import * as vscode from 'vscode';
import { basename } from 'node:path';
import {
  DocumentSymbol,
  RichTextKind,
  TodoTreeNode,
  getCodeFenceCompletion,
  getCodeFenceLengthAfterLine,
  getCopyLineRange,
  getDocumentSymbols,
  getFormatLineEdits,
  getFoldingRanges,
  getRichTextSpansForLines,
  getTodoCompletion,
  getTodoTree,
  removeCommonIndent,
  toggleTodoLine
} from './snote';

const languageSelector: vscode.DocumentSelector = { language: 'snote' };
const richTextKinds: RichTextKind[] = ['bold', 'italic', 'boldItalic', 'strikethrough', 'inlineCode'];
const richTextRefreshDelayMs = 150;

export function activate(context: vscode.ExtensionContext): void {
  const richTextDecorations = createRichTextDecorationTypes();
  const richTextDecorationManager = new SnoteRichTextDecorationManager(richTextDecorations);
  const todoProvider = new SnoteTodoTreeProvider();
  const todoView = vscode.window.createTreeView('snote.todoList', { treeDataProvider: todoProvider });
  const updateTodoView = (): void => {
    todoView.description = todoProvider.description;
    todoView.message = todoProvider.message;
  };
  updateTodoView();

  context.subscriptions.push(
    todoProvider,
    todoView,
    todoProvider.onDidChangeTreeData(updateTodoView),
    vscode.commands.registerCommand('snote.openTodo', openTodo),
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

interface TodoTreeElement {
  readonly node: TodoTreeNode;
  readonly uri: vscode.Uri;
}

export class SnoteTodoTreeProvider implements vscode.TreeDataProvider<TodoTreeElement>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private document: vscode.TextDocument | undefined;
  private roots: TodoTreeNode[] = [];

  constructor() {
    this.updateEditor(vscode.window.activeTextEditor);
    this.subscriptions = [
      vscode.window.onDidChangeActiveTextEditor((editor) => this.updateEditor(editor)),
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        if (document === this.document) {
          this.setDocument(document.languageId === 'snote' ? document : undefined);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document === this.document) {
          this.setDocument(undefined);
        }
      })
    ];
  }

  get description(): string | undefined {
    return this.document === undefined ? undefined : basename(this.document.uri.path);
  }

  get message(): string | undefined {
    if (this.document === undefined) {
      return '请打开一个 snote 文件以查看未完成的 TODO。';
    }
    return this.roots.length === 0 ? '没有未完成的 TODO' : undefined;
  }

  getChildren(element?: TodoTreeElement): TodoTreeElement[] {
    if (element !== undefined) {
      return (element.node.children ?? []).map((node) => ({ node, uri: element.uri }));
    }
    const document = this.document;
    return document === undefined ? [] : this.roots.map((node) => ({ node, uri: document.uri }));
  }

  getTreeItem({ node, uri }: TodoTreeElement): vscode.TreeItem {
    const group = node.kind === 'group';
    const item = new vscode.TreeItem(
      node.title || '未命名 TODO',
      node.children?.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );
    item.id = `${uri.toString()}:${node.kind}:${node.line}`;
    item.iconPath = new vscode.ThemeIcon(group ? (node.completed ? 'pass' : 'symbol-namespace') : 'circle-large-outline');
    item.tooltip = `${item.label}\n${uri.fsPath}:${node.line + 1}`;
    if (group && node.completed) {
      item.description = '已完成';
    } else if (!group) {
      item.description = `${node.line + 1}`;
      item.command = {
        command: 'snote.openTodo',
        title: '跳转到 TODO',
        arguments: [uri, node.line, node.character]
      };
    }
    return item;
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.changeEmitter.dispose();
  }

  private updateEditor(editor: vscode.TextEditor | undefined): void {
    // Moving focus to a view can temporarily leave no active text editor.
    if (editor === undefined) {
      if (this.document?.isClosed) {
        this.setDocument(undefined);
      }
      return;
    }
    this.setDocument(editor.document.languageId === 'snote' ? editor.document : undefined);
  }

  private setDocument(document: vscode.TextDocument | undefined): void {
    this.document = document;
    this.roots = document === undefined ? [] : getTodoTree(document.getText());
    this.changeEmitter.fire();
  }
}

async function openTodo(uri: vscode.Uri, line: number, character: number): Promise<void> {
  const position = new vscode.Position(line, character);
  const editor = await vscode.window.showTextDocument(uri, {
    selection: new vscode.Range(position, position)
  });
  // Unfold every enclosing region, including nested blocks, without unfolding
  // unrelated sections of the document.
  await vscode.commands.executeCommand('editor.unfold', {
    selectionLines: [line],
    direction: 'up',
    levels: editor.document.lineCount
  });
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

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
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const fenceLength = getFenceLengthBeforeLine(document, position.line);
    const fenceItem = getCodeFenceCompletionItem(position, linePrefix, fenceLength);

    if (fenceItem !== undefined) {
      return [fenceItem];
    }

    // Markers, TODO items, and `call` blocks are literal text inside a fence.
    if (fenceLength > 0) {
      return [];
    }

    const items: vscode.CompletionItem[] = [];

    items.push(...getCallCompletionItems(document, position));

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

function getCodeFenceCompletionItem(
  position: vscode.Position,
  linePrefix: string,
  fenceLength: number
): vscode.CompletionItem | undefined {
  const completion = getCodeFenceCompletion(linePrefix, fenceLength);

  if (completion === undefined) {
    return undefined;
  }

  const opening = completion.kind === 'open';
  const item = new vscode.CompletionItem(
    opening ? 'code block' : 'close code block',
    vscode.CompletionItemKind.Snippet
  );
  item.detail = opening ? 'SNote code block' : 'SNote code block end';
  item.documentation = opening
    ? 'Insert a fenced code block with a language label and a closing fence.'
    : `Close the current code block with ${fenceLength} backticks.`;
  item.filterText = linePrefix.trim();
  item.insertText = completion.snippet
    ? new vscode.SnippetString(completion.insertText)
    : completion.insertText;
  item.preselect = true;
  // Replace the whole line prefix, indentation included: the snippet supplies
  // its own indentation so the closing fence stays aligned.
  item.range = new vscode.Range(position.line, 0, position.line, position.character);
  item.sortText = '0000';

  return item;
}

function getFenceLengthBeforeLine(document: vscode.TextDocument, line: number): number {
  let fenceLength = 0;

  for (let index = 0; index < line; index += 1) {
    fenceLength = getCodeFenceLengthAfterLine(document.lineAt(index).text, fenceLength);
  }

  return fenceLength;
}

function getCallCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  const range = getCurrentWordRange(document, position);
  const prefix = document.getText(range);

  if (prefix.length === 0 || !'call'.startsWith(prefix)) {
    return [];
  }

  return [false, true].map((todo) => {
    const item = new vscode.CompletionItem(todo ? 'call TODO block' : 'call block', vscode.CompletionItemKind.Snippet);
    item.detail = todo ? 'SNote TODO call/ret block' : 'SNote call/ret block';
    item.documentation = todo ? 'Insert a SNote task block with its own scope.' : 'Insert a nested SNote call block.';
    item.filterText = 'call';
    item.insertText = new vscode.SnippetString(`call ${todo ? '[ ] ' : ''}\${1:title}:\n\t\${0}\nret`);
    item.preselect = !todo;
    item.range = range;
    item.sortText = todo ? '0001' : '0000';
    return item;
  });
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

async function toggleTodoInEditor(editor: vscode.TextEditor): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const handledLines = new Set<number>();

  for (const selection of editor.selections) {
    const line = editor.document.lineAt(selection.start.line);
    if (handledLines.has(line.lineNumber) || getFenceLengthBeforeLine(editor.document, line.lineNumber) > 0) {
      continue;
    }
    const toggled = toggleTodoLine(line.text);

    if (toggled !== undefined) {
      handledLines.add(line.lineNumber);
      edit.replace(editor.document.uri, line.range, toggled);
    }
  }

  if (handledLines.size > 0) {
    await vscode.workspace.applyEdit(edit);
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
