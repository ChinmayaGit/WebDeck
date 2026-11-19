(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---------------------------------------------------------------- helpers
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    wd.ui.toast('Copied', 'ok');
  }
  const b64encode = (str) => { const bytes = enc.encode(str); let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };
  const b64decode = (b64) => dec.decode(Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64urlDecode = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return b64decode(s); };
  const b64urlBytes = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  async function hashes(bytes) {
    const out = { MD5: window.md5Bytes(bytes) };
    for (const alg of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) out[alg] = hex(await crypto.subtle.digest(alg, bytes));
    return out;
  }

  /**
   * Two-pane converter: input on the left, output on the right, mode buttons on top.
   * modes: [{id, label, fn(input) => string | Promise<string>}]
   */
  function ioTool(el, { modes, placeholder, sample, live = true }) {
    let mode = modes[0].id;
    el.innerHTML = `
      <div class="wd-row" style="margin-bottom:10px">
        <div class="wd-tabs">${modes.map((m) => `<button class="wd-tab" data-mode="${m.id}" aria-selected="${m.id === mode}">${esc(m.label)}</button>`).join('')}</div>
        <div class="wd-spacer"></div>
        ${sample ? '<button class="wd-btn wd-btn-sm wd-btn-ghost" data-act="sample">Sample</button>' : ''}
        <button class="wd-btn wd-btn-sm wd-btn-ghost" data-act="swap" title="Use output as input">⇄</button>
        <button class="wd-btn wd-btn-sm" data-act="copy">Copy output</button>
      </div>
      <div class="io"><textarea class="wd-input" id="in" placeholder="${esc(placeholder || 'Input')}" spellcheck="false"></textarea>
      <textarea class="wd-input" id="out" readonly spellcheck="false" placeholder="Output"></textarea></div>
      <div class="wd-small wd-muted" id="status" style="margin-top:6px"></div>`;
    const inp = el.querySelector('#in'), out = el.querySelector('#out'), status = el.querySelector('#status');
    async function update() {
      const m = modes.find((x) => x.id === mode);
      if (!inp.value) { out.value = ''; status.textContent = ''; out.className = 'wd-input'; return; }
      try {
        out.value = await m.fn(inp.value);
        out.className = 'wd-input out-ok';
        status.textContent = `${inp.value.length.toLocaleString()} → ${out.value.length.toLocaleString()} characters`;
      } catch (e) {
        out.value = '';
        out.className = 'wd-input out-err';
        status.textContent = '⚠ ' + e.message;
      }
    }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.mode) { mode = b.dataset.mode; el.querySelectorAll('[data-mode]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === mode))); update(); }
      if (b.dataset.act === 'copy' && out.value) copy(out.value);
      if (b.dataset.act === 'swap') { inp.value = out.value; update(); }
      if (b.dataset.act === 'sample') { inp.value = sample; update(); }
    });
    inp.addEventListener('input', () => live && update());
    return { update };
  }

  /** Card with labeled fields and a result area, re-computed on every change. */
  function formTool(el, html, compute) {
    el.innerHTML = html;
    const fail = (e) => { const r = el.querySelector('[data-result]'); if (r) r.innerHTML = `<div class="wd-error">${esc(e.message)}</div>`; };
    // compute may be sync or async; errors from both end up in the result area.
    const run = () => Promise.resolve().then(() => compute(el)).catch(fail);
    el.addEventListener('input', run);
    el.addEventListener('change', run);
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) copy(c.dataset.copy);
      if (e.target.closest('#go')) run();
    });
    run();
  }
  const kvRows = (pairs) => `<div class="kv">${pairs.map(([k, v]) => `<b class="wd-small">${esc(k)}</b><code>${esc(v)}</code><button class="wd-btn wd-btn-sm wd-btn-ghost" data-copy="${esc(v)}">Copy</button>`).join('')}</div>`;

  // -------------------------------------------------------------- formatters
  function formatXml(xml, indent = '  ') {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('Invalid XML: ' + err.textContent.split('\n')[0].slice(0, 160));
    const lines = [];
    const walk = (node, depth) => {
      const pad = indent.repeat(depth);
      if (node.nodeType === 3) { const t = node.nodeValue.trim(); if (t) lines.push(pad + esc(t).replace(/&#39;/g, "'")); return; }
      if (node.nodeType === 8) { lines.push(`${pad}<!--${node.nodeValue}-->`); return; }
      if (node.nodeType === 4) { lines.push(`${pad}<![CDATA[${node.nodeValue}]]>`); return; }
      if (node.nodeType !== 1) return;
      const attrs = [...node.attributes].map((a) => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('');
      const kids = [...node.childNodes].filter((n) => !(n.nodeType === 3 && !n.nodeValue.trim()));
      if (!kids.length) lines.push(`${pad}<${node.nodeName}${attrs}/>`);
      else if (kids.length === 1 && kids[0].nodeType === 3) lines.push(`${pad}<${node.nodeName}${attrs}>${esc(kids[0].nodeValue.trim()).replace(/&#39;/g, "'")}</${node.nodeName}>`);
      else { lines.push(`${pad}<${node.nodeName}${attrs}>`); kids.forEach((k) => walk(k, depth + 1)); lines.push(`${pad}</${node.nodeName}>`); }
    };
    const decl = /^\s*<\?xml[^>]*\?>/.exec(xml);
    if (decl) lines.push(decl[0].trim());
    [...doc.childNodes].forEach((n) => walk(n, 0));
    return lines.join('\n');
  }
  const minifyXml = (xml) => { formatXml(xml); return xml.replace(/>\s+</g, '><').replace(/<!--[\s\S]*?-->/g, '').trim(); };
  const minifyCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>~+])\s*/g, '$1').replace(/;}/g, '}').trim();
  const minifyHtml = (html) => html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();

  // ------------------------------------------------------------------ misc
  const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');
  const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  function loremSentence() {
    const n = 6 + rand(10);
    const w = Array.from({ length: n }, () => LOREM[rand(LOREM.length)]);
    w[0] = w[0][0].toUpperCase() + w[0].slice(1);
    return w.join(' ') + '.';
  }

  function words(s) {
    return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
  }
  const CASES = {
    'camelCase': (w) => w.map((x, i) => (i ? x[0].toUpperCase() + x.slice(1).toLowerCase() : x.toLowerCase())).join(''),
    'PascalCase': (w) => w.map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(''),
    'snake_case': (w) => w.map((x) => x.toLowerCase()).join('_'),
    'SCREAMING_SNAKE': (w) => w.map((x) => x.toUpperCase()).join('_'),
    'kebab-case': (w) => w.map((x) => x.toLowerCase()).join('-'),
    'Title Case': (w) => w.map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' '),
    'Sentence case': (w) => { const s = w.join(' ').toLowerCase(); return s[0].toUpperCase() + s.slice(1); },
    'lower case': (w) => w.join(' ').toLowerCase(),
    'UPPER CASE': (w) => w.join(' ').toUpperCase(),
    'dot.case': (w) => w.map((x) => x.toLowerCase()).join('.'),
  };

  // Cron: "m h dom mon dow"
  function explainCron(expr) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('Expected 5 fields: minute hour day-of-month month day-of-week');
    const MON = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const names = { mon: MON, dow: DOW };
    function field(v, unit, min, max, kind) {
      const label = (n) => (kind ? names[kind][+n] || n : n);
      const one = (p) => {
        let m;
        if (p === '*') return `every ${unit}`;
        if ((m = /^\*\/(\d+)$/.exec(p))) return `every ${m[1]} ${unit}s`;
        if ((m = /^(\d+)-(\d+)\/(\d+)$/.exec(p))) return `every ${m[3]} ${unit}s from ${label(m[1])} through ${label(m[2])}`;
        if ((m = /^(\d+)-(\d+)$/.exec(p))) return `${label(m[1])} through ${label(m[2])}`;
        if (/^\d+$/.test(p)) { if (+p < min || +p > max) throw new Error(`${unit} ${p} is out of range ${min}-${max}`); return kind ? label(p) : p; }
        throw new Error(`Cannot read “${p}” in the ${unit} field`);
      };
      return v.split(',').map(one).join(', ');
    }
    const [mi, h, dom, mon, dow] = parts;
    let time;
    if (/^\d+$/.test(mi) && /^\d+$/.test(h)) time = `At ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    else time = `At minute ${field(mi, 'minute', 0, 59)}, ${h === '*' ? 'every hour' : 'hour ' + field(h, 'hour', 0, 23)}`;
    const days = [];
    if (dom !== '*') days.push(`on day ${field(dom, 'day', 1, 31)} of the month`);
    if (dow !== '*') days.push(`on ${field(dow, 'weekday', 0, 7, 'dow')}`);
    if (mon !== '*') days.push(`in ${field(mon, 'month', 1, 12, 'mon')}`);
    return `${time}${days.length ? ', ' + days.join(', ') : ', every day'}.`;
  }

  function hexToRgb(h) {
    h = h.trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }
  function parseColor(s) {
    s = s.trim();
    let m;
    if ((m = hexToRgb(s))) return m;
    if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s))) return [+m[1], +m[2], +m[3]].map((v) => Math.min(255, v));
    if ((m = /^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(s))) {
      const h = +m[1] / 360, sat = +m[2] / 100, l = +m[3] / 100;
      const f = (n) => { const k = (n + h * 12) % 12; const a = sat * Math.min(l, 1 - l); return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255); };
      return [f(0), f(8), f(4)];
    }
    const probe = document.createElement('div'); probe.style.color = s;
    if (probe.style.color) { document.body.appendChild(probe); const c = getComputedStyle(probe).color; probe.remove(); const r = /(\d+), (\d+), (\d+)/.exec(c); if (r) return [+r[1], +r[2], +r[3]]; }
    throw new Error('Enter a color like #3b82f6, rgb(59,130,246), hsl(217,91%,60%) or a CSS name');
  }

  // ------------------------------------------------------------------ tools
  const tools = [
    // ----- Format
    { group: 'Format', id: 'json', name: 'JSON formatter', render: (el) => ioTool(el, {
      placeholder: 'Paste JSON', sample: '{"name":"WebDeck","apps":[{"id":1,"ok":true},{"id":2,"ok":false}],"meta":null}',
      modes: [
        { id: 'pretty', label: 'Format', fn: (s) => JSON.stringify(JSON.parse(s), null, 2) },
        { id: 'min', label: 'Minify', fn: (s) => JSON.stringify(JSON.parse(s)) },
        { id: 'sort', label: 'Sort keys', fn: (s) => { const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v; return JSON.stringify(sort(JSON.parse(s)), null, 2); } },
        { id: 'esc', label: 'Escape as string', fn: (s) => JSON.stringify(s) },
      ] }) },
    { group: 'Format', id: 'xml', name: 'XML formatter', render: (el) => ioTool(el, {
      placeholder: 'Paste XML', sample: '<?xml version="1.0"?><catalog><book id="1"><title>Dune</title><price>9.99</price></book><book id="2"/></catalog>',
      modes: [{ id: 'pretty', label: 'Format', fn: (s) => formatXml(s) }, { id: 'min', label: 'Minify', fn: minifyXml }] }) },
    { group: 'Format', id: 'html', name: 'HTML beautify / minify', render: (el) => ioTool(el, {
      placeholder: 'Paste HTML', sample: '<div class="card"><h1>Hello</h1><p>World <b>bold</b></p><ul><li>One</li><li>Two</li></ul></div>',
      modes: [{ id: 'pretty', label: 'Beautify', fn: (s) => window.html_beautify(s, { indent_size: 2, wrap_line_length: 120 }) }, { id: 'min', label: 'Minify', fn: minifyHtml }] }) },
    { group: 'Format', id: 'css', name: 'CSS beautify / minify', render: (el) => ioTool(el, {
      placeholder: 'Paste CSS', sample: '.card{display:flex;gap:8px}/* note */ .card > h1 { color : red ; margin:0 }',
      modes: [{ id: 'pretty', label: 'Beautify', fn: (s) => window.css_beautify(s, { indent_size: 2 }) }, { id: 'min', label: 'Minify', fn: minifyCss }] }) },
    { group: 'Format', id: 'js', name: 'JavaScript beautify', render: (el) => ioTool(el, {
      placeholder: 'Paste JavaScript', sample: 'function add(a,b){if(!a){return b}return a+b}const x=[1,2,3].map(n=>n*2);',
      modes: [{ id: 'pretty', label: 'Beautify', fn: (s) => window.js_beautify(s, { indent_size: 2 }) }] }) },

    // ----- Encode
    { group: 'Encode & decode', id: 'base64', name: 'Base64', render: (el) => ioTool(el, {
      placeholder: 'Text or Base64',
      modes: [{ id: 'enc', label: 'Encode', fn: b64encode }, { id: 'dec', label: 'Decode', fn: (s) => { try { return b64decode(s); } catch (_) { throw new Error('Not valid Base64'); } } },
        { id: 'urlenc', label: 'Encode (URL-safe)', fn: (s) => b64url(enc.encode(s)) }] }) },
    { group: 'Encode & decode', id: 'url', name: 'URL encode / decode', render: (el) => ioTool(el, {
      placeholder: 'Text or URL',
      modes: [{ id: 'enc', label: 'Encode component', fn: encodeURIComponent }, { id: 'encuri', label: 'Encode full URL', fn: encodeURI },
        { id: 'dec', label: 'Decode', fn: (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (_) { throw new Error('Malformed percent-encoding'); } } }] }) },
    { group: 'Encode & decode', id: 'binary', name: 'Text ↔ binary / hex', render: (el) => ioTool(el, {
      placeholder: 'Text, or binary/hex to decode',
      modes: [
        { id: 'tobin', label: 'Text → binary', fn: (s) => [...enc.encode(s)].map((b) => b.toString(2).padStart(8, '0')).join(' ') },
        { id: 'frombin', label: 'Binary → text', fn: (s) => { const bits = s.replace(/[^01]/g, ''); if (bits.length % 8) throw new Error('Binary length must be a multiple of 8'); return dec.decode(Uint8Array.from(bits.match(/.{8}/g), (b) => parseInt(b, 2))); } },
        { id: 'tohex', label: 'Text → hex', fn: (s) => hex(enc.encode(s)) },
        { id: 'fromhex', label: 'Hex → text', fn: (s) => { const h = s.replace(/[^0-9a-f]/gi, ''); if (h.length % 2) throw new Error('Odd number of hex digits'); return dec.decode(Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16))); } },
      ] }) },
    { group: 'Encode & decode', id: 'img64', name: 'Image to Base64', render: (el) => {
      el.innerHTML = `<div class="wd-card wd-stack"><div class="wd-row"><button class="wd-btn wd-btn-primary" id="p">Choose image</button><div class="wd-muted wd-small" id="info"></div></div><div id="r"></div></div>`;
      el.querySelector('#p').onclick = async () => {
        try {
          const [f] = await wd.files.pick({ type: 'image' });
          if (!f) return;
          const blob = await (await fetch(f.url)).blob();
          const url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
          el.querySelector('#info').textContent = `${f.name} · ${wd.ui.formatBytes(f.size)} → ${wd.ui.formatBytes(url.length)} as text`;
          el.querySelector('#r').innerHTML = `<img src="${esc(url)}" style="max-height:160px;border-radius:8px"><div class="wd-row" style="margin:10px 0"><button class="wd-btn wd-btn-sm" data-c="data">Copy data URL</button><button class="wd-btn wd-btn-sm" data-c="raw">Copy Base64 only</button><button class="wd-btn wd-btn-sm" data-c="css">Copy CSS</button></div><textarea class="wd-input" readonly>${esc(url)}</textarea>`;
          el.querySelector('#r').onclick = (e) => { const c = e.target.dataset.c; if (c) copy(c === 'raw' ? url.split(',')[1] : c === 'css' ? `background-image: url("${url}");` : url); };
        } catch (e) { wd.ui.toast(e.message, 'error'); }
      };
    } },
    { group: 'Encode & decode', id: 'jwt', name: 'JWT decode & verify', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div><label class="wd-label">JWT</label><textarea class="wd-input" id="t" style="min-height:90px" placeholder="eyJhbGciOi…"></textarea></div>
      <div><label class="wd-label">Secret (optional, to verify HS256/384/512 signatures)</label><input class="wd-input" id="s"></div><div data-result></div></div>`, async (el) => {
      const t = el.querySelector('#t').value.trim(), secret = el.querySelector('#s').value, r = el.querySelector('[data-result]');
      if (!t) { r.innerHTML = ''; return; }
      const parts = t.split('.');
      if (parts.length !== 3) throw new Error('A JWT has three dot-separated parts');
      let header, payload;
      try { header = JSON.parse(b64urlDecode(parts[0])); payload = JSON.parse(b64urlDecode(parts[1])); } catch (_) { throw new Error('Header or payload is not valid Base64URL JSON'); }
      const times = ['iat', 'nbf', 'exp'].filter((k) => typeof payload[k] === 'number').map((k) => `${k}: ${new Date(payload[k] * 1000).toLocaleString()}`);
      const expired = typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
      let verify = '<span class="wd-badge">Enter the secret to verify</span>';
      if (secret) {
        const alg = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' }[header.alg];
        if (!alg) verify = `<span class="wd-badge wd-badge-amber">Only HS256/384/512 can be verified here (token uses ${esc(header.alg)})</span>`;
        else {
          const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: alg }, false, ['verify']);
          const ok = await crypto.subtle.verify('HMAC', key, b64urlBytes(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
          verify = ok ? '<span class="wd-badge wd-badge-green">Signature valid</span>' : '<span class="wd-badge wd-badge-red">Signature invalid</span>';
        }
      }
      r.innerHTML = `<div class="wd-row">${verify}${expired ? '<span class="wd-badge wd-badge-red">Expired</span>' : ''}</div>
        <label class="wd-label" style="margin-top:10px">Header</label><pre class="wd-log">${esc(JSON.stringify(header, null, 2))}</pre>
        <label class="wd-label">Payload</label><pre class="wd-log">${esc(JSON.stringify(payload, null, 2))}</pre>
        ${times.length ? `<div class="wd-small wd-muted">${esc(times.join(' · '))}</div>` : ''}`;
    }) },
    { group: 'Encode & decode', id: 'jwtgen', name: 'JWT generator', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields"><div><label class="wd-label">Algorithm</label><select class="wd-select" id="a"><option>HS256</option><option>HS384</option><option>HS512</option></select></div>
      <div><label class="wd-label">Secret</label><input class="wd-input" id="s" value="change-me"></div>
      <div><label class="wd-label">Expires in</label><select class="wd-select" id="e"><option value="0">Never</option><option value="3600" selected>1 hour</option><option value="86400">1 day</option><option value="604800">7 days</option></select></div></div>
      <div><label class="wd-label">Payload (JSON)</label><textarea class="wd-input" id="p" style="min-height:120px">{\n  "sub": "1234567890",\n  "name": "Ada Lovelace",\n  "admin": true\n}</textarea></div><div data-result></div></div>`, async (el) => {
      const alg = el.querySelector('#a').value, secret = el.querySelector('#s').value, exp = +el.querySelector('#e').value;
      let payload;
      try { payload = JSON.parse(el.querySelector('#p').value); } catch (_) { throw new Error('Payload must be valid JSON'); }
      const now = Math.floor(Date.now() / 1000);
      payload = { iat: now, ...(exp ? { exp: now + exp } : {}), ...payload };
      const head = b64url(enc.encode(JSON.stringify({ alg, typ: 'JWT' }))), body = b64url(enc.encode(JSON.stringify(payload)));
      const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-' + alg.slice(2) }, false, ['sign']);
      const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(head + '.' + body))));
      const token = `${head}.${body}.${sig}`;
      el.querySelector('[data-result]').innerHTML = `<label class="wd-label">Token</label><code class="wd-log" style="display:block">${esc(token)}</code><button class="wd-btn wd-btn-sm" data-copy="${esc(token)}" style="margin-top:8px">Copy token</button>`;
    }) },

    // ----- Generate
    { group: 'Generate', id: 'hash', name: 'Hash generator', render: (el) => {
      formTool(el, `<div class="wd-card wd-stack"><div><label class="wd-label">Text</label><textarea class="wd-input" id="t" style="min-height:90px" placeholder="Type or paste text"></textarea></div>
        <div class="wd-row"><button class="wd-btn wd-btn-sm" id="f">Hash a file instead…</button><span class="wd-small wd-muted" id="fn"></span></div><div data-result></div></div>`, async (el) => {
        if (el.dataset.file) return;
        const v = el.querySelector('#t').value;
        el.querySelector('[data-result]').innerHTML = kvRows(Object.entries(await hashes(enc.encode(v))));
      });
      el.querySelector('#f').onclick = async () => {
        try {
          const [f] = await wd.files.pick({});
          if (!f) return;
          el.dataset.file = '1';
          el.querySelector('#fn').textContent = `${f.name} (${wd.ui.formatBytes(f.size)})`;
          el.querySelector('[data-result]').innerHTML = '<div class="wd-muted">Hashing…</div>';
          const bytes = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
          el.querySelector('[data-result]').innerHTML = kvRows(Object.entries(await hashes(bytes)));
          delete el.dataset.file;
        } catch (e) { wd.ui.toast(e.message, 'error'); }
      };
    } },
    { group: 'Generate', id: 'uuid', name: 'UUID generator', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields"><div><label class="wd-label">Version</label><select class="wd-select" id="v"><option value="4">v4 (random)</option><option value="7">v7 (time-ordered)</option></select></div>
      <div><label class="wd-label">How many</label><input class="wd-input" id="n" type="number" min="1" max="500" value="5"></div>
      <div><label class="wd-label">Format</label><select class="wd-select" id="f"><option value="l">lowercase</option><option value="u">UPPERCASE</option><option value="b">{braces}</option><option value="n">no dashes</option></select></div></div>
      <div class="wd-row"><button class="wd-btn wd-btn-primary" id="go">Generate</button></div><div data-result></div></div>`, (el) => {
      const gen = (ver) => {
        if (ver === '4') return crypto.randomUUID();
        const b = crypto.getRandomValues(new Uint8Array(16));
        const ts = Date.now();
        for (let i = 0; i < 6; i++) b[i] = Math.floor(ts / 2 ** (8 * (5 - i))) & 255;
        b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
        const h = hex(b);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      };
      const fmt = { l: (s) => s, u: (s) => s.toUpperCase(), b: (s) => `{${s}}`, n: (s) => s.replace(/-/g, '') }[el.querySelector('#f').value];
      const list = Array.from({ length: Math.min(500, Math.max(1, +el.querySelector('#n').value || 1)) }, () => fmt(gen(el.querySelector('#v').value))).join('\n');
      el.querySelector('[data-result]').innerHTML = `<textarea class="wd-input" readonly>${esc(list)}</textarea><button class="wd-btn wd-btn-sm" data-copy="${esc(list)}" style="margin-top:8px">Copy all</button>`;
    }) },
    { group: 'Generate', id: 'password', name: 'Password generator', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div><label class="wd-label">Length: <span id="lv">20</span></label><input type="range" id="len" min="6" max="64" value="20"></div>
      <div class="wd-row wd-small"><label><input type="checkbox" id="lo" checked> a-z</label><label><input type="checkbox" id="up" checked> A-Z</label><label><input type="checkbox" id="di" checked> 0-9</label><label><input type="checkbox" id="sy" checked> Symbols</label><label><input type="checkbox" id="am"> Avoid look-alikes (Il1O0)</label></div>
      <div class="wd-row"><button class="wd-btn wd-btn-primary" id="go">New passwords</button></div><div data-result></div></div>`, (el) => {
      const len = +el.querySelector('#len').value;
      el.querySelector('#lv').textContent = len;
      let chars = (el.querySelector('#lo').checked ? 'abcdefghijklmnopqrstuvwxyz' : '') + (el.querySelector('#up').checked ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '') + (el.querySelector('#di').checked ? '0123456789' : '') + (el.querySelector('#sy').checked ? '!@#$%^&*()-_=+[]{};:,.?/' : '');
      if (el.querySelector('#am').checked) chars = chars.replace(/[Il1O0]/g, '');
      if (!chars) throw new Error('Pick at least one character set');
      const one = () => Array.from({ length: len }, () => chars[rand(chars.length)]).join('');
      const bits = Math.round(len * Math.log2(chars.length));
      const strength = bits >= 100 ? ['Very strong', 'green'] : bits >= 70 ? ['Strong', 'green'] : bits >= 50 ? ['Fair', 'amber'] : ['Weak', 'red'];
      el.querySelector('[data-result]').innerHTML = `<div class="wd-row"><span class="wd-badge wd-badge-${strength[1]}">${strength[0]} · ${bits} bits</span></div>` +
        Array.from({ length: 5 }, one).map((p) => `<div class="wd-item"><code class="wd-grow wd-mono" style="overflow-wrap:anywhere">${esc(p)}</code><button class="wd-btn wd-btn-sm" data-copy="${esc(p)}">Copy</button></div>`).join('');
    }) },
    { group: 'Generate', id: 'lorem', name: 'Lorem ipsum', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields"><div><label class="wd-label">Paragraphs</label><input class="wd-input" id="n" type="number" min="1" max="50" value="3"></div>
      <div><label class="wd-label">Start with "Lorem ipsum…"</label><select class="wd-select" id="s"><option value="1">Yes</option><option value="0">No</option></select></div></div>
      <div class="wd-row"><button class="wd-btn wd-btn-primary" id="go">Generate</button></div><div data-result></div></div>`, (el) => {
      const n = Math.min(50, Math.max(1, +el.querySelector('#n').value || 1));
      const paras = Array.from({ length: n }, () => Array.from({ length: 4 + rand(4) }, loremSentence).join(' '));
      if (el.querySelector('#s').value === '1') paras[0] = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' + paras[0];
      const text = paras.join('\n\n');
      el.querySelector('[data-result]').innerHTML = `<textarea class="wd-input" readonly style="min-height:200px;font-family:var(--wd-font)">${esc(text)}</textarea><button class="wd-btn wd-btn-sm" data-copy="${esc(text)}" style="margin-top:8px">Copy</button>`;
    }) },
    { group: 'Generate', id: 'qr', name: 'QR code generator', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields"><div><label class="wd-label">Type</label><select class="wd-select" id="k"><option value="text">URL or text</option><option value="wifi">Wi-Fi network</option><option value="email">Email</option><option value="tel">Phone</option></select></div>
      <div><label class="wd-label">Error correction</label><select class="wd-select" id="ec"><option value="L">Low</option><option value="M" selected>Medium</option><option value="Q">High</option><option value="H">Highest</option></select></div></div>
      <div id="fields"></div><div data-result></div></div>`, (el) => {
      const kind = el.querySelector('#k').value;
      const box = el.querySelector('#fields');
      if (box.dataset.kind !== kind) {
        box.dataset.kind = kind;
        box.innerHTML = {
          text: '<label class="wd-label">URL or text</label><textarea class="wd-input" id="q1" style="min-height:70px">https://example.com</textarea>',
          wifi: '<div class="wd-fields"><div><label class="wd-label">Network name</label><input class="wd-input" id="q1"></div><div><label class="wd-label">Password</label><input class="wd-input" id="q2"></div><div><label class="wd-label">Security</label><select class="wd-select" id="q3"><option>WPA</option><option>WEP</option><option value="nopass">None</option></select></div></div>',
          email: '<div class="wd-fields"><div><label class="wd-label">Email</label><input class="wd-input" id="q1"></div><div><label class="wd-label">Subject</label><input class="wd-input" id="q2"></div></div>',
          tel: '<label class="wd-label">Phone number</label><input class="wd-input" id="q1" placeholder="+1 555 123 4567">',
        }[kind];
      }
      const v = (id) => el.querySelector('#' + id)?.value || '';
      const wifiEsc = (s) => s.replace(/([\\;,:"])/g, '\\$1');
      const data = { text: v('q1'), wifi: `WIFI:T:${v('q3')};S:${wifiEsc(v('q1'))};P:${wifiEsc(v('q2'))};;`, email: `mailto:${v('q1')}${v('q2') ? '?subject=' + encodeURIComponent(v('q2')) : ''}`, tel: `tel:${v('q1').replace(/[^\d+]/g, '')}` }[kind];
      const r = el.querySelector('[data-result]');
      if (!v('q1')) { r.innerHTML = ''; return; }
      const qr = window.qrcode(0, el.querySelector('#ec').value);
      qr.addData(unescape(encodeURIComponent(data)), 'Byte');
      qr.make();
      const svg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
      r.innerHTML = `<div class="wd-row" style="align-items:flex-start"><div class="qr" style="width:220px">${svg}</div>
        <div class="wd-stack"><button class="wd-btn wd-btn-primary" id="png">Save PNG</button><button class="wd-btn" id="svg">Save SVG</button><div class="wd-small wd-muted">${qr.getModuleCount()}×${qr.getModuleCount()} modules</div></div></div>`;
      r.querySelector('#svg').onclick = async () => { const s = await wd.files.save({ name: 'qr-code.svg', text: qr.createSvgTag({ cellSize: 10, margin: 4 }) }); wd.ui.toast('Saved ' + s.name, 'ok'); wd.files.reveal(s.path); };
      r.querySelector('#png').onclick = async () => {
        const n = qr.getModuleCount(), cell = 16, m = 4, size = (n + m * 2) * cell;
        const cv = document.createElement('canvas'); cv.width = cv.height = size;
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); ctx.fillStyle = '#000';
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) ctx.fillRect((x + m) * cell, (y + m) * cell, cell, cell);
        const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
        const s = await wd.files.save({ name: 'qr-code.png', blob }); wd.ui.toast('Saved ' + s.name, 'ok'); wd.files.reveal(s.path);
      };
    }) },

    // ----- Convert
    { group: 'Convert', id: 'base', name: 'Number base converter', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields"><div><label class="wd-label">Number</label><input class="wd-input" id="n" value="255"></div>
      <div><label class="wd-label">Input base</label><select class="wd-select" id="b"><option value="10">Decimal</option><option value="2">Binary</option><option value="16">Hex</option><option value="8">Octal</option></select></div></div><div data-result></div></div>`, (el) => {
      const s = el.querySelector('#n').value.trim().replace(/^0[xbo]/i, '').replace(/[_\s]/g, ''), b = +el.querySelector('#b').value;
      if (!s) { el.querySelector('[data-result]').innerHTML = ''; return; }
      const digits = '0123456789abcdef'.slice(0, b);
      if (![...s.toLowerCase()].every((ch) => digits.includes(ch))) throw new Error(`“${s}” is not a valid base-${b} number`);
      const v = [...s.toLowerCase()].reduce((acc, ch) => acc * BigInt(b) + BigInt(digits.indexOf(ch)), 0n);
      el.querySelector('[data-result]').innerHTML = kvRows([['Decimal', v.toString(10)], ['Binary', v.toString(2)], ['Hex', v.toString(16).toUpperCase()], ['Octal', v.toString(8)]]);
    }) },
    { group: 'Convert', id: 'color', name: 'Color converter', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields"><div><label class="wd-label">Color (HEX, RGB, HSL or name)</label><input class="wd-input" id="c" value="#388bfd"></div>
      <div><label class="wd-label">Pick</label><input type="color" id="p" value="#388bfd" style="width:100%;height:38px;border:0;background:none"></div></div><div data-result></div></div>`, (el) => {
      const inp = el.querySelector('#c'), picker = el.querySelector('#p');
      if (document.activeElement === picker) inp.value = picker.value;
      const [r, g, b] = parseColor(inp.value);
      const hx = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
      picker.value = hx;
      const [h, s, l] = rgbToHsl(r, g, b);
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      el.querySelector('[data-result]').innerHTML = `<div class="swatch" style="background:${hx};color:${lum > 0.55 ? '#000' : '#fff'};display:grid;place-items:center;font-weight:700">${hx.toUpperCase()}</div>` +
        kvRows([['HEX', hx.toUpperCase()], ['RGB', `rgb(${r}, ${g}, ${b})`], ['HSL', `hsl(${h}, ${s}%, ${l}%)`], ['CSS rgba', `rgba(${r}, ${g}, ${b}, 1)`], ['Text on it', lum > 0.55 ? 'Use dark text' : 'Use light text']]);
    }) },
    { group: 'Convert', id: 'timestamp', name: 'Unix timestamp', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields"><div><label class="wd-label">Timestamp (seconds or milliseconds)</label><input class="wd-input" id="t"></div>
      <div><label class="wd-label">…or a date</label><input class="wd-input" id="d" type="datetime-local"></div></div>
      <div class="wd-row"><button class="wd-btn wd-btn-sm" id="now">Now</button></div><div data-result></div></div>`, (el) => {
      const t = el.querySelector('#t'), d = el.querySelector('#d');
      if (!t.value && !d.value) t.value = String(Math.floor(Date.now() / 1000));
      let date;
      if (document.activeElement === d && d.value) { date = new Date(d.value); t.value = String(Math.floor(date / 1000)); }
      else { const n = +t.value.trim(); if (!Number.isFinite(n)) throw new Error('Enter a number'); date = new Date(Math.abs(n) > 1e11 ? n : n * 1000); }
      if (isNaN(date)) throw new Error('Invalid date');
      const rel = Math.round((date - Date.now()) / 1000);
      const ago = Math.abs(rel) < 60 ? `${Math.abs(rel)} s` : Math.abs(rel) < 3600 ? `${Math.round(Math.abs(rel) / 60)} min` : Math.abs(rel) < 86400 ? `${Math.round(Math.abs(rel) / 3600)} h` : `${Math.round(Math.abs(rel) / 86400)} days`;
      el.querySelector('[data-result]').innerHTML = kvRows([['Local', date.toLocaleString()], ['UTC', date.toUTCString()], ['ISO 8601', date.toISOString()], ['Seconds', String(Math.floor(date / 1000))], ['Milliseconds', String(+date)], ['Relative', rel < 0 ? `${ago} ago` : `in ${ago}`]]);
    }) },
    { group: 'Convert', id: 'timezone', name: 'Time zone converter', render: (el) => {
      const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo']);
      const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const opts = (sel) => zones.map((z) => `<option ${z === sel ? 'selected' : ''}>${z}</option>`).join('');
      formTool(el, `<div class="wd-card wd-stack"><div class="wd-fields"><div><label class="wd-label">Date & time</label><input class="wd-input" id="d" type="datetime-local"></div>
        <div><label class="wd-label">From zone</label><select class="wd-select" id="f">${opts(here)}</select></div>
        <div><label class="wd-label">Show in (comma list)</label><input class="wd-input" id="to" value="UTC, America/New_York, Europe/London, Asia/Kolkata, Asia/Tokyo"></div></div><div data-result></div></div>`, (el2) => {
        const d = el2.querySelector('#d');
        if (!d.value) { const n = new Date(); n.setSeconds(0, 0); d.value = new Date(n - n.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
        const from = el2.querySelector('#f').value;
        // Interpret the wall-clock time in the "from" zone.
        const [datePart, timePart] = d.value.split('T');
        const guess = new Date(`${datePart}T${timePart}:00Z`);
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: from, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess).map((p) => [p.type, p.value]));
        const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
        const instant = new Date(+guess - (asIfUtc - +guess));
        const list = el2.querySelector('#to').value.split(',').map((s) => s.trim()).filter(Boolean);
        el2.querySelector('[data-result]').innerHTML = kvRows(list.map((z) => {
          try { return [z, instant.toLocaleString(undefined, { timeZone: z, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })]; } catch (_) { return [z, 'Unknown time zone']; }
        }));
      });
    } },
    { group: 'Convert', id: 'case', name: 'Text case converter', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div><label class="wd-label">Text</label><input class="wd-input" id="t" value="hello world fooBar baz_qux"></div><div data-result></div></div>`, (el) => {
      const w = words(el.querySelector('#t').value);
      el.querySelector('[data-result]').innerHTML = w.length ? kvRows(Object.entries(CASES).map(([k, f]) => [k, f(w)])) : '';
    }) },

    // ----- Text
    { group: 'Text', id: 'count', name: 'Word counter', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><textarea class="wd-input" id="t" style="min-height:200px;font-family:var(--wd-font);font-size:14px" placeholder="Paste or type text…"></textarea><div data-result></div></div>`, (el) => {
      const t = el.querySelector('#t').value;
      const wordsN = (t.match(/\S+/g) || []).length;
      const stats = [
        ['Words', wordsN], ['Characters', [...t].length], ['Characters (no spaces)', [...t.replace(/\s/g, '')].length],
        ['Sentences', (t.match(/[^.!?]+[.!?]+(\s|$)/g) || []).length || (t.trim() ? 1 : 0)], ['Paragraphs', t.split(/\n\s*\n/).filter((p) => p.trim()).length],
        ['Lines', t ? t.split('\n').length : 0], ['Reading time', `${Math.max(t.trim() ? 1 : 0, Math.round(wordsN / 230))} min`], ['Speaking time', `${Math.max(t.trim() ? 1 : 0, Math.round(wordsN / 140))} min`],
      ];
      el.querySelector('[data-result]').innerHTML = `<div class="wd-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${stats.map(([k, v]) => `<div class="wd-card" style="padding:10px 12px"><div class="wd-small wd-muted">${k}</div><b style="font-size:20px">${typeof v === 'number' ? v.toLocaleString() : v}</b></div>`).join('')}</div>`;
    }) },
    { group: 'Text', id: 'regex', name: 'Regex tester', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields"><div style="grid-column:span 2"><label class="wd-label">Pattern</label><input class="wd-input wd-mono" id="p" value="(\\w+)@(\\w+)\\.com"></div>
      <div><label class="wd-label">Flags</label><input class="wd-input wd-mono" id="f" value="gi"></div></div>
      <div><label class="wd-label">Test text</label><textarea class="wd-input" id="t" style="min-height:120px">Contact ada@example.com or grace@navy.com for details.</textarea></div><div data-result></div></div>`, (el) => {
      const p = el.querySelector('#p').value, f = el.querySelector('#f').value, t = el.querySelector('#t').value;
      if (!p) { el.querySelector('[data-result]').innerHTML = ''; return; }
      let re;
      try { re = new RegExp(p, f.includes('g') ? f : f + 'g'); } catch (e) { throw new Error(e.message); }
      const matches = [...t.matchAll(re)].slice(0, 500);
      let html = '', last = 0;
      for (const m of matches) { html += esc(t.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`; last = m.index + m[0].length; if (!m[0].length) break; }
      html += esc(t.slice(last));
      el.querySelector('[data-result]').innerHTML = `<div class="wd-row"><span class="wd-badge ${matches.length ? 'wd-badge-green' : ''}">${matches.length} match${matches.length === 1 ? '' : 'es'}</span></div>
        <div class="wd-log" style="white-space:pre-wrap;color:var(--wd-text);margin-top:8px">${html}</div>
        ${matches.length ? `<table class="wd-table" style="margin-top:8px"><tr><th>#</th><th>Match</th><th>Index</th><th>Groups</th></tr>${matches.slice(0, 50).map((m, i) => `<tr><td>${i + 1}</td><td><code>${esc(m[0])}</code></td><td>${m.index}</td><td>${m.slice(1).map((g) => `<code>${esc(g ?? '')}</code>`).join(' ')}</td></tr>`).join('')}</table>` : ''}`;
    }) },
    { group: 'Text', id: 'cron', name: 'Cron explainer', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div><label class="wd-label">Cron expression (minute hour day month weekday)</label><input class="wd-input wd-mono" id="c" value="30 9 * * 1-5"></div>
      <div class="wd-row wd-small">${['*/15 * * * *', '0 0 * * *', '0 9 1 * *', '0 18 * * 5', '0 */6 * * *'].map((x) => `<button class="wd-chip" data-ex="${x}">${x}</button>`).join('')}</div><div data-result></div></div>`, (el) => {
      el.querySelectorAll('[data-ex]').forEach((b) => (b.onclick = () => { el.querySelector('#c').value = b.dataset.ex; el.dispatchEvent(new Event('input')); }));
      el.querySelector('[data-result]').innerHTML = `<div class="wd-card" style="font-size:16px">🕒 ${esc(explainCron(el.querySelector('#c').value))}</div>`;
    }) },

    // ----- CSS
    { group: 'CSS generators', id: 'glass', name: 'Glassmorphism', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields">
        <div><label class="wd-label">Blur: <span id="bv"></span>px</label><input type="range" id="b" min="0" max="40" value="12"></div>
        <div><label class="wd-label">Transparency: <span id="ov"></span>%</label><input type="range" id="o" min="0" max="100" value="22"></div>
        <div><label class="wd-label">Color</label><input type="color" id="c" value="#ffffff" style="width:100%;height:36px;border:0;background:none"></div>
        <div><label class="wd-label">Radius: <span id="rv"></span>px</label><input type="range" id="r" min="0" max="48" value="18"></div></div>
      <div class="preview-stage" style="background:linear-gradient(135deg,#f97316,#8b5cf6 50%,#06b6d4)"><div id="pv" style="width:260px;height:150px;display:grid;place-items:center;color:#fff;font-weight:700">Glass card</div></div><div data-result></div></div>`, (el) => {
      const b = el.querySelector('#b').value, o = el.querySelector('#o').value, r = el.querySelector('#r').value, rgbv = hexToRgb(el.querySelector('#c').value).join(', ');
      el.querySelector('#bv').textContent = b; el.querySelector('#ov').textContent = o; el.querySelector('#rv').textContent = r;
      const css = `background: rgba(${rgbv}, ${(o / 100).toFixed(2)});\nborder-radius: ${r}px;\nbox-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);\nbackdrop-filter: blur(${b}px);\n-webkit-backdrop-filter: blur(${b}px);\nborder: 1px solid rgba(${rgbv}, 0.3);`;
      el.querySelector('#pv').style.cssText += ';' + css.replace(/\n/g, '');
      el.querySelector('[data-result]').innerHTML = `<pre class="wd-log" style="color:var(--wd-text)">${esc(css)}</pre><button class="wd-btn wd-btn-sm" data-copy="${esc(css)}">Copy CSS</button>`;
    }) },
    { group: 'CSS generators', id: 'neu', name: 'Neumorphism', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields">
        <div><label class="wd-label">Base color</label><input type="color" id="c" value="#e0e5ec" style="width:100%;height:36px;border:0;background:none"></div>
        <div><label class="wd-label">Distance: <span id="dv"></span>px</label><input type="range" id="d" min="2" max="40" value="12"></div>
        <div><label class="wd-label">Shadow strength: <span id="iv"></span>%</label><input type="range" id="i" min="5" max="40" value="15"></div>
        <div><label class="wd-label">Shape</label><select class="wd-select" id="s"><option value="flat">Raised</option><option value="pressed">Pressed</option></select></div></div>
      <div class="preview-stage" id="stage"><div id="pv" style="width:180px;height:180px;border-radius:28px"></div></div><div data-result></div></div>`, (el) => {
      const hx = el.querySelector('#c').value, d = +el.querySelector('#d').value, i = +el.querySelector('#i').value / 100, pressed = el.querySelector('#s').value === 'pressed';
      el.querySelector('#dv').textContent = d; el.querySelector('#iv').textContent = Math.round(i * 100);
      const shade = (amt) => '#' + hexToRgb(hx).map((v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt))).toString(16).padStart(2, '0')).join('');
      const dark = shade(-i), light = shade(i);
      const shadow = `${pressed ? 'inset ' : ''}${d}px ${d}px ${d * 2}px ${dark}, ${pressed ? 'inset ' : ''}-${d}px -${d}px ${d * 2}px ${light}`;
      const css = `border-radius: 28px;\nbackground: ${hx};\nbox-shadow: ${shadow};`;
      el.querySelector('#stage').style.background = hx;
      el.querySelector('#pv').style.background = hx;
      el.querySelector('#pv').style.boxShadow = shadow;
      el.querySelector('[data-result]').innerHTML = `<pre class="wd-log" style="color:var(--wd-text)">${esc(css)}</pre><button class="wd-btn wd-btn-sm" data-copy="${esc(css)}">Copy CSS</button>`;
    }) },
    { group: 'CSS generators', id: 'gradient', name: 'Gradient', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields">
        <div><label class="wd-label">From</label><input type="color" id="a" value="#8b5cf6" style="width:100%;height:36px;border:0;background:none"></div>
        <div><label class="wd-label">To</label><input type="color" id="b" value="#06b6d4" style="width:100%;height:36px;border:0;background:none"></div>
        <div><label class="wd-label">Type</label><select class="wd-select" id="t"><option value="linear">Linear</option><option value="radial">Radial</option><option value="conic">Conic</option></select></div>
        <div><label class="wd-label">Angle: <span id="av"></span>°</label><input type="range" id="g" min="0" max="360" value="135"></div></div>
      <div class="preview-stage" id="pv"></div><div data-result></div></div>`, (el) => {
      const a = el.querySelector('#a').value, b = el.querySelector('#b').value, t = el.querySelector('#t').value, g = el.querySelector('#g').value;
      el.querySelector('#av').textContent = g;
      const css = t === 'linear' ? `linear-gradient(${g}deg, ${a}, ${b})` : t === 'radial' ? `radial-gradient(circle, ${a}, ${b})` : `conic-gradient(from ${g}deg, ${a}, ${b}, ${a})`;
      el.querySelector('#pv').style.background = css;
      el.querySelector('[data-result]').innerHTML = `<pre class="wd-log" style="color:var(--wd-text)">background: ${esc(css)};</pre><button class="wd-btn wd-btn-sm" data-copy="background: ${esc(css)};">Copy CSS</button>`;
    }) },
    { group: 'CSS generators', id: 'blob', name: 'SVG blob', render: (el) => formTool(el, `
      <div class="wd-card wd-stack"><div class="wd-fields">
        <div><label class="wd-label">Points: <span id="nv"></span></label><input type="range" id="n" min="3" max="12" value="6"></div>
        <div><label class="wd-label">Randomness: <span id="rv"></span>%</label><input type="range" id="r" min="0" max="60" value="30"></div>
        <div><label class="wd-label">Color</label><input type="color" id="c" value="#388bfd" style="width:100%;height:36px;border:0;background:none"></div></div>
      <div class="wd-row"><button class="wd-btn wd-btn-primary" id="go">New shape</button><button class="wd-btn" id="sv">Save SVG</button></div>
      <div class="preview-stage" id="pv"></div><div data-result></div></div>`, (el) => {
      const n = +el.querySelector('#n').value, r = +el.querySelector('#r').value / 100, c = el.querySelector('#c').value;
      el.querySelector('#nv').textContent = n; el.querySelector('#rv').textContent = Math.round(r * 100);
      const pts = Array.from({ length: n }, (_, i) => { const ang = (i / n) * Math.PI * 2, rad = 80 * (1 - r / 2 + Math.random() * r); return [100 + Math.cos(ang) * rad, 100 + Math.sin(ang) * rad]; });
      // Smooth closed Catmull-Rom → cubic Bézier
      let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
      for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${c1.map((v) => v.toFixed(1)).join(',')} ${c2.map((v) => v.toFixed(1)).join(',')} ${p2.map((v) => v.toFixed(1)).join(',')}`;
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="240" height="240"><path fill="${c}" d="${d} Z"/></svg>`;
      el.querySelector('#pv').innerHTML = svg;
      el.querySelector('#sv').onclick = async () => { const s = await wd.files.save({ name: 'blob.svg', text: svg }); wd.ui.toast('Saved ' + s.name, 'ok'); };
      el.querySelector('[data-result]').innerHTML = `<pre class="wd-log" style="color:var(--wd-text)">${esc(svg)}</pre><button class="wd-btn wd-btn-sm" data-copy="${esc(svg)}">Copy SVG</button>`;
    }) },
  ];

  // ----------------------------------------------------------------- shell
  function renderList(filter = '') {
    const q = filter.toLowerCase();
    const shown = tools.filter((t) => !q || t.name.toLowerCase().includes(q) || t.group.toLowerCase().includes(q));
    const groups = [...new Set(shown.map((t) => t.group))];
    $('list').innerHTML = groups.map((g) => `<div class="wd-group">${esc(g)}</div>` + shown.filter((t) => t.group === g).map((t) => `<button data-tool="${t.id}">${esc(t.name)}</button>`).join('')).join('') || '<div class="wd-small wd-muted" style="padding:8px">No tools match.</div>';
    highlight();
  }
  let current = null;
  function highlight() { document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tool === current))); }
  function open(id) {
    const t = tools.find((x) => x.id === id) || tools[0];
    current = t.id;
    const host = document.createElement('div');
    $('main').replaceChildren(host);
    host.insertAdjacentHTML('beforebegin', `<h2 style="margin:0 0 12px">${esc(t.name)}</h2>`);
    t.render(host);
    highlight();
    try { localStorage.setItem('devkit-tool', t.id); } catch (_) {}
  }
  $('list').onclick = (e) => { const id = e.target.closest('[data-tool]')?.dataset.tool; if (id) open(id); };
  $('search').oninput = (e) => renderList(e.target.value);
  renderList();
  let first = 'json';
  try { first = localStorage.getItem('devkit-tool') || first; } catch (_) {}
  open(first);
})();
