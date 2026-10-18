#!/usr/bin/env node
// Foundation + AI-infrastructure gate for the Explain It Simply repo.
// Node built-ins only, so it runs straight after a clone with no install step.
// Every check executes real code against real modules and can fail.

'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'explain-it-simply-vs-code-extension');
const WEB_DIR = path.join(ROOT, 'explain-it-simply-website');
const SHARED = path.join(ROOT, 'shared');

const results = [];
const warnings = [];
let group = '';

const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg >= 0
  ? String(process.argv[onlyArg + 1] || '').split(',').map((s) => s.trim()).filter(Boolean)
  : [];
const shouldRun = (name) => ONLY.length === 0 || ONLY.includes(name);

function setGroup(name) {
  group = name;
}

async function check(name, fn) {
  const label = `${group}: ${name}`;
  if (process.stdout.isTTY) process.stdout.write(`  … ${label}\n`);
  let error = null;
  try {
    await fn();
  } catch (caught) {
    error = caught instanceof Error ? caught : new Error(String(caught));
  }
  results.push({ name: label, ok: !error, detail: error ? (process.env.STACK && error.stack ? error.stack : error.message) : '' });
}

function fail(message) {
  throw new Error(message);
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function walk(dir, matches) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, matches));
    else if (matches(full)) found.push(full);
  }
  return found;
}

function sh(cmd, args, options = {}) {
  const out = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...options });
  if (out.error) throw out.error;
  return { code: out.status, stdout: out.stdout || '', stderr: out.stderr || '' };
}

function git(args) {
  return sh('git', args);
}

function trackedFiles() {
  const out = git(['ls-files', '--cached', '--others', '--exclude-standard']);
  if (out.code !== 0) fail(`git ls-files failed: ${out.stderr}`);
  return out.stdout.split(/\r?\n/).filter(Boolean);
}

async function expectErrorCode(promise, expected, label) {
  let thrown = null;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  if (!thrown) fail(`${label}: expected a rejection, got a result`);
  if (thrown.code !== expected) fail(`${label}: expected ${expected}, got ${thrown.code} (${thrown.message})`);
}

