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

async function checkTaskBlocks(provider: SnoteTodoTreeProvider): Promise<void> {
  const completionDocument = await vscode.workspace.openTextDocument({ language: 'snote', content: 'c' });
  const completionEditor = await vscode.window.showTextDocument(completionDocument);
  let taskCompletion: vscode.CompletionItem | undefined;
  for (const prefix of ['c', 'call']) {
    if (completionDocument.getText() !== prefix) {
      await completionEditor.edit((edit) => edit.replace(completionDocument.lineAt(0).range, prefix));
    }
    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider', completionDocument.uri, new vscode.Position(0, prefix.length)
    );
    assert.ok(completions);
    const find = (label: string) => completions.items.find((item) =>
      (typeof item.label === 'string' ? item.label : item.label.label) === label);
    taskCompletion = find('call TODO block');
    assert.ok(taskCompletion, `${prefix} offers task block completion`);
    assert.notEqual(taskCompletion.preselect, true);
    assert.equal(find('call block')?.preselect, true, 'ordinary call remains the default');
  }
  assert.ok(taskCompletion?.insertText instanceof vscode.SnippetString);
  completionEditor.selection = new vscode.Selection(0, 0, 0, 4);
  await vscode.commands.executeCommand('editor.action.insertSnippet', { snippet: taskCompletion.insertText.value });
  assert.match(completionDocument.getText(), /^call \[ \] title:\r?\n[\t ]*\r?\nret$/);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

  const document = await vscode.workspace.openTextDocument({
    language: 'snote',
    content: [
      'call project:',
      '  call [ ] parent:',
      '    notes',
      '    - [ ] child',
      '    call [X] completed parent:',
      '      call [ ] nested:',
      '        body',
      '      ret',
      '    ret',
      '  ret',
      '  call [x] hidden:',
      '  ret',
      '  call [ ] standalone:',
      '  ret',
      'ret',
      '```snote',
      'call [ ] literal:',
      '- [ ] literal',
      'ret',
      '```'
    ].join('\n')
  });
  const editor = await vscode.window.showTextDocument(document);
  await waitFor(() => provider.getChildren()[0]?.node.title === 'project', 'task block hierarchy');
  const project = provider.getChildren()[0];
  const tasks = () => provider.getChildren(provider.getChildren()[0]);
  assert.equal(tasks().length, 2, 'completed task without unfinished descendants is hidden');
  const parent = tasks()[0];
  assert.equal(parent.node.kind, 'todo');
  assert.equal(provider.getTreeItem(parent).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  assert.equal(provider.getTreeItem(parent).label, 'parent');
  const children = provider.getChildren(parent);
  assert.equal(children.length, 2);
  const completed = children[1];
  assert.equal(provider.getTreeItem(completed).description, '已完成');
  assert.equal(provider.getTreeItem(completed).command, undefined, 'completed parent is only context');
  assert.equal(provider.getTreeItem(tasks()[1]).collapsibleState, vscode.TreeItemCollapsibleState.None);
  assert.equal(provider.getChildren(project).length, 2, 'task appears once rather than as a duplicate child');

  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider', document.uri
  );
  assert.equal(symbols?.[0].children[0].name, '[ ] parent');
  assert.equal(symbols?.[0].children[0].children[0].name, '[X] completed parent');

  await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', document.uri);
  await vscode.commands.executeCommand('editor.foldAll');
  await vscode.commands.executeCommand('snote.todoList.focus');
  const command = provider.getTreeItem(provider.getChildren(completed)[0]).command;
  assert.ok(command);
  await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
  assert.equal(editor.selection.active.line, 5);
  await waitFor(() => editor.visibleRanges.some((range) => range.contains(new vscode.Position(5, 6))), 'nested task jump unfolds ancestors');

  editor.selection = new vscode.Selection(1, 0, 1, 0);
  await vscode.commands.executeCommand('snote.toggleTodo');
  await waitFor(() => provider.getTreeItem(tasks()[0]).description === '已完成', 'completed parent becomes context');
  assert.equal(document.lineAt(1).text, '  call [x] parent:');
  assert.equal(document.lineAt(3).text, '    - [ ] child', 'toggling parent leaves child untouched');
  assert.equal(document.lineAt(4).text, '    call [X] completed parent:', 'toggling parent preserves descendants');
  await vscode.commands.executeCommand('undo');
  await waitFor(() => tasks()[0].node.kind === 'todo', 'undo restores parent task');

  editor.selection = new vscode.Selection(12, 0, 12, 0);
  await vscode.commands.executeCommand('snote.toggleTodo');
  await waitFor(() => tasks().length === 1, 'completed standalone task disappears');
  await vscode.commands.executeCommand('undo');
  await waitFor(() => tasks().length === 2, 'undo restores standalone task');

  const before = document.getText();
  editor.selections = [new vscode.Selection(16, 0, 16, 0), new vscode.Selection(17, 0, 17, 0)];
  await vscode.commands.executeCommand('snote.toggleTodo');
  assert.equal(document.getText(), before, 'neither task syntax can be toggled inside code');
  const fencedCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(16, 1)
  );
  assert.ok(!fencedCompletions?.items.some((item) => item.label === 'call TODO block'));

  await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '\n'));
  await waitFor(() => tasks()[0].node.line === 2, 'unsaved task header position update');
  const moved = provider.getTreeItem(tasks()[0]).command;
  assert.ok(moved);
  await vscode.commands.executeCommand(moved.command, ...(moved.arguments ?? []));
  assert.equal(editor.selection.active.line, 2);
  assert.equal(editor.selection.active.character, 2);
  assert.equal(document.isDirty, true);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
}

