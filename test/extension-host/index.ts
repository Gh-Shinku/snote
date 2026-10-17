import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { SnoteTodoTreeProvider } from '../../src/extension';

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Run with VS Code's --extensionTestsPath pointing at out/test/extension-host.
export async function run(): Promise<void> {
  const extension = vscode.extensions.all.find((candidate) => candidate.packageJSON.name === 'snote');
  assert.ok(extension, 'SNote is installed in the Extension Development Host');
  await extension.activate();
  const provider = new SnoteTodoTreeProvider();
  let changes = 0;
  const listener = provider.onDidChangeTreeData(() => { changes += 1; });
  const document = await vscode.workspace.openTextDocument({
    language: 'snote',
    content: 'call outer:\n  call inner:\n    - [ ] first\n  ret\nret\n- [ ]\n'
  });

  try {
    const editor = await vscode.window.showTextDocument(document);
    await waitFor(() => provider.getChildren().length === 2, 'initial tree');
    assert.equal(provider.description, document.uri.path.split('/').pop());
    assert.equal(provider.message, undefined);
    const outer = provider.getChildren()[0];
    const inner = provider.getChildren(outer)[0];
    const todo = provider.getChildren(inner)[0];
    assert.equal(provider.getTreeItem(outer).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.equal(provider.getTreeItem(todo).label, 'first');
    assert.equal(provider.getTreeItem(todo).description, '3');
    assert.equal(provider.getTreeItem(provider.getChildren()[1]).label, '未命名 TODO');

    // Focus the real contributed view and use exactly the command assigned to
    // its item. The target is initially hidden inside two collapsed regions.
    await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', document.uri);
    await vscode.commands.executeCommand('editor.foldAll');
    await vscode.commands.executeCommand('snote.todoList.focus');
    assert.equal(provider.getChildren().length, 2, 'view focus retains the document');
    const command = provider.getTreeItem(todo).command;
    assert.ok(command);
    await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
    await waitFor(() => vscode.window.activeTextEditor?.selection.active.line === 2, 'TODO selection');
    assert.equal(vscode.window.activeTextEditor?.document, document);
    assert.equal(vscode.window.activeTextEditor?.selection.active.character, 4);
    await waitFor(() => editor.visibleRanges.some((range) => range.contains(new vscode.Position(2, 4))), 'unfolded TODO');

    await vscode.commands.executeCommand('snote.toggleTodo');
    await waitFor(() => provider.getChildren().length === 1, 'completed item and empty groups removed');
    assert.equal(document.isDirty, true, 'changes are not saved');
    await vscode.commands.executeCommand('undo');
    await waitFor(() => provider.getChildren().length === 2, 'undo restores TODO hierarchy');

    // Inserting a line must update both the displayed line and jump arguments.
    await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '\n'));
    await waitFor(() => provider.getChildren()[0].node.line === 1, 'positions after unsaved edit');
    const shifted = provider.getChildren(provider.getChildren(provider.getChildren()[0])[0])[0];
    const shiftedCommand = provider.getTreeItem(shifted).command;
    assert.ok(shiftedCommand);
    await vscode.commands.executeCommand(shiftedCommand.command, ...(shiftedCommand.arguments ?? []));
    assert.equal(vscode.window.activeTextEditor?.selection.active.line, 3);

    const second = await vscode.workspace.openTextDocument({ language: 'snote', content: '- [X] done' });
    await vscode.window.showTextDocument(second);
    await waitFor(() => provider.description === second.uri.path.split('/').pop(), 'second SNote document');
    assert.deepEqual(provider.getChildren(), []);
    assert.equal(provider.message, '没有未完成的 TODO');

    const plain = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '- [ ] ignored' });
    await vscode.window.showTextDocument(plain);
    await waitFor(() => provider.description === undefined, 'non-SNote clears the view');
    assert.deepEqual(provider.getChildren(), []);
    assert.match(provider.message ?? '', /打开.*snote/);

    const fixtureDirectory = await mkdtemp(join(tmpdir(), 'snote-todo-host-'));
    const fixturePath = join(fixtureDirectory, 'saved.snote');
    try {
      await writeFile(fixturePath, '- [ ] saved task\n');
      const saved = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath));
      const savedEditor = await vscode.window.showTextDocument(saved);
      await waitFor(() => provider.description === 'saved.snote', 'saved SNote file');
      assert.equal(provider.getTreeItem(provider.getChildren()[0]).label, 'saved task');
      await savedEditor.edit((edit) => edit.replace(saved.lineAt(0).range, '- [ ] edited without saving'));
      await waitFor(
        () => provider.getChildren()[0]?.node.title === 'edited without saving',
        'unsaved edit in saved file'
      );
      assert.equal(saved.isDirty, true);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await waitFor(() => provider.description === undefined, 'closed saved file clears view');
    } finally {
      await unlink(fixturePath);
      await rmdir(fixtureDirectory);
    }

    await vscode.window.showTextDocument(document);
    await waitFor(() => provider.getChildren().length === 2, 'return to SNote');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await waitFor(() => document.isClosed, 'close untitled SNote without saving');
    assert.equal(provider.description, undefined);
    assert.deepEqual(provider.getChildren(), []);
    assert.ok(changes > 0, 'provider notifies the contributed view');
    console.log('SNote TODO Extension Development Host checks passed.');
  } finally {
    listener.dispose();
    provider.dispose();
  }
}