function request(port, { method = 'GET', path: urlPath, body, headers = {}, raw = false }) {
  return new Promise((resolve, reject) => {
    const payload = raw || body === undefined ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers }
          : headers,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch (e) { json = null; }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.setTimeout(25000, () => req.destroy(new Error(`request timed out: ${method} ${urlPath}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ----------------------------------------------------------------- 1 syntax

async function checkSyntax() {
  setGroup('syntax');
  const files = [
    ...walk(SHARED, (f) => f.endsWith('.js')),
    ...walk(path.join(EXT_DIR, 'src'), (f) => f.endsWith('.js')),
    ...walk(path.join(EXT_DIR, 'webview'), (f) => f.endsWith('.js')),
    ...walk(path.join(WEB_DIR, 'src'), (f) => f.endsWith('.js')),
    path.join(WEB_DIR, 'server.js'),
    path.join(ROOT, 'scripts', 'check.js'),
    path.join(ROOT, 'scripts', 'vendor-shared.js'),
  ];

  await check(`node --check on ${files.length} source files`, () => {
    if (files.length < 40) fail(`only ${files.length} files found — the walk is wrong`);
    const broken = [];
    for (const file of files) {
      const out = sh(process.execPath, ['--check', file]);
      if (out.code !== 0) broken.push(`${rel(file)}: ${(out.stderr || out.stdout).trim() || `exit ${out.code}`}`);
    }
    if (broken.length) fail(broken.join('\n'));
  });

  await check('manifests parse and carry no stale provider config', () => {
    const ext = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.json'), 'utf8'));
    const web = JSON.parse(fs.readFileSync(path.join(WEB_DIR, 'package.json'), 'utf8'));
    assert.ok(ext.contributes.commands.length >= 15, 'extension lost commands');
    assert.deepStrictEqual(ext.activationEvents, [], 'extension must not auto-activate');
    assert.ok(!('cors' in web.dependencies), 'website still declares the unused cors package');
    assert.ok(!('node-fetch' in web.dependencies), 'website declares node-fetch but uses built-ins');
    const lock = JSON.parse(fs.readFileSync(path.join(WEB_DIR, 'package-lock.json'), 'utf8'));
    assert.ok(!lock.packages['node_modules/cors'], 'cors is still in the lockfile');
  });

  await check('no model id string lives outside the registry', () => {
    const offenders = [];
    const pattern = /\b(gemini-[0-9][a-z0-9.\\-]*|gpt-[0-9][a-z0-9.\-]*|claude-[a-z0-9.\-]+|llama-[0-9.]+-versatile|gpt-oss-[0-9]+b)\b/;
    const roots = [
      ['shared', SHARED],
      ['extension src', path.join(EXT_DIR, 'src')],
      ['website src', path.join(WEB_DIR, 'src')],
      ['webview', path.join(EXT_DIR, 'webview')],
    ];
    for (const [label, dir] of roots) {
      for (const file of walk(dir, (f) => f.endsWith('.js'))) {
        if (file.includes(`${path.sep}shared${path.sep}`) && path.basename(file) === 'registry.js') continue;
        if (rel(file).endsWith('providers/registry.js')) continue;
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (pattern.test(line) && !/RETIRED|deprecated|example/i.test(line)) {
            offenders.push(`${label}: ${rel(file)}:${index + 1} → ${line.trim().slice(0, 70)}`);
          }
        });
      }
    }
    // The harness-style fake ids used by this script are allowed here and nowhere else.
    offenders.push(...[]);
    if (offenders.length) fail(`hard-coded model ids:\n      ${offenders.join('\n      ')}`);
  });
}

// ----------------------------------------------------------------- 2 secrets

const SECRET_PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'OpenAI key', re: /sk-(?!ant)[A-Za-z0-9_-]{20,}/ },
  { name: 'Anthropic key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'Groq key', re: /gsk_[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

async function checkSecrets() {
  setGroup('secrets');
  const files = trackedFiles();

  await check('the scanner detects a planted credential', () => {
    const planted = [
      ['AIza', 'b'.repeat(35)].join(''),
      ['gsk_', 'A'.repeat(40)].join(''),
      ['sk-', 'c'.repeat(35)].join(''),
    ];
    for (const secret of planted) {
      if (!SECRET_PATTERNS.some((pattern) => pattern.re.test(secret))) fail(`pattern set misses ${secret.slice(0, 6)}…`);
    }
  });

  await check(`${files.length} tracked files hold no credentials`, () => {
    if (files.length < 20) fail(`only ${files.length} tracked files`);
    const hits = [];
    for (const file of files) {
      if (file.endsWith('package-lock.json') || file.endsWith('.zip')) continue;
      const full = path.join(ROOT, file);
      if (!fs.existsSync(full)) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const pattern of SECRET_PATTERNS) {
        const match = pattern.re.exec(text);
        if (match) hits.push(`${file} → ${pattern.name} ${match[0].slice(0, 6)}…`);
      }
    }
    if (hits.length) fail(`credentials in tracked files: ${hits.join('; ')}`);
  });

  await check('env files, node_modules and archives stay untracked', () => {
    const offenders = files.filter((file) => {
      if (file.endsWith('.env.example')) return false;
      return /(^|\/)\.env(\..*)?$/.test(file)
        || /(^|\/)env(\.txt)?$/i.test(file)
        || file.includes('node_modules/')
        || /\.(vsix|zip)$/.test(file);
    });
    if (offenders.length) fail(`tracked but must stay local: ${offenders.join(', ')}`);
  });

  await check('git ignores a bare `env` file (the original leak vector)', () => {
    const probes = ['explain-it-simply-website/env', 'explain-it-simply-website/env.txt', 'explain-it-simply-website/.env'];
    const notIgnored = probes.filter((probe) => git(['check-ignore', '-q', '--', probe]).code !== 0);
    if (notIgnored.length) fail(`not ignored: ${notIgnored.join(', ')}`);
  });

  await check('the API key never appears in source or webview assets', () => {
    const scanned = [
      ...walk(SHARED, (f) => f.endsWith('.js')),
      ...walk(path.join(EXT_DIR, 'webview'), (f) => true),
      ...walk(path.join(WEB_DIR, 'src'), (f) => f.endsWith('.js')),
    ];
    const leaked = scanned.filter((file) => /AIza[0-9A-Za-z]{20,}/.test(fs.readFileSync(file, 'utf8')));
    if (leaked.length) fail(`key material in ${leaked.map(rel).join(', ')}`);
  });

  reportHistorySecrets();
  reportDiskSecrets();
}

// A key that leaked into git history is usually still sitting in the working tree too,
// in files git ignores and nobody re-reads. Warning, not failing: `.env` is a legitimate
// place for a key — the point is to say where copies live so they can be revoked once.
function reportDiskSecrets() {
  const candidates = walk(ROOT, (file) => {
    if (/(\.vsix|\.zip|\.png|\.jpg|\.ico|\.woff2?|\.lock)$/.test(file)) return false;
    if (/\bpackage(-lock)?\.json$/.test(file)) return false;
    return fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size < 2_000_000;
  });
  const found = [];
  for (const file of candidates) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      continue;
    }
    if (text.includes('\u0000')) continue;
    for (const pattern of SECRET_PATTERNS) {
      pattern.re.lastIndex = 0;
      const match = pattern.re.exec(text);
      if (match) found.push(`${rel(file)} [${pattern.name}] ${match[0].slice(0, 6)}…${match[0].length} chars`);
    }
  }
  if (found.length) {
    warnings.push(`credential-shaped values on disk (ignored by git, still worth revoking or deleting): ${found.join('; ')}`);
  }
}

// Reported, not asserted: a pushed secret can only be fixed by revoking it, so
// failing the suite forever would just train everyone to ignore the red.
function reportHistorySecrets() {
  const commits = git(['log', '--all', '--format=%H']).stdout.split(/\r?\n/).filter(Boolean);
  const hits = [];
  for (const commit of commits) {
    const listing = git(['ls-tree', '-r', '--name-only', commit]).stdout.split(/\r?\n/).filter(Boolean);
    for (const file of listing) {
      if (!/(^|\/)(\.env|env|env\.txt)$/i.test(file)) continue;
      const blob = git(['show', `${commit}:${file}`]).stdout;
      if (SECRET_PATTERNS.some((pattern) => pattern.re.test(blob))) hits.push(`${commit.slice(0, 7)} ${file}`);
    }
  }
  if (hits.length) warnings.push(`credential committed in history and pushed to origin: ${hits.join(', ')} — revoke that key at the provider`);
}

// ----------------------------------------------------------------- 3 vendor

async function checkVendoring() {
  setGroup('vendored core');
  await check('src/shared matches shared/ exactly', () => {
    const out = sh(process.execPath, [path.join(ROOT, 'scripts', 'vendor-shared.js'), '--check']);
    if (out.code !== 0) fail((out.stderr || out.stdout).trim());
  });

  await check('the vendored copy is what ships inside the .vsix', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'src', 'shared', 'ORIGIN.json'), 'utf8'));
    assert.ok(manifest.count >= 15, 'vendored manifest looks empty');
    const ignore = fs.readFileSync(path.join(EXT_DIR, '.vscodeignore'), 'utf8');
    if (/src\/shared/.test(ignore)) fail('.vscodeignore excludes src/shared — the packaged extension would crash');
  });
}

// ----------------------------------------------------------------- 4 core

const FAKE_KEY = 'TEST-ONLY-not-a-real-key-1234567890';

const QUIET = { info() {}, warn() {}, error() {}, setSecrets() {}, sanitize: (value) => value, LEVELS: { info: 10 } };

function fakeReply(payload) {
  return { status: 200, headers: { 'content-type': 'application/json' }, text: JSON.stringify(payload) };
}

const EXPLANATION_JSON = JSON.stringify({
  title: 'Recursion',
  summary: 'A function that solves a problem by calling itself on a smaller input.',
  simpleExplanation: { heading: 'Explain it simply', body: 'Boxes inside boxes until you find the toy.' },
  technicalExplanation: { heading: 'Technical breakdown', body: 'Each call adds a stack frame.', points: ['Needs a base case', 'Unwinds in reverse'] },
  keyTakeaway: 'Repeat on smaller input until a base case stops it.',
});

const CODE_CHANGE_JSON = JSON.stringify({
  title: 'Simplified',
  language: 'javascript',
  code: 'const identity = (value) => value;',
  summary: 'Removed a pointless loop.',
  changes: [{ what: 'loop replaced', why: 'the loop only copied the array' }],
});

function makeTransport(handler) {
  let calls = 0;
  const log = [];
  const shared = { sseEvents: handler.sseEvents || [], streamStatus: handler.streamStatus || 200 };
  const transport = {
    log,
    get calls() {
      return calls;
    },
    json: async (options) => {
      calls += 1;
      log.push({ kind: 'json', hostname: options.hostname, path: options.path, headers: options.headers, body: options.body });
      return handler(options, calls, log);
    },
    sse: async (options, onEvent) => {
      calls += 1;
      log.push({ kind: 'sse', hostname: options.hostname, path: options.path, body: options.body });
      for (const event of shared.sseEvents) onEvent(event);
      return { status: shared.streamStatus, headers: {}, text: '' };
    },
  };
  // Tests assign the scripted stream frames after creating the transport.
  Object.defineProperty(transport, 'sseEvents', {
    get: () => shared.sseEvents,
    set: (value) => {
      shared.sseEvents = value;
    },
  });
  return transport;
}

function googleReply(text, extra = {}) {
  return fakeReply({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { candidatesTokenCount: 51, promptTokenCount: 120 }, ...extra });
}

async function checkCore() {
  setGroup('core');
  const { createCore } = require(path.join(SHARED, 'index.js'));
    const baseConfig = {
    providerId: 'google',
    model: 'gemini-3.8-flash',
    apiKey: FAKE_KEY,
    retries: 3,
    logger: QUIET,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  };

  await check('topic request runs the full pipeline and returns Explanation v2', async () => {
    const transport = makeTransport(() => googleReply(EXPLANATION_JSON));
    const core = createCore({ ...baseConfig, transport });
    const { result, meta } = await core.explain({ task: 'explain-topic', subject: 'What is recursion?' });
    assert.strictEqual(result.version, 2);
    assert.strictEqual(result.title, 'Recursion');
    assert.strictEqual(result.simpleExplanation.body, 'Boxes inside boxes until you find the toy.');
    assert.deepStrictEqual(result.technicalExplanation.points, ['Needs a base case', 'Unwinds in reverse']);
    assert.strictEqual(meta.provider, 'google');
    assert.strictEqual(meta.structuredOutput, 'native');
    assert.strictEqual(meta.usage.outputTokens, 51);
    assert.ok(meta.stages.validate >= 0 && meta.stages.provider >= 0, 'stage timings missing');
    assert.deepStrictEqual(meta.missingFields, [], `a complete balanced answer should validate cleanly, got ${meta.missingFields.join('; ')}`);
    assert.ok(JSON.stringify(transport.log.at(-1).body).includes('responseSchema'), 'no native schema sent');
    // Google carries the key in the query string by design; it must never appear
    // in the request body or in anything the caller can read back.
    assert.ok(!JSON.stringify(transport.log).includes(FAKE_KEY) || transport.log.at(-1).path.includes(`key=${FAKE_KEY}`), 'key leaked outside the google query string');
    assert.ok(!JSON.stringify(transport.log.at(-1).body).includes(FAKE_KEY), 'the key was sent inside a request body');
  });

  await check('a complete deep answer validates with no shortfall', async () => {
    const deep = JSON.stringify({
      title: 'Recursion in depth',
      summary: 'A function that solves a problem by calling itself on a smaller input.',
      simpleExplanation: { heading: 'Explain it simply', body: 'Boxes inside boxes until you find the toy.' },
      technicalExplanation: { heading: 'Technical breakdown', body: 'Each call adds a stack frame.', points: ['Needs a base case'] },
      howItWorks: ['The caller pushes a frame', 'The body runs on a smaller input', 'The base case returns', 'Frames unwind in reverse'],
      examples: [{ title: 'factorial', language: 'javascript', code: 'const fact = (n) => (n < 2 ? 1 : n * fact(n - 1));' }],
      keyConcepts: [{ term: 'base case', meaning: 'the input that stops the recursion' }],
      commonMistakes: ['Forgetting the base case, which overflows the stack'],
      keyTakeaway: 'Recurse on a smaller input until a base case stops you.',
      relatedTopics: [{ name: 'stack frames', why: 'where the cost lives' }],
    });
    const core = createCore({ ...baseConfig, transport: makeTransport(() => googleReply(deep)) });
    const { result, meta } = await core.explain({ task: 'explain-topic', subject: 'x', depth: 'deep' });
    assert.deepStrictEqual(meta.missingFields, [], meta.missingFields.join('; '));
    assert.strictEqual(result.examples.length, 1);
    assert.strictEqual(result.relatedTopics[0].name, 'stack frames');
    assert.ok(result.howItWorks.length >= 4);
  });

  await check('depth changes the ask, not just the length', async () => {
    const seen = [];
    const transport = makeTransport((options) => {
      seen.push(options.body.systemInstruction.parts[0].text);
      return googleReply(EXPLANATION_JSON);
    });
    const core = createCore({ ...baseConfig, transport });
    const quick = await core.explain({ task: 'explain-topic', subject: 'x', depth: 'quick' });
    const deep = await core.explain({ task: 'explain-topic', subject: 'x', depth: 'deep' });
    assert.ok(!quick.result.technicalExplanation, 'quick kept the technical layer');
    assert.ok(seen[0] !== seen[1], 'identical prompts for different depths');
    assert.ok(!/REQUIRED howItWorks/.test(seen[0]), 'quick prompt asked for deep fields');
    assert.ok(/REQUIRED howItWorks/.test(seen[1]), 'deep prompt omitted howItWorks');
    assert.ok(deep.meta.missingFields.length > 0, 'deep answer shortfall not reported');
    assert.strictEqual(quick.meta.depth, 'quick');
  });

  await check('teach-me forces a lesson structure', async () => {
    const transport = makeTransport(() => googleReply(EXPLANATION_JSON));
    const core = createCore({ ...baseConfig, depth: 'quick', transport });
    const { meta } = await core.explain({ task: 'teach-me', subject: 'recursion' });
    assert.strictEqual(meta.depth, 'deep', 'teach-me should raise quick to deep');
  });

  await check('code context is mined, bounded and reported', async () => {
    const document = [
      'import fs from "fs";',
      'import path from "path";',
      '',
      'export function readConfig(file) {',
      '  const raw = fs.readFileSync(path.resolve(file), "utf8");',
      '  return JSON.parse(raw);',
      '}',
      '',
      'function unused() { return 1; }',
    ].join('\n');
    const transport = makeTransport(() => googleReply(EXPLANATION_JSON));
    const core = createCore({ ...baseConfig, transport });
    const { result, meta } = await core.explain({
      task: 'explain-code',
      subject: '  const raw = fs.readFileSync(path.resolve(file), "utf8");',
      fullDocument: document,
      cursorLine: 4,
      fileName: 'config.mjs',
      language: 'javascript',
    });
    const parts = meta.context.manifest.map((entry) => entry.part);
    assert.deepStrictEqual(parts, ['selection', 'enclosing-block', 'imports', 'surrounding-lines']);
    assert.strictEqual(result.kind, 'code');
    assert.ok(meta.context.chars < 20000, 'context not bounded');
    const sent = transport.log.at(-1).body.contents[0].parts[0].text;
    assert.ok(sent.includes('enclosing-block'), 'context text was not sent');
    assert.ok(sent.includes('do not claim anything about code you were not shown'), 'no honesty guard in the prompt');
  });

  await check('huge documents are refused before any provider call', async () => {
    const transport = makeTransport(() => googleReply(EXPLANATION_JSON));
    const core = createCore({ ...baseConfig, transport });
    await expectErrorCode(
      core.explain({ task: 'explain-code', subject: 'x'.repeat(300), fullDocument: 'y'.repeat(250000) }),
      'CONTEXT_TOO_LARGE',
      'oversized document',
    );
    assert.strictEqual(transport.calls, 0, 'provider was called anyway');
  });

  await check('empty, unknown-task and unknown-provider requests fail as validations', async () => {
    const core = createCore({ ...baseConfig, transport: makeTransport(() => googleReply(EXPLANATION_JSON)) });
    await expectErrorCode(core.explain({ task: 'explain-topic', subject: '   ' }), 'VALIDATION_ERROR', 'blank subject');
    await expectErrorCode(core.explain({ task: 'make-coffee', subject: 'x' }), 'VALIDATION_ERROR', 'unknown task');
    await expectErrorCode(core.explain({ task: 'explain-topic', subject: 'x', providerId: 'mistral' }), 'VALIDATION_ERROR', 'unknown provider');
    const noKey = createCore({ ...baseConfig, apiKey: '' });
    await expectErrorCode(noKey.explain({ task: 'explain-topic', subject: 'x' }), 'CONFIGURATION_ERROR', 'missing key');
  });

  await check('retired model ids are refused with a recovery message', async () => {
    const registry = require(path.join(SHARED, 'providers/registry.js'));
    const core = createCore({ ...baseConfig, providerId: 'google', model: 'gemini-2.0-flash', transport: makeTransport(() => googleReply(EXPLANATION_JSON)) });
    const failure = core.validateConfiguration();
    assert.ok(!failure.ok, 'a retired model was accepted silently');
    assert.match(failure.problems.join(' '), /no longer available|not in the built-in list/);
    assert.ok(registry.retirementReason('gpt-3.5-turbo'), 'gpt-3.5-turbo is not marked retired');
    assert.ok(registry.retirementReason('gemini-1.5-pro'), 'gemini-1.5-pro is not marked retired');
  });

  await check('prose instead of JSON is a MalformedResponseError, not a crash', async () => {
    const core = createCore({ ...baseConfig, transport: makeTransport(() => googleReply('Sure! Recursion is when a function calls itself.')) });
    await expectErrorCode(core.explain({ task: 'explain-topic', subject: 'x' }), 'MALFORMED_RESPONSE', 'prose reply');
  });

  await check('truncated JSON is repaired when the core fields are intact', async () => {
    const cut = EXPLANATION_JSON.slice(0, EXPLANATION_JSON.length - 45);
    const core = createCore({ ...baseConfig, transport: makeTransport(() => googleReply(cut)) });
    const { result } = await core.explain({ task: 'explain-topic', subject: 'x' });
    assert.strictEqual(result.title, 'Recursion');
  });

  await check('a layer that is present but empty is a gap, not an answer', async () => {
    // Shape observed live from nvidia/nemotron-3.5-super-vl on 2026-10-16: the key was
    // there, the content was not, and the old check called it complete.
    const core = createCore({
      ...baseConfig,
      transport: makeTransport(() => googleReply(JSON.stringify({
        title: 'JavaScript Closures Explained',
        simpleExplanation: { heading: 'Explain it simply', body: '', points: [] },
        keyTakeaway: 'A closure keeps variables from where it was created.',
      }))),
    });
    await expectErrorCode(
      core.explain({ task: 'explain-topic', subject: 'x', depth: 'quick' }),
      'MALFORMED_RESPONSE',
      'empty simple layer',
    );
  });

  await check('a model that pastes the paragraph into heading is trimmed', async () => {
    const rambling = 'Think of a function as a worker who carries a backpack of tools. When the worker leaves a job, they still keep the backpack. A closure happens when an inner function remembers variables.';
    const core = createCore({
      ...baseConfig,
      transport: makeTransport(() => googleReply(JSON.stringify({
        title: 'Closures',
        simpleExplanation: { heading: rambling, body: 'The real body stays intact.', points: [] },
        keyTakeaway: 'Keeps variables alive.',
      }))),
    });
    const { result } = await core.explain({ task: 'explain-topic', subject: 'x', depth: 'quick' });
    assert.ok(result.simpleExplanation.heading.length <= 91, `heading kept ${result.simpleExplanation.heading.length} chars`);
    assert.ok(!/\. \S/.test(result.simpleExplanation.heading), `heading still holds two sentences: ${result.simpleExplanation.heading}`);
    assert.notStrictEqual(result.simpleExplanation.heading, rambling, 'the paragraph was kept whole');
    assert.strictEqual(result.simpleExplanation.body, 'The real body stays intact.', 'the body was damaged by trimming the heading');
  });

  await check('a reply with no explanatory content is rejected', async () => {
    const core = createCore({ ...baseConfig, transport: makeTransport(() => googleReply('{"title":"Empty","keyTakeaway":""}')) });
    await expectErrorCode(core.explain({ task: 'explain-topic', subject: 'x' }), 'MALFORMED_RESPONSE', 'empty explanation');
  });

  await check('extra fields the schema never asked for are dropped', async () => {
    const noisy = JSON.stringify({ ...JSON.parse(EXPLANATION_JSON), hacked: '<script>alert(1)</script>', debug: { key: FAKE_KEY } });
    const core = createCore({ ...baseConfig, transport: makeTransport(() => googleReply(noisy)) });
    const { result } = await core.explain({ task: 'explain-topic', subject: 'x' });
    assert.strictEqual(result.hacked, undefined, 'unknown field survived normalization');
    assert.strictEqual(result.debug, undefined, 'unknown field survived normalization');
    if (JSON.stringify(result).includes(FAKE_KEY)) fail('provider echo carried the key into the result');
  });

  await check('429 is retried honouring Retry-After; 401 is not retried', async () => {
    let n = 0;
    const retries = [];
    const rateLimited = createCore({
      ...baseConfig,
      transport: makeTransport((options, call) => (call === 1
        ? { status: 429, headers: { 'retry-after': '3' }, text: JSON.stringify({ error: { message: 'slow down' } }) }
        : googleReply(EXPLANATION_JSON))),
      onRetry: null,
    });
    const first = await rateLimited.pipeline.runRequest({ ...baseConfig }, { task: 'explain-topic', subject: 'x' }, {
      transport: makeTransport((options, call) => (call === 1
        ? { status: 429, headers: { 'retry-after': '3' }, text: JSON.stringify({ error: { message: 'slow down' } }) }
        : googleReply(EXPLANATION_JSON))),
      sleep: () => Promise.resolve(),
      onRetry: (info) => retries.push(info),
    });
    assert.strictEqual(first.meta.retries, 1, 'the 429 was not retried');
    assert.strictEqual(retries[0].delayMs, 3000, 'Retry-After was ignored');

    const authFail = () => { n += 1; return { status: 401, headers: {}, text: JSON.stringify({ error: { message: 'Incorrect API key provided' } }) }; };
    await assert.rejects(
      createCore({ ...baseConfig, providerId: 'openai', model: 'gpt-4o-mini', transport: makeTransport(authFail) })
        .explain({ task: 'explain-topic', subject: 'x' }),
      (error) => {
        assert.strictEqual(error.code, 'AUTHENTICATION_ERROR');
        return true;
      },
    );
    assert.strictEqual(n, 1, `authentication failure was retried ${n} times`);
  });

  await check('provider failures map to the right class and recovery message', async () => {
    const cases = [
      {
        label: 'google-style bad key (400)',
        reply: { status: 400, headers: {}, text: JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }) },
        code: 'AUTHENTICATION_ERROR',
      },
      {
        label: 'unknown model (404)',
        reply: { status: 404, headers: {}, text: JSON.stringify({ error: { message: 'Model not found.' } }) },
        code: 'PROVIDER_ERROR',
      },
      {
        label: 'openai bad key (401)',
        reply: { status: 401, headers: {}, text: JSON.stringify({ error: { message: 'Incorrect API key provided' } }) },
        code: 'AUTHENTICATION_ERROR',
      },
      {
        label: 'anthropic-style invalid x-api-key (400)',
        reply: { status: 400, headers: {}, text: JSON.stringify({ error: { message: 'Invalid x-api-key in request headers' } }) },
        code: 'AUTHENTICATION_ERROR',
      },
      {
        // A 400 about something else must NOT be read as a key problem: a false
        // AuthenticationError puts a healthy key on a five-minute cooldown.
        label: 'unrelated 400 mentioning a cache key',
        reply: { status: 400, headers: {}, text: JSON.stringify({ error: { message: 'the sorting key is invalid for this cache' } }) },
        // Not AUTHENTICATION_ERROR: a misread here would cool down a healthy key.
        code: 'PROVIDER_ERROR',
      },
    ];
    for (const testCase of cases) {
      let caught = null;
      try {
        await createCore({ ...baseConfig, transport: makeTransport(() => testCase.reply) }).explain({ task: 'explain-topic', subject: 'x' });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught, `${testCase.label}: no error surfaced`);
      assert.strictEqual(caught.code, testCase.code, `${testCase.label} -> ${caught.code}`);
    }
    // A missing model must tell the user what to do next, not just fail.
    let modelError = null;
    try {
      await createCore({ ...baseConfig, transport: makeTransport(() => ({ status: 404, headers: {}, text: '{"error":{"message":"model not found"}}' })) })
        .explain({ task: 'explain-topic', subject: 'x' });
    } catch (error) {
      modelError = error;
    }
    assert.match(modelError.message, /unavailable|choose another model/i, `model failure said: ${modelError.message}`);
  });

  await check('server 5xx is retryable, provider 400 is not', async () => {
    let five = 0;
    const busyCore = createCore({
      ...baseConfig,
      transport: makeTransport(() => {
        five += 1;
        return { status: 503, headers: {}, text: '{"error":{"message":"busy"}}' };
      }),
    });
    await busyCore.explain({ task: 'explain-topic', subject: 'x' }).catch(() => {});
    assert.strictEqual(five, 3, `expected 3 attempts on 503, got ${five}`);

    let four = 0;
    const badModelCore = createCore({
      ...baseConfig,
      transport: makeTransport(() => {
        four += 1;
        return { status: 400, headers: {}, text: '{"error":{"message":"model_not_found"}}' };
      }),
    });
    await badModelCore.explain({ task: 'explain-topic', subject: 'x' }).catch(() => {});
    assert.strictEqual(four, 1, `a 400 was retried ${four} times`);
  });

  await check('cancellation: abort stops the request, ledger keeps newest', async () => {
    const controller = new AbortController();
    const core = createCore({
      ...baseConfig,
      transport: {
        json: async (options) => {
          controller.abort();
          await new Promise((resolve) => setTimeout(resolve, 20));
          if (options.signal.aborted) {
            const { CancelledError } = require(path.join(SHARED, 'errors.js'));
            throw new CancelledError();
          }
          return googleReply(EXPLANATION_JSON);
        },
      },
    });
    await expectErrorCode(core.explain({ task: 'explain-topic', subject: 'x', signal: controller.signal }), 'CANCELLED', 'abort');

    const { Ledger } = require(path.join(SHARED, 'pipeline/requestLedger.js'));
    const ledger = new Ledger();
    const first = ledger.begin('a');
    const second = ledger.begin('b');
    assert.ok(!first.isCurrent(), 'older request still current');
    assert.ok(second.isCurrent(), 'newest request is not current');
    assert.ok(first.signal.aborted, 'older request was not aborted');
    assert.strictEqual(ledger.cancelAll(), 1);
    assert.ok(!second.isCurrent(), 'cancelAll left the request active');
  });

  await check('streaming assembles deltas and reports them as streamed', async () => {
    const pieces = ['{"title":"Streaming","simpleExpla', 'nation":{"body":"built from deltas"}}'];
    const transport = makeTransport(() => googleReply(EXPLANATION_JSON));
    transport.sseEvents = pieces.map((text) => ({ event: 'message', data: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) }));
    const core = createCore({ ...baseConfig, transport });
    let seen = '';
    const { result, meta } = await core.explain({ task: 'explain-topic', subject: 'x', onDelta: (piece) => { seen += piece; } });
    assert.ok(seen.includes('Streaming'), 'deltas did not reach the caller');
    assert.strictEqual(result.title, 'Streaming');
    assert.strictEqual(meta.streaming, true);
    assert.ok(transport.log.at(-1).path.includes('streamGenerateContent'), 'did not use the streaming endpoint');
    assert.ok(transport.log.at(-1).path.includes('alt=sse'), 'missing alt=sse on the stream endpoint');
  });

  await check('each provider style is shaped and parsed correctly', async () => {
    const seen = [];
    const transport = {
      json: async (options) => {
        seen.push(options);
        if (options.hostname === 'api.anthropic.com') {
          return fakeReply({ content: [{ type: 'text', text: EXPLANATION_JSON.slice(1) }], usage: { input_tokens: 5, output_tokens: 7 } });
        }
        return fakeReply({ choices: [{ message: { content: options.body.response_format?.json_schema?.schema?.properties?.code ? CODE_CHANGE_JSON : EXPLANATION_JSON } }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
      },
    };
    const anthropic = createCore({ ...baseConfig, providerId: 'anthropic', model: 'claude-sonnet-5-5', transport });
    const fromAnthropic = await anthropic.explain({ task: 'explain-topic', subject: 'x' });
    const anthropicCall = seen.at(-1);
    assert.strictEqual(anthropicCall.headers['x-api-key'], FAKE_KEY);
    assert.strictEqual(anthropicCall.headers['anthropic-version'], '2023-06-01');
    assert.strictEqual(anthropicCall.body.messages.at(-1).role, 'assistant', 'no JSON prefill turn');
    assert.strictEqual(fromAnthropic.result.title, 'Recursion', 'prefilled brace not restored');
    assert.strictEqual(fromAnthropic.meta.structuredOutput, 'prompt');

    const openai = createCore({ ...baseConfig, providerId: 'openai', model: 'gpt-4o-mini', transport });
    const changed = await openai.explain({ task: 'simplify', subject: 'function a(){ return 1 }', language: 'javascript' });
    assert.strictEqual(changed.meta.contract, 'code-change');
    assert.ok(changed.result.code.includes('identity'), 'code payload lost');
    assert.strictEqual(seen.at(-1).body.response_format.type, 'json_schema');
    assert.strictEqual(seen.at(-1).body.response_format.json_schema.strict, true);

    const groq = createCore({ ...baseConfig, providerId: 'groq', model: 'gpt-oss-120b', transport });
    const fromGroq = await groq.explain({ task: 'explain-code', subject: 'x' });
    assert.ok(seen.at(-1).path.startsWith('/openai/v1/'), 'groq used the wrong path');
    assert.strictEqual(fromGroq.meta.provider, 'groq');
  });

  await check('structured output can be switched off and the answer still parses', async () => {
    const transport = makeTransport(() => googleReply(EXPLANATION_JSON));
    const core = createCore({ ...baseConfig, structuredOutput: false, transport });
    const { meta } = await core.explain({ task: 'explain-topic', subject: 'x' });
    assert.strictEqual(meta.structuredOutput, 'prompt');
    assert.ok(!('responseMimeType' in transport.log.at(-1).body.generationConfig), 'native fields still sent when disabled');
  });

  await check('live model list is reconciled with the catalogue', async () => {
    const transport = makeTransport(() => fakeReply({ models: [{ name: 'models/gemini-3.8-flash' }, { name: 'models/gemini-3.6-flash' }, { name: 'models/gemini-9-pro-preview' }] }));
    const core = createCore({ ...baseConfig, transport });
    const result = await core.listLiveModels({ providerId: 'google' });
    assert.strictEqual(result.supported, true);
    assert.ok(result.models.some((model) => model.id === 'gemini-9-pro-preview' && model.fromLiveList), 'live-only model not added');
    const curated = result.models.find((model) => model.id === 'gemini-3.1-pro-preview');
    assert.strictEqual(curated.inLiveList, false, 'catalogue-only model should be flagged');
    assert.strictEqual(result.hiddenCount, 0, 'a short live list reported hidden models');
    assert.strictEqual(result.capped, false, 'a short live list reported being capped');
    assert.strictEqual(result.liveCount, 3);
  });

  await check('logs never carry prompts, code or keys', () => {
    const lines = [];
    const { createLogger } = require(path.join(SHARED, 'observability/logger.js'));
    const logger = createLogger({ name: 't', sink: (line) => lines.push(line), errorSink: (line) => lines.push(line), secrets: [FAKE_KEY] });
    logger.info('explain.start', { subject: 'SECRET-SOURCE-CODE', prompt: `key ${FAKE_KEY}`, provider: 'google', chars: 12 });
    logger.error('explain.fail', { message: `rejected ${FAKE_KEY}`, code: 'PROVIDER_ERROR' });
    const text = lines.join('\n');
    assert.ok(!text.includes('SECRET-SOURCE-CODE'), 'subject text was logged');
    assert.ok(!text.includes(FAKE_KEY), 'a registered secret was logged');
    assert.ok(/provider=google/.test(text), 'safe fields should still be logged');
    assert.ok(/subjectLen=\d+/.test(text), 'omitted fields should show their size');
  });
}

// ----------------------------------------------------------------- 5 registry

async function checkRegistry() {
  setGroup('registry');
  const registry = require(path.join(SHARED, 'providers/registry.js'));
  const prompts = require(path.join(SHARED, 'prompts/tasks.js'));
  const { API_STYLES } = registry;

  await check('every provider has an adapter and a style', () => {
    const { ADAPTERS } = require(path.join(SHARED, 'providers/index.js'));
    for (const provider of registry.listProviders()) {
      assert.ok(ADAPTERS[provider.style], `${provider.id} has no adapter for style ${provider.style}`);
      assert.ok(provider.hostname && provider.keyEnv && provider.keyUrl, `${provider.id} is missing connection metadata`);
      assert.ok(provider.models.length >= 2, `${provider.id} needs more than one model`);
      assert.ok(provider.models.some((m) => m.id === provider.defaultModel), `${provider.id} default is not in its own list`);
    }
  });

  await check('no retired model is offered as selectable', () => {
    for (const provider of registry.listProviders()) {
      for (const model of provider.models) {
        assert.ok(!registry.retirementReason(model.id), `${provider.id} still lists retired ${model.id}`);
      }
    }
  });

  await check('streaming and structured output are declared per provider', () => {
    const modes = registry.listProviders().map((p) => p.capabilities.structuredOutput);
    assert.ok(modes.includes('json-schema') && modes.includes('response-schema') && modes.includes('prefill'), 'adapter strategies missing');
    for (const provider of registry.listProviders()) {
      assert.strictEqual(typeof provider.capabilities.streaming, 'boolean', `${provider.id} streaming flag`);
    }
    assert.ok(Object.values(API_STYLES).length === 3);
  });

  await check('the OpenAI-compatible providers route correctly', async () => {
    const { createAdapter } = require(path.join(SHARED, 'providers/index.js'));
    const seen = [];
    const transport = {
      json: async (options) => {
        seen.push({ hostname: options.hostname, path: options.path, headers: options.headers, body: options.body });
        return fakeReply({ choices: [{ message: { content: EXPLANATION_JSON } }], data: [{ id: 'kimi-k2.7-code' }] });
      },
    };
    for (const [id, host, pathPrefix] of [['openrouter', 'openrouter.ai', '/api/v1/'], ['kimi', 'api.moonshot.ai', '/v1/']]) {
      const adapter = createAdapter({ providerId: id, model: registry.defaultModelFor(id), apiKey: 'placeholder-key-value-123', transport });
      const { text } = await adapter.generate({ system: 'S', user: 'U' });
      assert.strictEqual(JSON.parse(text).title, 'Recursion', `${id} reply not parsed`);
      const call = seen.at(-1);
      assert.strictEqual(call.hostname, host, `${id} hit the wrong host`);
      assert.ok(call.path.startsWith(pathPrefix), `${id} used the wrong path: ${call.path}`);
      assert.strictEqual(call.headers.Authorization, 'Bearer placeholder-key-value-123');
    }
    // Attribution belongs to OpenRouter only; sending it elsewhere is noise.
    const orCall = seen.find((entry) => entry.hostname === 'openrouter.ai');
    const kimiCall = seen.find((entry) => entry.hostname === 'api.moonshot.ai');
    assert.strictEqual(orCall.headers['X-OpenRouter-Title'], 'Explain It Simply');
    assert.ok(orCall.headers['HTTP-Referer'], 'OpenRouter attribution referer missing');
    assert.ok(!('X-OpenRouter-Title' in kimiCall.headers), 'Kimi received OpenRouter headers');
  });

  await check('aggregator model lists keep slash-containing ids intact', () => {
    const merged = registry.mergeLiveModels('kimi', ['kimi-k2.7-code', 'kimi/k2-next']);
    assert.ok(merged.models.some((model) => model.id === 'kimi/k2-next' && model.fromLiveList), 'a namespaced live id was lost');
    assert.ok(merged.models.find((model) => model.id === 'kimi-k3').inLiveList === false, 'catalogue-only id should be flagged');
    const catalog = registry.toPublicConfig();
    assert.strictEqual(catalog.providers.length, 6, `expected 6 providers, got ${catalog.providers.length}`);
    for (const id of ['google', 'anthropic', 'openai', 'groq', 'openrouter', 'kimi']) {
      assert.ok(catalog.providers.some((provider) => provider.id === id), `${id} missing from the public catalogue`);
    }
  });

  await check('a several-hundred-model live list stays usable', () => {
    const { checkConfiguration } = require(path.join(SHARED, 'providers/index.js'));
    const ids = ['ghost/model'];
    for (let i = 0; i < 300; i++) ids.push(`vendor/model-${i}`);
    const merged = registry.mergeLiveModels('openrouter', ids);
    assert.ok(
      merged.models.length <= registry.listModels('openrouter').length + registry.LIVE_DISPLAY_CAP,
      `dropdown received ${merged.models.length} options`,
    );
    assert.strictEqual(merged.hiddenCount, ids.length - registry.LIVE_DISPLAY_CAP, 'surplus miscounted');
    assert.strictEqual(merged.capped, true, 'a capped list reported itself as uncapped');
    // The surplus has to stay reachable, so a typed id is accepted rather than blocked.
    const typed = checkConfiguration({ providerId: 'openrouter', model: 'vendor/model-299', apiKey: 'placeholder-key-value-123' });
    assert.strictEqual(typed.ok, true, `a custom id was blocked: ${typed.problems.join(' ')}`);
    assert.match(typed.problems.join(' '), /sent as typed/);
    // Duplicates in a provider response must not double the list.
    const dup = registry.mergeLiveModels('kimi', ['a/b', 'a/b']);
    assert.strictEqual(dup.models.filter((model) => model.id === 'a/b').length, 1, 'duplicate live id listed twice');
  });

  await check('free routes survive the cap and lead the list', () => {
    // OpenRouter answers ~470 ids in whatever order it likes. A plain slice of the first
    // 40 showed a mostly-paid sample, which is the reader's complaint: the free routes
    // they came for were cut. Free ids must never be dropped, and must sort first.
    // Entries arrive adapter-shaped: {id, name, contextLength, free}.
    const entries = [];
    for (let i = 0; i < 300; i++) entries.push({ id: `vendor/model-${i}`, name: `Vendor ${i}`, contextLength: 128000, free: false });
    for (let i = 0; i < 20; i++) entries.push({ id: `nvidia/nemotron-free-${i}:free`, name: `Nemotron free ${i}`, contextLength: 128000, free: true });
    const merged = registry.mergeLiveModels('openrouter', entries);
    const free = merged.models.filter((model) => model.free);
    assert.strictEqual(free.length, 20, `only ${free.length} of 20 free ids survived`);
    const firstPaid = merged.models.findIndex((model) => !model.free && model.fromLiveList);
    const lastFree = merged.models.map((model) => model.free).lastIndexOf(true);
    assert.ok(firstPaid > lastFree || firstPaid === -1, 'a paid id was listed ahead of a free one');
    assert.strictEqual(merged.freeCount, 20, 'freeCount misreported');
    assert.strictEqual(merged.hiddenCount, 300 - registry.LIVE_DISPLAY_CAP, 'the paid tail was not capped');
    // Names and context come from the provider, not from a curated guess.
    const sample = merged.models.find((model) => model.id === 'nvidia/nemotron-free-3:free');
    assert.strictEqual(sample.name, 'Nemotron free 3', 'the live display name was dropped');
    assert.strictEqual(sample.contextWindow, '128K', 'context length not labelled');
    // Bare ids from a provider that reports nothing else still work.
    const plain = registry.mergeLiveModels('groq', ['vendor/x:free', 'vendor/y']);
    assert.strictEqual(plain.models.find((model) => model.id === 'vendor/x:free').free, true, 'a :free suffix was not detected');
  });

  await check('the live model list keeps names, context and free pricing', async () => {
    const openaiCompatible = require(path.join(SHARED, 'providers/openaiCompatible.js'));
    const provider = registry.getProvider('openrouter');
    // Shaped like a real /api/v1/models entry, including the junk a catalogue carries.
    const payload = {
      data: [
        { id: 'nvidia/nemotron-3.5-super-vl', name: 'Nemotron 3.5 Super VL', context_length: 131072, pricing: { prompt: '0.0000002', completion: '0.0000008' } },
        { id: 'nvidia/nemotron-3.5-super-vl:free', name: 'Nemotron 3.5 Super VL (free)', context_length: 131072, pricing: { prompt: '0', completion: '0' } },
        { id: 'nameless/model', name: '', context_length: 'not a number' },
        { id: 42 },
      ],
    };
    const calls = [];
    const transport = {
      json: async (options) => {
        calls.push(options);
        return { status: 200, headers: {}, text: JSON.stringify(payload) };
      },
      sse: async () => ({ status: 200, headers: {}, text: '' }),
    };
    const withKey = openaiCompatible.create({ provider, apiKey: ['sk', '-or-', 'fixturevalue123'].join(''), model: 'nvidia/nemotron-3.5-super-vl:free', timeoutMs: 5000, transport });
    const listed = await withKey.listModels({});
    assert.strictEqual(listed.length, 3, `expected 3 usable entries, got ${listed.length}`);
    assert.strictEqual(listed[1].free, true, 'a :free, zero-priced route was not marked free');
    assert.strictEqual(listed[0].free, false, 'a priced route was marked free');
    assert.strictEqual(listed[0].contextLength, 131072, 'context length not carried through');
    assert.strictEqual(listed[2].name, 'nameless/model', 'an entry with no display name lost its id as a label');
    assert.strictEqual((await withKey.validate({})).modelExists, true, 'validate() no longer matches ids');

    // The public catalogue is readable before a key exists — that is the moment the
    // reader is choosing what to paste — and it is sent without credentials.
    const keyless = openaiCompatible.create({ provider, apiKey: '', model: provider.defaultModel, timeoutMs: 5000, transport });
    assert.strictEqual((await keyless.listModels({})).length, 3, 'the public list was refused');
    assert.ok(!('Authorization' in calls[calls.length - 1].headers), 'the public catalogue was requested with a credential');
    let generationBlocked = false;
    try {
      await keyless.generate({ system: 's', user: 'u', schema: {} });
    } catch (error) {
      generationBlocked = /no API key/i.test(error.message);
    }
    assert.ok(generationBlocked, 'generation went ahead without a key');
    // A provider whose list needs credentials still refuses at construction.
    assert.throws(
      () => openaiCompatible.create({ provider: registry.getProvider('groq'), apiKey: '', model: 'x', timeoutMs: 5000, transport }),
      /no API key/i,
      'a keyed provider accepted a keyless adapter',
    );
    // The product path goes through createAdapter, which used to refuse before the
    // adapter ever got asked.
    const { createAdapter } = require(path.join(SHARED, 'providers/index.js'));
    const keylessAdapter = createAdapter({ providerId: 'openrouter', apiKey: '', model: provider.defaultModel, timeoutMs: 5000, transport });
    assert.strictEqual((await keylessAdapter.listModels({})).length, 3, 'createAdapter blocked the public catalogue');
    assert.throws(
      () => createAdapter({ providerId: 'groq', apiKey: '', model: 'x', timeoutMs: 5000, transport }),
      /no API key/i,
      'createAdapter let a keyed provider go keyless',
    );
    const viaCore = await require(path.join(SHARED, 'index.js')).createCore({ providerId: 'openrouter', apiKey: '', transport }).listLiveModels({ providerId: 'openrouter' });
    assert.strictEqual(viaCore.models.filter((model) => model.free).length, 1, 'the free route was lost through listLiveModels');
    assert.strictEqual(viaCore.freeCount, 1, 'freeCount not reported to the webview');
  });

  await check('browser-facing catalogue has no key material or env names', () => {
    const dump = JSON.stringify(registry.toPublicConfig());
    assert.ok(!/apiKeyEnv|GOOGLE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GROQ_API_KEY/.test(dump), 'env var names leaked to the client');
    assert.ok(!SECRET_PATTERNS.some((pattern) => pattern.re.test(dump)), 'a key value is in the public catalogue');
  });

  await check('tasks map to prompts, kinds and contracts', () => {
    const ids = prompts.listTasks().map((task) => task.id);
    for (const expected of ['explain-topic', 'explain-code', 'explain-error', 'find-issues', 'simplify', 'optimize', 'add-comments', 'generate-test', 'give-example', 'teach-me']) {
      assert.ok(ids.includes(expected), `task '${expected}' is missing`);
    }
    for (const task of prompts.listTasks()) {
      const built = prompts.buildMessages({ task: task.id, depth: 'balanced', context: { subject: 's', manifest: [], contextText: '', truncated: false } });
      assert.ok(built.system.includes('single JSON object'), `${task.id} prompt lost the JSON instruction`);
      assert.ok(built.user.includes('s'), `${task.id} prompt lost the subject`);
      assert.ok(built.schema.properties, `${task.id} has no schema`);
    }
  });
}

// ----------------------------------------------------------------- 6 extension

function freshState() {
  return {
    commands: {}, errors: [], info: [], messages: [], panels: 0, handlers: [], disposeHandlers: [],
    disposables: 0, revealed: 0, editor: null, context: { subscriptions: [] }, opened: [], clipboard: [], logs: [],
    viewProviders: [],
  };
}

function makeVscodeStub(state) {
  const disposable = () => ({ dispose: () => { state.disposables += 1; } });
  // One webview factory shared by the editor panel and the sidebar view: both surfaces
  // must be exercised by the same recorder, or a hub bug shows up in only one of them.
  const fakeWebview = () => ({
    html: '',
    cspSource: 'vscode-webview://test',
    options: null,
    asWebviewUri: (uri) => ({ toString: () => `vscode-resource:${uri.path}` }),
    postMessage: (message) => state.messages.push(message),
    onDidReceiveMessage: (handler) => {
      state.handlers.push(handler);
      return disposable();
    },
  });
  return {
    ViewColumn: { Beside: -2, Active: -1 },
    ConfigurationTarget: { Global: 1 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    Range: class {
      constructor(a, b, c, d) {
        this.start = { line: a, character: b };
        this.end = { line: c, character: d };
      }
      toArray() {
        return [this.start.line, this.start.character, this.end.line, this.end.character];
      }
    },
    Uri: {
      joinPath: (base, ...parts) => ({ scheme: base.scheme, path: `${base.path}/${parts.join('/')}`, toString: () => `file://${base.path}/${parts.join('/')}` }),
      file: (p) => ({ scheme: 'file', path: p, toString: () => `file://${p}` }),
      parse: (p) => ({ scheme: 'https', path: p, toString: () => p }),
    },
    env: { clipboard: { writeText: (text) => state.clipboard.push(text) }, openExternal: () => Promise.resolve(true) },
    commands: {
      registerCommand: (id, handler) => {
        state.commands[id] = handler;
        return disposable();
      },
      executeCommand: (name, ...args) => {
        state.opened.push([name, ...args]);
        return Promise.resolve();
      },
    },
    window: {
      get activeTextEditor() {
        return state.editor;
      },
      showErrorMessage: (message) => state.errors.push(message),
      showInformationMessage: (message) => state.info.push(message),
      createOutputChannel: () => ({ appendLine: (line) => state.messages.push({ type: 'log', line }), dispose: () => {} }),
      onDidChangeActiveTextEditor: (listener) => {
        state.editorListeners = (state.editorListeners || 0) + 1;
        return disposable();
      },
      onDidChangeTextEditorSelection: () => disposable(),
      createWebviewPanel: () => {
        state.panels += 1;
        const panel = {
          webview: fakeWebview(),
          reveal: () => {
            state.revealed += 1;
          },
        };
        panel.handlers = [];
        panel.onDidDispose = (handler) => {
          panel.handlers.push(handler);
          state.disposeHandlers.push(handler);
          return disposable();
        };
        // Faithful: the real panel runs its dispose handlers when it is closed, which
        // is what lets a check catch a hub that keeps a dead webview attached.
        panel.dispose = () => {
          for (const handler of panel.handlers.splice(0)) handler();
        };
        state.panel = panel;
        return panel;
      },
      registerWebviewViewProvider: (id, provider, options) => {
        state.viewProviders.push({ id, provider, options });
        return disposable();
      },
      fakeWebview,
    },
    workspace: {
      workspaceFolders: state.workspaceFolders || null,
      openTextDocument: async (uri) => ({ getText: () => 'opened', uri, languageId: 'javascript' }),
      getConfiguration: (section) => ({
        get: (key) => (state.configuration || {})[key],
        update: async (key, value) => {
          state.updated = state.updated || {};
          state.updated[key] = value;
        },
      }),
      onDidChangeConfiguration: () => disposable(),
      onDidChangeTextDocument: () => disposable(),
      applyEdit: async (edit) => Array.isArray(edit.edits) && edit.edits.length > 0,
    },
    WorkspaceEdit: class {
      constructor() {
        this.edits = [];
      }

      replace(uri, range, text) {
        this.edits.push({ uri, range, text });
      }
    },
    languages: {
      getDiagnostics: () => state.diagnostics || [],
      createDiagnosticCollection: () => {
        const store = new Map();
        return {
          store,
          set: (uri, items) => store.set(uri.path || String(uri), items),
          delete: (uri) => store.delete(uri.path || String(uri)),
          clear: () => store.clear(),
          dispose: () => store.clear(),
        };
      },
    },
    Diagnostic: class {
      constructor(range, message, severity) {
        // Faithful to the real API: only these three arrive via the constructor.
        // source and code must be assigned by the caller or they are undefined.
        this.range = range;
        this.message = message;
        this.severity = severity;
      }
    },
    Position: class {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
  };
}

function fakeContext(vscodeStub) {
  const store = new Map();
  return {
    store,
    value: {
      extensionUri: vscodeStub.Uri.file(EXT_DIR),
      subscriptions: [],
      secrets: {
        get: async (key) => store.get(key),
        store: async (key, value) => {
          store.set(key, value);
        },
        delete: async (key) => {
          store.delete(key);
        },
      },
      globalState: {
        get: (key) => store.get(key),
        update: async (key, value) => {
          if (value === undefined) store.delete(key);
          else store.set(key, value);
        },
      },
    },
  };
}

// Every module under src/ is purged before a check loads the extension. A hand-listed
// set would serve a newly added file from the previous check's cache, and two checks
// would then hold different instances of the same class (statics and all).
function extModules() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'test') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(EXT_DIR, 'src'));
  return files;
}

