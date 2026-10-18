# Explain It Simply

> AI-powered understanding for code, concepts, and everything in between.

Explain It Simply helps people understand complex topics instead of just consuming them.

Whether you're a student learning a new concept, a developer reading unfamiliar code, or someone trying to understand a technical topic, Explain It Simply breaks information into multiple levels of understanding so you can learn at your own pace.

---

## Why We Built This

Most tools generate answers.

Very few help people truly understand them.

Developers copy code without knowing how it works.
Students read explanations that feel too technical.
Non-technical users struggle with jargon-heavy content.

We wanted to create a tool that adapts explanations to the user's level of understanding while keeping the information accurate and useful.

---

## Features

### Dual-Level Explanations

Every explanation is generated in two layers:

#### Explain Like I'm 5 (ELI5)

Simple, analogy-based explanations designed for beginners.

#### Technical Breakdown

Structured explanations for users who want deeper understanding.

---

### Web Platform

* Enter any topic or question
* Receive beginner-friendly and technical explanations
* Designed for students, learners, and curious minds

---

### VS Code Extension

* Reads selected code or files
* Explains how code works directly inside VS Code
* Helps developers understand unfamiliar codebases faster
* Supports learning, debugging, and onboarding

---

## How It Works

1. User enters a topic or code snippet
2. Structured prompts determine explanation style and depth
3. An AI model processes the input
4. The system generates:

   * Conceptual explanation
   * Technical explanation
5. Results are displayed in a clean, easy-to-follow format

---

## Tech Stack

### Frontend

* HTML
* CSS
* JavaScript

### Backend

* Node.js
* Express.js

### AI

* Prompt Engineering
* Large Language Models
* Gemini API

### Developer Tools

* VS Code Extension API
* GitHub

---

## Project Structure

```text
Explain_It_Simply/
│
├── frontend/
├── backend/
├── vscode-extension/
├── prompts/
├── routes/
├── controllers/
├── services/
└── README.md
```

---

## Problem We Solve

Most AI tools focus on generating content.

Explain It Simply focuses on generating understanding.

The goal is to reduce cognitive overload while making learning accessible for both technical and non-technical users.

---

## Future Roadmap

* Personalized explanation levels
* Voice-based explanations
* Educational platform integrations
* Full project-level code explanations
* Team onboarding tools
* Documentation assistant
* Enterprise knowledge systems

---

## Impact

Explain It Simply aims to make knowledge more accessible by helping people understand complex ideas instead of memorizing them.

If you can explain it simply, you truly understand it.

---

## Recognition

🏆 ET AI Hackathon 2026 - Semi Finalist

Built as a hackathon project focused on improving learning, developer productivity, and knowledge accessibility.

---

## Working in this repository

An explanation layer for developers and learners. Ask about a concept or hand it
some code and you get two answers: one in plain language you can act on in fifteen
seconds, and one with the precise terminology, mechanism and edge cases. Then you
can go deeper, ask for an example, or run a code action on the same context.

| Path | What it is |
|---|---|
| `shared/` | The AI core: provider adapters, request pipeline, prompts, schemas, context engine, errors, logging. |
| `explain-it-simply-vs-code-extension/` | VS Code extension — context-aware commands, panel UI, settings, history. |
| `explain-it-simply-website/` | Express backend holding the key server-side + landing page and the explainer app. |
| `scripts/check.js` | The gate: 131 checks across syntax, secrets, vendoring, core, registry, extension, webview (the panel client is run against a fake DOM), audit, security, server. |
| `scripts/vscode-window-check.js` | `npm run check:vscode` (working tree) and `npm run check:vscode:package` (the unpacked `.vsix`): opens a real, disposable VS Code window and runs the extension inside it via `src/test/realWindow.js`. Needs a desktop; nothing else does. |
| `explain-it-simply-vs-code-extension/tools/preview/probe.js` | `npm run check:layout`: drives headless Chrome over CDP at the measured rail and panel sizes and scrolls the webview with **trusted** wheel input. Programmatic `scrollTop` moves even when nothing is reachable by hand, so this is the only honest scroll check. |
| `docs/ARCHITECTURE.md` | Pipeline, provider boundary, schemas, security, state. Read it before changing anything. |

## Check it

```bash
npm run check           # no install needed, Node built-ins only
npm run check:vscode    # needs a desktop: opens a throwaway VS Code window
npm run check:layout    # needs Chrome: proves wheel scrolling and clipping at real widths
```

Everything should pass, with one warning about a key that is still in git history.

## Run the web app

```bash
cd explain-it-simply-website
cp .env.example .env      # set GOOGLE_API_KEY (or another provider's) and EIS_MODEL
npm install
npm start                 # prints the bound address; defaults to 127.0.0.1
```

Then open the printed URL: `index.html` is the product page, `app.html` is the
explainer. `POST /api/explain` and `POST /api/explain/stream` (SSE) are the real
endpoints; `GET /api/catalog` tells the UI which providers, models, depths and tasks
actually exist. Nothing is hardcoded in the frontend that the backend has not offered.

Out of the box the server binds to loopback, is rate limited, and serves only
`public/`. Binding to a reachable interface without `EIS_ACCESS_TOKEN` is refused at
startup — otherwise the server is an open proxy for your API key.

## Run the extension

Open `explain-it-simply-vs-code-extension/` in VS Code and press **F5**. The extension
puts an icon in the Activity Bar (left rail) — click it for the panel, or press
`Ctrl+Alt+E` on a selection and use the right-click menu (*Explain Selection*, *Explain
Function*, *Explain Error* when a diagnostic is present, *Find Issues*, *Simplify*).
First run asks for provider → model → key, with **Test connection** and **Refresh
models** before it saves.

```
Ctrl+Alt+E  open panel      Ctrl+Alt+S  explain selection
Ctrl+Alt+F  explain function Ctrl+Alt+D explain the error here
```

## What is sent, and what is kept

The selection plus a bounded amount of context — enclosing function, imports,
surrounding lines — up to `explainItSimply.context.maxCharacters` (default 8 000).
Every part included is listed under "what was sent" on the answer, with sizes and
truncation notices. The workspace is never read. Keys live in your OS keychain (or
the server's environment) and never reach the webview, the browser, or an error
message. History is local, capped, searchable and pinnable, and
`explainItSimply.privacy.codeRetention` decides how much of your source it keeps —
`none` stores no code at all.

## Known status

- Model ids come from vendor documentation on 2026-10-11 and are marked
  `verified`/`unverified`; the live model list reconciles them with reality once a key
  is present. `npm run check` proves shapes and behaviour, not that a specific id is
  still sold tomorrow.
- A Google key committed in history (`6f5a5d2`) is still pushed; revoke it. Creating a
  clean repository does not remove it from this history.
- The extension runs in a real VS Code window under `npm run check:vscode` (working
  tree) and `npm run check:vscode:package` (the unpacked `.vsix`), and its scrolling is
  proven with trusted wheel input under `npm run check:layout`.
- Five provider adapters (Google, Anthropic, OpenAI, Groq, Kimi) have never been called
  live; only OpenRouter has.
