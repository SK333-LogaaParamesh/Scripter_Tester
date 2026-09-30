// TestGen Dashboard - zero-dependency Node server (Node 18+).
// Run: node src/server.js  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const LOGS = path.join(ROOT, 'logs');
const PORT = process.env.PORT || 3000;
const MAX_BODY = 5 * 1024 * 1024;
const CHUNK_CHARS = 24000;
const CODE_EXT = new Set(['.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.robot', '.cs', '.rb', '.ps1', '.sh', '.go', '.php', '.kt', '.cpp', '.c', '.rs', '.sql', '.txt']);

fs.mkdirSync(LOGS, { recursive: true });

// ---- tiny .env loader -------------------------------------------------------
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PROVIDERS = {
  grok: {
    label: 'Grok (xAI)',
    url: 'https://api.x.ai/v1/chat/completions',
    env: 'XAI_API_KEY',
    models: ['grok-4', 'grok-3', 'grok-3-mini', 'grok-code-fast-1'],
  },
  openrouter: {
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    env: 'OPENROUTER_API_KEY',
    models: ['x-ai/grok-4', 'anthropic/claude-sonnet-4.5', 'openai/gpt-4o-mini', 'deepseek/deepseek-chat', 'google/gemini-2.5-flash'],
  },
};

// ---- prompt engineering -----------------------------------------------------
const CATEGORIES = {
  functional: 'core happy-path behaviour',
  boundary: 'min/max/off-by-one, empty, zero, huge inputs, limits',
  negative: 'invalid types, malformed or missing input, wrong state',
  error_handling: 'exceptions, timeouts, network/IO/DB failures, retries, cleanup',
  security: 'injection, path traversal, auth bypass, secrets, unsafe deserialization, unsafe eval/exec',
  concurrency: 'race conditions, re-entrancy, ordering, idempotency',
  performance: 'large inputs, loops, memory, slow dependencies',
  integration: 'external services, files, env vars, config, side effects',
};

const SYSTEM_PROMPT = `You are a principal QA / SDET engineer. You design rigorous, non-redundant test suites by reading source code.

Method (follow silently, do not output it):
1. Identify every public function/class/endpoint/CLI entry point, its inputs, outputs, side effects and dependencies.
2. For each unit, derive tests using: equivalence partitioning, boundary-value analysis, error guessing, state transitions, and (where relevant) security and concurrency thinking.
3. Base every test on behaviour that is actually visible in the code. NEVER invent functions, files or APIs that are not in the code. If behaviour is ambiguous, say so in "rationale" and pick the most defensible expectation.
4. Edge cases must be concrete (exact input values), not generic advice like "test invalid input".
5. Prefer fewer, sharper tests over many duplicates. Each test must be independently executable.

Output rules:
- Reply with ONE valid JSON object and nothing else (no markdown fences, no prose).
- Schema:
{
  "language": string,
  "summary": string (2-3 sentences: what the script does),
  "units": [{"name": string, "purpose": string, "inputs": string, "outputs": string}],
  "test_cases": [{
    "id": "TC-001",
    "title": string,
    "category": one of [functional, boundary, negative, error_handling, security, concurrency, performance, integration],
    "priority": "High" | "Medium" | "Low",
    "target": string (function/class/flow under test),
    "preconditions": string,
    "input": string (concrete values),
    "steps": [string],
    "expected_result": string,
    "rationale": string (one sentence: why this test matters / which line or branch it covers)
  }],
  "edge_cases": [{"id": "EC-001", "scenario": string, "input": string, "expected_behavior": string, "why_it_matters": string}],
  "risks": [string] (bugs, code smells or untested assumptions you noticed in the code)
}
- "edge_cases" are the trickiest, most likely-to-break scenarios (aim 5-12); "test_cases" is the full suite.`;

