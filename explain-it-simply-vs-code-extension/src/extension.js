const vscode = require('vscode');
const { ExplainPanel } = require('./panel');
const { SettingsManager } = require('./settings');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const settingsManager = new SettingsManager(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('explainItSimply.openPanel', async () => {
      ExplainPanel.createOrShow(context, settingsManager);
    }),

    vscode.commands.registerCommand('explainItSimply.explainSelection', async () => {
      // Capture editor BEFORE creating panel (panel focus steals activeTextEditor)
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showErrorMessage('No active editor found.'); return; }
      const selectedText = editor.document.getText(editor.selection);
      if (!selectedText.trim()) { vscode.window.showErrorMessage('No text selected.'); return; }
      const lang = editor.document.languageId;
      const panel = ExplainPanel.createOrShow(context, settingsManager);
      if (!settingsManager.hasApiKey()) { panel.showSetupWizard(); return; }
      panel.explainCode(selectedText, lang);
    }),

    vscode.commands.registerCommand('explainItSimply.explainFile', async () => {
      // Capture editor BEFORE creating panel
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showErrorMessage('No active editor found.'); return; }
      const lang = editor.document.languageId;
      const fileName = editor.document.fileName.split(/[\\/]/).pop();
      const content = editor.document.getText();
      const panel = ExplainPanel.createOrShow(context, settingsManager);
      if (!settingsManager.hasApiKey()) { panel.showSetupWizard(); return; }
      panel.explainCode(content, lang, fileName);
    }),

    vscode.commands.registerCommand('explainItSimply.resetSettings', async () => {
      await settingsManager.clearSettings();
      vscode.window.showInformationMessage('Settings reset.');
      const panel = ExplainPanel.createOrShow(context, settingsManager);
      panel.showSetupWizard();
    })
  );

  // Always open panel on activation - panel.js decides what screen to show
  ExplainPanel.createOrShow(context, settingsManager);
}

function deactivate() {}

module.exports = { activate, deactivate };
