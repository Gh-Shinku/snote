import * as vscode from 'vscode';
import { formatDocument, getFoldingRanges } from './snote';

const languageSelector: vscode.DocumentSelector = { language: 'snote' };

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(languageSelector, new SnoteFoldingRangeProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(languageSelector, new SnoteDocumentFormattingProvider())
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