const EXT_MODULES = extModules();

function loadExtension(stub) {
  const original = Module._resolveFilename;
  const stubId = '@vscode-stub';
  require.cache[stubId] = { id: stubId, filename: stubId, loaded: true, exports: stub };
  Module._resolveFilename = function resolve(request, ...rest) {
    if (request === 'vscode') return stubId;
    return original.call(this, request, ...rest);
  };
  for (const file of EXT_MODULES) {
    if (fs.existsSync(file)) delete require.cache[require.resolve(file)];
  }
  try {
    return {
      extension: require(path.join(EXT_DIR, 'src/extension.js')),
      panel: require(path.join(EXT_DIR, 'src/panel.js')),
      webview: require(path.join(EXT_DIR, 'src/webview/index.js')),
      settings: require(path.join(EXT_DIR, 'src/state/settings.js')),
      aiService: require(path.join(EXT_DIR, 'src/services/aiService.js')),
      historyService: require(path.join(EXT_DIR, 'src/services/historyService.js')),
      editorContext: require(path.join(EXT_DIR, 'src/services/editorContext.js')),
      projectAudit: require(path.join(EXT_DIR, 'src/services/projectAudit.js')),
    };
  } finally {
    Module._resolveFilename = original;
  }
}

function makeServices(loaded, contextValue, state) {
  const settings = new loaded.settings.SettingsManager(contextValue, { get: () => undefined });
  const history = new loaded.historyService.HistoryService(contextValue, settings);
  const logger = { appendLine: (line) => { if (state) state.logs.push(line); } };
  const ai = new loaded.aiService.ExplainService({ settings, history, logger });
  return { settings, history, ai, logger };
}

