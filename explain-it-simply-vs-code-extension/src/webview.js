function getWebviewContent(providers, allModels) {
  const providersJson = JSON.stringify(providers);
  const modelsJson = JSON.stringify(allModels);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Explain It Simply</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --btn2-bg: var(--vscode-button-secondaryBackground);
    --btn2-fg: var(--vscode-button-secondaryForeground);
    --card-bg: var(--vscode-editorWidget-background);
    --accent: var(--vscode-focusBorder);
    --success: #4caf50;
    --error: var(--vscode-errorForeground);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --tab-inactive: var(--vscode-tab-inactiveBackground);
    --select-bg: var(--vscode-dropdown-background);
    --select-fg: var(--vscode-dropdown-foreground);
    --select-border: var(--vscode-dropdown-border);
    --highlight: var(--vscode-editor-selectionHighlightBackground);
    --link: var(--vscode-textLink-foreground);
    --font: var(--vscode-font-family);
    --font-mono: var(--vscode-editor-font-family);
    --font-size: var(--vscode-font-size, 13px);
    --radius: 6px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font-family: var(--font); font-size: var(--font-size); min-height: 100vh; overflow-x: hidden; }

  /* ── SETUP ── */
  #setup-screen { display: none; min-height: 100vh; padding: 32px 24px; flex-direction: column; align-items: center; justify-content: flex-start; }
  #setup-screen.active { display: flex; }
  .setup-header { text-align: center; margin-bottom: 32px; }
  .setup-logo { font-size: 40px; margin-bottom: 8px; }
  .setup-title { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
  .setup-subtitle { opacity: 0.65; font-size: 12px; max-width: 380px; }
  .setup-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; width: 100%; max-width: 460px; }
  .step-indicator { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
  .step-dot { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; background: var(--border); color: var(--fg); opacity: 0.5; transition: all 0.2s; }
  .step-dot.active { background: var(--btn-bg); color: var(--btn-fg); opacity: 1; }
  .step-dot.done { background: var(--success); color: #fff; opacity: 1; }
  .step-line { flex: 1; height: 1px; background: var(--border); }
  .form-group { margin-bottom: 16px; }
  label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.5px; }
  select, input[type="text"], input[type="password"], textarea { width: 100%; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border, var(--border)); border-radius: var(--radius); padding: 8px 10px; font-family: var(--font); font-size: var(--font-size); outline: none; transition: border-color 0.15s; }
  select { background: var(--select-bg); color: var(--select-fg); border-color: var(--select-border); cursor: pointer; }
  select:focus, input:focus, textarea:focus { border-color: var(--accent); }
  .provider-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .provider-card { border: 2px solid var(--border); border-radius: var(--radius); padding: 12px; cursor: pointer; transition: all 0.15s; text-align: center; user-select: none; }
  .provider-card:hover { border-color: var(--accent); background: var(--highlight); }
  .provider-card.selected { border-color: var(--btn-bg); background: var(--highlight); }
  .provider-icon { font-size: 22px; margin-bottom: 4px; }
  .provider-name { font-size: 12px; font-weight: 600; }
  .provider-hint { font-size: 10px; opacity: 0.55; margin-top: 2px; }
  .model-list { display: flex; flex-direction: column; gap: 6px; }
  .model-option { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 10px; user-select: none; }
  .model-option:hover { border-color: var(--accent); }
  .model-option.selected { border-color: var(--btn-bg); background: var(--highlight); }
  .model-option .radio { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border); flex-shrink: 0; transition: all 0.15s; }
  .model-option.selected .radio { border-color: var(--btn-bg); background: var(--btn-bg); }
  .model-label { font-size: 12px; }
  .key-input-wrap { position: relative; }
  .key-input-wrap input { padding-right: 36px; font-family: var(--font-mono); font-size: 12px; }
  .toggle-eye { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); cursor: pointer; opacity: 0.5; transition: opacity 0.15s; background: none; border: none; color: var(--fg); font-size: 16px; }
  .toggle-eye:hover { opacity: 1; }
  .key-hint { font-size: 11px; opacity: 0.55; margin-top: 5px; }
  .key-hint a { color: var(--link); text-decoration: none; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 16px; border-radius: var(--radius); border: none; cursor: pointer; font-family: var(--font); font-size: 13px; font-weight: 600; transition: background 0.15s; user-select: none; }
  .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
  .btn-primary:hover { background: var(--btn-hover); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: var(--btn2-bg); color: var(--btn2-fg); }
  .btn-secondary:hover { opacity: 0.85; }
  .btn-ghost { background: transparent; color: var(--fg); opacity: 0.6; border: 1px solid var(--border); }
  .btn-ghost:hover { opacity: 1; }
  .setup-nav { display: flex; gap: 8px; margin-top: 20px; justify-content: space-between; }

  /* ── MAIN ── */
  #main-screen { display: none; flex-direction: column; height: 100vh; }
  #main-screen.active { display: flex; }
  .app-header { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .app-logo { font-size: 20px; }
  .app-title { font-weight: 700; font-size: 14px; flex: 1; }
  .model-badge { font-size: 10px; padding: 2px 8px; border-radius: 20px; background: var(--badge-bg); color: var(--badge-fg); font-weight: 600; letter-spacing: 0.3px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .icon-btn { background: none; border: none; color: var(--fg); cursor: pointer; padding: 4px; border-radius: 4px; font-size: 16px; opacity: 0.6; transition: opacity 0.15s; line-height: 1; }
  .icon-btn:hover { opacity: 1; }

  /* ── TABS ── */
  .tab-bar { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .tab { padding: 8px 16px; cursor: pointer; font-size: 12px; font-weight: 600; border-bottom: 2px solid transparent; transition: all 0.15s; user-select: none; display: flex; align-items: center; gap: 6px; }
  .tab:hover { background: var(--highlight); }
  .tab.active { border-bottom-color: var(--btn-bg); color: var(--btn-bg); }
  .tab-content { display: none; flex: 1; overflow: hidden; flex-direction: column; }
  .tab-content.active { display: flex; }

  /* ── TOPIC ── */
  .topic-pane { display: flex; flex-direction: column; height: 100%; padding: 16px; }
  .input-area { margin-bottom: 12px; }
  textarea.topic-input { resize: none; height: 80px; line-height: 1.5; font-family: var(--font); font-size: 13px; }
  .topic-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .example-chip { font-size: 11px; padding: 3px 10px; border-radius: 20px; background: var(--card-bg); border: 1px solid var(--border); cursor: pointer; transition: all 0.15s; user-select: none; }
  .example-chip:hover { border-color: var(--accent); background: var(--highlight); }
  .action-row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }

  /* ── CODE ── */
  .code-pane { display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 10px; }
  .code-source-btn-group { display: flex; gap: 8px; }
  textarea.code-input { resize: none; flex: 1; min-height: 120px; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; }
  .code-meta { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  .lang-select { width: auto; flex: 1; }

  /* ── OUTPUT ── */
  .output-area { flex: 1; overflow-y: auto; padding: 0 0 20px 0; }
  .placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; opacity: 0.4; text-align: center; gap: 8px; padding: 40px; }
  .placeholder-icon { font-size: 36px; }
  .placeholder-text { font-size: 13px; line-height: 1.6; }

  /* ── LOADING ── */
  .loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 16px; text-align: center; padding: 40px; }
  .spinner { width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--btn-bg); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-messages { display: flex; flex-direction: column; gap: 6px; align-items: center; }
  .loading-msg { font-size: 13px; opacity: 0; animation: fadeIn 0.5s ease forwards; }
  .loading-msg:nth-child(1) { animation-delay: 0.1s; }
  .loading-msg:nth-child(2) { animation-delay: 1.2s; }
  .loading-msg:nth-child(3) { animation-delay: 2.4s; }
  @keyframes fadeIn { to { opacity: 0.7; } }

  /* ── RESULTS ── */
  .result-wrapper { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .result-title { font-size: 16px; font-weight: 700; line-height: 1.3; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
  .explanation-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .card-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); cursor: pointer; user-select: none; }
  .card-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 20px; letter-spacing: 0.3px; }
  .badge-eli5 { background: #ff9800; color: #fff; }
  .badge-tech { background: #2196f3; color: #fff; }
  .card-title { font-weight: 600; font-size: 13px; flex: 1; }
  .card-toggle { font-size: 14px; opacity: 0.5; transition: transform 0.2s; }
  .card-toggle.open { transform: rotate(180deg); }
  .card-body { padding: 14px; }
  .eli5-content { font-size: 14px; line-height: 1.7; }
  .tech-content { font-size: 13px; line-height: 1.7; }
  .tech-bullet { display: flex; gap: 8px; margin-bottom: 4px; }
  .tech-bullet::before { content: "▸"; color: #2196f3; flex-shrink: 0; margin-top: 1px; }
  .takeaway-card { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; display: flex; align-items: flex-start; gap: 10px; background: rgba(255,152,0,0.05); border-left: 3px solid #ff9800; }
  .takeaway-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
  .takeaway-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6; margin-bottom: 3px; }
  .takeaway-text { font-size: 13px; line-height: 1.5; font-weight: 500; }
  .code-snippet-preview { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .snippet-header { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--tab-inactive); border-bottom: 1px solid var(--border); }
  .snippet-lang { font-size: 11px; font-weight: 600; opacity: 0.7; }
  .snippet-toggle { font-size: 11px; opacity: 0.5; cursor: pointer; margin-left: auto; }
  .snippet-toggle:hover { opacity: 1; }
  pre.snippet-code { padding: 12px; overflow-x: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; max-height: 180px; overflow-y: auto; margin: 0; }

  /* ── ERROR ── */
  .error-state { margin: 16px; padding: 14px; border-radius: var(--radius); border: 1px solid var(--error); background: rgba(255,0,0,0.05); display: flex; gap: 10px; align-items: flex-start; }
  .error-icon { font-size: 18px; flex-shrink: 0; }
  .error-title { font-weight: 600; font-size: 13px; color: var(--error); margin-bottom: 4px; }
  .error-msg { font-size: 12px; opacity: 0.8; line-height: 1.5; }

  /* ── HISTORY ── */
  .history-pane { height: 100%; overflow-y: auto; padding: 12px 16px; }
  .history-empty { display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.4; font-size: 13px; }
  .history-item { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; margin-bottom: 8px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 10px; }
  .history-item:hover { border-color: var(--accent); background: var(--highlight); }
  .history-type { font-size: 16px; flex-shrink: 0; }
  .history-info { flex: 1; overflow: hidden; }
  .history-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .history-time { font-size: 10px; opacity: 0.5; margin-top: 2px; }
  .history-del { font-size: 14px; opacity: 0; cursor: pointer; transition: opacity 0.15s; }
  .history-item:hover .history-del { opacity: 0.5; }
  .history-del:hover { opacity: 1 !important; color: var(--error); }

  .hidden { display: none !important; }
  .collapsed .card-body { display: none; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--accent); }
</style>
</head>
<body>

<!-- SETUP SCREEN -->
<div id="setup-screen">
  <div class="setup-header">
    <div class="setup-logo">🧠</div>
    <div class="setup-title">Explain It Simply</div>
    <div class="setup-subtitle">AI-powered layered explanations for code and concepts. Quick 3-step setup.</div>
  </div>
  <div class="setup-card">
    <div class="step-indicator">
      <div class="step-dot active" id="dot-1">1</div>
      <div class="step-line"></div>
      <div class="step-dot" id="dot-2">2</div>
      <div class="step-line"></div>
      <div class="step-dot" id="dot-3">3</div>
    </div>

    <!-- Step 1: Provider -->
    <div id="step-1">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px;">Choose your AI Provider</div>
      <div style="opacity:0.6;font-size:12px;margin-bottom:16px;">Select the service you want to use.</div>
      <div class="provider-grid" id="provider-grid"></div>
      <div class="setup-nav">
        <div></div>
        <button class="btn btn-primary" onclick="goStep(2)" id="btn-step1-next" disabled>Next →</button>
      </div>
    </div>

    <!-- Step 2: Model -->
    <div id="step-2" class="hidden">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px;">Select a Model</div>
      <div style="opacity:0.6;font-size:12px;margin-bottom:16px;">You can change this later via ⚙.</div>
      <div class="model-list" id="model-list"></div>
      <div class="setup-nav">
        <button class="btn btn-ghost" onclick="goStep(1)">← Back</button>
        <button class="btn btn-primary" onclick="goStep(3)" id="btn-step2-next" disabled>Next →</button>
      </div>
    </div>

    <!-- Step 3: API Key -->
    <div id="step-3" class="hidden">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px;">Enter your API Key</div>
      <div style="opacity:0.6;font-size:12px;margin-bottom:16px;">Stored securely in VS Code's secret storage — never logged.</div>
      <div class="form-group">
        <label>API Key</label>
        <div class="key-input-wrap">
          <input type="password" id="api-key-input" placeholder="Paste your API key here..." oninput="validateKey()"/>
          <button class="toggle-eye" onclick="toggleKeyVisibility()">👁</button>
        </div>
        <div class="key-hint" id="key-hint"></div>
      </div>
      <div class="setup-nav">
        <button class="btn btn-ghost" onclick="goStep(2)">← Back</button>
        <button class="btn btn-primary" onclick="saveAndFinish()" id="btn-finish" disabled>Finish ✓</button>
      </div>
    </div>
  </div>
</div>

<!-- MAIN SCREEN -->
<div id="main-screen">
  <div class="app-header">
    <span class="app-logo">🧠</span>
    <span class="app-title">Explain It Simply</span>
    <span class="model-badge" id="model-badge">—</span>
    <button class="icon-btn" title="Reset settings" onclick="resetSettings()">⚙</button>
  </div>

  <div class="tab-bar">
    <div class="tab active" id="tab-topic" onclick="switchTab('topic')">💡 Topic</div>
    <div class="tab" id="tab-code" onclick="switchTab('code')">💻 Code</div>
    <div class="tab" id="tab-history" onclick="switchTab('history')">🕑 History</div>
  </div>

  <!-- TOPIC TAB -->
  <div class="tab-content active" id="content-topic">
    <div class="topic-pane">
      <div class="input-area">
        <textarea class="topic-input" id="topic-input" placeholder="What would you like to understand? e.g. 'How does HTTP work?' or 'What is recursion?'" onkeydown="topicKeydown(event)"></textarea>
        <div class="topic-examples">
          <div class="example-chip" onclick="setTopic('How does the internet work?')">🌐 Internet</div>
          <div class="example-chip" onclick="setTopic('What is machine learning?')">🤖 Machine Learning</div>
          <div class="example-chip" onclick="setTopic('What is recursion in programming?')">🔄 Recursion</div>
          <div class="example-chip" onclick="setTopic('How do databases work?')">🗄 Databases</div>
          <div class="example-chip" onclick="setTopic('What is Big O notation?')">📈 Big O</div>
          <div class="example-chip" onclick="setTopic('How does HTTPS encryption work?')">🔐 HTTPS</div>
        </div>
      </div>
      <div class="action-row">
        <button class="btn btn-primary" onclick="explainTopic()">✨ Explain It</button>
        <button class="btn btn-ghost" onclick="clearOutput()">Clear</button>
      </div>
      <div class="output-area" id="topic-output">
        <div class="placeholder">
          <div class="placeholder-icon">💡</div>
          <div class="placeholder-text">Enter any topic or question above<br/>and get a layered explanation instantly.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- CODE TAB -->
  <div class="tab-content" id="content-code">
    <div class="code-pane">
      <div class="code-source-btn-group">
        <button class="btn btn-secondary" onclick="loadFromEditor()">📋 Load from Editor</button>
        <button class="btn btn-ghost" onclick="clearCode()">Clear</button>
      </div>
      <div class="code-meta">
        <label style="margin:0;white-space:nowrap;">Language:</label>
        <select class="lang-select" id="lang-select">
          <option value="">Auto-detect</option>
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
          <option value="python">Python</option>
          <option value="java">Java</option>
          <option value="csharp">C#</option>
          <option value="cpp">C++</option>
          <option value="c">C</option>
          <option value="go">Go</option>
          <option value="rust">Rust</option>
          <option value="php">PHP</option>
          <option value="ruby">Ruby</option>
          <option value="swift">Swift</option>
          <option value="kotlin">Kotlin</option>
          <option value="sql">SQL</option>
          <option value="html">HTML</option>
          <option value="css">CSS</option>
          <option value="shell">Shell/Bash</option>
        </select>
      </div>
      <textarea class="code-input" id="code-input" placeholder="Paste code here, or click 'Load from Editor' to pull your active file or selection..."></textarea>
      <div class="action-row">
        <button class="btn btn-primary" onclick="explainCode()">✨ Explain Code</button>
      </div>
      <div class="output-area" id="code-output">
        <div class="placeholder">
          <div class="placeholder-icon">💻</div>
          <div class="placeholder-text">Paste code or load from your editor<br/>to get a layered code explanation.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- HISTORY TAB -->
  <div class="tab-content" id="content-history">
    <div class="history-pane">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-weight:700;font-size:13px;">Explanation History</div>
        <button class="btn btn-ghost" style="font-size:11px;padding:4px 10px;" onclick="clearHistory()">Clear All</button>
      </div>
      <div id="history-list"></div>
    </div>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
const PROVIDERS = ${providersJson};
const ALL_MODELS = ${modelsJson};

let selectedProvider = null;
let selectedModel = null;
let history = [];

const PROVIDER_ICONS = { openai: '🟢', anthropic: '🟣', google: '🔵', groq: '⚡' };
const KEY_LINKS = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/keys',
  google: 'https://aistudio.google.com/apikey',
  groq: 'https://console.groq.com/keys',
};

// ── SETUP ──────────────────────────────────────────

function initSetup() {
  selectedProvider = null;
  selectedModel = null;
  goStep(1);
  const grid = document.getElementById('provider-grid');
  grid.innerHTML = '';
  PROVIDERS.forEach(p => {
    const card = document.createElement('div');
    card.className = 'provider-card';
    card.dataset.id = p.id;
    card.innerHTML = \`<div class="provider-icon">\${PROVIDER_ICONS[p.id] || '🤖'}</div><div class="provider-name">\${p.label}</div><div class="provider-hint">\${p.keyHint}</div>\`;
    card.onclick = () => selectProvider(p.id);
    grid.appendChild(card);
  });
}

function selectProvider(id) {
  selectedProvider = id;
  selectedModel = null;
  document.querySelectorAll('.provider-card').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
  document.getElementById('btn-step1-next').disabled = false;
  populateModels(id);
}

function populateModels(providerId) {
  const list = document.getElementById('model-list');
  list.innerHTML = '';
  (ALL_MODELS[providerId] || []).forEach(m => {
    const opt = document.createElement('div');
    opt.className = 'model-option';
    opt.dataset.id = m.id;
    opt.innerHTML = \`<div class="radio"></div><div class="model-label">\${m.label}</div>\`;
    opt.onclick = () => selectModel(m.id);
    list.appendChild(opt);
  });
}

function selectModel(id) {
  selectedModel = id;
  document.querySelectorAll('.model-option').forEach(o => o.classList.toggle('selected', o.dataset.id === id));
  document.getElementById('btn-step2-next').disabled = false;
}

function goStep(n) {
  [1, 2, 3].forEach(i => {
    document.getElementById('step-' + i).classList.toggle('hidden', i !== n);
    const dot = document.getElementById('dot-' + i);
    dot.classList.remove('active', 'done');
    if (i < n) dot.classList.add('done');
    else if (i === n) dot.classList.add('active');
  });
  if (n === 3) {
    const p = PROVIDERS.find(x => x.id === selectedProvider);
    const link = KEY_LINKS[selectedProvider] || '#';
    document.getElementById('key-hint').innerHTML =
      p ? \`Format: <code>\${p.keyHint}</code> &nbsp;·&nbsp; <a href="\${link}">Get key ↗</a>\` : '';
  }
}

function toggleKeyVisibility() {
  const inp = document.getElementById('api-key-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

function validateKey() {
  document.getElementById('btn-finish').disabled =
    document.getElementById('api-key-input').value.trim().length < 8;
}

function saveAndFinish() {
  const apiKey = document.getElementById('api-key-input').value.trim();
  if (!apiKey || !selectedProvider || !selectedModel) return;
  vscode.postMessage({ command: 'saveSettings', provider: selectedProvider, model: selectedModel, apiKey });
}

function showMainScreen(provider, model) {
  document.getElementById('setup-screen').classList.remove('active');
  document.getElementById('main-screen').classList.add('active');
  const prov = PROVIDERS.find(p => p.id === provider);
  const models = ALL_MODELS[provider] || [];
  const mod = models.find(m => m.id === model);
  const provLabel = prov ? prov.label.split(' ')[0] : provider;
  const modLabel = mod ? mod.label.split(' ')[0] : model;
  document.getElementById('model-badge').textContent = provLabel + ' · ' + modLabel;
}

// ── TABS ────────────────────────────────────────────

function switchTab(tab) {
  ['topic', 'code', 'history'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
    document.getElementById('content-' + t).classList.toggle('active', t === tab);
  });
  if (tab === 'history') renderHistory();
}

// ── TOPIC ───────────────────────────────────────────

function setTopic(text) { document.getElementById('topic-input').value = text; }

function topicKeydown(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) explainTopic();
}

function explainTopic() {
  const text = document.getElementById('topic-input').value.trim();
  if (!text) return;
  vscode.postMessage({ command: 'explainTopic', text });
}

function clearOutput() {
  document.getElementById('topic-output').innerHTML =
    '<div class="placeholder"><div class="placeholder-icon">💡</div><div class="placeholder-text">Enter any topic or question above<br/>and get a layered explanation instantly.</div></div>';
}

// ── CODE ────────────────────────────────────────────

function loadFromEditor() {
  vscode.postMessage({ command: 'getEditorContent' });
}

function clearCode() {
  document.getElementById('code-input').value = '';
  document.getElementById('code-output').innerHTML =
    '<div class="placeholder"><div class="placeholder-icon">💻</div><div class="placeholder-text">Paste code or load from your editor.</div></div>';
}

function explainCode() {
  const code = document.getElementById('code-input').value.trim();
  if (!code) {
    document.getElementById('code-output').innerHTML =
      '<div class="error-state"><div class="error-icon">⚠️</div><div><div class="error-title">No code</div><div class="error-msg">Please paste or load some code first.</div></div></div>';
    return;
  }
  const lang = document.getElementById('lang-select').value;
  vscode.postMessage({ command: 'explainCode', code, lang, fileName: '' });
}

function resetSettings() {
  if (confirm('Reset API settings? You will need to re-enter your key.')) {
    vscode.postMessage({ command: 'resetSettings' });
  }
}

// ── RENDER ──────────────────────────────────────────

function renderResult(result, isCode, inputCode, lang) {
  addToHistory(result, isCode);

  const techLines = result.technical.content
    .split(/\\n•/)
    .map((s, i) => {
      const text = s.replace(/^•/, '').trim();
      if (!text) return '';
      return (i === 0 && !result.technical.content.startsWith('\\n•'))
        ? \`<div style="margin-bottom:6px;">\${text}</div>\`
        : \`<div class="tech-bullet">\${text}</div>\`;
    }).join('');

  let codePreview = '';
  if (isCode && inputCode) {
    const escaped = inputCode.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    codePreview = \`
      <div class="code-snippet-preview">
        <div class="snippet-header">
          <span class="snippet-lang">\${lang || 'code'}</span>
          <span class="snippet-toggle" onclick="toggleSnippet(this)">▼ collapse</span>
        </div>
        <pre class="snippet-code">\${escaped}</pre>
      </div>\`;
  }

  return \`
    <div class="result-wrapper">
      \${codePreview}
      <div class="result-title">📖 \${result.title}</div>
      <div class="explanation-card" id="card-eli5">
        <div class="card-header" onclick="toggleCard('card-eli5')">
          <span class="card-badge badge-eli5">ELI5</span>
          <span class="card-title">\${result.eli5.heading}</span>
          <span class="card-toggle open">▼</span>
        </div>
        <div class="card-body eli5-content">\${result.eli5.content}</div>
      </div>
      <div class="explanation-card" id="card-tech">
        <div class="card-header" onclick="toggleCard('card-tech')">
          <span class="card-badge badge-tech">TECH</span>
          <span class="card-title">\${result.technical.heading}</span>
          <span class="card-toggle open">▼</span>
        </div>
        <div class="card-body tech-content">\${techLines}</div>
      </div>
      <div class="takeaway-card">
        <div class="takeaway-icon">💎</div>
        <div>
          <div class="takeaway-label">Key Takeaway</div>
          <div class="takeaway-text">\${result.keyTakeaway}</div>
        </div>
      </div>
    </div>\`;
}

function toggleCard(id) {
  const card = document.getElementById(id);
  card.classList.toggle('collapsed');
  card.querySelector('.card-toggle').classList.toggle('open');
}

function toggleSnippet(btn) {
  const pre = btn.closest('.code-snippet-preview').querySelector('pre');
  const collapsed = pre.style.display === 'none';
  pre.style.display = collapsed ? '' : 'none';
  btn.textContent = collapsed ? '▼ collapse' : '▶ expand';
}

function showLoading(outputId, isCode) {
  const msgs = isCode
    ? ['Reading your code...', 'Analyzing structure...', 'Crafting explanations...']
    : ['Thinking about this...', 'Building simple explanation...', 'Adding technical depth...'];
  document.getElementById(outputId).innerHTML = \`
    <div class="loading-state">
      <div class="spinner"></div>
      <div class="loading-messages">
        \${msgs.map(m => \`<div class="loading-msg">\${m}</div>\`).join('')}
      </div>
    </div>\`;
}

// ── HISTORY ─────────────────────────────────────────

function addToHistory(result, isCode) {
  history.unshift({ result, isCode, ts: Date.now() });
  if (history.length > 50) history.pop();
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (!history.length) {
    list.innerHTML = '<div class="history-empty">No explanations yet.</div>';
    return;
  }
  list.innerHTML = history.map((h, i) => \`
    <div class="history-item" onclick="loadHistoryItem(\${i})">
      <div class="history-type">\${h.isCode ? '💻' : '💡'}</div>
      <div class="history-info">
        <div class="history-title">\${h.result.title}</div>
        <div class="history-time">\${timeAgo(h.ts)}</div>
      </div>
      <div class="history-del" onclick="event.stopPropagation();deleteHistory(\${i})">✕</div>
    </div>\`).join('');
}

function loadHistoryItem(i) {
  const h = history[i];
  switchTab(h.isCode ? 'code' : 'topic');
  const outputId = h.isCode ? 'code-output' : 'topic-output';
  document.getElementById(outputId).innerHTML = renderResult(h.result, h.isCode, null, '');
}

function deleteHistory(i) { history.splice(i, 1); renderHistory(); }
function clearHistory() { history = []; renderHistory(); }

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

// ── MESSAGE HANDLER ──────────────────────────────────

window.addEventListener('message', e => {
  const msg = e.data;
  switch (msg.command) {

    case 'init':
      // Called once on load — panel tells us if we're configured or not
      if (msg.configured) {
        showMainScreen(msg.provider, msg.model);
      } else {
        initSetup();
        document.getElementById('setup-screen').classList.add('active');
        document.getElementById('main-screen').classList.remove('active');
      }
      break;

    case 'showSetup':
      initSetup();
      document.getElementById('setup-screen').classList.add('active');
      document.getElementById('main-screen').classList.remove('active');
      break;

    case 'settingsSaved':
      showMainScreen(msg.provider, msg.model);
      break;

    case 'loading':
      showLoading(msg.isCode ? 'code-output' : 'topic-output', msg.isCode);
      switchTab(msg.isCode ? 'code' : 'topic');
      break;

    case 'result': {
      const outputId = msg.isCode ? 'code-output' : 'topic-output';
      document.getElementById(outputId).innerHTML = renderResult(msg.result, msg.isCode, msg.input, msg.lang);
      break;
    }

    case 'error': {
      const html = \`<div class="error-state"><div class="error-icon">⚠️</div><div><div class="error-title">Something went wrong</div><div class="error-msg">\${msg.message}</div></div></div>\`;
      const active = document.querySelector('.tab-content.active');
      const out = active && active.querySelector('.output-area');
      if (out) out.innerHTML = html;
      break;
    }

    case 'editorContent':
      if (msg.full || msg.selected) {
        switchTab('code');
        document.getElementById('code-input').value = msg.selected || msg.full;
        if (msg.lang) {
          const sel = document.getElementById('lang-select');
          for (const opt of sel.options) {
            if (opt.value === msg.lang) { sel.value = msg.lang; break; }
          }
        }
        if (msg.selected) {
          // Show a notice about what was loaded
          document.getElementById('code-output').innerHTML =
            '<div class="placeholder"><div class="placeholder-icon">✅</div><div class="placeholder-text">Selection loaded! Click Explain Code.</div></div>';
        }
      } else {
        switchTab('code');
        document.getElementById('code-output').innerHTML =
          '<div class="error-state"><div class="error-icon">⚠️</div><div><div class="error-title">No editor found</div><div class="error-msg">Open a file in the editor first, then click Load from Editor.</div></div></div>';
      }
      break;
  }
});

// ── INIT: Tell extension we are ready ───────────────
// This fires AFTER the webview is fully loaded
vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
}

module.exports = { getWebviewContent };
