(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const saved = wd.db.collection('requests');
  const hist = wd.db.collection('history');
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  $('method').innerHTML = METHODS.map((m) => `<option>${m}</option>`).join('');

  // ------------------------------------------------------------ state
  const blank = () => ({ _id: null, name: '', collection: '', method: 'GET', url: '', params: [], headers: [], bodyType: 'none', body: '', form: [], auth: { type: 'none' }, timeout: 30, redirects: true });
  let req = blank();
  let envs = { 'No environment': {} };
  let activeEnv = 'No environment';
  let inflight = null;

  // Key/value table editor
  function kvTable(el, rows, onChange) {
    const draw = () => {
      const list = [...rows, { k: '', v: '', on: true, _new: true }];
      el.innerHTML = `<table class="kvt"><tr><th></th><th class="wd-small wd-muted" style="text-align:left">Key</th><th class="wd-small wd-muted" style="text-align:left">Value</th><th></th></tr>${list.map((r, i) => `<tr>
        <td><input type="checkbox" data-i="${i}" data-f="on" ${r.on !== false ? 'checked' : ''} ${r._new ? 'hidden' : ''}></td>
        <td><input class="wd-input" type="text" data-i="${i}" data-f="k" value="${esc(r.k)}" placeholder="key"></td>
        <td><input class="wd-input" type="text" data-i="${i}" data-f="v" value="${esc(r.v)}" placeholder="value"></td>
        <td>${r._new ? '' : `<button class="wd-btn wd-btn-sm wd-btn-ghost" data-del="${i}">✕</button>`}</td></tr>`).join('')}</table>`;
    };
    el.oninput = (e) => {
      const i = +e.target.dataset.i, f = e.target.dataset.f;
      if (!f) return;
      if (i === rows.length) { rows.push({ k: '', v: '', on: true }); }
      rows[i][f] = f === 'on' ? e.target.checked : e.target.value;
      onChange?.();
      if (i === rows.length - 1 && f !== 'on' && !el.querySelector(`[data-i="${rows.length}"]`)) { const pos = e.target.selectionStart; draw(); const again = el.querySelector(`[data-i="${i}"][data-f="${f}"]`); again.focus(); again.setSelectionRange(pos, pos); }
    };
    el.onclick = (e) => { const d = e.target.dataset.del; if (d != null) { rows.splice(+d, 1); draw(); onChange?.(); } };
    draw();
  }

  // URL <-> params sync
  function paramsFromUrl() {
    const [, query = ''] = $('url').value.split('?');
    req.params = query ? query.split('&').filter(Boolean).map((p) => { const [k, ...v] = p.split('='); return { k: safeDecode(k), v: safeDecode(v.join('=')), on: true }; }) : [];
    kvTable($('rt-params'), req.params, urlFromParams);
  }
  function urlFromParams() {
    const base = $('url').value.split('?')[0];
    const q = req.params.filter((p) => p.on !== false && p.k).map((p) => `${encodeURIComponent(p.k)}=${encodeURIComponent(p.v)}`.replace(/%7B%7B/g, '{{').replace(/%7D%7D/g, '}}')).join('&');
    $('url').value = q ? `${base}?${q}` : base;
  }
  const safeDecode = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (_) { return s; } };
  $('url').addEventListener('input', paramsFromUrl);

  // request tabs
  document.querySelectorAll('[data-rt]').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('[data-rt]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['params', 'headers', 'body', 'auth', 'settings'].forEach((t) => ($('rt-' + t).hidden = t !== b.dataset.rt));
  }));
  document.querySelectorAll('[name=bt]').forEach((r) => (r.onchange = () => { req.bodyType = r.value; syncBodyUi(); }));
  function syncBodyUi() {
    document.querySelectorAll('[name=bt]').forEach((r) => (r.checked = r.value === req.bodyType));
    $('body').hidden = !['json', 'raw'].includes(req.bodyType);
    $('formBody').hidden = req.bodyType !== 'form';
    $('fmtBody').hidden = req.bodyType !== 'json';
    if (req.bodyType === 'form') kvTable($('formBody'), req.form);
  }
  $('fmtBody').onclick = () => { try { $('body').value = JSON.stringify(JSON.parse(sub($('body').value)), null, 2); } catch (e) { wd.ui.toast('Invalid JSON: ' + e.message, 'error'); } };
  $('authType').onchange = () => { req.auth = { type: $('authType').value }; drawAuth(); };
  function drawAuth() {
    const a = req.auth;
    $('authType').value = a.type;
    const f = (id, label, ph = '') => `<div><label class="wd-label">${label}</label><input class="wd-input wd-mono" data-auth="${id}" value="${esc(a[id] || '')}" placeholder="${ph}"></div>`;
    $('authFields').innerHTML = `<div class="wd-fields">${a.type === 'bearer' ? f('token', 'Token', '{{token}}') : a.type === 'basic' ? f('user', 'Username') + f('pass', 'Password') : a.type === 'apikey' ? f('header', 'Header name', 'X-API-Key') + f('key', 'Key') : ''}</div>`;
  }
  $('authFields').oninput = (e) => { const k = e.target.dataset.auth; if (k) req.auth[k] = e.target.value; };

  // -------------------------------------------------------- environments
  const sub = (s) => String(s ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => (k in (envs[activeEnv] || {}) ? envs[activeEnv][k] : m));
  function drawEnvs() { $('env').innerHTML = Object.keys(envs).map((n) => `<option ${n === activeEnv ? 'selected' : ''}>${esc(n)}</option>`).join(''); }
  $('env').onchange = () => { activeEnv = $('env').value; wd.kv.set('activeEnv', activeEnv); };
  $('editEnv').onclick = () => {
    const dlg = $('dlg');
    const text = Object.entries(envs).filter(([n]) => n !== 'No environment').map(([n, vars]) => `[${n}]\n${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n')}`).join('\n\n');
    dlg.innerHTML = `<h2>Environments</h2><p class="wd-small wd-muted" style="margin:6px 0 10px">One section per environment. Use variables as {{name}} in URLs, headers, bodies and auth.</p>
      <textarea class="wd-input" id="envText" style="min-height:240px">${esc(text || '[Local]\nbase=http://localhost:3000\ntoken=\n\n[Production]\nbase=https://api.example.com\ntoken=')}</textarea>
      <div class="wd-row" style="margin-top:12px"><div class="wd-spacer"></div><button class="wd-btn" id="envCancel">Cancel</button><button class="wd-btn wd-btn-primary" id="envSave">Save</button></div>`;
    dlg.showModal();
    $('envCancel').onclick = () => dlg.close();
    $('envSave').onclick = async () => {
      const next = { 'No environment': {} };
      let cur = null;
      for (const line of $('envText').value.split('\n')) {
        const sec = /^\s*\[(.+)\]\s*$/.exec(line);
        if (sec) { cur = sec[1].trim(); next[cur] = {}; continue; }
        const kv = /^\s*([\w.-]+)\s*=(.*)$/.exec(line);
        if (kv && cur) next[cur][kv[1]] = kv[2].trim();
      }
      envs = next;
      if (!envs[activeEnv]) activeEnv = 'No environment';
      await wd.kv.set('envs', envs);
      drawEnvs();
      dlg.close();
    };
  };

  // ------------------------------------------------------------- load/save
  function readForm() {
    req.name = $('name').value.trim();
    req.collection = $('col').value.trim();
    req.method = $('method').value;
    req.url = $('url').value.trim();
    req.body = $('body').value;
    req.timeout = +$('timeout').value || 30;
    req.redirects = $('redirects').checked;
    return req;
  }
  function loadReq(r) {
    req = { ...blank(), ...JSON.parse(JSON.stringify(r)) };
    $('name').value = req.name; $('col').value = req.collection; $('method').value = req.method; $('url').value = req.url;
    $('body').value = req.body; $('timeout').value = req.timeout; $('redirects').checked = req.redirects;
    kvTable($('rt-params'), req.params, urlFromParams);
    kvTable($('rt-headers'), req.headers);
    syncBodyUi();
    drawAuth();
  }
  $('newReq').onclick = () => loadReq(blank());
  $('save').onclick = async () => {
    readForm();
    if (!req.url) return wd.ui.toast('Enter a URL first', 'error');
    if (!req.name) req.name = `${req.method} ${req.url.replace(/^https?:\/\//, '').split('?')[0]}`.slice(0, 60);
    if (!req.collection) req.collection = 'My requests';
    $('name').value = req.name; $('col').value = req.collection;
    const { _id, ...data } = req;
    if (_id) await saved.update(_id, data); else req._id = (await saved.insert(data))._id;
    wd.ui.toast('Saved', 'ok');
    drawSidebar();
  };

  async function drawSidebar() {
    const all = await saved.find(null, { sort: 'name' });
    const groups = {};
    all.forEach((r) => (groups[r.collection || 'My requests'] = groups[r.collection || 'My requests'] || []).push(r));
    $('cols').innerHTML = Object.entries(groups).map(([g, list]) => `<details open><summary class="wd-small" style="cursor:pointer;margin:6px 0;font-weight:600">📁 ${esc(g)}</summary>
      ${list.map((r) => `<div class="req-row" data-saved="${r._id}"><span class="m ${r.method}">${r.method}</span><span class="wd-ellipsis wd-grow">${esc(r.name)}</span><a href="#" data-delreq="${r._id}" class="wd-muted">✕</a></div>`).join('')}</details>`).join('') ||
      '<div class="wd-small wd-muted">Saved requests appear here.</div>';
    const h = await hist.find(null, { sort: '-_createdAt', limit: 40 });
    $('hist').innerHTML = h.map((r) => `<div class="req-row" data-hist="${r._id}"><span class="m ${r.method}">${r.method}</span><span class="wd-ellipsis wd-grow" title="${esc(r.url)}">${esc(r.url.replace(/^https?:\/\//, ''))}</span><span class="wd-small s${String(r.status)[0]}">${r.status || 'ERR'}</span></div>`).join('') || '<div class="wd-small wd-muted">No requests yet.</div>';
  }
  document.querySelector('.side').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-delreq]');
    if (del) { e.preventDefault(); e.stopPropagation(); await saved.remove(del.dataset.delreq); return drawSidebar(); }
    const s = e.target.closest('[data-saved]');
    if (s) return loadReq(await saved.get(s.dataset.saved));
    const h = e.target.closest('[data-hist]');
    if (h) { const r = await hist.get(h.dataset.hist); loadReq({ ...r.request, _id: null }); }
  });
  $('clearHist').onclick = async () => { await hist.clear(); drawSidebar(); };

  // ------------------------------------------------------------------ send
  function build() {
    readForm();
    const headers = {};
    req.headers.filter((h) => h.on !== false && h.k).forEach((h) => (headers[sub(h.k)] = sub(h.v)));
    const a = req.auth;
    if (a.type === 'bearer' && a.token) headers.Authorization = `Bearer ${sub(a.token)}`;
    if (a.type === 'basic') headers.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(`${sub(a.user)}:${sub(a.pass)}`)));
    if (a.type === 'apikey' && a.header) headers[sub(a.header)] = sub(a.key);
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.bodyType === 'json') { body = sub(req.body); if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'; }
      if (req.bodyType === 'raw') body = sub(req.body);
      if (req.bodyType === 'form') { body = req.form.filter((f) => f.on !== false && f.k).map((f) => `${encodeURIComponent(sub(f.k))}=${encodeURIComponent(sub(f.v))}`).join('&'); headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded'; }
    }
    let url = sub(req.url);
    if (url && !/^https?:\/\//i.test(url)) url = (/^(localhost|127\.|10\.|192\.168\.)/.test(url) ? 'http://' : 'https://') + url;
    return { url, method: req.method, headers, body };
  }

  function highlightJson(text) {
    return esc(text).replace(/(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (m, str, colon, lit, num) => (str ? `<span class="${colon ? 'j-k' : 'j-s'}">${str}</span>${colon || ''}` : lit ? `<span class="j-b">${lit}</span>` : `<span class="j-n">${num}</span>`));
  }

  let lastResp = null;
  $('send').onclick = async () => {
    const b = build();
    if (!b.url) return wd.ui.toast('Enter a URL', 'error');
    const t0 = performance.now();
    const token = (inflight = {});
    $('send').disabled = true; $('cancel').hidden = false;
    $('resp').innerHTML = '<div class="wd-progress wd-indeterminate"><div></div></div>';
    let res, error;
    try {
      res = await wd.net.fetch(b.url, { method: b.method, headers: b.headers, body: b.body, rawHeaders: true, timeout: req.timeout, followRedirects: req.redirects });
    } catch (e) { error = e; }
    if (token !== inflight) return; // cancelled
    inflight = null;
    $('send').disabled = false; $('cancel').hidden = true;
    const ms = Math.round(performance.now() - t0);
    await hist.insert({ method: b.method, url: b.url, status: res ? res.status : 0, request: JSON.parse(JSON.stringify(readForm())) });
    const old = await hist.find(null, { sort: '-_createdAt', skip: 200 });
    for (const o of old) await hist.remove(o._id);
    drawSidebar();
    if (error) {
      $('resp').innerHTML = `<div class="wd-error">${esc(error.message)}</div>${error.code === 'forbidden' ? '' : '<p class="wd-small wd-muted" style="margin-top:8px">Is the server running? For local servers use http://localhost:PORT.</p>'}`;
      return;
    }
    lastResp = res;
    const ct = res.headers['content-type'] || '';
    let pretty = res.text || '';
    let isJson = /json/.test(ct);
    try { if (isJson || /^\s*[{[]/.test(pretty)) { pretty = JSON.stringify(JSON.parse(pretty), null, 2); isJson = true; } } catch (_) { isJson = false; }
    $('resp').innerHTML = `
      <div class="wd-row" style="margin-bottom:10px"><span class="status s${String(res.status)[0]}">${res.status} ${esc(res.reason || '')}</span>
        <span class="wd-small wd-muted">${ms} ms · ${wd.ui.formatBytes(res.size || 0)}${res.url && res.url !== b.url ? ' · redirected to ' + esc(res.url) : ''}</span><div class="wd-spacer"></div>
        <div class="wd-tabs"><button class="wd-tab" data-pt="body" aria-selected="true">Body</button><button class="wd-tab" data-pt="headers" aria-selected="false">Headers (${Object.keys(res.headers).length})</button></div>
        <button class="wd-btn wd-btn-sm" id="copyBody">Copy</button></div>
      <pre class="body" id="pt-body">${isJson ? highlightJson(pretty) : esc(pretty) || '<span class="wd-muted">(empty body)</span>'}</pre>
      <div id="pt-headers" hidden><table class="wd-table">${Object.entries(res.headers).map(([k, v]) => `<tr><td class="wd-mono" style="width:30%">${esc(k)}</td><td class="wd-mono" style="word-break:break-all">${esc(v)}</td></tr>`).join('')}</table></div>`;
    $('resp').querySelectorAll('[data-pt]').forEach((t) => (t.onclick = () => {
      $('resp').querySelectorAll('[data-pt]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      $('pt-body').hidden = t.dataset.pt !== 'body'; $('pt-headers').hidden = t.dataset.pt !== 'headers';
    }));
    $('copyBody').onclick = () => copy(pretty);
  };
  $('cancel').onclick = () => { inflight = null; $('send').disabled = false; $('cancel').hidden = true; $('resp').innerHTML = '<div class="wd-muted">Cancelled.</div>'; };
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('send').click(); if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); $('save').click(); } });

  // ------------------------------------------------------------------ cURL
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch (_) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    wd.ui.toast('Copied', 'ok');
  }
  const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  $('copyCurl').onclick = () => {
    const b = build();
    const parts = ['curl', b.method !== 'GET' ? `-X ${b.method}` : '', shq(b.url), ...Object.entries(b.headers).map(([k, v]) => `-H ${shq(`${k}: ${v}`)}`), b.body != null && b.body !== '' ? `--data ${shq(b.body)}` : ''].filter(Boolean);
    copy(parts.join(' \\\n  '));
  };
  /** Tokenizes a shell command (quotes + backslash-newlines). */
  function shellWords(s) {
    const out = []; let cur = '', q = null, any = false;
    s = s.replace(/\\\r?\n/g, ' ');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; else cur += c; }
      else if (c === '"' || c === "'") { q = c; any = true; }
      else if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ''; any = false; }
      else if (c === '\\' && i + 1 < s.length) cur += s[++i];
      else cur += c;
    }
    if (cur || any) out.push(cur);
    return out;
  }
  $('importCurl').onclick = () => {
    const dlg = $('dlg');
    dlg.innerHTML = `<h2>Import cURL</h2><textarea class="wd-input" id="curlText" style="min-height:160px;margin-top:10px" placeholder="curl -X POST https://api.example.com -H 'Content-Type: application/json' -d '{&quot;a&quot;:1}'"></textarea>
      <div class="wd-row" style="margin-top:12px"><div class="wd-spacer"></div><button class="wd-btn" id="cC">Cancel</button><button class="wd-btn wd-btn-primary" id="cI">Import</button></div>`;
    dlg.showModal();
    $('cC').onclick = () => dlg.close();
    $('cI').onclick = () => {
      const w = shellWords($('curlText').value.trim());
      if (w[0] !== 'curl') return wd.ui.toast('Paste a command starting with curl', 'error');
      const r = blank();
      for (let i = 1; i < w.length; i++) {
        const a = w[i];
        if (a === '-X' || a === '--request') r.method = w[++i].toUpperCase();
        else if (a === '-H' || a === '--header') { const [k, ...v] = w[++i].split(':'); r.headers.push({ k: k.trim(), v: v.join(':').trim(), on: true }); }
        else if (['-d', '--data', '--data-raw', '--data-binary', '--json'].includes(a)) { r.body = w[++i]; r.bodyType = /^\s*[{[]/.test(r.body) ? 'json' : 'raw'; if (r.method === 'GET') r.method = 'POST'; }
        else if (a === '-u' || a === '--user') { const [u, ...pw] = w[++i].split(':'); r.auth = { type: 'basic', user: u, pass: pw.join(':') }; }
        else if (a === '--url') r.url = w[++i];
        else if (!a.startsWith('-') && !r.url) r.url = a;
      }
      r.headers = r.headers.filter((h) => { if (/^authorization$/i.test(h.k) && /^bearer /i.test(h.v)) { r.auth = { type: 'bearer', token: h.v.slice(7) }; return false; } return true; });
      dlg.close();
      loadReq(r);
      paramsFromUrl();
    };
  };

  (async () => {
    envs = await wd.kv.get('envs', envs);
    activeEnv = await wd.kv.get('activeEnv', activeEnv);
    if (!envs[activeEnv]) activeEnv = 'No environment';
    drawEnvs();
    loadReq(blank());
    drawSidebar();
  })();
})();
