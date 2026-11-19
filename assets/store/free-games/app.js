(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = wd.ui.escape;
  const API = 'https://www.gamerpower.com/api/giveaways';

  const PLATFORMS = [
    { id: 'epic', label: 'Epic Games', match: /epic games/i },
    { id: 'steam', label: 'Steam', match: /steam/i },
    { id: 'gog', label: 'GOG', match: /\bgog\b/i },
    { id: 'itch', label: 'itch.io', match: /itch\.io/i },
    { id: 'pc-other', label: 'Other PC / DRM-free', match: /drm-free|indiegala/i },
    { id: 'playstation', label: 'PlayStation', match: /ps4|ps5|playstation/i },
    { id: 'xbox', label: 'Xbox', match: /xbox/i },
    { id: 'switch', label: 'Switch', match: /switch/i },
    { id: 'mobile', label: 'Android / iOS', match: /android|ios/i },
    { id: 'vr', label: 'VR', match: /\bvr\b/i },
  ];
  const DEFAULT_NOTIFY = ['epic', 'steam', 'gog'];

  const PC_STORES = ['epic', 'steam', 'gog', 'itch', 'pc-other'];
  function platformsOf(g) {
    const parts = g.platforms.split(',').map((s) => s.trim());
    const ids = PLATFORMS.filter((p) => parts.some((s) => p.match.test(s))).map((p) => p.id);
    // Plain "PC" giveaways from smaller stores.
    if (parts.some((s) => /^pc$/i.test(s)) && !ids.some((id) => PC_STORES.includes(id))) ids.push('pc-other');
    return ids;
  }

  async function fetchGiveaways(includeLoot) {
    const types = includeLoot ? ['game', 'loot'] : ['game'];
    const all = [];
    for (const type of types) {
      const res = await wd.net.fetch(`${API}?type=${type}&sort-by=date`, { timeout: 30 });
      if (res.status === 201) continue; // GamerPower: no active giveaways for this type
      if (!res.ok) throw new Error(`GamerPower returned HTTP ${res.status}`);
      const list = res.json();
      if (Array.isArray(list)) all.push(...list);
    }
    return all.map((g) => ({
      id: String(g.id),
      title: g.title.replace(/\s*\((Epic Games|Steam|GOG|IndieGala|Itch\.io)\)\s*Giveaway$/i, '').replace(/\s*Giveaway$/i, ''),
      worth: g.worth && g.worth !== 'N/A' ? g.worth : null,
      image: g.image || g.thumbnail,
      platforms: g.platforms || '',
      type: g.type,
      endDate: g.end_date && g.end_date !== 'N/A' ? g.end_date.replace(' ', 'T') : null,
      url: g.open_giveaway_url || g.gamerpower_url,
      description: g.description,
      published: g.published_date,
    }));
  }

  // ------------------------------------------------------- background job
  if (wd.job.active) {
    wd.job.run(async () => {
      const includeLoot = await wd.kv.get('includeLoot', false);
      const games = await fetchGiveaways(includeLoot);
      await wd.kv.set('cache', { at: new Date().toISOString(), games });
      const seen = new Set(await wd.kv.get('seen', []));
      const firstRun = seen.size === 0;
      const notifyFor = new Set(await wd.kv.get('notifyPlatforms', DEFAULT_NOTIFY));
      const fresh = games.filter((g) => !seen.has(g.id) && platformsOf(g).some((p) => notifyFor.has(p)));
      games.forEach((g) => seen.add(g.id));
      await wd.kv.set('seen', [...seen].slice(-1000));
      if (!firstRun && fresh.length) {
        const names = fresh.slice(0, 3).map((g) => g.title).join(', ');
        await wd.notify(
          fresh.length === 1 ? `Free now: ${fresh[0].title}` : `${fresh.length} new free games`,
          fresh.length === 1 ? `${fresh[0].platforms}${fresh[0].worth ? ` · worth ${fresh[0].worth}` : ''}` : names + (fresh.length > 3 ? '…' : ''),
          { url: fresh.length === 1 ? fresh[0].url : undefined },
        );
      }
      return `${games.length} active giveaways, ${firstRun ? 'baseline saved' : `${fresh.length} new`}`;
    });
    return;
  }

  // ------------------------------------------------------------------- UI
  let games = [];
  let filter = 'all';
  let seen = new Set();

  function remaining(end) {
    if (!end) return '';
    const ms = Date.parse(end) - Date.now();
    if (Number.isNaN(ms)) return '';
    if (ms <= 0) return 'Ending';
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
  }

  function render() {
    const counts = {};
    games.forEach((g) => platformsOf(g).forEach((p) => (counts[p] = (counts[p] || 0) + 1)));
    $('chips').innerHTML = [{ id: 'all', label: 'All' }, ...PLATFORMS.filter((p) => counts[p.id])]
      .map((p) => `<button class="wd-chip" aria-pressed="${filter === p.id}" data-filter="${p.id}">${esc(p.label)}${p.id === 'all' ? ` ${games.length}` : ` ${counts[p.id]}`}</button>`)
      .join('');
    const shown = filter === 'all' ? games : games.filter((g) => platformsOf(g).includes(filter));
    if (!shown.length) {
      $('games').innerHTML = '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">🕹️</div>No giveaways right now.</div>';
      return;
    }
    $('games').innerHTML = shown.map((g) => `
      <div class="game">
        <img src="${esc(g.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div class="body">
          <div class="wd-row" style="gap:6px">${!seen.has(g.id) ? '<span class="wd-badge wd-badge-blue">New</span>' : ''}${g.type !== 'Game' ? `<span class="wd-badge">${esc(g.type)}</span>` : ''}<span class="wd-small wd-muted wd-ellipsis wd-grow">${esc(g.platforms)}</span></div>
          <div class="title">${esc(g.title)}</div>
          <div class="foot">
            <span class="free">FREE</span>${g.worth ? `<span class="worth">${esc(g.worth)}</span>` : ''}
            <span class="wd-spacer"></span>
            <span class="wd-small wd-muted">${remaining(g.endDate)}</span>
            <button class="wd-btn wd-btn-primary wd-btn-sm" data-claim="${esc(g.id)}">Get</button>
          </div>
        </div>
      </div>`).join('');
  }

  async function refresh(force) {
    $('refresh').disabled = true;
    $('error').innerHTML = '';
    try {
      const cache = await wd.kv.get('cache', null);
      const fresh = cache && Date.now() - Date.parse(cache.at) < 30 * 60 * 1000;
      if (!force && fresh) {
        games = cache.games;
      } else {
        games = await fetchGiveaways(await wd.kv.get('includeLoot', false));
        await wd.kv.set('cache', { at: new Date().toISOString(), games });
      }
      $('sub').textContent = `${games.length} free giveaways · updated ${wd.ui.timeAgo((await wd.kv.get('cache')).at)}`;
    } catch (e) {
      const cache = await wd.kv.get('cache', null);
      if (cache) games = cache.games;
      $('error').innerHTML = `<div class="wd-error" style="margin-bottom:12px">Could not refresh: ${esc(e.message)}${cache ? '. Showing saved list.' : ''}</div>`;
    }
    render();
    // Everything visible now counts as seen (for the job's "new" detection), after rendering the badges.
    const merged = new Set([...(await wd.kv.get('seen', [])), ...games.map((g) => g.id)]);
    await wd.kv.set('seen', [...merged].slice(-1000));
    $('refresh').disabled = false;
  }

  async function renderSettings() {
    const notifyFor = new Set(await wd.kv.get('notifyPlatforms', DEFAULT_NOTIFY));
    $('notifyPlatforms').innerHTML = PLATFORMS.map((p) =>
      `<label><input type="checkbox" data-p="${p.id}" ${notifyFor.has(p.id) ? 'checked' : ''}> ${esc(p.label)}</label>`).join('');
    $('includeLoot').checked = await wd.kv.get('includeLoot', false);
  }

  $('notifyPlatforms').addEventListener('change', async () => {
    const ids = [...document.querySelectorAll('[data-p]')].filter((c) => c.checked).map((c) => c.dataset.p);
    await wd.kv.set('notifyPlatforms', ids);
    wd.ui.toast('Alert preferences saved', 'ok');
  });
  $('includeLoot').onchange = async () => {
    await wd.kv.set('includeLoot', $('includeLoot').checked);
    refresh(true);
  };
  $('settingsBtn').onclick = () => { $('settings').hidden = !$('settings').hidden; };
  $('refresh').onclick = () => refresh(true);
  $('credit').onclick = (e) => { e.preventDefault(); wd.openUrl('https://www.gamerpower.com'); };
  $('chips').addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]')?.dataset.filter;
    if (f) { filter = f; render(); }
  });
  $('games').addEventListener('click', (e) => {
    const id = e.target.closest('[data-claim]')?.dataset.claim;
    const g = games.find((x) => x.id === id);
    if (g) wd.openUrl(g.url).catch((err) => wd.ui.toast(err.message, 'error'));
  });

  (async () => {
    seen = new Set(await wd.kv.get('seen', []));
    await renderSettings();
    await refresh(false);
  })();
})();
