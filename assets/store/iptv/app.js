(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const BASE = 'https://iptv-org.github.io';
  const favs = wd.db.collection('favorites');
  const video = $('video');
  const RECHECK_MS = 6 * 3600 * 1000;
  let countries = [], categories = [], channels = [], live = [], current = null, favIds = new Set();

  /** Parses an M3U playlist into channels. */
  function parseM3u(text) {
    const out = [];
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('#EXTINF')) {
        const attr = (k) => (new RegExp(`${k}="([^"]*)"`).exec(line) || [])[1] || '';
        cur = { id: attr('tvg-id') || '', logo: attr('tvg-logo'), group: attr('group-title') || 'Other', name: line.split(',').slice(1).join(',').trim(), needsHeaders: false };
      } else if (line.startsWith('#EXTVLCOPT') && cur) {
        cur.needsHeaders = true; // referrer/user-agent requirements a <video> element can't satisfy
      } else if (line && !line.startsWith('#') && cur) {
        cur.url = line;
        cur.key = cur.id || cur.url;
        out.push(cur);
        cur = null;
      }
    }
    return out;
  }

  /** A stream is "live" if its playlist (or media) answers right now. */
  async function probe(ch) {
    try {
      const r = await wd.net.fetch(ch.url, { timeout: 8, maxBytes: 4096 });
      if (!r.ok) return false;
      const t = (r.text || '').slice(0, 200);
      const type = (r.headers['content-type'] || '').toLowerCase();
      return t.startsWith('#EXTM3U') || /mpegurl|video\/|audio\/|mp2t|octet-stream/.test(type);
    } catch (_) { return false; }
  }

  async function loadLists() {
    const cached = await wd.kv.get('lists', null);
    if (cached && Date.now() - cached.at < 7 * 86400000) ({ countries, categories } = cached);
    else {
      countries = (await wd.net.fetch(`${BASE}/api/countries.json`)).json().map((c) => ({ code: c.code.toLowerCase(), name: c.name, flag: c.flag || '' })).sort((a, b) => a.name.localeCompare(b.name));
      categories = (await wd.net.fetch(`${BASE}/api/categories.json`)).json().map((c) => ({ id: c.id, name: c.name }));
      await wd.kv.set('lists', { at: Date.now(), countries, categories });
    }
  }
  function fillPick() {
    const kind = $('kind').value;
    $('pick').hidden = kind === 'favs';
    $('scan').hidden = kind === 'favs';
    $('pick').innerHTML = kind === 'countries'
      ? countries.map((c) => `<option value="${c.code}">${esc(c.flag + ' ' + c.name)}</option>`).join('')
      : categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }

  const scanKey = () => `scan:${$('kind').value}:${$('pick').value}`;

  async function showSaved() {
    if ($('kind').value === 'favs') {
      live = await favs.find(null, { sort: 'name' });
      $('scanInfo').textContent = `${live.length} favorite channel${live.length === 1 ? '' : 's'}`;
      return renderList();
    }
    const saved = await wd.kv.get(scanKey(), null);
    live = saved ? saved.live : [];
    $('scanInfo').textContent = saved
      ? `${live.length} live of ${saved.total} channels · checked ${wd.ui.timeAgo(new Date(saved.at).toISOString())}${Date.now() - saved.at > RECHECK_MS ? ' · press "Find live channels" to refresh' : ''}`
      : 'Press "Find live channels" to test this list.';
    renderList();
  }

  $('scan').onclick = async () => {
    const kind = $('kind').value, id = $('pick').value;
    $('scan').disabled = true;
    $('scanBar').hidden = false;
    try {
      const text = (await wd.net.fetch(`${BASE}/iptv/${kind}/${id}.m3u`, { timeout: 30 })).text;
      channels = parseM3u(text).filter((c) => !c.needsHeaders);
      const found = [];
      let done = 0;
      const queue = channels.slice();
      const worker = async () => {
        while (queue.length) {
          const ch = queue.shift();
          if (await probe(ch)) { found.push(ch); live = found.slice().sort((a, b) => a.name.localeCompare(b.name)); renderList(); }
          done++;
          $('scanBar').firstElementChild.style.width = `${(done / channels.length) * 100}%`;
          $('scanInfo').textContent = `Testing streams… ${done}/${channels.length} · ${found.length} live`;
        }
      };
      await Promise.all(Array.from({ length: 12 }, worker));
      await wd.kv.set(scanKey(), { at: Date.now(), total: channels.length, live: found });
    } catch (e) { wd.ui.toast(e.message, 'error'); }
    $('scan').disabled = false;
    $('scanBar').hidden = true;
    showSaved();
  };

  function renderList() {
    const groups = [...new Set(live.map((c) => c.group))].sort();
    const g = $('group').value;
    $('group').innerHTML = '<option value="">All</option>' + groups.map((x) => `<option ${x === g ? 'selected' : ''}>${esc(x)}</option>`).join('');
    const q = $('filter').value.toLowerCase();
    const shown = live.filter((c) => (!g || c.group === g) && (!q || c.name.toLowerCase().includes(q)));
    $('list').innerHTML = shown.map((c) => `<div class="ch ${current && current.key === c.key ? 'on' : ''}" data-key="${esc(c.key)}">
        <span class="live"></span>${c.logo ? `<img src="${esc(c.logo)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : ''}
        <div class="wd-grow" style="min-width:0"><div class="wd-ellipsis">${esc(c.name)}</div><div class="wd-small wd-muted">${esc(c.group)}</div></div>
        <button class="star ${favIds.has(c.key) ? 'on' : ''}" data-star="${esc(c.key)}">${favIds.has(c.key) ? '★' : '☆'}</button></div>`).join('') ||
      `<div class="wd-empty" style="padding:24px">${$('kind').value === 'favs' ? 'Star channels to keep them here.' : 'No live channels yet.'}</div>`;
  }
  $('filter').oninput = renderList;
  $('group').onchange = renderList;

  $('list').addEventListener('click', async (e) => {
    const star = e.target.closest('[data-star]');
    const find = (k) => live.find((c) => c.key === k);
    if (star) {
      const ch = find(star.dataset.star);
      const existing = (await favs.find({ key: ch.key }))[0];
      if (existing) { await favs.remove(existing._id); favIds.delete(ch.key); } else { await favs.insert({ ...ch }); favIds.add(ch.key); }
      return $('kind').value === 'favs' ? showSaved() : renderList();
    }
    const row = e.target.closest('[data-key]');
    if (row) play(find(row.dataset.key));
  });

  async function play(ch) {
    current = ch;
    renderList();
    $('nowTitle').textContent = ch.name;
    $('nowMeta').textContent = ch.group;
    $('screenMsg').textContent = 'Connecting…';
    video.hidden = false;
    video.src = ch.url; // WebKit plays HLS natively
    try { await video.play(); $('screenMsg').textContent = ''; } catch (err) { if (err.name !== 'AbortError') $('screenMsg').textContent = 'Press play to start'; }
  }
  video.addEventListener('error', () => {
    video.hidden = true;
    $('screenMsg').textContent = 'This channel went offline or can’t be played here. Try another one.';
  });

  $('kind').onchange = () => { fillPick(); showSaved(); };
  $('pick').onchange = showSaved;
  $('credit').onclick = (e) => { e.preventDefault(); wd.openUrl('https://github.com/iptv-org/iptv'); };

  (async () => {
    try { await loadLists(); } catch (e) { wd.ui.toast('Could not load the channel directory: ' + e.message, 'error'); }
    favIds = new Set((await favs.find()).map((f) => f.key));
    fillPick();
    const guess = (navigator.language.split('-')[1] || 'us').toLowerCase();
    if (countries.some((c) => c.code === guess)) $('pick').value = guess;
    showSaved();
  })();
})();
