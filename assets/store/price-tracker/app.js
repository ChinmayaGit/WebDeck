(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = wd.ui.escape;
  const items = wd.db.collection('items');
  const history = wd.db.collection('history');
  const { extract } = window.PriceExtract;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const HISTORY_EVERY_MS = 12 * 3600 * 1000;

  function fmt(price, currency) {
    if (price == null) return '—';
    if (currency) {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: price % 1 ? 2 : 0 }).format(price);
      } catch (_) { /* unknown currency code */ }
    }
    return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; } };

  // ------------------------------------------------------------- checking
  async function fetchInfo(url, selector) {
    const res = await wd.net.fetch(url, { timeout: 40 });
    const info = extract(res.text || '', res.url || url, selector);
    info.status = res.status;
    return info;
  }

  /** Fetches one item, records history and (optionally) notifies on drops. */
  async function checkItem(item, { notify }) {
    const now = new Date().toISOString();
    let info;
    try {
      info = await fetchInfo(item.url, item.selector);
    } catch (e) {
      return { item: await items.update(item._id, { lastChecked: now, lastError: e.message }) };
    }
    if (!info.price) {
      const error = info.blocked
        ? 'The shop blocked the automated check. It usually works again later.'
        : info.status >= 400
          ? `The page returned HTTP ${info.status}`
          : 'Price not found on the page. Try a CSS selector.';
      return { item: await items.update(item._id, { lastChecked: now, lastError: error }) };
    }

    const prev = item.lastPrice ?? null;
    const price = info.price;
    const patch = {
      lastPrice: price,
      lastChecked: now,
      lastError: null,
      currency: item.currency || info.currency || null,
      title: item.title || info.title || host(item.url),
      image: item.image || info.image || null,
      source: info.source,
      lowest: Math.min(item.lowest ?? price, price),
      highest: Math.max(item.highest ?? price, price),
    };
    if (prev != null && prev !== price) {
      patch.previousPrice = prev;
      patch.changedAt = now;
    }
    if (prev !== price || !item.lastPointAt || Date.now() - Date.parse(item.lastPointAt) > HISTORY_EVERY_MS) {
      await history.insert({ itemId: item._id, price, at: now });
      patch.lastPointAt = now;
    }
    const updated = await items.update(item._id, patch);
    const dropped = prev != null && price < prev;
    const targetHit = item.target > 0 && price <= item.target && !(prev != null && prev <= item.target);
    if (notify && (dropped || targetHit)) {
      const was = prev != null ? ` (was ${fmt(prev, updated.currency)})` : '';
      await wd.notify(
        targetHit ? 'Target price reached' : 'Price drop',
        `${updated.title}: ${fmt(price, updated.currency)}${was}`,
        { url: item.url },
      ).catch(() => {});
    }
    return { item: updated, dropped, targetHit };
  }

  // ------------------------------------------------------- background job
  if (wd.job.active) {
    wd.job.run(async () => {
      const all = await items.find({ paused: { $ne: true } });
      let drops = 0;
      let failed = 0;
      for (const it of all) {
        const r = await checkItem(it, { notify: true });
        if (r.dropped || r.targetHit) drops++;
        if (r.item && r.item.lastError) failed++;
        await sleep(1500); // be polite to shops
      }
      return `Checked ${all.length} item${all.length === 1 ? '' : 's'}: ${drops} price drop${drops === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`;
    });
    return;
  }

  // ------------------------------------------------------------------- UI
  let list = [];
  let points = {}; // itemId -> [{price, at}]
  const checking = new Set();

  async function load() {
    list = await items.find(null, { sort: '-_createdAt' });
    points = {};
    for (const p of await history.find(null, { sort: 'at' })) (points[p.itemId] = points[p.itemId] || []).push(p);
    render();
  }

  function sparkline(pts, w = 120, h = 34) {
    if (!pts || pts.length < 2) return '';
    const xs = pts.map((p) => Date.parse(p.at));
    const ys = pts.map((p) => p.price);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = (x) => (x1 === x0 ? w : ((x - x0) / (x1 - x0)) * (w - 4) + 2);
    const Y = (y) => (y1 === y0 ? h / 2 : h - 3 - ((y - y0) / (y1 - y0)) * (h - 6));
    let d = `M${X(xs[0])},${Y(ys[0])}`;
    for (let i = 1; i < pts.length; i++) d += ` H${X(xs[i])} V${Y(ys[i])}`;
    const color = ys[ys.length - 1] <= ys[0] ? 'var(--wd-green)' : 'var(--wd-red)';
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
  }

  function render() {
    const sub = list.length
      ? `${list.length} item${list.length === 1 ? '' : 's'} · checked every 4 hours`
      : 'Track prices and see their history';
    $('sub').textContent = sub;
    if (!list.length) {
      $('list').innerHTML = '<div class="wd-empty"><div class="wd-empty-icon">🛒</div>Paste a product link above to start tracking its price.</div>';
      return;
    }
    $('list').innerHTML = list.map((it) => {
      const delta = it.previousPrice != null && it.lastPrice != null ? it.lastPrice - it.previousPrice : 0;
      const pct = delta && it.previousPrice ? Math.abs((delta / it.previousPrice) * 100).toFixed(1) : null;
      const deltaHtml = delta
        ? `<div class="delta ${delta < 0 ? 'down' : 'up'}">${delta < 0 ? '▼' : '▲'} ${fmt(Math.abs(delta), it.currency)} (${pct}%)</div>`
        : `<div class="delta wd-muted">${it.lastPrice != null ? 'no change' : ''}</div>`;
      const status = checking.has(it._id)
        ? '<span class="wd-badge wd-badge-blue">Checking…</span>'
        : it.lastError
          ? `<span class="wd-badge wd-badge-red" title="${esc(it.lastError)}">Check failed</span>`
          : it.target && it.lastPrice != null && it.lastPrice <= it.target
            ? '<span class="wd-badge wd-badge-green">At target</span>'
            : '';
      return `<div class="wd-item wd-clickable" data-id="${it._id}">
        ${it.image ? `<div class="thumb" style="background-image:url(&quot;${esc(encodeURI(it.image))}&quot;)"></div>` : '<div class="thumb none">🏷️</div>'}
        <div class="wd-grow">
          <div class="wd-ellipsis" style="font-weight:600">${esc(it.title || it.url)}</div>
          <div class="wd-small wd-muted wd-row" style="gap:6px">${esc(host(it.url))} · ${wd.ui.timeAgo(it.lastChecked)}
            ${it.target ? ` · alert ≤ ${fmt(it.target, it.currency)}` : ''} ${status}</div>
        </div>
        ${sparkline(points[it._id])}
        <div><div class="price">${fmt(it.lastPrice, it.currency)}</div>${deltaHtml}</div>
      </div>`;
    }).join('');
  }

  $('list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (row) openDetail(row.dataset.id);
  });

  $('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('url').value.trim();
    if (!/^https?:\/\//i.test(url)) { wd.ui.toast('Paste a full http(s) link', 'error'); return; }
    if (list.some((i) => i.url === url)) { wd.ui.toast('Already tracking this link'); return; }
    const target = parseFloat($('target').value) || null;
    const selector = $('selector').value.trim() || null;
    $('addBtn').disabled = true;
    $('addBtn').textContent = 'Checking…';
    try {
      const item = await items.insert({ url, target, selector, title: null });
      list.unshift(item);
      checking.add(item._id);
      render();
      const r = await checkItem(item, { notify: false });
      checking.delete(item._id);
      await load();
      $('url').value = ''; $('target').value = ''; $('selector').value = '';
      if (r.item.lastError) wd.ui.toast(r.item.lastError, 'error');
      else wd.ui.toast(`Tracking at ${fmt(r.item.lastPrice, r.item.currency)}`, 'ok');
    } catch (err) {
      wd.ui.toast(err.message, 'error');
    } finally {
      $('addBtn').disabled = false;
      $('addBtn').textContent = 'Track';
    }
  });

  $('checkAll').onclick = async () => {
    $('checkAll').disabled = true;
    let drops = 0;
    for (const it of list) {
      checking.add(it._id);
      render();
      const r = await checkItem(it, { notify: true });
      if (r.dropped) drops++;
      checking.delete(it._id);
    }
    await load();
    $('checkAll').disabled = false;
    wd.ui.toast(drops ? `${drops} price drop${drops === 1 ? '' : 's'}!` : 'All prices checked', 'ok');
  };

  // --------------------------------------------------------------- detail
  function chart(pts, currency) {
    const W = 700, H = 220, L = 70, R = 12, T = 12, B = 26;
    if (!pts || !pts.length) return '<div class="wd-empty">No price history yet.</div>';
    const data = pts.length === 1 ? [pts[0], { ...pts[0], at: new Date().toISOString() }] : pts;
    const xs = data.map((p) => Date.parse(p.at));
    const ys = data.map((p) => p.price);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y0 === y1) { y0 *= 0.95; y1 *= 1.05; }
    const pad = (y1 - y0) * 0.1;
    y0 -= pad; y1 += pad;
    const X = (x) => L + (x1 === x0 ? 0 : ((x - x0) / (x1 - x0)) * (W - L - R));
    const Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    let d = `M${X(xs[0])},${Y(ys[0])}`;
    for (let i = 1; i < data.length; i++) d += ` H${X(xs[i])} V${Y(ys[i])}`;
    const area = `${d} V${H - B} H${X(xs[0])} Z`;
    const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
    const date = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<svg id="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Price history chart">
      <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#388bfd" stop-opacity=".35"/><stop offset="1" stop-color="#388bfd" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="#30363d" stroke-dasharray="3 4"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(fmt(t, currency))}</text>`).join('')}
      <path d="${area}" fill="url(#g)"/>
      <path d="${d}" fill="none" stroke="#388bfd" stroke-width="2"/>
      ${pts.map((p) => `<circle cx="${X(Date.parse(p.at))}" cy="${Y(p.price)}" r="3" fill="#388bfd"><title>${esc(fmt(p.price, currency))} · ${new Date(p.at).toLocaleString()}</title></circle>`).join('')}
      <text x="${L}" y="${H - 6}">${date(x0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${date(x1)}</text>
    </svg>`;
  }

  function openDetail(id) {
    const it = list.find((i) => i._id === id);
    if (!it) return;
    const pts = points[id] || [];
    const avg = pts.length ? pts.reduce((s, p) => s + p.price, 0) / pts.length : null;
    const lowPt = pts.reduce((m, p) => (!m || p.price < m.price ? p : m), null);
    const dlg = $('detail');
    dlg.innerHTML = `
      <div class="detail-head">
        ${it.image ? `<div class="thumb" style="background-image:url(&quot;${esc(encodeURI(it.image))}&quot;)"></div>` : ''}
        <div class="wd-grow"><h2>${esc(it.title || it.url)}</h2><div class="wd-small wd-muted">${esc(host(it.url))}${it.source ? ' · found via ' + esc(it.source) : ''}</div></div>
        <button class="wd-btn wd-btn-ghost" data-act="close">✕</button>
      </div>
      ${it.lastError ? `<div class="wd-error" style="margin-top:12px">${esc(it.lastError)}</div>` : ''}
      <div class="stats">
        <div class="stat"><span>Now</span><b>${fmt(it.lastPrice, it.currency)}</b></div>
        <div class="stat"><span>Lowest</span><b class="down">${fmt(it.lowest, it.currency)}</b>${lowPt ? `<span>${new Date(lowPt.at).toLocaleDateString()}</span>` : ''}</div>
        <div class="stat"><span>Highest</span><b class="up">${fmt(it.highest, it.currency)}</b></div>
        <div class="stat"><span>Average</span><b>${fmt(avg, it.currency)}</b></div>
      </div>
      ${chart(pts, it.currency)}
      <div class="wd-row" style="margin-top:14px">
        <div class="wd-grow"><label class="wd-label">Alert when at or below</label><input class="wd-input" id="dTarget" type="number" step="any" min="0" value="${it.target ?? ''}"></div>
        <div class="wd-grow"><label class="wd-label">CSS selector (optional)</label><input class="wd-input" id="dSelector" value="${esc(it.selector || '')}"></div>
        <label class="wd-row wd-small" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="dPaused" ${it.paused ? 'checked' : ''}> Pause</label>
      </div>
      <details style="margin-top:12px"><summary class="wd-small wd-muted" style="cursor:pointer">History (${pts.length} records)</summary>
        <div class="history"><table class="wd-table"><tr><th>Date</th><th>Price</th></tr>
        ${pts.slice().reverse().map((p) => `<tr><td>${new Date(p.at).toLocaleString()}</td><td>${fmt(p.price, it.currency)}</td></tr>`).join('')}</table></div>
      </details>
      <div class="wd-row" style="margin-top:16px">
        <button class="wd-btn wd-btn-danger" data-act="delete">Delete</button>
        <div class="wd-spacer"></div>
        <button class="wd-btn" data-act="open">Open page</button>
        <button class="wd-btn" data-act="check">Check now</button>
        <button class="wd-btn wd-btn-primary" data-act="save">Save</button>
      </div>`;
    dlg.onclick = async (e) => {
      if (e.target === dlg) { dlg.close(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      try {
        if (act === 'close') dlg.close();
        if (act === 'open') await wd.openUrl(it.url);
        if (act === 'save' || act === 'check') {
          await items.update(it._id, {
            target: parseFloat($('dTarget').value) || null,
            selector: $('dSelector').value.trim() || null,
            paused: $('dPaused').checked,
          });
        }
        if (act === 'check') {
          e.target.disabled = true;
          e.target.textContent = 'Checking…';
          const fresh = await items.get(it._id);
          const r = await checkItem(fresh, { notify: false });
          await load();
          if (r.item.lastError) wd.ui.toast(r.item.lastError, 'error');
          openDetail(it._id);
          return;
        }
        if (act === 'save') { await load(); dlg.close(); wd.ui.toast('Saved', 'ok'); }
        if (act === 'delete') {
          // Native confirm() isn't available in the embedded WebView: confirm with a second click.
          const btn = e.target.closest('[data-act]');
          if (!btn.dataset.armed) {
            btn.dataset.armed = '1';
            btn.textContent = 'Click again to delete';
            return;
          }
          await items.remove(it._id);
          await history.removeWhere({ itemId: it._id });
          dlg.close();
          await load();
        }
      } catch (err) {
        wd.ui.toast(err.message, 'error');
      }
    };
    if (!dlg.open) dlg.showModal();
  }

  load();
})();
