(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = wd.ui.escape;
  const watches = wd.db.collection('watches');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------- checking
  async function pageText(url, selector) {
    const res = await wd.net.fetch(url, { timeout: 40 });
    if (!res.ok) throw new Error(`The page returned HTTP ${res.status}`);
    const doc = res.html();
    doc.querySelectorAll('script, style, noscript, template, svg').forEach((n) => n.remove());
    let scope = doc.body || doc.documentElement;
    if (selector) {
      let el;
      try { el = doc.querySelector(selector); } catch (_) { throw new Error('Invalid CSS selector'); }
      if (!el) throw new Error(`Nothing matches "${selector}" on the page`);
      scope = el;
    }
    return (scope.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function snippetAround(text, needle) {
    const i = text.toLowerCase().indexOf(needle.toLowerCase());
    if (i < 0) return null;
    return (i > 60 ? '…' : '') + text.slice(Math.max(0, i - 60), i + needle.length + 60) + '…';
  }

  /** Returns the updated watch; notifies when it fires. */
  async function check(w, { notify }) {
    const now = new Date().toISOString();
    let text;
    try {
      text = await pageText(w.url, w.selector);
    } catch (e) {
      return watches.update(w._id, { lastChecked: now, lastError: e.message });
    }
    const patch = { lastChecked: now, lastError: null };
    let fired = false;
    if (w.mode === 'changes') {
      const h = hash(text);
      if (w.hash && w.hash !== h) {
        fired = true;
        patch.status = 'changed';
        patch.triggeredAt = now;
        patch.snippet = text.slice(0, 160);
      } else if (!w.hash) {
        patch.status = 'waiting';
      }
      patch.hash = h;
    } else {
      const present = text.toLowerCase().includes((w.text || '').toLowerCase());
      const isHit = w.mode === 'appears' ? present : !present;
      patch.snippet = present ? snippetAround(text, w.text) : null;
      if (isHit && w.status !== 'triggered') {
        fired = true;
        patch.status = 'triggered';
        patch.triggeredAt = now;
      } else if (!isHit) {
        patch.status = 'waiting';
      }
    }
    const updated = await watches.update(w._id, patch);
    if (fired && notify) {
      const what = w.mode === 'changes' ? 'The page changed'
        : w.mode === 'appears' ? `"${w.text}" is now on the page` : `"${w.text}" is gone from the page`;
      await wd.notify(`🎟️ ${w.name || 'Watched page'}`, what, { url: w.url }).catch(() => {});
    }
    return updated;
  }

  // ------------------------------------------------------- background job
  if (wd.job.active) {
    wd.job.run(async () => {
      const active = await watches.find({ paused: { $ne: true } });
      let fired = 0;
      for (const w of active) {
        const before = w.triggeredAt;
        const after = await check(w, { notify: true });
        if (after && after.triggeredAt !== before) fired++;
        await sleep(1000);
      }
      return `Checked ${active.length} page${active.length === 1 ? '' : 's'}${fired ? `, ${fired} alert${fired === 1 ? '' : 's'}` : ''}`;
    });
    return;
  }

  // ------------------------------------------------------------------- UI
  let list = [];
  const busy = new Set();

  const syncMode = () => { $('textRow').hidden = $('mode').value === 'changes'; };
  $('mode').onchange = syncMode;

  async function load() {
    list = await watches.find(null, { sort: '-_createdAt' });
    render();
  }

  function render() {
    if (!list.length) {
      $('list').innerHTML = '<div class="wd-empty"><div class="wd-empty-icon">🎫</div>Add a page above. WebDeck checks it every 30 minutes and notifies you.</div>';
      return;
    }
    $('list').innerHTML = list.map((w) => {
      const icon = w.lastError ? '⚠️' : w.status === 'triggered' ? '🎉' : w.status === 'changed' ? '🔔' : w.paused ? '⏸️' : '👀';
      const badge = busy.has(w._id) ? '<span class="wd-badge wd-badge-blue">Checking…</span>'
        : w.lastError ? `<span class="wd-badge wd-badge-red" title="${esc(w.lastError)}">Error</span>`
        : w.status === 'triggered' ? '<span class="wd-badge wd-badge-green">Available!</span>'
        : w.status === 'changed' ? '<span class="wd-badge wd-badge-amber">Changed</span>'
        : w.paused ? '<span class="wd-badge">Paused</span>' : '<span class="wd-badge">Watching</span>';
      const rule = w.mode === 'changes' ? 'any change' : `${w.mode === 'appears' ? 'appears' : 'disappears'}: “${esc(w.text)}”`;
      return `<div class="wd-item">
        <div class="state">${icon}</div>
        <div class="wd-grow">
          <div class="wd-row" style="gap:8px"><b class="wd-ellipsis">${esc(w.name || w.url)}</b>${badge}</div>
          <div class="wd-small wd-muted">${rule} · checked ${wd.ui.timeAgo(w.lastChecked)}${w.triggeredAt ? ` · fired ${wd.ui.timeAgo(w.triggeredAt)}` : ''}</div>
          ${w.lastError ? `<div class="wd-small" style="color:var(--wd-red)">${esc(w.lastError)}</div>` : w.snippet ? `<div class="snippet wd-ellipsis">${esc(w.snippet)}</div>` : ''}
        </div>
        <div class="wd-row">
          <button class="wd-btn wd-btn-sm" data-act="open" data-id="${w._id}">Open</button>
          <button class="wd-btn wd-btn-sm" data-act="check" data-id="${w._id}">Check</button>
          ${w.status === 'triggered' || w.status === 'changed' ? `<button class="wd-btn wd-btn-sm" data-act="rearm" data-id="${w._id}">Re-arm</button>` : ''}
          <button class="wd-btn wd-btn-sm wd-btn-ghost" data-act="pause" data-id="${w._id}" title="${w.paused ? 'Resume' : 'Pause'}">${w.paused ? '▶' : '⏸'}</button>
          <button class="wd-btn wd-btn-sm wd-btn-ghost" data-act="delete" data-id="${w._id}" title="Delete">✕</button>
        </div>
      </div>`;
    }).join('');
  }

  $('list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const w = list.find((x) => x._id === b.dataset.id);
    try {
      switch (b.dataset.act) {
        case 'open': await wd.openUrl(w.url); break;
        case 'check':
          busy.add(w._id); render();
          await check(w, { notify: true });
          busy.delete(w._id);
          break;
        case 'rearm': await watches.update(w._id, { status: 'waiting', triggeredAt: null }); break;
        case 'pause': await watches.update(w._id, { paused: !w.paused }); break;
        case 'delete': await watches.remove(w._id); break;
      }
    } catch (err) {
      wd.ui.toast(err.message, 'error');
    }
    busy.delete(w._id);
    load();
  });

  $('preview').onclick = async () => {
    const out = $('previewOut');
    out.hidden = false;
    out.innerHTML = '<div class="wd-muted wd-small">Fetching…</div>';
    try {
      const text = await pageText($('url').value.trim(), $('selector').value.trim() || null);
      const needle = $('text').value.trim();
      const found = needle && text.toLowerCase().includes(needle.toLowerCase());
      out.innerHTML = `${needle ? `<div class="wd-small" style="margin-bottom:6px">${found ? `✅ “${esc(needle)}” is on the page right now` : `❌ “${esc(needle)}” is not on the page right now`}</div>` : ''}
        <div class="wd-log preview">${esc(text.slice(0, 3000)) || '(no text found: this page probably renders with JavaScript)'}</div>`;
    } catch (err) {
      out.innerHTML = `<div class="wd-error">${esc(err.message)}</div>`;
    }
  };

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('url').value.trim();
    const mode = $('mode').value;
    const text = $('text').value.trim();
    if (!/^https?:\/\//i.test(url)) { wd.ui.toast('Enter a full http(s) link', 'error'); return; }
    if (mode !== 'changes' && !text) { wd.ui.toast('Enter the text to look for', 'error'); return; }
    $('add').disabled = true;
    try {
      const w = await watches.insert({
        name: $('name').value.trim() || null, url, mode, text: mode === 'changes' ? null : text,
        selector: $('selector').value.trim() || null, status: 'waiting',
      });
      const checked = await check(w, { notify: false });
      if (checked.status === 'triggered') wd.ui.toast('Heads up: the condition is already true right now!', 'ok');
      else if (checked.lastError) wd.ui.toast(checked.lastError, 'error');
      else wd.ui.toast('Watching. You will be notified.', 'ok');
      ['name', 'url', 'text', 'selector'].forEach((id) => ($(id).value = ''));
      $('previewOut').hidden = true;
      await load();
    } catch (err) {
      wd.ui.toast(err.message, 'error');
    } finally {
      $('add').disabled = false;
    }
  });

  $('checkAll').onclick = async () => {
    $('checkAll').disabled = true;
    for (const w of list.filter((x) => !x.paused)) {
      busy.add(w._id); render();
      await check(w, { notify: true });
      busy.delete(w._id);
    }
    await load();
    $('checkAll').disabled = false;
  };

  syncMode();
  load();
})();