const FEW_SHOT_USER = 'Script: add.py\n```\ndef add(a, b):\n    return a + b\n```';
const FEW_SHOT_ASSISTANT = JSON.stringify({
  language: 'Python',
  summary: 'Defines add(a, b) which returns a + b with no validation.',
  units: [{ name: 'add', purpose: 'Sum two values', inputs: 'a, b (any type supporting +)', outputs: 'a + b' }],
  test_cases: [
    { id: 'TC-001', title: 'Adds two positive integers', category: 'functional', priority: 'High', target: 'add', preconditions: 'None', input: 'a=2, b=3', steps: ['Call add(2, 3)'], expected_result: 'Returns 5', rationale: 'Core behaviour.' },
    { id: 'TC-002', title: 'Mixed types raise TypeError', category: 'negative', priority: 'Medium', target: 'add', preconditions: 'None', input: 'a=1, b="1"', steps: ['Call add(1, "1")'], expected_result: 'Raises TypeError', rationale: 'No type validation, Python + rejects int+str.' },
  ],
  edge_cases: [{ id: 'EC-001', scenario: 'Float precision', input: 'a=0.1, b=0.2', expected_behavior: 'Returns 0.30000000000000004, not 0.3', why_it_matters: 'Callers comparing with == will fail.' }],
  risks: ['No input validation; string+string silently concatenates instead of failing.'],
});

function buildUserPrompt({ name, code, framework, categories, extra, chunk }) {
  const cats = (categories && categories.length ? categories : Object.keys(CATEGORIES))
    .filter((c) => CATEGORIES[c])
    .map((c) => `- ${c}: ${CATEGORIES[c]}`)
    .join('\n');
  return `Script: ${name}${chunk ? ` (part ${chunk.i} of ${chunk.n}; only cover code in this part)` : ''}
Preferred test framework (for wording of steps): ${framework || 'auto-detect from language'}

Focus on these categories only:
${cats}
${extra ? `\nExtra instructions from the user:\n${extra}\n` : ''}
\`\`\`
${code}
\`\`\`

Return the JSON object now.`;
}

