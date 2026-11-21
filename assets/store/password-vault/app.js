/*
 * Password Vault: logins, cards, bank accounts, PINs and notes, encrypted on-device.
 *
 * Crypto: master key → PBKDF2-SHA256 (310k rounds) → key-encryption key, which wraps a random
 * 256-bit vault key (AES-GCM). Every entry is stored as one AES-GCM blob encrypted with the
 * vault key, so titles, fields and links never touch storage in plain text. Fingerprint unlock
 * keeps a copy of the vault key in WebDeck's per-app secret store, released only after the
 * system biometric prompt succeeds.
 */
(function () {
  'use strict';
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => wd.ui.escape(s);
  const te = new TextEncoder();
  const td = new TextDecoder();

  const KDF_ITER = 310000;
  const CHECK = 'webdeck-password-vault';
  const BIO_KEY = 'vault-key';

  const TYPES = {
    login: { label: 'Login', plural: 'Logins', icon: '🔑', fields: [
      ['url', 'Website / app', 'text'], ['username', 'Username / email / phone', 'text'], ['password', 'Password', 'secret']] },
    card: { label: 'Card', plural: 'Cards', icon: '💳', fields: [
      ['bank', 'Bank / issuer', 'text'], ['holder', 'Name on card', 'text'], ['number', 'Card number', 'secret'],
      ['expiry', 'Expiry (MM/YY)', 'text'], ['cvv', 'CVV', 'secret'], ['pin', 'Card PIN', 'secret']] },
    bank: { label: 'Bank account', plural: 'Bank accounts', icon: '🏦', fields: [
      ['bank', 'Bank name', 'text'], ['holder', 'Account holder', 'text'], ['account', 'Account number', 'secret'],
      ['ifsc', 'IFSC / routing / sort code', 'text'], ['swift', 'SWIFT / BIC', 'text'], ['branch', 'Branch', 'text']] },
    pin: { label: 'PIN', plural: 'PINs', icon: '🔢', fields: [['pin', 'PIN / passcode', 'secret']] },
    note: { label: 'Secure note', plural: 'Notes', icon: '📝', fields: [] },
  };
  // Suggestions for "what is the other entry to this one" when linking.
  const ROLES = ['App login', 'Net banking', 'App PIN', 'Bank PIN', 'UPI PIN', 'Card', 'Card PIN', 'Bank account', 'Email', 'Recovery', 'Related'];

  // ------------------------------------------------------------------ state
  let meta = null;          // kv 'meta': { v, kind, salt, iter, wrapped, check }
  let vaultKey = null;      // CryptoKey while unlocked
  let vaultRaw = null;      // Uint8Array while unlocked (needed to re-wrap / enable fingerprint)
  let items = new Map();    // id → decrypted entry
  let filter = 'all';
  let selected = null;
  let bioAvailable = false;
  let bioEnabled = false;
  let autolockMin = 5;
  let idleTimer = null;
  let hiddenAt = 0;
  const shown = new Set();  // "id:field" revealed in the detail pane

  // ----------------------------------------------------------------- crypto
  const b64 = (buf) => {
    const a = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

  async function deriveKek(secret, salt, iter) {
    const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const importAes = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function seal(key, bytes) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function open(key, box) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct)));
  }
  const sealJson = async (key, obj) => seal(key, te.encode(JSON.stringify(obj)));
  const openJson = async (key, box) => JSON.parse(td.decode(await open(key, box)));

  /** Wraps raw vault-key bytes under a new master key. */
  async function wrapUnder(secret, raw) {
    const salt = rand(16);
    const kek = await deriveKek(secret, salt, KDF_ITER);
    return { salt: b64(salt), iter: KDF_ITER, wrapped: await seal(kek, raw) };
  }

  /** Throws when [raw] is not this vault's key. */
  async function adoptKey(raw) {
    const key = await importAes(raw);
    if (td.decode(await open(key, meta.check)) !== CHECK) throw new Error('bad key');
    vaultKey = key;
    vaultRaw = raw;
  }

  // ---------------------------------------------------------------- storage
  const col = wd.db.collection('items');

  async function loadItems() {
    items = new Map();
    const docs = await col.find(null, {});
    for (const d of docs) {
      try {
        const e = await openJson(vaultKey, d.box);
        e.id = d._id;
        items.set(d._id, e);
      } catch (_) { /* corrupt entry: skip rather than lock the user out */ }
    }
  }

  async function persist(entry) {
    const { id, ...data } = entry;
    data.updated = Date.now();
    const box = await sealJson(vaultKey, data);
    if (id && items.has(id)) {
      await col.update(id, { box });
      items.set(id, Object.assign(data, { id }));
      return id;
    }
    const doc = await col.insert({ box });
    items.set(doc._id, Object.assign(data, { id: doc._id }));
    return doc._id;
  }

  async function removeEntry(id) {
    const e = items.get(id);
    if (!e) return;
    for (const l of e.links || []) {
      const other = items.get(l.id);
      if (other) {
        other.links = (other.links || []).filter((x) => x.id !== id);
        await persist(other);
      }
    }
    await col.remove(id);
    items.delete(id);
  }

  async function link(aId, bId, roleOfB) {
    const a = items.get(aId);
    const b = items.get(bId);
    if (!a || !b || aId === bId) return;
    const roleOfA = TYPES[a.type].label;
    a.links = (a.links || []).filter((l) => l.id !== bId).concat({ id: bId, role: roleOfB || TYPES[b.type].label });
    b.links = (b.links || []).filter((l) => l.id !== aId).concat({ id: aId, role: roleOfA });
    await persist(a);
    await persist(b);
  }

  async function unlink(aId, bId) {
    for (const [x, y] of [[aId, bId], [bId, aId]]) {
      const e = items.get(x);
      if (!e) continue;
      e.links = (e.links || []).filter((l) => l.id !== y);
      await persist(e);
    }
  }

  /** Everything reachable through links, excluding [id] itself. */
  function group(id) {
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const e = items.get(queue.shift());
      for (const l of (e && e.links) || []) {
        if (!seen.has(l.id) && items.has(l.id)) { seen.add(l.id); queue.push(l.id); }
      }
    }
    seen.delete(id);
    return [...seen].map((x) => items.get(x));
  }

  // ------------------------------------------------------------- lock state
  function show(which) {
    for (const s of ['setup', 'lock', 'main']) $(s).hidden = s !== which;
  }

  function lock() {
    vaultKey = null;
    if (vaultRaw) vaultRaw.fill(0);
    vaultRaw = null;
    items = new Map();
    selected = null;
    shown.clear();
    closeModal();
    $('list').innerHTML = '';
    $('detail').innerHTML = '';
    clearTimeout(idleTimer);
    showLock();
  }

  function showLock() {
    show('lock');
    const pin = meta.kind === 'pin';
    $('lockKey').value = '';
    $('lockKey').inputMode = pin ? 'numeric' : 'text';
    $('lockKey').placeholder = pin ? 'Master PIN' : 'Master password';
    $('lockHint').textContent = pin ? 'Enter your master PIN to unlock' : 'Enter your master password to unlock';
    $('bioBtn').hidden = !(bioAvailable && bioEnabled);
    $('lockErr').textContent = '';
    if (bioAvailable && bioEnabled) unlockWithBio();
    else setTimeout(() => $('lockKey').focus(), 50);
  }

  async function afterUnlock() {
    await wd.kv.set('fails', null);
    await loadItems();
    show('main');
    render();
    bumpIdle();
  }

  function bumpIdle() {
    clearTimeout(idleTimer);
    if (!vaultKey || !autolockMin) return;
    idleTimer = setTimeout(lock, autolockMin * 60000);
  }
  ['pointerdown', 'keydown', 'scroll'].forEach((ev) => document.addEventListener(ev, bumpIdle, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    // Coming back after the auto-lock time (or after 1 min when auto-lock is off) locks the vault.
    const limit = (autolockMin || 1) * 60000;
    if (vaultKey && hiddenAt && Date.now() - hiddenAt > limit) lock();
  });

  // ------------------------------------------------------------------ setup
  let setupKind = 'pin';
  $('setupKind').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    setupKind = b.dataset.kind;
    for (const x of $('setupKind').children) x.classList.toggle('on', x === b);
    const pin = setupKind === 'pin';
    for (const id of ['setupKey', 'setupKey2']) $(id).inputMode = pin ? 'numeric' : 'text';
    $('setupKey').placeholder = pin ? 'New PIN (at least 6 digits)' : 'New password (at least 8 characters)';
    $('setupKey2').placeholder = pin ? 'Repeat PIN' : 'Repeat password';
  });

  function keyProblem(kind, k) {
    if (kind === 'pin') return /^\d{6,}$/.test(k) ? '' : 'PIN must be at least 6 digits.';
    return k.length >= 8 ? '' : 'Password must be at least 8 characters.';
  }

  $('setupForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const k = $('setupKey').value;
    const problem = keyProblem(setupKind, k) || (k !== $('setupKey2').value ? 'The two entries do not match.' : '');
    $('setupErr').textContent = problem;
    if (problem) return;
    const raw = rand(32);
    const key = await importAes(raw);
    meta = Object.assign({ v: 1, kind: setupKind, check: await seal(key, te.encode(CHECK)) }, await wrapUnder(k, raw));
    await wd.kv.set('meta', meta);
    vaultKey = key;
    vaultRaw = raw;
    if (bioAvailable && $('setupBio').checked) await enableBio(true);
    await afterUnlock();
    wd.ui.toast('Vault created', 'ok');
  });

  // ------------------------------------------------------------------ unlock
  async function failDelay() {
    const f = await wd.kv.get('fails', { n: 0, until: 0 });
    return Math.max(0, (f.until || 0) - Date.now());
  }

  $('lockForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const wait = await failDelay();
    if (wait > 0) { $('lockErr').textContent = `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`; return; }
    const k = $('lockKey').value;
    if (!k) return;
    $('lockBtn').disabled = true;
    $('lockErr').textContent = '';
    try {
      const kek = await deriveKek(k, unb64(meta.salt), meta.iter);
      await adoptKey(await open(kek, meta.wrapped));
      await afterUnlock();
    } catch (_) {
      const f = await wd.kv.get('fails', { n: 0, until: 0 });
      f.n = (f.n || 0) + 1;
      // After 5 wrong tries: 30s, 60s, 120s… (max 1h).
      f.until = f.n >= 5 ? Date.now() + Math.min(3600, 30 * 2 ** (f.n - 5)) * 1000 : 0;
      await wd.kv.set('fails', f);
      $('lockErr').textContent = f.until ? `Wrong key. Locked for ${Math.round((f.until - Date.now()) / 1000)}s.` : 'Wrong key. Try again.';
      $('lockKey').select();
    } finally {
      $('lockBtn').disabled = false;
    }
  });

  let bioBusy = false;
  async function unlockWithBio() {
    if (bioBusy) return;
    bioBusy = true;
    $('lockErr').textContent = '';
    try {
      const v = await wd.auth.getSecret(BIO_KEY, 'Unlock Password Vault');
      if (!v) throw Object.assign(new Error('Fingerprint unlock is not set up. Use your master key.'), { code: 'missing' });
      await adoptKey(unb64(v));
      await afterUnlock();
    } catch (e) {
      if (e.code !== 'cancelled') $('lockErr').textContent = e.code === 'missing' ? e.message : 'Fingerprint unlock failed. Use your master key.';
      setTimeout(() => $('lockKey').focus(), 50);
    } finally {
      bioBusy = false;
    }
  }
  $('bioBtn').addEventListener('click', unlockWithBio);

  async function enableBio(on) {
    try {
      if (on) await wd.auth.setSecret(BIO_KEY, b64(vaultRaw), 'Turn on fingerprint unlock for Password Vault');
      else await wd.auth.setSecret(BIO_KEY, null);
      bioEnabled = on;
      await wd.kv.set('bio', on);
      return true;
    } catch (e) {
      wd.ui.toast(e.code === 'cancelled' ? 'Fingerprint was not confirmed' : 'Could not change fingerprint unlock: ' + e.message, 'error');
      return false;
    }
  }

  // ------------------------------------------------------------------ render
  const sorted = () => [...items.values()].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || a.title.localeCompare(b.title));
  const last4 = (s) => (s || '').replace(/\s+/g, '').slice(-4);

  function subtitle(e) {
    const f = e.fields || {};
    switch (e.type) {
      case 'login': return f.username || f.url || '';
      case 'card': return [f.bank, f.number ? '•••• ' + last4(f.number) : ''].filter(Boolean).join(' · ');
      case 'bank': return [f.bank, f.account ? '•••• ' + last4(f.account) : ''].filter(Boolean).join(' · ');
      case 'pin': {
        const owner = (e.links || []).map((l) => items.get(l.id)).find(Boolean);
        return owner ? 'for ' + owner.title : 'PIN';
      }
      default: return (e.notes || '').split('\n')[0].slice(0, 60);
    }
  }

  function matches(e, q) {
    if (!q) return true;
    const f = e.fields || {};
    const hay = [e.title, e.notes, f.url, f.username, f.bank, f.holder, f.branch,
      ...(e.custom || []).filter((c) => !c.secret).map((c) => c.label + ' ' + c.value)].join(' ').toLowerCase();
    return hay.includes(q);
  }

  function renderChips() {
    const counts = { all: items.size };
    for (const e of items.values()) counts[e.type] = (counts[e.type] || 0) + 1;
    const keys = ['all', ...Object.keys(TYPES).filter((t) => counts[t])];
    if (!keys.includes(filter)) filter = 'all';
    $('chips').innerHTML = keys.map((k) => `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${
      k === 'all' ? 'All' : TYPES[k].icon + ' ' + TYPES[k].plural} <span class="wd-muted">${counts[k]}</span></button>`).join('');
  }

  function renderList() {
    const q = $('search').value.trim().toLowerCase();
    const list = sorted().filter((e) => (filter === 'all' || e.type === filter) && matches(e, q));
    if (!items.size) {
      $('list').innerHTML = `<div class="wd-empty">Your vault is empty.<br><br><button class="wd-btn wd-btn-primary" data-act="add">+ Add your first entry</button></div>`;
      return;
    }
    if (!list.length) { $('list').innerHTML = '<div class="wd-empty">Nothing matches.</div>'; return; }
    $('list').innerHTML = list.map((e) => `
      <button class="row ${e.id === selected ? 'on' : ''}" data-id="${e.id}">
        <span class="tico">${TYPES[e.type].icon}</span>
        <span class="wd-grow"><div class="t wd-ellipsis">${e.fav ? '★ ' : ''}${esc(e.title)}</div><div class="s wd-ellipsis">${esc(subtitle(e))}</div></span>
        ${(e.links || []).length ? `<span class="lnk" title="Linked entries">🔗 ${e.links.length}</span>` : ''}
      </button>`).join('');
  }

  function fieldRow(id, key, label, value, secret, mono = true) {
    if (!value) return '';
    const open = !secret || shown.has(id + ':' + key);
    const display = open ? esc(value) : '•'.repeat(Math.min(12, Math.max(6, value.length)));
    return `<div class="field">
      <div class="wd-grow"><div class="lbl">${esc(label)}</div><div class="val" style="${mono ? '' : 'font-family:inherit'}">${display}</div></div>
      ${secret ? `<button class="ib" data-act="reveal" data-k="${esc(key)}" title="${open ? 'Hide' : 'Show'}">${open ? '🙈' : '👁'}</button>` : ''}
      <button class="ib" data-act="copy" data-k="${esc(key)}" title="Copy">⧉</button>
    </div>`;
  }

  function valueOf(e, key) {
    if (key === 'notes') return e.notes;
    if (key.startsWith('c:')) return ((e.custom || [])[+key.slice(2)] || {}).value;
    return (e.fields || {})[key];
  }

  function renderDetail() {
    const layout = $('layout');
    const e = items.get(selected);
    layout.classList.toggle('showing', !!e);
    if (!e) {
      $('detail').innerHTML = `<div class="empty-detail"><div style="font-size:40px">🔐</div><p>Select an entry to see its details.</p>
        <p class="wd-small" style="margin-top:8px">Tip: link a bank account to its app login, net-banking password, debit card and card PIN so they always show up together.</p></div>`;
      return;
    }
    const t = TYPES[e.type];
    const f = e.fields || {};
    let rows = t.fields.map(([k, label, kind]) => fieldRow(e.id, k, label, f[k], kind === 'secret')).join('');
    rows += (e.custom || []).map((c, i) => fieldRow(e.id, 'c:' + i, c.label || 'Field', c.value, !!c.secret)).join('');
    rows += fieldRow(e.id, 'notes', 'Notes', e.notes, false, false);
    const direct = (e.links || []).map((l) => ({ l, o: items.get(l.id) })).filter((x) => x.o);
    const directIds = new Set(direct.map((x) => x.o.id));
    const indirect = group(e.id).filter((o) => !directIds.has(o.id));
    const linkRow = (o, role, removable) => `
      <div class="link-row" data-open="${o.id}">
        <span class="tico">${TYPES[o.type].icon}</span>
        <span class="wd-grow">${role ? `<div class="role">${esc(role)}</div>` : ''}<div class="wd-ellipsis"><b>${esc(o.title)}</b></div><div class="wd-small wd-muted wd-ellipsis">${esc(subtitle(o))}</div></span>
        ${removable ? `<button class="ib" data-act="unlink" data-id="${o.id}" title="Remove link">✕</button>` : ''}
      </div>`;
    $('detail').innerHTML = `
      <button class="wd-btn wd-btn-ghost wd-btn-sm back" data-act="back" style="margin-bottom:10px">← Back</button>
      <div class="dhead">
        <span class="tico">${t.icon}</span>
        <div class="wd-grow"><h2 class="wd-ellipsis">${esc(e.title)}</h2><div class="wd-small wd-muted">${t.label} · updated ${wd.ui.timeAgo(new Date(e.updated).toISOString())}</div></div>
        <button class="ib" data-act="fav" title="Favorite">${e.fav ? '★' : '☆'}</button>
        <button class="ib" data-act="edit" title="Edit">✎</button>
      </div>
      <div>${rows || '<p class="wd-muted">No details yet. Tap ✎ to add some.</p>'}</div>
      <div class="sect">
        <h3>🔗 Linked <span class="wd-spacer"></span><button class="wd-btn wd-btn-sm" data-act="link">+ Link</button></h3>
        ${direct.length ? direct.map((x) => linkRow(x.o, x.l.role, true)).join('') : '<p class="wd-small wd-muted">Nothing linked yet. Link related entries, e.g. this account’s app login, card and PINs.</p>'}
      </div>
      ${indirect.length ? `<div class="sect"><h3>Also in this group</h3>${indirect.map((o) => linkRow(o, '', false)).join('')}</div>` : ''}
      <div class="actions" style="justify-content:flex-start;margin-top:22px">
        <button class="wd-btn wd-btn-danger wd-btn-sm" data-act="delete">Delete</button>
      </div>`;
  }

  function render() {
    renderChips();
    renderList();
    renderDetail();
  }

  // ------------------------------------------------------------- clipboard
  let clearTimer = null;
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    wd.ui.toast('Copied · clipboard clears in 30s', 'ok');
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => navigator.clipboard && navigator.clipboard.writeText('').catch(() => {}), 30000);
  }

  // ---------------------------------------------------------------- events
  $('search').addEventListener('input', renderList);
  $('chips').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    renderChips();
    renderList();
  });
  $('list').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act="add"]')) return editEntry(null);
    const r = ev.target.closest('[data-id]');
    if (!r) return;
    selected = r.dataset.id;
    shown.clear();
    renderList();
    renderDetail();
    window.scrollTo(0, 0);
  });
  $('detail').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    const e = items.get(selected);
    if (btn) {
      ev.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'back') { selected = null; renderList(); renderDetail(); return; }
      if (!e) return;
      if (act === 'reveal') {
        const k = e.id + ':' + btn.dataset.k;
        shown.has(k) ? shown.delete(k) : shown.add(k);
        return renderDetail();
      }
      if (act === 'copy') return copy(valueOf(e, btn.dataset.k) || '');
      if (act === 'fav') { e.fav = !e.fav; await persist(e); return render(); }
      if (act === 'edit') return editEntry(e);
      if (act === 'link') return linkDialog(e);
      if (act === 'unlink') { await unlink(e.id, btn.dataset.id); return render(); }
      if (act === 'delete') {
        if (!(await ask({ title: `Delete “${e.title}”?`, message: 'This cannot be undone. Links to it are removed too.', ok: 'Delete', danger: true }))) return;
        await removeEntry(e.id);
        selected = null;
        return render();
      }
      return;
    }
    const o = ev.target.closest('[data-open]');
    if (o) { selected = o.dataset.open; shown.clear(); render(); window.scrollTo(0, 0); }
  });
  $('addBtn').addEventListener('click', () => editEntry(null));
  $('lockNow').addEventListener('click', lock);
  $('settingsBtn').addEventListener('click', settingsDialog);
  $('modal').addEventListener('click', (ev) => { if (ev.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });

  function openModal(html) {
    $('sheet').innerHTML = html;
    $('modal').hidden = false;
    const first = $('sheet').querySelector('input:not([type=checkbox]),textarea');
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    $('modal').hidden = true;
    $('sheet').innerHTML = '';
    $('sheet').onclick = $('sheet').onsubmit = $('sheet').onchange = null;
  }

  /** In-page replacement for confirm()/prompt(), which the WebView does not show on phones. */
  function ask({ title, message, input, ok = 'OK', danger = false }) {
    return new Promise((resolve) => {
      openModal(`<h2>${esc(title)}</h2>${message ? `<p class="wd-muted" style="margin-bottom:12px">${esc(message)}</p>` : ''}
        <form id="askF" autocomplete="off">${input ? `<input class="wd-input" id="askIn" type="${input}" style="width:100%">` : ''}
        <div class="actions"><button type="button" class="wd-btn wd-btn-ghost" data-no>Cancel</button>
        <button type="submit" class="wd-btn ${danger ? 'wd-btn-danger' : 'wd-btn-primary'}">${esc(ok)}</button></div></form>`);
      $('sheet').onclick = (ev) => { if (ev.target.closest('[data-no]')) { closeModal(); resolve(null); } };
      $('sheet').onsubmit = (ev) => {
        ev.preventDefault();
        const v = input ? $('askIn').value : true;
        closeModal();
        resolve(v);
      };
    });
  }

  // ---------------------------------------------------------------- editor
  function generatePassword(len = 20) {
    const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];
    const all = sets.join('');
    const out = sets.map((s) => s[randInt(s.length)]);
    while (out.length < len) out.push(all[randInt(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = randInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.join('');
  }
  function randInt(n) {
    const lim = Math.floor(0x100000000 / n) * n;
    const b = new Uint32Array(1);
    do crypto.getRandomValues(b); while (b[0] >= lim);
    return b[0] % n;
  }
  function strength(pw) {
    if (!pw) return 0;
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/\d/.test(pw)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
    return Math.min(1, (pw.length * Math.log2(pool || 1)) / 100);
  }

  function editEntry(existing, presetType) {
    const draft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { type: presetType || (filter !== 'all' ? filter : 'login'), title: '', fields: {}, custom: [], notes: '', links: [] };
    const isNew = !existing;

    const draw = () => {
      const t = TYPES[draft.type];
      openModal(`
        <h2>${isNew ? 'New entry' : 'Edit ' + esc(t.label.toLowerCase())}</h2>
        ${isNew ? `<div class="types">${Object.entries(TYPES).map(([k, v]) =>
          `<button type="button" data-type="${k}" class="${k === draft.type ? 'on' : ''}"><b>${v.icon}</b>${v.label}</button>`).join('')}</div>` : ''}
        <form id="ed" autocomplete="off">
          <label class="f"><span>Title</span><input class="wd-input" name="title" required value="${esc(draft.title)}" placeholder="${
            { login: 'e.g. HDFC NetBanking', card: 'e.g. SBI Debit Card', bank: 'e.g. SBI Savings', pin: 'e.g. SBI ATM PIN', note: 'e.g. Wi-Fi details' }[draft.type]}"></label>
          ${t.fields.map(([k, label, kind]) => kind === 'secret'
            ? `<label class="f"><span>${label}</span><div class="pw"><input class="wd-input" type="password" name="f:${k}" value="${esc(draft.fields[k] || '')}" ${k === 'pin' || k === 'cvv' ? 'inputmode="numeric"' : ''}>
                <button type="button" class="ib" data-eye title="Show">👁</button>${k === 'password' ? '<button type="button" class="ib" data-gen title="Generate">🎲</button>' : ''}</div>
                ${k === 'password' ? '<div class="strength"><i id="str"></i></div>' : ''}</label>`
            : `<label class="f"><span>${label}</span><input class="wd-input" name="f:${k}" value="${esc(draft.fields[k] || '')}"></label>`).join('')}
          <div class="f"><span class="wd-small wd-muted">Extra fields</span><div id="customs" style="margin-top:4px">${(draft.custom || []).map((c, i) => `
            <div class="custom"><input class="wd-input" data-c="${i}" data-p="label" placeholder="Label" value="${esc(c.label)}">
              <input class="wd-input" data-c="${i}" data-p="value" type="${c.secret ? 'password' : 'text'}" placeholder="Value" value="${esc(c.value)}">
              <label class="check" title="Hide this value"><input type="checkbox" data-c="${i}" data-p="secret" ${c.secret ? 'checked' : ''}>🔒</label>
              <button type="button" class="ib" data-rmc="${i}" title="Remove">✕</button></div>`).join('')}</div>
            <button type="button" class="wd-btn wd-btn-sm" data-addc style="margin-top:4px">+ Add field</button></div>
          <label class="f" style="margin-top:10px"><span>Notes</span><textarea class="wd-input" name="notes">${esc(draft.notes || '')}</textarea></label>
          <div class="actions">
            <button type="button" class="wd-btn wd-btn-ghost" data-cancel>Cancel</button>
            <button type="submit" class="wd-btn wd-btn-primary">${isNew ? 'Save' : 'Save changes'}</button>
          </div>
        </form>`);
      const pwInput = $('sheet').querySelector('[name="f:password"]');
      const meter = () => {
        const s = strength(pwInput.value);
        const bar = $('str');
        bar.style.width = Math.round(s * 100) + '%';
        bar.style.background = s < 0.4 ? 'var(--wd-red)' : s < 0.7 ? 'var(--wd-amber)' : 'var(--wd-green)';
      };
      if (pwInput) { pwInput.addEventListener('input', meter); meter(); }
    };

    const collect = () => {
      const form = $('ed');
      if (!form) return;
      draft.title = form.title.value.trim();
      draft.notes = form.notes.value;
      for (const [k] of TYPES[draft.type].fields) {
        const inp = form.elements['f:' + k];
        if (inp) draft.fields[k] = inp.value;
      }
      draft.custom = (draft.custom || []).map((c, i) => ({
        label: form.querySelector(`[data-c="${i}"][data-p="label"]`).value,
        value: form.querySelector(`[data-c="${i}"][data-p="value"]`).value,
        secret: form.querySelector(`[data-c="${i}"][data-p="secret"]`).checked,
      }));
    };

    draw();
    $('sheet').onclick = (ev) => {
      const tb = ev.target.closest('[data-type]');
      if (tb) { collect(); draft.type = tb.dataset.type; return draw(); }
      if (ev.target.closest('[data-cancel]')) return closeModal();
      const eye = ev.target.closest('[data-eye]');
      if (eye) { const inp = eye.parentElement.querySelector('input'); inp.type = inp.type === 'password' ? 'text' : 'password'; return; }
      if (ev.target.closest('[data-gen]')) {
        const inp = $('sheet').querySelector('[name="f:password"]');
        inp.value = generatePassword();
        inp.type = 'text';
        inp.dispatchEvent(new Event('input'));
        return;
      }
      if (ev.target.closest('[data-addc]')) { collect(); draft.custom.push({ label: '', value: '', secret: false }); return draw(); }
      const rm = ev.target.closest('[data-rmc]');
      if (rm) { collect(); draft.custom.splice(+rm.dataset.rmc, 1); return draw(); }
    };
    $('sheet').onchange = (ev) => {
      const c = ev.target.closest('[data-p="secret"]');
      if (c) $('sheet').querySelector(`[data-c="${c.dataset.c}"][data-p="value"]`).type = c.checked ? 'password' : 'text';
    };
    $('sheet').onsubmit = async (ev) => {
      ev.preventDefault();
      collect();
      if (!draft.title) return;
      // Keep only the fields this type uses, and drop empty extra fields.
      const keep = new Set(TYPES[draft.type].fields.map(([k]) => k));
      draft.fields = Object.fromEntries(Object.entries(draft.fields).filter(([k, v]) => keep.has(k) && v));
      draft.custom = draft.custom.filter((c) => c.label || c.value);
      selected = await persist(draft);
      closeModal();
      render();
      wd.ui.toast('Saved', 'ok');
    };
  }

  // ------------------------------------------------------------------ links
  function linkDialog(e) {
    const linked = new Set((e.links || []).map((l) => l.id));
    let picked = null;
    const draw = (q = '') => {
      const options = sorted().filter((o) => o.id !== e.id && !linked.has(o.id) && matches(o, q.toLowerCase()));
      $('pick').innerHTML = options.length ? options.map((o) => `
        <button type="button" class="row ${o.id === picked ? 'on' : ''}" data-pick="${o.id}">
          <span class="tico">${TYPES[o.type].icon}</span>
          <span class="wd-grow"><div class="t wd-ellipsis">${esc(o.title)}</div><div class="s wd-ellipsis">${esc(subtitle(o))}</div></span>
        </button>`).join('') : '<div class="wd-muted wd-small">No other entries to link. Create one below.</div>';
    };
    openModal(`
      <h2>Link to “${esc(e.title)}”</h2>
      <p class="wd-small wd-muted" style="margin-bottom:10px">Pick a related entry, then say what it is for this one (e.g. Card PIN, App login, Net banking).</p>
      <input class="wd-input" id="pickQ" type="search" placeholder="Search entries…" style="width:100%;margin-bottom:8px">
      <div class="pick" id="pick"></div>
      <label class="f"><span>What is it?</span><input class="wd-input" id="role" list="roles" placeholder="e.g. Card PIN"></label>
      <datalist id="roles">${ROLES.map((r) => `<option value="${r}">`).join('')}</datalist>
      <div class="actions">
        <div class="wd-spacer" style="flex:1">${Object.entries(TYPES).map(([k, v]) => `<button type="button" class="wd-btn wd-btn-sm" data-new="${k}" title="New ${v.label} linked here" style="margin:0 4px 4px 0">+ ${v.icon}</button>`).join('')}</div>
        <button type="button" class="wd-btn wd-btn-ghost" data-cancel>Cancel</button>
        <button type="button" class="wd-btn wd-btn-primary" id="doLink" disabled>Link</button>
      </div>`);
    draw();
    $('pickQ').addEventListener('input', () => draw($('pickQ').value.trim()));
    $('sheet').onsubmit = null;
    $('sheet').onchange = null;
    $('sheet').onclick = async (ev) => {
      if (ev.target.closest('[data-cancel]')) return closeModal();
      const p = ev.target.closest('[data-pick]');
      if (p) {
        picked = p.dataset.pick;
        if (!$('role').value) $('role').value = TYPES[items.get(picked).type].label;
        $('doLink').disabled = false;
        return draw($('pickQ').value.trim());
      }
      const n = ev.target.closest('[data-new]');
      if (n) {
        // Create a new entry, then link it back automatically.
        const role = $('role').value.trim();
        const before = new Set(items.keys());
        const type = n.dataset.new;
        editEntry(null, type);
        const origSubmit = $('sheet').onsubmit;
        $('sheet').onsubmit = async (sev) => {
          await origSubmit(sev);
          const created = [...items.keys()].find((k) => !before.has(k));
          if (created) { await link(e.id, created, role || TYPES[type].label); selected = e.id; render(); }
        };
        return;
      }
      if (ev.target.closest('#doLink') && picked) {
        await link(e.id, picked, $('role').value.trim());
        closeModal();
        render();
      }
    };
  }

  // --------------------------------------------------------------- settings
  function settingsDialog() {
    openModal(`
      <h2>Vault settings</h2>
      <div class="wd-stack">
        ${bioAvailable
          ? `<label class="check" style="font-size:14px;color:var(--wd-text)"><input type="checkbox" id="sBio" ${bioEnabled ? 'checked' : ''}> Unlock with fingerprint / face</label>`
          : '<p class="wd-small wd-muted">Fingerprint unlock is not available on this device (no enrolled fingerprint, face or Touch ID).</p>'}
        <label class="f"><span>Auto-lock after inactivity</span>
          <select class="wd-input" id="sAuto">${[[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [60, '1 hour'], [0, 'Never (lock manually)']]
            .map(([v, l]) => `<option value="${v}" ${v === autolockMin ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="wd-card" style="padding:12px">
          <h3 style="margin-bottom:8px">Change master key</h3>
          <div class="seg" id="sKind" style="margin-bottom:8px">
            <button type="button" data-kind="pin" class="${meta.kind === 'pin' ? 'on' : ''}">PIN</button>
            <button type="button" data-kind="password" class="${meta.kind === 'password' ? 'on' : ''}">Password</button>
          </div>
          <input class="wd-input" id="sOld" type="password" placeholder="Current key" style="width:100%;margin-bottom:6px">
          <input class="wd-input" id="sNew" type="password" placeholder="New key" style="width:100%;margin-bottom:6px">
          <input class="wd-input" id="sNew2" type="password" placeholder="Repeat new key" style="width:100%;margin-bottom:6px">
          <div class="err" id="sErr"></div>
          <button class="wd-btn wd-btn-sm" id="sChange">Change key</button>
        </div>
        <div class="wd-card" style="padding:12px">
          <h3 style="margin-bottom:4px">Backup</h3>
          <p class="wd-small wd-muted" style="margin-bottom:8px">The backup file stays encrypted. Restoring it needs the master key that was in use when it was made.</p>
          <div class="wd-row"><button class="wd-btn wd-btn-sm" id="sExport">⬇ Export backup</button><button class="wd-btn wd-btn-sm" id="sImport">⬆ Restore from backup</button></div>
        </div>
      </div>
      <div class="actions"><button class="wd-btn wd-btn-primary" data-cancel>Done</button></div>`);
    let newKind = meta.kind;
    $('sheet').onsubmit = null;
    $('sheet').onchange = async (ev) => {
      if (ev.target.id === 'sBio') {
        if (!(await enableBio(ev.target.checked))) ev.target.checked = bioEnabled;
      }
      if (ev.target.id === 'sAuto') {
        autolockMin = +ev.target.value;
        await wd.kv.set('autolock', autolockMin);
        bumpIdle();
      }
    };
    $('sheet').onclick = async (ev) => {
      if (ev.target.closest('[data-cancel]')) return closeModal();
      const kb = ev.target.closest('#sKind button');
      if (kb) { newKind = kb.dataset.kind; for (const x of $('sKind').children) x.classList.toggle('on', x === kb); return; }
      if (ev.target.closest('#sChange')) return changeKey(newKind);
      if (ev.target.closest('#sExport')) return exportBackup();
      if (ev.target.closest('#sImport')) return importBackup();
    };
  }

  async function changeKey(kind) {
    const err = (m) => { $('sErr').textContent = m; };
    const oldK = $('sOld').value;
    const k = $('sNew').value;
    try {
      const kek = await deriveKek(oldK, unb64(meta.salt), meta.iter);
      await open(kek, meta.wrapped);
    } catch (_) { return err('Current key is wrong.'); }
    const problem = keyProblem(kind, k) || (k !== $('sNew2').value ? 'The new keys do not match.' : '');
    if (problem) return err(problem);
    meta = Object.assign({}, meta, { kind }, await wrapUnder(k, vaultRaw));
    await wd.kv.set('meta', meta);
    err('');
    for (const id of ['sOld', 'sNew', 'sNew2']) $(id).value = '';
    wd.ui.toast('Master key changed', 'ok');
  }

  async function exportBackup() {
    try {
      const docs = await col.find(null, {});
      const backup = { format: 'webdeck-password-vault', v: 1, exported: new Date().toISOString(), meta,
        items: docs.map((d) => ({ id: d._id, box: d.box })) };
      const name = `password-vault-${new Date().toISOString().slice(0, 10)}.wdvault`;
      const saved = await wd.files.save({ name, text: JSON.stringify(backup) });
      wd.ui.toast('Backup saved: ' + saved.name, 'ok');
      wd.files.reveal(saved.path).catch(() => {});
    } catch (e) {
      wd.ui.toast('Export failed: ' + e.message, 'error');
    }
  }

  async function importBackup() {
    try {
      const [file] = await wd.files.pick({ extensions: ['wdvault', 'json'] });
      if (!file) return;
      const backup = await (await fetch(file.url)).json();
      if (backup.format !== 'webdeck-password-vault' || !backup.meta) throw new Error('Not a Password Vault backup');
      const key = await ask({ title: 'Restore backup', message: `Enter the master key that was in use when “${file.name}” was made.`, input: 'password', ok: 'Restore' });
      if (!key) return;
      let bkKey;
      try {
        const kek = await deriveKek(key, unb64(backup.meta.salt), backup.meta.iter);
        bkKey = await importAes(await open(kek, backup.meta.wrapped));
      } catch (_) { throw new Error('Wrong key for this backup'); }
      // Re-encrypt every entry with this vault's key, then point links at the new ids.
      const restored = [];
      const idMap = new Map();
      for (const it of backup.items || []) {
        let d;
        try { d = await openJson(bkKey, it.box); } catch (_) { continue; } // skip damaged entry
        const oldLinks = d.links || [];
        d.links = [];
        delete d.id;
        const newId = await persist(d);
        idMap.set(it.id, newId);
        restored.push({ newId, oldLinks });
      }
      for (const { newId, oldLinks } of restored) {
        const e = items.get(newId);
        e.links = oldLinks.map((l) => ({ id: idMap.get(l.id), role: l.role })).filter((l) => l.id);
        if (e.links.length) await persist(e);
      }
      render();
      wd.ui.toast(`Restored ${restored.length} entries`, 'ok');
    } catch (e) {
      wd.ui.toast('Restore failed: ' + e.message, 'error');
    }
  }

  // ------------------------------------------------------------------- boot
  async function boot() {
    try { bioAvailable = !!(await wd.auth.status()).biometric; } catch (_) { bioAvailable = false; }
    meta = await wd.kv.get('meta', null);
    bioEnabled = !!(await wd.kv.get('bio', false)) && bioAvailable;
    autolockMin = await wd.kv.get('autolock', 5);
    if (!meta) {
      $('setupBioWrap').hidden = !bioAvailable;
      show('setup');
      setTimeout(() => $('setupKey').focus(), 50);
    } else {
      showLock();
    }
  }
  boot();
})();
