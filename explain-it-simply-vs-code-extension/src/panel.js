const vscode = require('vscode');
const { getExplanation } = require('./api');
const { getWebviewContent } = require('./webview');

class ExplainPanel {
  static currentPanel = undefined;

  static createOrShow(context, settingsManager) {
    // If panel already exists, just reveal it — webview retains its state
    if (ExplainPanel.currentPanel) {
      ExplainPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside, true);
      return ExplainPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'explainItSimply',
      'Explain It Simply',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true, // keeps webview state when panel is hidden
      }
    );

    ExplainPanel.currentPanel = new ExplainPanel(panel, context, settingsManager);
    return ExplainPanel.currentPanel;
  }

  constructor(panel, context, settingsManager) {
    this._panel = panel;
    this._settingsManager = settingsManager;
    this._disposables = [];
    // Track last known active editor so "load from editor" works even after panel gains focus
    this._lastActiveEditor = vscode.window.activeTextEditor;

    // Keep track of the active editor even when the webview steals focus
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        this._lastActiveEditor = editor;
      }
    }, null, this._disposables);

    // Build the HTML
    this._panel.webview.html = getWebviewContent(
      settingsManager.getProviders(),
      settingsManager.getAllModels()
    );

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {

        case 'ready': {
          // Webview signals it's ready — send initial state
          const hasKey = settingsManager.hasApiKey();
          if (hasKey) {
            const settings = await settingsManager.getSettings();
            this._panel.webview.postMessage({
              command: 'init',
              configured: true,
              provider: settings.provider,
              model: settings.model,
            });
          } else {
            this._panel.webview.postMessage({ command: 'init', configured: false });
          }
          break;
        }

        case 'saveSettings': {
          await settingsManager.saveSettings(msg.provider, msg.model, msg.apiKey);
          this._panel.webview.postMessage({
            command: 'settingsSaved',
            provider: msg.provider,
            model: msg.model,
          });
          break;
        }

        case 'explainTopic':
          await this._handleExplain(msg.text, false, '', '');
          break;

        case 'explainCode':
          await this._handleExplain(msg.code, true, msg.lang || '', msg.fileName || '');
          break;

        case 'getEditorContent': {
          // Use _lastActiveEditor — not activeTextEditor, which is null when webview has focus
          const editor = this._lastActiveEditor;
          if (editor && editor.document) {
            const selection = editor.selection;
            const selected = (!selection.isEmpty)
              ? editor.document.getText(selection).trim()
              : null;
            this._panel.webview.postMessage({
              command: 'editorContent',
              selected: selected || null,
              full: editor.document.getText(),
              lang: editor.document.languageId,
              fileName: editor.document.fileName.split(/[\\/]/).pop(),
            });
          } else {
            this._panel.webview.postMessage({
              command: 'editorContent',
              selected: null,
              full: null,
              lang: '',
              fileName: '',
            });
          }
          break;
        }

        case 'resetSettings':
          await settingsManager.clearSettings();
          this._panel.webview.postMessage({ command: 'showSetup' });
          break;
      }
    }, null, this._disposables);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  async _handleExplain(input, isCode, lang, fileName) {
    this._panel.webview.postMessage({ command: 'loading', isCode });
    try {
      const settings = await this._settingsManager.getSettings();
      if (!settings.apiKey) {
        this._panel.webview.postMessage({
          command: 'error',
          message: 'No API key configured. Click ⚙ to set up the extension.',
        });
        return;
      }
      const result = await getExplanation(settings, input, isCode, lang, fileName);
      this._panel.webview.postMessage({
        command: 'result',
        result,
        isCode,
        input: isCode ? input : null,
        lang,
      });
    } catch (err) {
      this._panel.webview.postMessage({ command: 'error', message: err.message });
    }
  }

  showSetupWizard() {
    this._panel.webview.postMessage({ command: 'showSetup' });
  }

  explainCode(code, lang, fileName = '') {
    this._handleExplain(code, true, lang, fileName);
  }

  dispose() {
    ExplainPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}

module.exports = { ExplainPanel };