// ---- LLM call ---------------------------------------------------------------
async function chat(p, key, model, messages, { temperature = 0.2, json = true } = {}) {
  const cfg = PROVIDERS[p];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  if (p === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost:' + PORT;
    headers['X-Title'] = 'TestGen Dashboard';
  }
  const body = { model, messages, temperature };
  if (json) body.response_format = { type: 'json_object' };

  const post = async (b) => {
    const r = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify(b), signal: AbortSignal.timeout(300000) });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = null; }
    return { ok: r.ok, status: r.status, data, text };
  };

  let res = await post(body);
  // some models reject response_format -> retry without it
  if (!res.ok && res.status === 400 && json) { delete body.response_format; res = await post(body); }
  if (!res.ok) {
    const msg = res.data?.error?.message || res.data?.error || res.text.slice(0, 300);
    const err = new Error(`${cfg.label} API error ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }
  const content = res.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Model returned an empty response');
  return { content, usage: res.data.usage || {} };
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  throw new Error('invalid JSON');
}

function normalize(r) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const str = (x) => (x == null ? '' : typeof x === 'string' ? x : JSON.stringify(x));
  return {
    language: str(r.language),
    summary: str(r.summary),
    units: arr(r.units).map((u) => ({ name: str(u.name), purpose: str(u.purpose), inputs: str(u.inputs), outputs: str(u.outputs) })),
    test_cases: arr(r.test_cases).map((t) => ({
      id: '', title: str(t.title), category: CATEGORIES[t.category] ? t.category : 'functional',
      priority: ['High', 'Medium', 'Low'].includes(t.priority) ? t.priority : 'Medium',
      target: str(t.target), preconditions: str(t.preconditions), input: str(t.input),
      steps: arr(t.steps).map(str), expected_result: str(t.expected_result), rationale: str(t.rationale),
    })),
    edge_cases: arr(r.edge_cases).map((e) => ({ id: '', scenario: str(e.scenario), input: str(e.input), expected_behavior: str(e.expected_behavior), why_it_matters: str(e.why_it_matters) })),
    risks: arr(r.risks).map(str),
  };
}

function splitChunks(code) {
  if (code.length <= CHUNK_CHARS) return [code];
  const out = []; let cur = '';
  for (const line of code.split('\n')) {
    if (cur.length + line.length > CHUNK_CHARS && cur) { out.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur) out.push(cur);
  return out;
}

async function generateOne(p, key, model, temperature, msgs) {
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const add = (u) => { usage.prompt_tokens += u.prompt_tokens || 0; usage.completion_tokens += u.completion_tokens || 0; };
  const first = await chat(p, key, model, msgs, { temperature });
  add(first.usage);
  let content = first.content;
  for (let attempt = 0; ; attempt++) {
    try { return { data: normalize(parseJson(content)), usage }; }
    catch {
      if (attempt >= 1) throw new Error('Model did not return valid JSON after a retry. Try a stronger model. Raw start: ' + content.slice(0, 200));
      const fix = await chat(p, key, model, [...msgs, { role: 'assistant', content }, { role: 'user', content: 'Your reply was not valid JSON. Return ONLY the corrected JSON object, nothing else.' }], { temperature: 0 });
      add(fix.usage); content = fix.content;
    }
  }
}

async function generate(input) {
  const { code, name = 'pasted_script', path: srcPath = '', provider, model, temperature = 0.2, framework, categories, extra, withCode } = input;
  const p = PROVIDERS[provider];
  if (!p) throw httpErr(400, 'Unknown provider');
  if (!code || !code.trim()) throw httpErr(400, 'No script provided');
  if (!model) throw httpErr(400, 'Model is required');
  const key = (input.apiKey || '').trim() || process.env[p.env];
  if (!key) throw httpErr(400, `No API key for ${p.label}. Enter it in the UI or set ${p.env} in .env`);

  const started = Date.now();
  const chunks = splitChunks(code);
  const merged = { language: '', summary: '', units: [], test_cases: [], edge_cases: [], risks: [] };
  const usage = { prompt_tokens: 0, completion_tokens: 0 };

  for (let i = 0; i < chunks.length; i++) {
    const user = buildUserPrompt({ name, code: chunks[i], framework, categories, extra, chunk: chunks.length > 1 ? { i: i + 1, n: chunks.length } : null });
    const msgs = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: FEW_SHOT_USER },
      { role: 'assistant', content: FEW_SHOT_ASSISTANT },
      { role: 'user', content: user },
    ];
    const { data, usage: u } = await generateOne(provider, key, model, temperature, msgs);
    usage.prompt_tokens += u.prompt_tokens; usage.completion_tokens += u.completion_tokens;
    merged.language ||= data.language;
    merged.summary += (merged.summary && data.summary ? ' ' : '') + data.summary;
    for (const k of ['units', 'test_cases', 'edge_cases', 'risks']) merged[k].push(...data[k]);
  }
  merged.test_cases.forEach((t, i) => (t.id = 'TC-' + String(i + 1).padStart(3, '0')));
  merged.edge_cases.forEach((e, i) => (e.id = 'EC-' + String(i + 1).padStart(3, '0')));

  let test_code = '';
  if (withCode && merged.test_cases.length) {
    const fw = framework && framework !== 'auto' ? framework : `the most common framework for ${merged.language || 'this language'}`;
    const cases = merged.test_cases.map(({ title, target, input: inp, expected_result }) => ({ title, target, input: inp, expected_result }));
    const edges = merged.edge_cases.map(({ scenario, input: inp, expected_behavior }) => ({ scenario, input: inp, expected_behavior }));
    const r = await chat(provider, key, model, [
      { role: 'system', content: 'You write runnable automated tests. Output ONLY the test source file, no explanation. You may wrap it in one markdown code fence.' },
      { role: 'user', content: `Write a complete test file using ${fw} implementing these test cases and edge cases for the script "${name}". Import/require the script under test appropriately and mock external I/O.\n\nSCRIPT:\n${code.slice(0, CHUNK_CHARS)}\n\nTEST CASES:\n${JSON.stringify(cases)}\n\nEDGE CASES:\n${JSON.stringify(edges)}` },
    ], { temperature: 0.1, json: false });
    usage.prompt_tokens += r.usage.prompt_tokens || 0; usage.completion_tokens += r.usage.completion_tokens || 0;
    const m = r.content.match(/```[\w+-]*\n([\s\S]*?)```/);
    test_code = (m ? m[1] : r.content).trim();
  }

  const now = new Date();
  const record = {
    id: now.toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(2).toString('hex'),
    timestamp: now.toISOString(),
    script: { name, path: srcPath, chars: code.length, lines: code.split('\n').length, sha256: crypto.createHash('sha256').update(code).digest('hex'), chunks: chunks.length },
    request: { provider, model, temperature, framework: framework || 'auto', categories: categories || [], extra: extra || '', withCode: !!withCode },
    duration_ms: Date.now() - started,
    usage,
    result: { ...merged, test_code },
    code,
  };
  fs.writeFileSync(path.join(LOGS, record.id + '.json'), JSON.stringify(record, null, 2));
  fs.appendFileSync(path.join(LOGS, 'testgen.log'),
    `${record.timestamp} | ${name} | ${srcPath || '(pasted)'} | ${provider}/${model} | tests=${merged.test_cases.length} edge=${merged.edge_cases.length} | ${record.duration_ms}ms | tokens=${usage.prompt_tokens}+${usage.completion_tokens} | ${record.id}\n`);
  return record;
}

// ---- helpers ----------------------------------------------------------------
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

function readPath(p) {
  if (!p) throw httpErr(400, 'Path is empty');
  const full = path.resolve(p.trim().replace(/^"|"$/g, ''));
  if (!fs.existsSync(full)) throw httpErr(404, 'Path not found: ' + full);
  const st = fs.statSync(full);
  if (st.isDirectory()) {
    const files = fs.readdirSync(full, { withFileTypes: true })
      .filter((d) => d.isFile() && CODE_EXT.has(path.extname(d.name).toLowerCase()))
      .map((d) => path.join(full, d.name));
    return { directory: full, files };
  }
  if (st.size > 1024 * 1024) throw httpErr(413, 'File larger than 1 MB');
  return { name: path.basename(full), path: full, content: fs.readFileSync(full, 'utf8') };
}

function listLogs() {
  return fs.readdirSync(LOGS).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(LOGS, f), 'utf8'));
      return { id: r.id, timestamp: r.timestamp, script: r.script.name, path: r.script.path, lines: r.script.lines, provider: r.request.provider, model: r.request.model, tests: r.result.test_cases.length, edges: r.result.edge_cases.length, duration_ms: r.duration_ms, tokens: (r.usage.prompt_tokens || 0) + (r.usage.completion_tokens || 0) };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

const safeId = (id) => /^[\w.-]+$/.test(id) && !id.includes('..');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(httpErr(413, 'Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(httpErr(400, 'Invalid JSON body')); } });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, obj, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(obj) : obj); };
  try {
    if (url.pathname === '/api/config') {
      return send(200, { providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, { label: v.label, models: v.models, keyConfigured: !!process.env[v.env], env: v.env }])), categories: CATEGORIES });
    }
    if (url.pathname === '/api/read-path' && req.method === 'POST') return send(200, readPath((await readBody(req)).path));
    if (url.pathname === '/api/generate' && req.method === 'POST') return send(200, await generate(await readBody(req)));
    if (url.pathname === '/api/logs' && req.method === 'GET') return send(200, listLogs());
    if (url.pathname === '/api/logs.txt') {
      const f = path.join(LOGS, 'testgen.log');
      return send(200, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '', 'text/plain; charset=utf-8');
    }
    const m = url.pathname.match(/^\/api\/logs\/([^/]+)$/);
    if (m) {
      if (!safeId(m[1])) throw httpErr(400, 'Bad id');
      const f = path.join(LOGS, m[1] + '.json');
      if (!fs.existsSync(f)) throw httpErr(404, 'Log not found');
      if (req.method === 'DELETE') { fs.unlinkSync(f); return send(200, { ok: true }); }
      return send(200, JSON.parse(fs.readFileSync(f, 'utf8')));
    }
    if (url.pathname.startsWith('/api/')) throw httpErr(404, 'Not found');
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const f = path.join(PUBLIC, rel);
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || !fs.statSync(f).isFile()) throw httpErr(404, 'Not found');
    return send(200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
  } catch (e) {
    if (!e.status) console.error(e);
    send(e.status || 500, { error: e.message || String(e) });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`TestGen Dashboard: http://localhost:${PORT}`));
