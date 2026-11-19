(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const API = 'https://www.cheapshark.com/api/1.0';
  const UA = { 'User-Agent': 'WebDeck-GamePriceTracker/1.0' };
  const watch = wd.db.collection('watch');
  const history = wd.db.collection('history');
  const usd = (n) => (n == null || isNaN(n) ? '—' : +n === 0 ? 'FREE' : '$' + (+n).toFixed(2));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function api(path) {
    const res = await wd.net.fetch(API + path, { headers: UA, timeout: 30 });
    if (res.status === 429) throw new Error('CheapShark is rate-limiting requests. Try again in a minute.');
    if (!res.ok) throw new Error(`CheapShark returned HTTP ${res.status}`);
    const data = res.json();
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  let stores = {};
  async function loadStores() {
    let list = await wd.kv.get('stores', null);
    if (!list || Date.now() - (list.at || 0) > 7 * 86400000) {
      list = { at: Date.now(), items: await api('/stores') };
      await wd.kv.set('stores', list);
    }
    stores = Object.fromEntries(list.items.filter((s) => s.isActive).map((s) => [s.storeID, s]));
  }
  const storeName = (id) => stores[id]?.storeName || `Store ${id}`;
  const storeIcon = (id) => (stores[id] ? `<img class="store-ico" src="https://www.cheapshark.com${stores[id].images.icon}" alt="">` : '');
  const dealUrl = (dealID) => `https://www.cheapshark.com/redirect?dealID=${dealID}`;

  /** Fetches a game's live deals and records its best price in the history. */
  async function checkGame(w, { notify }) {
    const g = await api(`/games?id=${encodeURIComponent(w.gameID)}`);
    const deals = (g.deals || []).filter((d) => stores[d.storeID] || !Object.keys(stores).length).sort((a, b) => a.price - b.price);
    const best = deals[0];
    const now = new Date().toISOString();
    if (!best) return watch.update(w._id, { lastChecked: now, lastError: 'No current deals' });
    const price = +best.price;
    const prev = w.bestPrice;
    const last = await history.find({ gameID: w.gameID }, { sort: '-at', limit: 1 });
    if (!last.length || last[0].price !== price || Date.now() - Date.parse(last[0].at) > 20 * 3600000) {
      await history.insert({ gameID: w.gameID, price, storeID: best.storeID, at: now });
    }
    const patch = {
      lastChecked: now, lastError: null, bestPrice: price, bestStore: best.storeID, bestDealID: best.dealID,
      retail: +best.retailPrice, lowestEver: g.cheapestPriceEver ? +g.cheapestPriceEver.price : null,
      lowestEverDate: g.cheapestPriceEver?.date ? new Date(g.cheapestPriceEver.date * 1000).toISOString() : null,
      title: g.info?.title || w.title, thumb: g.info?.thumb || w.thumb,
    };
    if (prev != null && prev !== price) patch.previousPrice = prev;
    const updated = await watch.update(w._id, patch);
    const hitTarget = w.target != null && price <= w.target && !(prev != null && prev <= w.target);
    const allTimeLow = patch.lowestEver != null && price <= patch.lowestEver && prev != null && price < prev;
    if (notify && (hitTarget || allTimeLow || (prev != null && price < prev))) {
      await wd.notify(
        hitTarget ? `🎯 ${updated.title} hit your price` : allTimeLow ? `🔥 All-time low: ${updated.title}` : `Price drop: ${updated.title}`,
        `${usd(price)} at ${storeName(best.storeID)}${prev != null ? ` (was ${usd(prev)})` : ''}`,
        { url: dealUrl(best.dealID) },
      ).catch(() => {});
    }
    return updated;
  }

  // ------------------------------------------------------------- background job
  if (wd.job.active) {
    wd.job.run(async () => {
      await loadStores();
      const list = await watch.find();
      let drops = 0;
      for (const w of list) {
        const before = w.bestPrice;
        try { const u = await checkGame(w, { notify: true }); if (before != null && u.bestPrice < before) drops++; } catch (e) { await watch.update(w._id, { lastError: e.message }); }
        await sleep(1200);
      }
      return `Checked ${list.length} game${list.length === 1 ? '' : 's'}, ${drops} price drop${drops === 1 ? '' : 's'}`;
    });
    return;
  }

  // ----------------------------------------------------------------------- UI
  let tab = 'deals';
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['deals', 'search', 'watch'].forEach((id) => ($(id).hidden = id !== tab));
    if (tab === 'watch') renderWatch();
  }));

  function card(g) {
    const sale = +g.salePrice, normal = +g.normalPrice, off = Math.round(+g.savings || 0);
    return `<div class="game" data-game="${esc(g.gameID)}">
      <img src="${esc(g.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <div class="body"><div class="wd-ellipsis" style="font-weight:600">${esc(g.title || g.external)}</div>
        <div class="wd-row" style="gap:8px">${off > 0 ? `<span class="off">-${off}%</span>` : ''}<span class="price">${usd(g.salePrice ?? g.cheapest)}</span>${normal > sale ? `<span class="old">${usd(normal)}</span>` : ''}
          <span class="wd-spacer"></span><span class="wd-small wd-muted">${g.storeID ? storeIcon(g.storeID) + esc(storeName(g.storeID)) : 'best price'}</span></div>
        ${g.metacriticScore && g.metacriticScore !== '0' ? `<div class="wd-small wd-muted">Metacritic ${esc(g.metacriticScore)}${g.steamRatingText ? ' · ' + esc(g.steamRatingText) : ''}</div>` : ''}
      </div></div>`;
  }

  async function loadDeals() {
    $('dealList').innerHTML = '<div class="wd-muted">Loading deals…</div>';
    const q = new URLSearchParams({ pageSize: '40', sortBy: $('dSort').value });
    if ($('dStore').value) q.set('storeID', $('dStore').value);
    if ($('dMax').value !== '') q.set('upperPrice', $('dMax').value);
    if ($('dAAA').checked) q.set('AAA', '1');
    q.set('onSale', '1');
    try {
      const deals = await api('/deals?' + q);
      $('dealList').innerHTML = deals.map(card).join('') || '<div class="wd-empty">No deals match.</div>';
    } catch (e) { $('dealList').innerHTML = `<div class="wd-error">${esc(e.message)}</div>`; }
  }
  ['dStore', 'dMax', 'dSort', 'dAAA'].forEach((id) => ($(id).onchange = loadDeals));

  $('sForm').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('sq').value.trim();
    if (!q) return;
    $('searchList').innerHTML = '<div class="wd-muted">Searching…</div>';
    try {
      const games = await api(`/games?title=${encodeURIComponent(q)}&limit=40`);
      $('searchList').innerHTML = games.map((g) => card({ ...g, title: g.external })).join('') || '<div class="wd-empty">No games found.</div>';
    } catch (err) { $('searchList').innerHTML = `<div class="wd-error">${esc(err.message)}</div>`; }
  };

  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-game]');
    if (g && !e.target.closest('dialog')) openGame(g.dataset.game);
  });

  function chart(pts) {
    if (pts.length < 2) return '<p class="wd-small wd-muted">The price chart fills in as WebDeck checks this game over time.</p>';
    const W = 700, H = 180, L = 50, R = 10, T = 10, B = 22;
    const xs = pts.map((p) => Date.parse(p.at)), ys = pts.map((p) => p.price);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y0 === y1) { y0 = Math.max(0, y0 - 1); y1 += 1; }
    const X = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R), Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    let d = `M${X(xs[0])},${Y(ys[0])}`;
    for (let i = 1; i < pts.length; i++) d += ` H${X(xs[i])} V${Y(ys[i])}`;
    return `<svg id="chart" viewBox="0 0 ${W} ${H}" width="100%"><path d="${d}" fill="none" stroke="#a78bfa" stroke-width="2"/>
      ${[y0, y1].map((t) => `<text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${usd(t)}</text>`).join('')}
      <text x="${L}" y="${H - 4}">${new Date(x0).toLocaleDateString()}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">${new Date(x1).toLocaleDateString()}</text></svg>`;
  }

  async function openGame(gameID) {
    const dlg = $('detail');
    dlg.innerHTML = '<p class="wd-muted">Loading…</p>';
    if (!dlg.open) dlg.showModal();
    try {
      const g = await api(`/games?id=${encodeURIComponent(gameID)}`);
      const deals = (g.deals || []).sort((a, b) => a.price - b.price);
      const watched = (await watch.find({ gameID }))[0];
      const pts = await history.find({ gameID }, { sort: 'at' });
      const low = g.cheapestPriceEver;
      dlg.innerHTML = `
        <div class="wd-row" style="align-items:flex-start"><img src="${esc(g.info.thumb)}" style="width:180px;border-radius:8px" referrerpolicy="no-referrer">
          <div class="wd-grow"><h2>${esc(g.info.title)}</h2>
            <div class="wd-small wd-muted" style="margin-top:4px">${low ? `All-time low: <span class="low">${usd(low.price)}</span> on ${new Date(low.date * 1000).toLocaleDateString()}` : ''}</div>
            ${g.info.steamAppID ? `<a href="#" data-steam="${esc(g.info.steamAppID)}" class="wd-small">View on Steam</a>` : ''}</div>
          <button class="wd-btn wd-btn-ghost" data-close>✕</button></div>
        <table class="wd-table deals" style="margin:14px 0"><tr><th>Store</th><th>Price</th><th>Regular</th><th>Discount</th><th></th></tr>
          ${deals.map((d) => `<tr><td>${storeIcon(d.storeID)}${esc(storeName(d.storeID))}</td><td class="${+d.price <= +(low?.price ?? -1) ? 'low' : ''}"><b>${usd(d.price)}</b></td><td class="wd-muted">${usd(d.retailPrice)}</td>
            <td>${Math.round(+d.savings) > 0 ? `<span class="off">-${Math.round(+d.savings)}%</span>` : ''}</td><td><button class="wd-btn wd-btn-sm" data-buy="${esc(d.dealID)}">Open store</button></td></tr>`).join('')}</table>
        <h3 style="margin-bottom:6px">Price history</h3>${chart(pts)}
        <div class="wd-row" style="margin-top:14px">
          <label class="wd-label" style="margin:0">Alert me at or below $</label><input class="wd-input" id="target" type="number" min="0" step="0.01" style="width:110px" value="${watched?.target ?? ''}">
          <div class="wd-spacer"></div>
          ${watched ? '<button class="wd-btn wd-btn-danger" data-unwatch>Remove from watchlist</button><button class="wd-btn wd-btn-primary" data-save>Save alert</button>' : '<button class="wd-btn wd-btn-primary" data-watch>Add to watchlist</button>'}
        </div>`;
      dlg.onclick = async (e) => {
        const b = e.target.closest('[data-close],[data-buy],[data-steam],[data-watch],[data-unwatch],[data-save]');
        if (e.target === dlg || (b && 'close' in b.dataset)) return dlg.close();
        if (!b) return;
        if (b.dataset.buy) return wd.openUrl(dealUrl(b.dataset.buy));
        if (b.dataset.steam) { e.preventDefault(); return wd.openUrl(`https://store.steampowered.com/app/${b.dataset.steam}`); }
        const target = $('target').value === '' ? null : +$('target').value;
        if ('watch' in b.dataset) {
          const w = await watch.insert({ gameID, title: g.info.title, thumb: g.info.thumb, target });
          await checkGame(w, { notify: false });
          wd.ui.toast('Added to watchlist', 'ok');
        }
        if ('save' in b.dataset) { await watch.update(watched._id, { target }); wd.ui.toast('Alert saved', 'ok'); }
        if ('unwatch' in b.dataset) { await watch.remove(watched._id); await history.removeWhere({ gameID }); wd.ui.toast('Removed'); }
        dlg.close();
        renderWatch();
      };
    } catch (e) { dlg.innerHTML = `<div class="wd-error">${esc(e.message)}</div><button class="wd-btn" onclick="this.closest('dialog').close()">Close</button>`; }
  }

  async function renderWatch() {
    const list = await watch.find(null, { sort: 'title' });
    $('wSub').textContent = list.length ? `${list.length} game${list.length === 1 ? '' : 's'} · checked every 6 hours` : '';
    $('watchList').innerHTML = list.map((w) => {
      const atTarget = w.target != null && w.bestPrice != null && w.bestPrice <= w.target;
      const delta = w.previousPrice != null && w.bestPrice != null ? w.bestPrice - w.previousPrice : 0;
      return `<div class="wd-item wd-clickable" data-game="${esc(w.gameID)}">
        <img src="${esc(w.thumb)}" style="width:120px;border-radius:6px" referrerpolicy="no-referrer" alt="">
        <div class="wd-grow"><b class="wd-ellipsis">${esc(w.title)}</b>
          <div class="wd-small wd-muted">${w.bestStore ? storeIcon(w.bestStore) + esc(storeName(w.bestStore)) : ''}${w.lowestEver != null ? ` · all-time low ${usd(w.lowestEver)}` : ''}${w.target != null ? ` · alert ≤ ${usd(w.target)}` : ''} · ${wd.ui.timeAgo(w.lastChecked)}</div>
          ${w.lastError ? `<div class="wd-small" style="color:var(--wd-red)">${esc(w.lastError)}</div>` : ''}</div>
        <div style="text-align:right">${atTarget ? '<span class="wd-badge wd-badge-green">At target</span><br>' : ''}<span class="price">${usd(w.bestPrice)}</span>
          ${delta ? `<div class="wd-small" style="color:${delta < 0 ? 'var(--wd-green)' : 'var(--wd-red)'}">${delta < 0 ? '▼' : '▲'} ${usd(Math.abs(delta))}</div>` : ''}</div></div>`;
    }).join('') || '<div class="wd-empty"><div class="wd-empty-icon">👀</div>Open any game and press "Add to watchlist" to track its price.</div>';
  }

  $('checkAll').onclick = async () => {
    $('checkAll').disabled = true;
    for (const w of await watch.find()) { try { await checkGame(w, { notify: true }); } catch (e) { await watch.update(w._id, { lastError: e.message }); } await sleep(800); }
    $('checkAll').disabled = false;
    renderWatch();
  };

  (async () => {
    try {
      await loadStores();
      $('dStore').innerHTML += Object.values(stores).map((s) => `<option value="${s.storeID}">${esc(s.storeName)}</option>`).join('');
    } catch (e) { wd.ui.toast(e.message, 'error'); }
    loadDeals();
  })();
})();