async function checkCallFolding(): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: 'snote',
    content: [
      'call outer:',
      '  call [ ] inner:',
      '    detail',
      '  ret',
      'ret',
      'call [x] sibling:',
      '  detail',
      'ret',
      'call empty:',
      'ret',
      'call [ ] empty task:',
      'ret'
    ].join('\n')
  });
  const editor = await vscode.window.showTextDocument(document);
  const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
    'vscode.executeFoldingRangeProvider', document.uri
  );
  assert.deepEqual(ranges?.map(({ start, end }) => ({ start, end })), [
    { start: 0, end: 3 }, { start: 1, end: 2 }, { start: 5, end: 6 }
  ]);
  const visible = (line: number) => editor.visibleRanges.some((range) => range.contains(new vscode.Position(line, 0)));

  await vscode.commands.executeCommand('editor.fold', { selectionLines: [1] });
  await waitFor(() => !visible(2), 'inner task body is folded');
  assert.ok(visible(1) && visible(3), 'inner call and ret remain visible');

  await vscode.commands.executeCommand('editor.fold', { selectionLines: [0] });
  await waitFor(() => !visible(1) && !visible(3), 'outer fold hides the entire nested block');
  assert.ok(visible(0) && visible(4), 'outer call and ret remain visible');

  await vscode.commands.executeCommand('editor.fold', { selectionLines: [5] });
  await waitFor(() => !visible(6), 'sibling task body is folded');
  assert.ok(visible(5) && visible(7), 'completed task call and ret remain visible');
  assert.ok(visible(8) && visible(9) && visible(10) && visible(11), 'empty blocks remain two visible lines');

  await vscode.commands.executeCommand('editor.unfold', { selectionLines: [0] });
  await waitFor(() => visible(1) && visible(3), 'unfolding outer restores the nested boundaries');
  assert.equal(visible(2), false, 'inner fold is preserved');
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
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
    await checkTaskBlocks(provider);
    await checkCallFolding();
    console.log('SNote TODO Extension Development Host checks passed.');
  } finally {
    listener.dispose();
    provider.dispose();
  }
}
