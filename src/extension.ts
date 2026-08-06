import * as vscode from 'vscode';
import { formatDocument, getFoldingRanges, getTodoCompletion } from './snote';

const languageSelector: vscode.DocumentSelector = { language: 'snote' };

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(languageSelector, new SnoteFoldingRangeProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(languageSelector, new SnoteDocumentFormattingProvider()),
    vscode.languages.registerCompletionItemProvider(languageSelector, new SnoteCompletionItemProvider(), 'c', '-', ' ')
  );
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

function getCurrentWordRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
  const linePrefix = document.lineAt(position).text.slice(0, position.character);
  const currentWord = linePrefix.match(/[^\s:]*$/)?.[0] ?? '';
  return new vscode.Range(position.line, position.character - currentWord.length, position.line, position.character);
}
