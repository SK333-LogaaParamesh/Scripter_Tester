const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let cfg, srcPath = '', current = null;

async function api(url, body) {
  const r = await fetch(url, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

// ---- setup ----
(async function init() {
  cfg = await api('/api/config');
  $('#provider').innerHTML = Object.entries(cfg.providers).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#cats').innerHTML = Object.entries(cfg.categories).map(([k, d]) => `<label title="${esc(d)}"><input type="checkbox" value="${k}" checked> ${k.replace('_', ' ')}</label>`).join('');
  const saved = JSON.parse(localStorage.getItem('testgen') || '{}');
  if (saved.provider && cfg.providers[saved.provider]) $('#provider').value = saved.provider;
  onProvider(saved.model);
  if (saved.framework) $('#framework').value = saved.framework;
})();

function onProvider(model) {
  const p = cfg.providers[$('#provider').value];
  $('#models').innerHTML = p.models.map((m) => `<option value="${esc(m)}">`).join('');
  $('#model').value = model || p.models[0];
  $('#keyhint').textContent = p.keyConfigured ? `(✓ ${p.env} found in .env)` : `(${p.env} not set)`;
}
$('#provider').onchange = () => onProvider();

// ---- nav / tabs ----
function show(v) { for (const k of ['gen', 'hist']) { $('#view-' + k).classList.toggle('hide', k !== v); $('#nav-' + k).classList.toggle('on', k === v); } if (v === 'hist') loadHist(); }
$('#nav-gen').onclick = () => show('gen'); $('#nav-hist').onclick = () => show('hist');
document.querySelectorAll('#src-tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('#src-tabs button').forEach((x) => x.classList.toggle('on', x === b));
  for (const t of ['paste', 'upload', 'path']) $('#src-' + t).classList.toggle('hide', t !== b.dataset.t);
});

// ---- script input ----
function setScript(name, code, p = '') {
  $('#code').value = code; $('#name').value = name; srcPath = p;
  $('#loaded').textContent = `Loaded ${name} — ${code.split('\n').length} lines, ${code.length} chars${p ? ' from ' + p : ''}`;
}
$('#code').oninput = () => { srcPath = ''; $('#loaded').textContent = ''; };
const drop = $('#drop');
drop.onclick = () => $('#file').click();
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); };
$('#file').onchange = (e) => readFile(e.target.files[0]);
function readFile(f) {
  if (!f) return;
  if (f.size > 1024 * 1024) return alert('File larger than 1 MB');
  const r = new FileReader();
  r.onload = () => { setScript(f.name, r.result); document.querySelector('[data-t=paste]').click(); };
  r.readAsText(f);
}
async function loadPath(p) {
  $('#path-files').textContent = 'Loading…';
  try {
    const r = await api('/api/read-path', { path: p });
    if (r.files) {
      $('#path-files').innerHTML = r.files.length ? 'Pick a file:<br>' + r.files.map((f) => `<a href="#" data-f="${esc(f)}">${esc(f.split(/[\\/]/).pop())}</a>`).join(' · ') : 'No script files in that folder.';
      $('#path-files').querySelectorAll('a').forEach((a) => a.onclick = (e) => { e.preventDefault(); $('#path').value = a.dataset.f; loadPath(a.dataset.f); });
    } else { $('#path-files').textContent = ''; setScript(r.name, r.content, r.path); }
  } catch (e) { $('#path-files').innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
}
$('#load-path').onclick = () => loadPath($('#path').value);
$('#path').onkeydown = (e) => { if (e.key === 'Enter') loadPath($('#path').value); };

// ---- generate ----
$('#go').onclick = async () => {
  const code = $('#code').value;
  if (!code.trim()) return alert('Provide a script first (paste, upload or path).');
  const cats = [...document.querySelectorAll('#cats input:checked')].map((c) => c.value);
  const req = {
    code, name: $('#name').value.trim() || 'pasted_script', path: srcPath,
    provider: $('#provider').value, model: $('#model').value.trim(), apiKey: $('#apikey').value,
    temperature: parseFloat($('#temp').value) || 0, framework: $('#framework').value, categories: cats,
    extra: $('#extra').value.trim(), withCode: $('#withcode').checked,
  };
  localStorage.setItem('testgen', JSON.stringify({ provider: req.provider, model: req.model, framework: req.framework }));
  const btn = $('#go'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Generating… (can take 30-120s)';
  $('#out').innerHTML = '';
  try { render(await api('/api/generate', req)); }
  catch (e) { $('#out').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  finally { btn.disabled = false; btn.textContent = 'Generate test cases'; }
};

// ---- render result ----
function render(rec) {
  current = rec; const r = rec.result;
  const cats = [...new Set(r.test_cases.map((t) => t.category))];
  const byPrio = (p) => r.test_cases.filter((t) => t.priority === p).length;
  $('#out').innerHTML = `
  <div class="card">
    <div class="toolbar">
      <button class="btn sec sm" id="dl-json">Download JSON</button><button class="btn sec sm" id="dl-md">Download Markdown</button><button class="btn sec sm" id="dl-csv">Download CSV</button>
    </div>
    <div class="stats">
      <div class="stat"><b>${r.test_cases.length}</b><span>test cases</span></div>
      <div class="stat"><b>${r.edge_cases.length}</b><span>edge cases</span></div>
      <div class="stat"><b class="High">${byPrio('High')}</b><span>high priority</span></div>
      <div class="stat"><b>${r.risks.length}</b><span>risks found</span></div>
      <div class="stat"><b>${((rec.duration_ms || 0) / 1000).toFixed(1)}s</b><span>${(rec.usage.prompt_tokens || 0) + (rec.usage.completion_tokens || 0)} tokens</span></div>
    </div>
    <p style="margin:0 0 4px"><b>${esc(rec.script.name)}</b> <span class="mute">· ${esc(r.language)} · ${esc(rec.request.provider)}/${esc(rec.request.model)} · ${new Date(rec.timestamp).toLocaleString()}</span></p>
    <p class="mute" style="margin:0">${esc(r.summary)}</p>

    ${r.risks.length ? `<h3>Risks &amp; code smells</h3><ul style="margin:0;padding-left:20px">${r.risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}

    <h3>Edge cases</h3>
    ${r.edge_cases.map((e) => `<div class="edge"><b>${esc(e.id)} · ${esc(e.scenario)}</b><div>Input: <code>${esc(e.input)}</code></div><div>Expected: ${esc(e.expected_behavior)}</div><small>${esc(e.why_it_matters)}</small></div>`).join('') || '<p class="mute">None returned.</p>'}

    <h3>Test cases</h3>
    <div class="filters">
      <input type="text" id="q" placeholder="Search…" style="width:200px">
      <select id="f-cat"><option value="">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <select id="f-pri"><option value="">All priorities</option><option>High</option><option>Medium</option><option>Low</option></select>
    </div>
    <table><thead><tr><th>ID</th><th>Title</th><th>Category</th><th>Priority</th><th>Target</th></tr></thead><tbody id="tcs"></tbody></table>

    ${r.test_code ? `<h3>Generated test code</h3><div class="toolbar"><button class="btn sec sm" id="copy-code">Copy</button></div><pre class="code">${esc(r.test_code)}</pre>` : ''}
    <h3>Units detected</h3>
    <table><thead><tr><th>Name</th><th>Purpose</th><th>Inputs</th><th>Outputs</th></tr></thead><tbody>${r.units.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.purpose)}</td><td>${esc(u.inputs)}</td><td>${esc(u.outputs)}</td></tr>`).join('')}</tbody></table>
  </div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), c = $('#f-cat').value, p = $('#f-pri').value;
    $('#tcs').innerHTML = r.test_cases.filter((t) => (!c || t.category === c) && (!p || t.priority === p) && (!q || JSON.stringify(t).toLowerCase().includes(q))).map((t) => `
      <tr class="tc" data-id="${esc(t.id)}"><td>${esc(t.id)}</td><td>${esc(t.title)}</td><td><span class="pill">${esc(t.category)}</span></td><td class="${t.priority}"><b>${t.priority}</b></td><td>${esc(t.target)}</td></tr>
      <tr class="detail hide" data-for="${esc(t.id)}"><td colspan="5">
        <div><b>Preconditions:</b> ${esc(t.preconditions) || '—'}</div>
        <div><b>Input:</b> <code>${esc(t.input)}</code></div>
        <div><b>Steps:</b><ol style="margin:2px 0 6px;padding-left:20px">${t.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
        <div><b>Expected:</b> ${esc(t.expected_result)}</div>
        <div class="mute"><b>Why:</b> ${esc(t.rationale)}</div></td></tr>`).join('');
    $('#tcs').querySelectorAll('tr.tc').forEach((tr) => tr.onclick = () => $('#tcs').querySelector(`tr[data-for="${tr.dataset.id}"]`).classList.toggle('hide'));
  };
  ['#q', '#f-cat', '#f-pri'].forEach((s) => $(s).oninput = draw); draw();
  $('#dl-json').onclick = () => dl(`${base(rec)}.json`, JSON.stringify(rec, null, 2), 'application/json');
  $('#dl-md').onclick = () => dl(`${base(rec)}.md`, toMd(rec), 'text/markdown');
  $('#dl-csv').onclick = () => dl(`${base(rec)}.csv`, toCsv(rec), 'text/csv');
  if (r.test_code) $('#copy-code').onclick = () => navigator.clipboard.writeText(r.test_code);
}
const base = (rec) => `${rec.script.name.replace(/\W+/g, '_')}_testcases_${rec.timestamp.slice(0, 19).replace(/[:T]/g, '-')}`;
function dl(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
function toMd(rec) {
  const r = rec.result;
  return `# Test cases: ${rec.script.name}\n\n_${rec.timestamp} · ${rec.request.provider}/${rec.request.model}_\n\n${r.summary}\n\n## Risks\n${r.risks.map((x) => '- ' + x).join('\n') || '- none'}\n\n## Edge cases\n${r.edge_cases.map((e) => `### ${e.id} ${e.scenario}\n- Input: \`${e.input}\`\n- Expected: ${e.expected_behavior}\n- Why: ${e.why_it_matters}\n`).join('\n')}\n## Test cases\n${r.test_cases.map((t) => `### ${t.id} ${t.title}\n- Category: ${t.category} | Priority: ${t.priority} | Target: ${t.target}\n- Preconditions: ${t.preconditions}\n- Input: \`${t.input}\`\n- Steps:\n${t.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\n- Expected: ${t.expected_result}\n- Rationale: ${t.rationale}\n`).join('\n')}${r.test_code ? '\n## Generated test code\n```\n' + r.test_code + '\n```\n' : ''}`;
}
function toCsv(rec) {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['id', 'title', 'category', 'priority', 'target', 'preconditions', 'input', 'steps', 'expected_result', 'rationale'];
  return [head.join(','), ...rec.result.test_cases.map((t) => head.map((h) => q(h === 'steps' ? t.steps.join(' | ') : t[h])).join(','))].join('\r\n');
}

// ---- history ----
async function loadHist() {
  const rows = await api('/api/logs');
  $('#hist-empty').classList.toggle('hide', rows.length > 0);
  $('#hist').innerHTML = rows.map((r) => `<tr>
    <td>${new Date(r.timestamp).toLocaleString()}</td><td><b>${esc(r.script)}</b><div class="mute">${r.lines} lines</div></td>
    <td class="mute" style="max-width:260px;overflow-wrap:anywhere">${esc(r.path) || '(pasted)'}</td>
    <td>${esc(r.provider)}<div class="mute">${esc(r.model)}</div></td><td>${r.tests}</td><td>${r.edges}</td><td>${r.tokens}</td><td>${(r.duration_ms / 1000).toFixed(1)}s</td>
    <td style="white-space:nowrap"><button class="btn sec sm" data-open="${esc(r.id)}">Open</button> <button class="btn sec sm" data-del="${esc(r.id)}">Delete</button></td></tr>`).join('');
  $('#hist').querySelectorAll('[data-open]').forEach((b) => b.onclick = async () => { render(await api('/api/logs/' + b.dataset.open)); show('gen'); });
  $('#hist').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (confirm('Delete this log?')) { await fetch('/api/logs/' + b.dataset.del, { method: 'DELETE' }); loadHist(); } });
}
$('#refresh').onclick = loadHist;
