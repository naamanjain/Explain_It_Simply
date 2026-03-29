# 🧠 Explain It Simply — VS Code Extension

AI-powered dual-level explanations for code and concepts, right inside your editor.

---

## ▶ How to Run (Development Mode)

1. Press **`F5 / Fn+F5 → Clean Build` (or go to Run → Start Debugging / Run Extension)
   - This opens a new **Extension Development Host** window
   - The extension is active in that new window

2. In the **new window**, open the Command Palette (`Ctrl+Shift+P`) and run:
   ```
   Explain It Simply: Open Panel
   ```
   The setup wizard will open automatically.

---

## 📦 How to Package as a Real Extension (.vsix)

```bash
npm install -g @vscode/vsce
cd explain-it-simply
vsce package --no-dependencies
# Then install:
code --install-extension explain-it-simply-1.0.0.vsix
```

---

## ⌨ Commands & Shortcuts

| Action | How |
|---|---|
| Open panel | `Ctrl+Shift+X` / `Cmd+Shift+X` |
| Explain selected code | Select code → `Ctrl+Shift+E` / `Cmd+Shift+E` |
| Explain entire file | Right-click → Explain Current File |
| Reset API settings | Command Palette → `Explain It Simply: Reset API Settings` |

---

## 🔑 Supported Providers

| Provider | Free Tier? | Models |
|---|---|---|
| OpenAI | ❌ | GPT-4o, GPT-4o Mini, GPT-3.5 Turbo |
| Anthropic | ❌ | Claude 3.5 Sonnet, Haiku, Opus |
| Google | ✅ | Gemini 1.5 Pro/Flash, 2.0 Flash |
| Groq | ✅ | Llama 3.3 70B, Mixtral, Gemma 2 |

> **Tip:** Use **Groq** for free, fast explanations — Llama 3.3 70B is excellent.

---

## 🔐 Security

API keys are stored in **VS Code's built-in secret storage** (OS keychain). They are never logged or sent anywhere except the chosen provider's official API.