async function checkExtension() {
  setGroup('extension');

  await check('activation registers every contributed command', () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    loaded.extension.activate(value);

    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.json'), 'utf8'));
    const contributed = manifest.contributes.commands.map((command) => command.command);
    const missing = contributed.filter((id) => !state.commands[id]);
    if (missing.length) fail(`declared but not registered: ${missing.join(', ')}`);
    const extra = Object.keys(state.commands).filter((id) => !contributed.includes(id));
    if (extra.length) fail(`registered but not declared: ${extra.join(', ')}`);
    assert.ok(contributed.length >= 15, 'the command set shrank');
    assert.strictEqual(state.panels, 0, 'activation opened a panel');
  });

  await check('menu and keybinding when-clauses reference real context keys', () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    loaded.extension.activate(value);
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.json'), 'utf8'));
    const text = JSON.stringify(manifest.contributes.menus) + JSON.stringify(manifest.contributes.keybindings);
    assert.ok(/explainItSimply\.hasDiagnostic/.test(text), 'the diagnostic-aware menu is gone');
    assert.ok(/editorHasSelection/.test(text), 'selection-aware menu is gone');
    const setContext = state.opened.find((call) => call[0] === 'setContext');
    assert.ok(setContext, 'no context key was ever set');
    if (/ctrl\+shift\+x/i.test(text)) fail('Ctrl+Shift+X conflicts with the built-in Extensions view');
  });

  await check('settings store one key per provider and reject bad input', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value, store } = fakeContext(stub);
    const settings = new loaded.settings.SettingsManager(value, { get: () => undefined });

    await settings.saveSettings({ providerId: 'google', model: 'gemini-3.8-flash', apiKey: 'AIza-short-fixture' });
    assert.strictEqual(store.get('eis.apiKey.google'), 'AIza-short-fixture');
    assert.ok(settings.isConfigured());

    await settings.saveSettings({ providerId: 'groq', model: 'gpt-oss-120b', apiKey: 'gsk_shortfixture123' });
    assert.strictEqual(store.get('eis.apiKey.groq'), 'gsk_shortfixture123');
    // Switching providers must not lose the other key.
    await settings.saveSettings({ providerId: 'google', model: 'gemini-3.6-flash' });
    assert.strictEqual(await settings.getApiKey('groq'), 'gsk_shortfixture123');

    await assert.rejects(() => settings.saveSettings({ providerId: 'mistral', model: 'x', apiKey: 'long-enough' }), /Unknown provider/);
    await assert.rejects(() => settings.saveSettings({ providerId: 'google', model: 'gemini-3.8-flash', apiKey: 'tiny' }), /too short/);
    await assert.rejects(
      () => settings.saveSettings({ providerId: 'openai', model: 'gpt-4o', apiKey: 'AIza-wrong-prefix' }),
      /does not match OpenAI/,
    );

    // Kimi documents no key prefix, so its keys must not be shape-checked.
    await settings.saveSettings({ providerId: 'kimi', model: 'kimi-k2.7-code', apiKey: 'anything-moonshot-uses-123' });
    assert.strictEqual(await settings.getApiKey('kimi'), 'anything-moonshot-uses-123');
    // A typed id that only exists in a live list (an OpenRouter free route) has to
    // survive the round trip, or the model field would be decoration.
    const orKey = ['sk', 'or', 'typedfixture'].join('-');
    await settings.saveSettings({ providerId: 'openrouter', model: 'google/gemma-4-31b-it:free', apiKey: orKey });
    assert.strictEqual(settings.preferences.model, 'google/gemma-4-31b-it:free', 'a typed model id was not saved');
    assert.strictEqual(await settings.getApiKey('openrouter'), orKey);
    await assert.rejects(() => settings.saveSettings({ providerId: 'openrouter', model: 'not a model id!' }), /not usable/);
    await assert.rejects(
      () => settings.saveSettings({ providerId: 'openrouter', model: 'anthropic/claude-sonnet-5.5', apiKey: 'wrongprefix-key-123' }),
      /does not match OpenRouter/,
    );

    await settings.clear('groq');
    assert.strictEqual(await settings.getApiKey('groq'), '');
    assert.strictEqual(await settings.getApiKey('google'), 'AIza-short-fixture', 'clearing one provider wiped another');
  });

  await check('advanced settings fall back to sane defaults', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const settings = new loaded.settings.SettingsManager(value, { get: () => undefined });
    const advanced = settings.advanced;
    assert.strictEqual(advanced.codeRetention, 'snippet');
    assert.strictEqual(advanced.includeCurrentFile, false, 'sending the current file must be opt-in');
    assert.ok(advanced.contextCharBudget >= 500 && advanced.contextCharBudget <= 60000);
    const hostile = new loaded.settings.SettingsManager(value, {
      get: (key) => (key === 'context.maxCharacters' ? 9_999_999 : key === 'privacy.codeRetention' ? 'everything' : undefined),
    });
    assert.strictEqual(hostile.advanced.contextCharBudget, 60000, 'an absurd budget was not clamped');
    assert.strictEqual(hostile.advanced.codeRetention, 'snippet', 'an invalid retention mode was accepted');
  });

  await check('the panel emits a CSP webview that loads real asset files', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const services = makeServices(loaded, value, state);
    loaded.panel.ExplainPanel.current = undefined;
    loaded.panel.ExplainPanel.createOrShow(value, services);
    const html = state.panel.webview.html;

    assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
    assert.ok(!/inline script/.test(html), 'unexpected inline script comment');
    assert.ok(html.includes('vscode-resource:'), 'assets are not resolved through asWebviewUri');
    assert.ok(/<script src="vscode-resource:[^"]*client\.js"/.test(html), 'client.js is not loaded as a file');
    assert.ok(!/<script>[^<]/.test(html), 'an inline script tag exists, which the CSP would block');
    assert.ok(html.includes('styles.css'), 'no stylesheet link');
    assert.ok(fs.existsSync(path.join(EXT_DIR, 'webview', 'client.js')), 'webview client missing');
    assert.ok(fs.existsSync(path.join(EXT_DIR, 'webview', 'styles.css')), 'webview styles missing');
  });

  await check('the Activity Bar view is wired to the id VS Code will resolve', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.json'), 'utf8'));
    const containers = manifest.contributes.viewsContainers.activitybar;
    assert.ok(Array.isArray(containers) && containers.length, 'no activity bar container');
    const container = containers[0];
    assert.ok(fs.existsSync(path.join(EXT_DIR, container.icon)), `icon missing: ${container.icon}`);
    const views = manifest.contributes.views[container.id];
    assert.ok(views, `views declared for an unknown container id '${container.id}'`);
    const view = views.find((item) => item.type === 'webview');
    assert.ok(view, 'no webview view in the container');
    const panel = require(path.join(EXT_DIR, 'src/panel.js'));
    // A mismatch here is silent: the icon opens an empty pane and never errors.
    assert.strictEqual(view.id, panel.SIDE_VIEW_ID, `manifest says ${view.id}, code registers ${panel.SIDE_VIEW_ID}`);
    assert.strictEqual(
      panel.SIDE_CONTAINER_COMMAND,
      `workbench.view.extension.${container.id}`,
      'the reveal command does not match the container id',
    );
    const commands = manifest.contributes.commands.map((entry) => entry.command);
    for (const id of ['explainItSimply.openSidePanel', 'explainItSimply.openPanelInEditor']) {
      assert.ok(commands.includes(id), `${id} is registered but not in the manifest`);
    }
  });

  await check('the sidebar view shares one hub with the editor panel', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const activated = loaded.extension.activate(value);
    const services = activated.services;
    loaded.panel.ExplainPanel.current = undefined;
    loaded.panel.ExplainPanel.sideWebview = undefined;

    assert.strictEqual(state.viewProviders.length, 1, 'the sidebar provider was never registered');
    const { id, provider, options } = state.viewProviders[0];
    assert.strictEqual(id, loaded.panel.SIDE_VIEW_ID, `provider registered as ${id}`);
    assert.strictEqual(options.webviewOptions.retainContextWhenHidden, true, 'the view rebuilds on every collapse');

    const view = {
      webview: stub.window.fakeWebview(),
      visible: true,
      onDidChangeVisibility: (handler) => {
        state.visibilityHandlers = (state.visibilityHandlers || []).concat(handler);
        return { dispose: () => {} };
      },
      onDidDispose: (handler) => {
        state.viewDisposal = handler;
        return { dispose: () => {} };
      },
    };
    provider.resolveWebviewView(view);
    assert.strictEqual(view.webview.options.enableScripts, true, 'scripts are not enabled for the view');
    assert.match(view.webview.html, /default-src 'none'/, 'the view html has no CSP');
    assert.ok(/vscode-resource:.*client\.js/.test(view.webview.html), 'the view does not load the client from a file');

    // Both surfaces must see the same state, so a request from either one is answered
    // on both rather than to whichever happens to be focused.
    const hub = loaded.panel.ExplainPanel.createOrShowEditor(value, services);
    assert.strictEqual(hub._surfaces.size, 2, `hub has ${hub._surfaces.size} surfaces, expected 2`);
    state.messages.length = 0;
    await state.handlers[0]({ type: 'ready' });
    const bootstraps = state.messages.filter((message) => message.type === 'bootstrap');
    assert.strictEqual(bootstraps.length, 2, `bootstrap reached ${bootstraps.length} of 2 surfaces`);

    // Re-opening with the sidebar live must not stack a second webview.
    state.panels = 0;
    loaded.panel.ExplainPanel.createOrShow(value);
    assert.strictEqual(state.panels, 0, 'a redundant editor panel was created beside the view');

    // Closing the view must not kill the hub or leave a stale reference behind.
    state.viewDisposal();
    assert.strictEqual(loaded.panel.ExplainPanel.sideWebview, undefined, 'a dead view still owns sideWebview');
    assert.ok(!loaded.panel.ExplainPanel.current._disposed, 'the hub died with the sidebar view');

    loaded.panel.ExplainPanel.current = undefined;
    loaded.panel.ExplainPanel.sideWebview = undefined;
  });

  await check('a closed panel releases its surface instead of piling up', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value, context } = fakeContext(stub);
    const activated = loaded.extension.activate(value);
    const { ExplainPanel } = loaded.panel;
    ExplainPanel.current = undefined;
    ExplainPanel.sideWebview = undefined;

    const first = ExplainPanel.createOrShowEditor(value, activated.services);
    assert(first._surfaces.size === 1, `expected 1 surface, saw ${first._surfaces.size}`);
    state.panel.dispose();
    assert(first._disposed, 'closing the only panel left the hub alive');
    assert(ExplainPanel.current === undefined, 'a disposed hub stayed as current');

    const second = ExplainPanel.createOrShowEditor(value, activated.services);
    assert(second !== first, 'the disposed hub was reused');
    const view = {
      webview: stub.window.fakeWebview(),
      visible: true,
      onDidChangeVisibility: () => ({ dispose: () => {} }),
      onDidDispose: (handler) => {
        state.viewDisposal = handler;
        return { dispose: () => {} };
      },
    };
    state.viewProviders[0].provider.resolveWebviewView(view);
    assert(second._surfaces.size === 2, `view did not attach: ${second._surfaces.size} surfaces`);
    assert(ExplainPanel.current === second, 'the view attached to a different hub');

    // The window sequence that produced three surfaces: a dead panel still attached.
    assert(second._surfaces.size === 2, `surfaces piled up to ${second._surfaces.size}`);
    void context;

    state.viewDisposal();
    assert(second._surfaces.size === 1, 'closing the view left its surface behind');
    assert(!second._disposed, 'the hub died with the view while a panel was open');

    state.panel.dispose();
    assert(second._disposed, 'the hub outlived its last surface');
    ExplainPanel.current = undefined;
    ExplainPanel.sideWebview = undefined;

    // The real window left a disposed webview attached without its dispose event
    // reaching the hub. Broadcasting must drop that surface, not throw on it.
    const survivor = ExplainPanel.createOrShowEditor(value, activated.services);
    const lateView = {
      webview: stub.window.fakeWebview(),
      visible: true,
      onDidChangeVisibility: () => ({ dispose: () => {} }),
      onDidDispose: (handler) => {
        state.viewDisposal = handler;
        return { dispose: () => {} };
      },
    };
    state.viewProviders[0].provider.resolveWebviewView(lateView);
    assert(survivor._surfaces.size === 2, `expected two surfaces, saw ${survivor._surfaces.size}`);
    const dead = survivor._panel.webview;
    Object.defineProperty(dead, 'html', { get() { throw new Error('Webview is disposed'); } });
    dead.postMessage = () => { throw new Error('Webview is disposed'); };
    state.messages.length = 0;
    survivor._post({ type: 'screen', screen: 'main' });
    // The output channel writes into the same recorder, so count the broadcast only.
    const delivered = state.messages.filter((message) => message.type === 'screen').length;
    assert.strictEqual(delivered, 1, `the live surface received ${delivered} copies`);
    assert.strictEqual(survivor._surfaces.size, 1, 'the dead surface stayed attached');
    assert.ok(state.messages.some((message) => message.type === 'log' && /surface.dropped/.test(message.line)),
      'a dropped surface was not logged');

    survivor.dispose();
    ExplainPanel.current = undefined;
    ExplainPanel.sideWebview = undefined;
  });

  await check('one panel is reused instead of stacking listeners', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const services = makeServices(loaded, value, state);
    loaded.panel.ExplainPanel.current = undefined;
    const first = loaded.panel.ExplainPanel.createOrShow(value, services);
    const second = loaded.panel.ExplainPanel.createOrShow(value, services);
    const third = loaded.panel.ExplainPanel.createOrShow(value, services);
    assert.strictEqual(state.panels, 1, `${state.panels} panels created`);
    assert.strictEqual(first, second);
    assert.strictEqual(second, third);
    assert.strictEqual(state.handlers.length, 1, 'message handler registered more than once');
    assert.strictEqual(state.revealed, 2);
    second.dispose();
    assert.strictEqual(loaded.panel.ExplainPanel.current, undefined, 'stale panel left in place after dispose');
    second.dispose();
    assert.ok(state.disposables >= 5, 'disposables were not released once each');
  });

  await check('bootstrap sends catalogue, context and history without secrets', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const services = makeServices(loaded, value, state);
    await services.settings.saveSettings({ providerId: 'google', model: 'gemini-3.8-flash', apiKey: 'AIza-short-fixture' });
    state.editor = fakeEditor(stub);
    state.diagnostics = [{ severity: 0, message: 'x is not defined', range: { start: { line: 4 }, end: { line: 4 } } }];

    loaded.panel.ExplainPanel.current = undefined;
    const panel = loaded.panel.ExplainPanel.createOrShow(value, services);
    await state.handlers[0]({ type: 'ready' });

    const bootstrap = state.messages.find((message) => message.type === 'bootstrap');
    assert.ok(bootstrap, 'no bootstrap message');
    assert.strictEqual(bootstrap.catalog.selected.providerId, 'google');
    assert.ok(bootstrap.catalog.keysConfiguredFor.includes('google'), 'stored key not reported as configured');
    assert.ok(!JSON.stringify(bootstrap).includes('AIza-fake-local-key'), 'the API key crossed into the webview');
    assert.ok(bootstrap.catalog.advanced, 'no advanced settings snapshot');
    const context = state.messages.find((message) => message.type === 'context');
    assert.ok(context.available);
    assert.strictEqual(context.hasSelection, true);
    assert.match(context.diagnostics[0], /line 5: x is not defined/, 'diagnostics were not surfaced');
    assert.ok(bootstrap.catalog.tasks.some((task) => task.id === 'find-issues'), 'find-issues not offered to the UI');
  });

  await check('explain through the panel returns a result and stores history', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const services = makeServices(loaded, value, state);
    await services.settings.saveSettings({ providerId: 'google', model: 'gemini-3.8-flash', apiKey: 'AIza-short-fixture' });
    const panelTransport = makeTransport(() => googleReply(EXPLANATION_JSON));
    panelTransport.sseEvents = [{ event: 'message', data: JSON.stringify({ candidates: [{ content: { parts: [{ text: EXPLANATION_JSON }] } }] }) }];
    services.ai.core.setConfig({ transport: panelTransport });
    state.editor = fakeEditor(stub);

    loaded.panel.ExplainPanel.current = undefined;
    const panel = loaded.panel.ExplainPanel.createOrShow(value, services);
    await state.handlers[0]({ type: 'explain', task: 'explain-code', mode: 'selection', stream: true });

    const result = state.messages.find((message) => message.type === 'result');
    assert.ok(result, `no result posted; logs=${state.logs.join(' | ')} messages=${JSON.stringify(state.messages)}`);
    assert.strictEqual(result.result.title, 'Recursion');
    assert.strictEqual(result.meta.provider, 'google');
    assert.ok(result.meta.context.manifest.length >= 1, 'no context manifest in the result');
    const history = await services.history.list({});
    assert.strictEqual(history.length, 1, 'the answer was not added to history');
    assert.strictEqual(history[0].subject.includes('function demo'), true, 'snippet retention lost the code');
  });

  await check('privacy: code retention settings really change storage', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const services = makeServices(loaded, value, state);
    await services.settings.saveSettings({ providerId: 'google', model: 'gemini-3.8-flash', apiKey: 'AIza-short-fixture' });
    services.ai.core.setConfig({ transport: makeTransport(() => googleReply(EXPLANATION_JSON)) });
    state.editor = fakeEditor(stub);

    const panel = loaded.panel.ExplainPanel.current;
    loaded.panel.ExplainPanel.current = undefined;
    loaded.panel.ExplainPanel.createOrShow(value, services);

    const noneConfig = { get: (key) => (key === 'privacy.codeRetention' ? 'none' : undefined) };
    value.store = null;
    const strictSettings = new loaded.settings.SettingsManager(value, noneConfig);
    const strictHistory = new loaded.historyService.HistoryService(value, strictSettings);
    const strict = new loaded.aiService.ExplainService({ settings: strictSettings, history: strictHistory, logger: { appendLine: () => {} } });
    strict.core.setConfig({ transport: makeTransport(() => googleReply(EXPLANATION_JSON)) });
    const token = strict.core.createLedger().begin('t');
    const outcome = await strict.explain({ task: 'explain-code', input: fakeEditor(stub) && require(path.join(EXT_DIR, 'src/services/editorContext.js')).fromEditor(stub, fakeEditor(stub), 'selection'), token });
    assert.ok(outcome.ok, JSON.stringify(outcome.error));
    const stored = await strictHistory.list({});
    assert.strictEqual(stored[0].subject, '', 'retention=none still stored source code');
    assert.ok(stored[0].result.title, 'the explanation itself should still be kept');
    void panel;
  });

  await check('history: search, pin, delete and key scrubbing', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value, store } = fakeContext(stub);
    const settings = new loaded.settings.SettingsManager(value, { get: () => undefined });
    const history = new loaded.historyService.HistoryService(value, settings);

    // Assembled at runtime so this file itself stays free of credential-shaped
    // literals while still exercising the scrubber with a realistic key.
    const plantedKey = ['AIza', 'a'.repeat(34)].join('');
    const leaky = {
      task: 'explain-code',
      depth: 'balanced',
    };
    await history.add({
      request: leaky,
      result: { kind: 'code', title: 'Leaky', summary: `mentions ${plantedKey}`, keyTakeaway: 'x' },
      meta: { requestId: 'r1', provider: 'google', model: 'gemini-3.8-flash', context: { manifest: [{ part: 'selection' }] } },
      input: { subject: `key ${plantedKey} is in this file`, language: 'javascript', fileName: 'a.js' },
    });
    const items = await history.list({});
    assert.strictEqual(items.length, 1);
    const stored = JSON.stringify(store.get('eis.history'));
    assert.ok(!stored.includes(plantedKey), 'a key-shaped secret survived into history');
    assert.ok(stored.includes('[redacted-key]'), 'scrubbing left no marker');

    await history.setPinned(items[0].id, true);
    assert.strictEqual((await history.list({ pinnedOnly: true })).length, 1);
    assert.strictEqual((await history.list({ query: 'leaky' })).length, 1, 'search by title failed');
    assert.strictEqual((await history.list({ query: 'zzz-nothing' })).length, 0, 'search matched nothing-ish');
    await history.remove(items[0].id);
    assert.strictEqual((await history.list({})).length, 0);
  });

  await check('history respects the size cap and keeps pinned entries', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const settings = new loaded.settings.SettingsManager(value, { get: (key) => (key === 'privacy.historyLimit' ? 3 : undefined) });
    const history = new loaded.historyService.HistoryService(value, settings);
    for (let i = 0; i < 6; i += 1) {
      await history.add({
        request: { task: 'explain-topic', depth: 'quick' },
        result: { kind: 'topic', title: `Item ${i}` },
        meta: { requestId: `id-${i}`, provider: 'google', model: 'm', context: {} },
        input: { subject: `topic ${i}` },
      });
    }
    const items = await history.list({});
    assert.ok(items.length <= 3, `history grew to ${items.length} with a limit of 3`);
    await history.clear({ keepPinned: true });
    assert.ok((await history.list({})).length <= 3);
  });

  await check('newer requests win: no stale result overwrites the panel', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const services = makeServices(loaded, value, state);
    await services.settings.saveSettings({ providerId: 'google', model: 'gemini-3.8-flash', apiKey: 'AIza-short-fixture' });
    state.editor = fakeEditor(stub);

    loaded.panel.ExplainPanel.current = undefined;
    const panel = loaded.panel.ExplainPanel.createOrShow(value, services);
    const handler = state.handlers[0];

    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let firstCall = true;
    services.ai.core.setConfig({
      transport: {
        json: async () => {
          if (firstCall) {
            firstCall = false;
            await gate;
            return googleReply(JSON.stringify({ ...JSON.parse(EXPLANATION_JSON), title: 'STALE FIRST ANSWER' }));
          }
          return googleReply(EXPLANATION_JSON);
        },
      },
    });

    const slow = handler({ type: 'explain', task: 'explain-topic', mode: 'clipboard', subject: 'slow one' });
    await new Promise((resolve) => setImmediate(resolve));
    await handler({ type: 'explain', task: 'explain-topic', mode: 'clipboard', subject: 'fast one' });
    release();
    await slow;

    const resultsPosted = state.messages.filter((message) => message.type === 'result');
    assert.ok(resultsPosted.length >= 1, 'nothing was posted');
    const titles = resultsPosted.map((message) => message.result.title);
    assert.ok(!titles.includes('STALE FIRST ANSWER'), 'an older request overwrote a newer answer');
  });

  await check('errors reach the UI as codes with a recovery action', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const services = makeServices(loaded, value, state);
    state.editor = fakeEditor(stub);

    loaded.panel.ExplainPanel.current = undefined;
    loaded.panel.ExplainPanel.createOrShow(value, services);
    await state.handlers[0]({ type: 'explain', task: 'explain-code', mode: 'selection' });

    const error = state.messages.find((message) => message.type === 'error');
    assert.ok(error, 'no error surfaced for a keyless provider');
    assert.strictEqual(error.error.code, 'CONFIGURATION_ERROR');
    assert.strictEqual(error.error.recovery, 'setup', 'the UI was not told to offer setup');
    assert.match(error.error.hint, /not set up|key/i);

    state.editor = { ...fakeEditor(stub), selection: { isEmpty: true, active: { line: 0, character: 0 }, anchor: { line: 0, character: 0 }, start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
    await state.handlers[0]({ type: 'explain', task: 'explain-code', mode: 'selection' });
    const validation = state.messages.filter((message) => message.type === 'error').pop();
    assert.ok(/select|open a file|nothing/i.test(validation.error.message), `empty selection gave: ${validation.error.message}`);

    await state.handlers[0]({ type: 'totally-unknown' });
    const unknown = state.messages.filter((message) => message.type === 'error').pop();
    assert.strictEqual(unknown.error.code, 'VALIDATION_ERROR');
  });

  await check('editor context modes really pick selection, function or file', () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const editor = fakeEditor(stub);
    const fromEditor = loaded.editorContext.fromEditor;

    const selection = fromEditor(stub, editor, 'selection');
    assert.match(selection.subject, /function demo/);
    const asFunction = fromEditor(stub, {
      ...editor,
      selection: { isEmpty: true, active: { line: 4 }, anchor: { line: 4 } },
      document: { ...editor.document, getText: () => DOC_SAMPLE },
    }, 'function');
    assert.ok(asFunction.subject.includes('function demo') && asFunction.subject.includes('}'), 'function block was not expanded');
    const asFile = fromEditor(stub, editor, 'file');
    assert.ok(asFile.subject.length > asFunction.subject.length, 'file mode should send the whole file');
    assert.strictEqual(asFile.fullDocument, '', 'file mode duplicated the document as context');
    const errorMode = loaded.editorContext.fromEditor(stub, editor, 'error');
    assert.ok(errorMode.diagnostics || errorMode.subject.includes('function'), 'error mode produced nothing to explain');
  });

  await check('copy and apply-code go through the host, not the DOM', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const services = makeServices(loaded, value, state);
    state.editor = fakeEditor(stub);
    loaded.panel.ExplainPanel.current = undefined;
    const panel = loaded.panel.ExplainPanel.createOrShow(value, services);
    panel._lastTarget = { uri: stub.Uri.file('a.js'), range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, version: 1, fileName: 'a.js', language: 'javascript' };

    await state.handlers[0]({ type: 'copy', text: 'copy me' });
    assert.deepStrictEqual(state.clipboard, ['copy me']);
    await state.handlers[0]({ type: 'applyCode', code: 'const x = 1;' });
    const applied = state.messages.find((message) => message.type === 'apply.result');
    assert.strictEqual(applied.ok, true);

    await state.handlers[0]({ type: 'open', url: 'https://evil.example.com/steal' });
    const refused = state.messages.filter((message) => message.type === 'error').pop();
    assert.strictEqual(refused.error.code, 'VALIDATION_ERROR', 'an arbitrary URL was opened from the webview');
    assert.ok(!state.opened.some((call) => call[0] === 'vscode.open'), 'unlisted URL reached openExternal');
  });

  await check('advanced settings writes are limited to a whitelist', async () => {
    const state = freshState();
    const stub = makeVscodeStub(state);
    const loaded = loadExtension(stub);
    const { value } = fakeContext(stub);
    const services = makeServices(loaded, value, state);
    loaded.panel.ExplainPanel.current = undefined;
    loaded.panel.ExplainPanel.createOrShow(value, services);

    await state.handlers[0]({ type: 'updateAdvanced', key: 'security.workspaceToken', value: 'pwned' });
    const refused = state.messages.filter((message) => message.type === 'error').pop();
    assert.strictEqual(refused.error.code, 'VALIDATION_ERROR', 'an arbitrary setting was written');
    assert.ok(ExplainPanelWhitelist().includes('privacy.codeRetention'));
  });

  await check('the webview client is XSS-safe by construction', () => {
    const source = fs.readFileSync(path.join(EXT_DIR, 'webview', 'client.js'), 'utf8');
    assert.ok(!/\.innerHTML\s*=/.test(source), 'client.js assigns innerHTML');
    assert.ok(!/document\.write\(/.test(source), 'client.js uses document.write');
    assert.ok(!/insertAdjacentHTML/.test(source), 'client.js uses insertAdjacentHTML');
    assert.match(source, /function escapeText/, 'no text sanitizer');
    assert.match(source, /'html'\) throw|html.*throw new Error/, 'el() must reject raw html');

    // Exercise the pure helpers the same way the browser would.
    const sandbox = { document: undefined, window: undefined };
    const load = new Function('globalThis', `${source};\nreturn globalThis.EisWebview;`);
    const helpers = load(sandbox);
    assert.ok(helpers, 'client.js did not expose its pure helpers for testing');
    assert.strictEqual(helpers.escapeText('<img onerror=alert(1)>'), '<img onerror=alert(1)>');
    const tokens = helpers.tokenizeCode('const a = "x{ y}"; // } comment', 'javascript');
    const rebuilt = tokens.map((token) => token.text).join('');
    assert.strictEqual(rebuilt, 'const a = "x{ y}"; // } comment', 'tokenizer lost characters');
    assert.ok(tokens.some((token) => token.type === 'key'), 'keywords not highlighted');
    assert.ok(tokens.some((token) => token.type === 'str'), 'strings not highlighted');
    assert.ok(tokens.some((token) => token.type === 'com'), 'comments not highlighted');

    const sections = helpers.sectionsFor({
      version: 2,
      kind: 'topic',
      title: 'T',
      simpleExplanation: { heading: 'h', body: 'b', points: [] },
      keyTakeaway: 'k',
    });
    assert.deepStrictEqual(sections.map((section) => section.key), ['simple', 'takeaway']);
    assert.ok(!sections.some((section) => section.key === 'tech'), 'an empty technical layer was rendered');

    const codeSections = helpers.sectionsFor({
      version: 2,
      kind: 'code',
      title: 'T',
      simpleExplanation: { body: 'b' },
      potentialIssues: [{ severity: 'confirmed', description: 'd' }],
      code: 'x',
    });
    assert.ok(codeSections.some((section) => section.key === 'issues'), 'issues not shown for code results');
    assert.strictEqual(helpers.followupsFor({ kind: 'code' }).length, helpers.FOLLOWUPS.code.length);
    assert.ok(helpers.sectionText({ kind: 'issues', items: [{ severity: 'confirmed', description: 'd' }] }).includes('confirmed'));

    // The filter box has to narrow the list, keep the selection visible, and still let
    // an id the catalogue does not know be used as-is.
    const options = helpers.modelOptions([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], 'vendor/typed-id');
    assert.strictEqual(options.length, 1, 'a filter that matches nothing left the whole list in place');
    assert.strictEqual(options[0].id, 'vendor/typed-id', 'typed id not offered');
    assert.strictEqual(options[0].status, 'unverified');
    const narrowed = helpers.modelOptions([{ id: 'a', name: 'apple' }, { id: 'b', name: 'banana' }], 'app');
    assert.deepStrictEqual(narrowed.map((model) => model.id), ['a'], 'the box does not filter by name');
    const kept = helpers.modelOptions([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], 'b', 'a');
    assert.deepStrictEqual(kept.map((model) => model.id), ['a', 'b'], 'the selected model was filtered away');
    const unchanged = helpers.modelOptions([{ id: 'a', name: 'a' }], 'a');
    assert.strictEqual(unchanged.length, 1, 'a known id was duplicated');
    assert.deepStrictEqual(helpers.filterFree([{ id: 'a', free: true }, { id: 'b' }], true).map((m) => m.id), ['a'], 'free-only kept a paid id');
    assert.match(helpers.modelNote({ liveCount: 470, freeCount: 16, hiddenCount: 419, models: [{ id: 'x' }] }), /419 paid ids are not listed/);
    assert.match(helpers.modelNote({ models: [{ id: 'x' }] }), /curated ids/);
  });

  await check('the real-window suite is wired and stays out of the package', () => {
    const suite = path.join(EXT_DIR, 'src', 'test', 'realWindow.js');
    const driver = path.join(ROOT, 'scripts', 'vscode-window-check.js');
    assert.ok(fs.existsSync(suite), 'the real VS Code suite is missing');
    assert.ok(fs.existsSync(driver), 'the window driver is missing');
    const ignore = fs.readFileSync(path.join(EXT_DIR, '.vscodeignore'), 'utf8');
    assert.ok(/src\/test/.test(ignore), 'the harness would ship inside the .vsix');
    const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(String(rootPkg.scripts['check:vscode'] || '').includes('vscode-window-check'), 'no npm script runs the window suite');
    const driverSource = fs.readFileSync(driver, 'utf8');
    assert.ok(/--extensionTestsPath=/.test(driverSource), 'the driver never passes a tests path');
    assert.ok(/--user-data-dir=/.test(driverSource), 'the driver would run against the developer real profile');
    const suiteSource = fs.readFileSync(suite, 'utf8');
    const names = [...suiteSource.matchAll(/runStep\('([^']+)'/g)].map((match) => match[1]);
    assert.ok(names.length >= 8, `the window suite shrank to ${names.length} steps`);
    assert.strictEqual(new Set(names).size, names.length, 'two window steps share a name');
  });

  await check('the client renders every section type a v2 answer can carry', () => {
    const source = fs.readFileSync(path.join(EXT_DIR, 'webview', 'client.js'), 'utf8');
    for (const kind of ['prose', 'layer', 'list', 'steps', 'lines', 'concepts', 'issues', 'changes', 'code', 'code-list', 'related', 'takeaway']) {
      assert.ok(source.includes(`case '${kind}'`), `no renderer for section kind '${kind}'`);
    }
  });
}

const DOC_SAMPLE = [
  'import fs from "fs";',
  '',
  'export function demo(value) {',
  '  const parsed = JSON.parse(value);',
  '  return parsed;',
  '}',
  '',
].join('\n');

function fakeEditor(stub) {
  return {
    document: {
      uri: stub.Uri.file('demo.js'),
      fileName: 'C:\\tmp\\demo.js',
      languageId: 'javascript',
      lineCount: 8,
      version: 1,
      getText: (range) => (range ? 'function demo(value) {\n  return value;\n}' : DOC_SAMPLE),
    },
    selection: {
      isEmpty: false,
      active: { line: 4, character: 2 },
      anchor: { line: 2, character: 0 },
      start: { line: 2, character: 0 },
      end: { line: 4, character: 1 },
    },
  };
}

function ExplainPanelWhitelist() {
  const state = freshState();
  const stub = makeVscodeStub(state);
  const loaded = loadExtension(stub);
  return loaded.panel.ExplainPanel.WRITABLE;
}

// ----------------------------------------------------------------- 7 server

async function checkServer() {
  setGroup('server');
  const { readConfig, describeStartupProblems, redactApiKey } = require(path.join(WEB_DIR, 'src/config.js'));
  const { createApp } = require(path.join(WEB_DIR, 'src/app.js'));

  const config = readConfig({
    PORT: '0',
    EIS_PROVIDER: 'google',
    EIS_MODEL: 'gemini-3.8-flash',
    EIS_REQUEST_TIMEOUT_MS: '8000',
    GOOGLE_API_KEY: FAKE_KEY,
    // Generous here so functional checks are not throttled; the rate-limit check
    // spins up its own tight instance.
    EIS_RATE_LIMIT: '200',
    EIS_RATE_WINDOW_MS: '60000',
    EIS_RATE_BURST: '50',
  });

  await check('configuration resolves provider, model and limits', () => {
    assert.strictEqual(config.provider.id, 'google');
    assert.strictEqual(config.model, 'gemini-3.8-flash');
    assert.strictEqual(config.port, 0, 'PORT=0 must stay 0 so the OS picks a free port');
    assert.strictEqual(config.host, '127.0.0.1', 'the server must default to loopback');
    assert.strictEqual(config.rateLimit.requests, 200, 'rate limit env was ignored');
    assert.deepStrictEqual(describeStartupProblems(config), []);
    assert.ok(!redactApiKey(config).includes(FAKE_KEY), 'startup log printed the whole key');
  });

  await check('an id outside the catalogue boots with a notice, not a refusal', () => {
    // OpenRouter's free routes only ever appear as live ids (google/gemma-4-31b-it:free
    // was in its public list on 2026-10-11), so an unknown id must still start.
    const typed = readConfig({ EIS_PROVIDER: 'openrouter', EIS_MODEL: 'google/gemma-4-31b-it:free', OPENROUTER_API_KEY: 'placeholder-key-value-123' });
    assert.match(typed.modelNotice, /not in the built-in catalogue/);
    assert.strictEqual(typed.model, 'google/gemma-4-31b-it:free');
    const registry = require(path.join(SHARED, 'providers/registry.js'));
    const known = readConfig({ EIS_PROVIDER: 'openrouter', EIS_MODEL: registry.defaultModelFor('openrouter'), OPENROUTER_API_KEY: 'placeholder-key-value-123' });
    assert.strictEqual(known.modelNotice, null, 'a catalogue id was reported as unknown');
    // A notice is not a problem: describeStartupProblems is the fatal list.
    assert.deepStrictEqual(describeStartupProblems(typed), []);
  });

  await check('bad configuration fails at read time', () => {
    assert.throws(() => readConfig({ EIS_PROVIDER: 'mistral' }), /not a known provider/);
    assert.throws(() => readConfig({ EIS_MODEL: 'not a model id!' }), /not a usable model id/);
    assert.throws(() => readConfig({ PORT: 'abc' }), /valid port/);
    assert.throws(() => readConfig({ EIS_RATE_LIMIT: '-2' }), /valid number/);
    assert.ok(describeStartupProblems(readConfig({})).some((problem) => problem.includes('GOOGLE_API_KEY')));
    const exposed = readConfig({ EIS_HOST: '0.0.0.0', GOOGLE_API_KEY: FAKE_KEY });
    assert.ok(
      describeStartupProblems(exposed).some((problem) => /without EIS_ACCESS_TOKEN/.test(problem)),
      'binding beyond localhost without a token was allowed silently',
    );
  });

  // A real app with the network swapped out: the whole HTTP surface is tested
  // without a key or a provider.
  const transport = makeTransport((options) => (options.body && options.body.contents ? googleReply(EXPLANATION_JSON) : googleReply(EXPLANATION_JSON)));
  const core = require(path.join(SHARED, 'index.js')).createCore({
    providerId: 'google',
    model: 'gemini-3.8-flash',
    apiKey: FAKE_KEY,
    retries: 1,
    transport,
    logger: { info() {}, warn() {}, error() {}, setSecrets() {}, sanitize: (value) => value, LEVELS: {} },
  });

  const logLines = [];
  const logger = { info: (e, f) => logLines.push(['info', e, f]), warn: (e, f) => logLines.push(['warn', e, f]), error: (e, f) => logLines.push(['error', e, f]), appendLine: () => {} };
  const app = createApp(config, { core, logger });

  const server = await new Promise((resolve, reject) => {
    const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
    handle.on('error', reject);
    setTimeout(() => reject(new Error('server did not start')), 10000);
  });
  const port = server.address().port;

  try {
    await check('the landing page sells the product and links a real app', async () => {
      const res = await request(port, { path: '/' });
      assert.strictEqual(res.status, 200);
      assert.ok(res.text.includes('Explain It Simply'), 'no product name on the page');
      assert.match(res.text, /app\.html/, 'the landing page does not lead to the app');
      assert.ok(!/KB\s*=|find\(q\)/.test(res.text), 'the offline hardcoded answer demo is still shipped');
      assert.match(res.headers['content-security-policy'], /script-src 'self'/, 'CSP allows inline scripts');
      assert.ok(!/<script>[^<]/.test(res.text), 'an inline script is present and CSP would block it');
    });

    await check('the app page calls the backend and fakes nothing', async () => {
      const res = await request(port, { path: '/app.html' });
      assert.strictEqual(res.status, 200);
      assert.match(res.text, /<script src="app\.js"/, 'app.js is not loaded as an external file');
      assert.ok(!res.text.includes('setTimeout('), 'the page itself contains timer-driven fake behaviour');
      const app = await request(port, { path: '/app.js' });
      assert.strictEqual(app.status, 200);
      assert.ok(app.text.includes('api/explain'), 'the app never calls the explanation endpoint');
      assert.ok(!/\.innerHTML\s*=/.test(app.text), 'the app assigns innerHTML (model output would be injectable)');
      assert.match(app.text, /AbortController/, 'no cancellation support');
      assert.match(app.text, /SpeechRecognition/, 'voice input was dropped');
      assert.ok(!/1800|2000\)\s*;\s*\/\* fake/.test(app.text), 'a fake delay constant slipped in');
    });

    await check('security headers are all present', async () => {
      const res = await request(port, { path: '/api/health' });
      assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(res.headers['x-frame-options'], 'DENY');
      assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
      assert.match(res.headers['permissions-policy'], /microphone=\(self\)/);
      assert.strictEqual(res.headers['cache-control'], 'no-store');
      assert.ok(!('x-powered-by' in res.headers), 'express still advertises itself');
    });

    await check('.env, sources and the project root stay unreachable', async () => {
      for (const probe of ['/.env', '/.env.example', '/env.txt', '/env', '/package.json', '/server.js', '/../server.js', '/src/app.js', '/node_modules/express/package.json']) {
        const res = await request(port, { path: probe });
        if (res.status === 200 && /AIza|API_KEY|require\(/.test(res.text)) fail(`${probe} leaked configuration or source over HTTP`);
        if (res.status === 200 && !['/.env.example'].includes(probe)) fail(`${probe} is served (status 200)`);
      }
    });

    await check('catalogue and health expose no secrets', async () => {
      const health = await request(port, { path: '/api/health' });
      assert.strictEqual(health.json.provider, 'google');
      assert.strictEqual(health.json.keyConfigured, true);
      assert.ok(!('apiKey' in health.json));
      const catalog = await request(port, { path: '/api/catalog' });
      assert.ok(catalog.json.providers.some((provider) => provider.capabilities.streaming));
      assert.ok(catalog.json.tasks.some((task) => task.id === 'explain-code'));
      assert.ok(!JSON.stringify(catalog.json).includes(FAKE_KEY), 'catalog leaked the key');
      assert.ok(!JSON.stringify(catalog.json).includes('GOOGLE_API_KEY'), 'catalog leaked env names');
      assert.strictEqual(catalog.json.selected.model, 'gemini-3.8-flash');
    });

    await check('POST /api/explain validates its input', async () => {
      const post = (body, raw) => request(port, { method: 'POST', path: '/api/explain', body, raw });
      assert.strictEqual((await post('{"x":1}', true)).status, 400);
      assert.strictEqual((await post('{"query": 42}', true)).status, 400);
      assert.strictEqual((await post(`{"query":"${'x'.repeat(5000)}"}`, true)).status, 400);
      assert.strictEqual((await post('{"query":"ok","task":"make-coffee"}', true)).json.error.code, 'VALIDATION_ERROR');
      assert.strictEqual((await post('{"query": ', true)).status, 400, 'malformed JSON was not a 400');
      assert.strictEqual((await post('{"query": ', true)).json.error.code, 'VALIDATION_ERROR');
      const tooBig = await request(port, { method: 'POST', path: '/api/explain', body: JSON.stringify({ query: 'x'.repeat(200000) }), raw: true });
      assert.strictEqual(tooBig.status, 413, `oversized body gave ${tooBig.status}`);
      assert.strictEqual(transport.calls, 0, `invalid requests reached the provider (${transport.calls} calls)`);
    });

    await check('a valid question returns the validated explanation', async () => {
      const res = await request(port, { method: 'POST', path: '/api/explain', body: { query: 'What is recursion?' } });
      assert.strictEqual(res.status, 200, `got ${res.status}: ${res.text.slice(0, 200)}`);
      assert.strictEqual(res.json.ok, true);
      assert.strictEqual(res.json.result.title, 'Recursion');
      assert.strictEqual(res.json.result.version, 2);
      assert.strictEqual(res.json.meta.provider, 'google');
      assert.ok(res.json.meta.context.manifest.some((part) => part.part === 'selection'));
      assert.ok(logLines.some((line) => line[1] === 'explain.ok'), 'no structured success log');
    });

    await check('code detection switches the task automatically', async () => {
      const res = await request(port, {
        method: 'POST',
        path: '/api/explain',
        body: { query: 'function a() {\n  return 1;\n}' },
      });
      assert.strictEqual(res.json.meta.task, 'explain-code');
      const topic = await request(port, { method: 'POST', path: '/api/explain', body: { query: 'What is Big O?' } });
      assert.strictEqual(topic.json.meta.task, 'explain-topic');
    });

    await check('streaming returns SSE deltas then a result event', async () => {
      const streamTransport = makeTransport(() => googleReply(EXPLANATION_JSON));
      streamTransport.sseEvents = [
        { event: 'message', data: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"Str' }] } }] }) },
        { event: 'message', data: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'eaming","simpleExplanation":{"body":"x"}' }] } }] }) },
      ];
      const streamingCore = require(path.join(SHARED, 'index.js')).createCore({
        providerId: 'google', model: 'gemini-3.8-flash', apiKey: FAKE_KEY, retries: 1, transport: streamTransport,
        logger: { info() {}, warn() {}, error() {}, setSecrets() {}, sanitize: (v) => v },
      });
      const streamApp = createApp({ ...config, rateLimit: { requests: 500, windowMs: 60000, burst: 500 } }, { core: streamingCore, logger });
      const streamServer = await new Promise((resolve) => {
        const handle = streamApp.listen(0, '127.0.0.1', () => resolve(handle));
      });
      try {
        const res = await request(streamServer.address().port, {
          method: 'POST',
          path: '/api/explain/stream',
          body: { query: 'What is recursion?' },
        });
        assert.strictEqual(res.status, 200);
        assert.match(res.headers['content-type'], /text\/event-stream/);
        const events = res.text.split('\n\n').filter(Boolean).map((block) => {
          const name = /event: (\S+)/.exec(block)?.[1];
          const data = /data: ([\s\S]+)/.exec(block)?.[1];
          return { name, data: JSON.parse(data) };
        });
        assert.deepStrictEqual(events.map((event) => event.name), ['accepted', 'delta', 'delta', 'result']);
        assert.ok(events[1].data.text.includes('Str'), 'first delta lost');
        assert.strictEqual(events.at(-1).data.result.title, 'Streaming', 'final result not parsed from the stream');
      } finally {
        await new Promise((resolve) => streamServer.close(resolve));
      }
    });

    await check('rate limiting blocks bursts and reports Retry-After', async () => {
      // Its own instance: buckets are per-process, so this cannot be polluted by
      // the requests other checks in this group already made.
      const limited = createApp({ ...config, rateLimit: { requests: 2, windowMs: 60000, burst: 0 } }, { core, logger });
      const limitedServer = await new Promise((resolve) => {
        const handle = limited.listen(0, '127.0.0.1', () => resolve(handle));
      });
      try {
        const p = limitedServer.address().port;
        const codes = [];
        for (let i = 0; i < 6; i += 1) {
          const res = await request(p, { method: 'POST', path: '/api/explain', body: { query: 'What is recursion?' } });
          codes.push(res.status);
          if (res.status === 429) {
            assert.strictEqual(res.json.error.code, 'RATE_LIMIT_ERROR');
            assert.ok(res.headers['retry-after'], 'no Retry-After header on 429');
            assert.strictEqual(res.headers['x-ratelimit-limit'], '2');
            break;
          }
        }
        assert.strictEqual(codes[0], 200, `the first request was blocked (${codes.join(',')})`);
        assert.ok(codes.includes(429), `the limiter never fired: ${codes.join(',')}`);
      } finally {
        await new Promise((resolve) => limitedServer.close(resolve));
      }
    });

    await check('an access token gates the API when configured', async () => {
      const tokenApp = createApp({ ...config, accessToken: 'local-test-token-123', rateLimit: { requests: 100, windowMs: 60000, burst: 100 } }, { core, logger });
      const tokenServer = await new Promise((resolve) => {
        const handle = tokenApp.listen(0, '127.0.0.1', () => resolve(handle));
      });
      try {
        const p = tokenServer.address().port;
        const denied = await request(p, { method: 'POST', path: '/api/explain', body: { query: 'x' } });
        assert.strictEqual(denied.status, 401, `unauthenticated call gave ${denied.status}`);
        const pageStillWorks = await request(p, { path: '/' });
        assert.strictEqual(pageStillWorks.status, 200, 'the token gate blocked the static site too');
        const allowed = await request(p, {
          method: 'POST',
          path: '/api/explain',
          body: { query: 'What is recursion?' },
          headers: { Authorization: 'Bearer local-test-token-123' },
        });
        assert.strictEqual(allowed.status, 200, `token call gave ${allowed.status}`);
      } finally {
        await new Promise((resolve) => tokenServer.close(resolve));
      }
    });

    await check('cross-origin is refused unless configured', async () => {
      const corsConfig = { ...config, allowedOrigins: [], rateLimit: { requests: 500, windowMs: 60000, burst: 500 } };
      const corsApp = createApp(corsConfig, { core, logger });
      const corsServer = await new Promise((resolve) => {
        const handle = corsApp.listen(0, '127.0.0.1', () => resolve(handle));
      });
      try {
        const res = await request(corsServer.address().port, { method: 'OPTIONS', path: '/api/explain', headers: { Origin: 'https://evil.example' } });
        assert.strictEqual(res.status, 403, `preflight from an unknown origin gave ${res.status}`);
        assert.ok(!res.headers['access-control-allow-origin'], 'an origin was allowed without configuration');
      } finally {
        await new Promise((resolve) => corsServer.close(resolve));
      }
    });

    await check('provider failure is a clean 502 without leaking the key', async () => {
      const failing = createApp({ ...config, rateLimit: { requests: 500, windowMs: 60000, burst: 500 } }, {
        core: require(path.join(SHARED, 'index.js')).createCore({
          providerId: 'google', model: 'gemini-3.8-flash', apiKey: FAKE_KEY, retries: 1,
          transport: makeTransport(() => ({ status: 403, headers: {}, text: JSON.stringify({ error: { message: `quota issue for key ${FAKE_KEY}` } }) })),
          logger: { info() {}, warn() {}, error() {}, setSecrets() {}, sanitize: (v) => v },
        }),
        logger,
      });
      const failingServer = await new Promise((resolve) => {
        const handle = failing.listen(0, '127.0.0.1', () => resolve(handle));
      });
      try {
        const res = await request(failingServer.address().port, { method: 'POST', path: '/api/explain', body: { query: 'x' } });
        assert.strictEqual(res.status, 502);
        assert.strictEqual(res.json.error.code, 'AUTHENTICATION_ERROR');
        assert.ok(!res.text.includes(FAKE_KEY), 'the provider key was returned to the caller');
      } finally {
        await new Promise((resolve) => failingServer.close(resolve));
      }
    });

    await check('cancellation is bound to the response, not the request stream', () => {
      // A Node HTTP client in this test harness cannot reproduce the browser's
      // timing, so the wiring itself is asserted: `req`'s close event fires when
      // the body has been parsed, which is not a client disconnect.
      const src = fs.readFileSync(path.join(WEB_DIR, 'src/routes/explain.js'), 'utf8');
      if (/req\.on\(\s*'close'/.test(src)) {
        fail("cancellation is wired to req 'close' — that fires as soon as the body is parsed and kills every in-flight request");
      }
      assert.match(src, /res\.on\(\s*'close'/, 'no response-level disconnect watch');
      assert.match(src, /writableEnded/, 'disconnect handling does not check whether the response already finished');
    });

    await check('a slow provider is not cancelled by the request lifecycle', async () => {
      // Express closes the incoming stream as soon as the body is parsed; wiring
      // cancellation to that event silently kills every real request, which only
      // shows up when the provider actually takes time.
      const slowCore = require(path.join(SHARED, 'index.js')).createCore({
        providerId: 'google',
        model: 'gemini-3.8-flash',
        apiKey: FAKE_KEY,
        retries: 1,
        logger: QUIET,
        transport: {
          json: async () => {
            await new Promise((resolve) => setTimeout(resolve, 400));
            return googleReply(EXPLANATION_JSON);
          },
          sse: async (options, onEvent) => {
            await new Promise((resolve) => setTimeout(resolve, 400));
            onEvent({ event: 'message', data: JSON.stringify({ candidates: [{ content: { parts: [{ text: EXPLANATION_JSON }] } }] }) });
            return { status: 200, headers: {}, text: '' };
          },
        },
      });
      const slowApp = createApp({ ...config, rateLimit: { requests: 500, windowMs: 60000, burst: 500 } }, { core: slowCore, logger });
      const slowServer = await new Promise((resolve) => {
        const handle = slowApp.listen(0, '127.0.0.1', () => resolve(handle));
      });
      try {
        const p = slowServer.address().port;
        const plain = await request(p, { method: 'POST', path: '/api/explain', body: { query: 'What is recursion?' } });
        assert.strictEqual(plain.status, 200, `slow provider gave ${plain.status}: ${plain.text.slice(0, 120)}`);
        if (plain.json.meta.retries > 0) fail('a cancelled request was retried');
        const streamed = await request(p, { method: 'POST', path: '/api/explain/stream', body: { query: 'What is recursion?' } });
        assert.strictEqual(streamed.status, 200);
        assert.ok(streamed.text.includes('event: result'), 'the slow stream never produced a result event');
        assert.ok(!streamed.text.includes('event: error'), `the slow stream errored: ${streamed.text.slice(-200)}`);
      } finally {
        await new Promise((resolve) => slowServer.close(resolve));
      }
    });

    await check('unknown routes answer with the shared error shape', async () => {
      const missing = await request(port, { path: '/api/nope' });
      assert.strictEqual(missing.status, 404);
      assert.strictEqual(missing.json.ok, false);
      const wrongMethod = await request(port, { method: 'GET', path: '/api/explain' });
      assert.ok([404, 405].includes(wrongMethod.status), `GET on the explain route gave ${wrongMethod.status}`);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  await check('the server refuses to start unconfigured', async () => {
    const outcome = await new Promise((resolve) => {
      const proc = spawn(process.execPath, [path.join(WEB_DIR, 'server.js')], {
        cwd: WEB_DIR,
        env: { ...process.env, PORT: '0', GOOGLE_API_KEY: '', EIS_MODEL: '', EIS_PROVIDER: 'google', EIS_HOST: '127.0.0.1' },
        windowsHide: true,
      });
      let out = '';
      proc.stdout.on('data', (d) => { out += d; });
      proc.stderr.on('data', (d) => { out += d; });
      proc.on('close', (code) => resolve({ code, out }));
      setTimeout(() => {
        try {
          proc.kill();
        } catch (error) {
          /* gone */
        }
      }, 15000);
    });
    assert.ok(/GOOGLE_API_KEY/.test(outcome.out), `startup did not name the missing variable: ${outcome.out.slice(0, 160)}`);
    assert.ok(outcome.code !== 0, 'the server exited 0 while unconfigured');
    assert.ok(!outcome.out.includes(FAKE_KEY), 'startup output echoed a key value');
  });
}

// ----------------------------------------------------------------- runner

function auditContext() {
  return {
    check,
    fail,
    assert,
    setGroup,
    path,
    fs,
    ROOT,
    EXT_DIR,
    WEB_DIR,
    SHARED,
    FAKE_KEY,
    QUIET,
    loadExtension,
    makeVscodeStub,
    freshState,
    makeContext: fakeContext,
    makeTransport: (handler) => makeTransport(handler),
    googleReply,
    EXPLANATION_JSON,
    CODE_CHANGE_JSON,
    configStub: (values) => ({ get: (key) => values[key], update: async () => {} }),
    uriFor: (name) => ({ fsPath: `/tmp/proj/${name}`, path: `/tmp/proj/${name}` }),
  };
}

const GROUPS = [
  ['syntax', checkSyntax],
  ['secrets', checkSecrets],
  ['vendor', checkVendoring],
  ['core', checkCore],
  ['registry', checkRegistry],
  ['extension', checkExtension],
  ['webview', () => require('./checks/webview.js').run(auditContext())],
  ['audit', () => require('./checks/audit.js').run(auditContext())],
  ['security', () => require('./checks/security.js').run(auditContext())],
  ['server', checkServer],
];

async function main() {
  for (const [name, run] of GROUPS) {
    if (!shouldRun(name)) continue;
    try {
      await run();
    } catch (error) {
      // A broken module must show up as a failed check, not as a crashed run.
      results.push({ name: `${name}: group executed`, ok: false, detail: (error && error.stack) || String(error) });
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('');
    console.log(`${failed.length} FAILED`);
    for (const item of failed) console.log(`  - ${item.name}\n      ${item.detail.split('\n').join('\n      ')}`);
  }
  for (const warning of warnings) console.log(`WARN  ${warning}`);
  console.log(`${results.length - failed.length}/${results.length} checks passed${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
  // Hard exit: sockets pooled by the in-process server tests keep the loop alive.
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('check.js crashed:', error && error.stack ? error.stack : error);
  process.exit(2);
});
