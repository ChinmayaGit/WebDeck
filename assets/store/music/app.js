(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  // Material icons as inline SVG (works offline).
  const ICON = {
    play: 'M8 5v14l11-7z', pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z', prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
    shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
    repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
    repeatOne: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
    heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    heartOutline: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    eq: 'M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z',
  };
  const svg = (name) => `<svg class="i" viewBox="0 0 24 24"><path d="${ICON[name]}"/></svg>`;
  // Stable cover colors per song/album.
  const HUES = [[350, 280], [200, 250], [160, 200], [25, 345], [45, 15], [265, 310], [190, 140]];
  function coverStyle(key) {
    let h = 0;
    for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const [a, b] = HUES[h % HUES.length];
    return `background:linear-gradient(135deg,hsl(${a} 75% 52%),hsl(${b} 70% 38%))`;
  }
  const tracksDb = wd.db.collection('tracks');
  const audio = $('audio');
  const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'oga', 'alac', 'aif', 'aiff'];
  const fmtT = (s) => (!isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

  /** "01 - Artist - Title.mp3" → {artist, title} */
  function parseName(name) {
    const base = name.replace(/\.[^.]+$/, '').replace(/^\d{1,3}[\s.\-_]+/, '').replace(/_/g, ' ');
    const parts = base.split(' - ');
    return parts.length >= 2 ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() } : { artist: '', title: base.trim() };
  }

  // ------------------------------------------------------------ tabs
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['library', 'favs', 'free'].forEach((id) => ($(id).hidden = id !== b.dataset.tab));
    if (b.dataset.tab === 'favs') renderFavs();
  }));

  // ---------------------------------------------------------- library
  let library = [];
  async function loadLibrary() {
    library = await tracksDb.find(null, { sort: 'title' });
    renderLibrary();
  }
  async function addFiles(files, folder) {
    const known = new Set(library.map((t) => t.path));
    let added = 0;
    for (const f of files) {
      if (known.has(f.path) || !AUDIO_EXT.includes(f.ext)) continue;
      const { artist, title } = parseName(f.name);
      await tracksDb.insert({ path: f.path, name: f.name, title, artist, album: folder || '', size: f.size, fav: false });
      added++;
    }
    await loadLibrary();
    wd.ui.toast(added ? `Added ${added} song${added === 1 ? '' : 's'}` : 'No new songs found', added ? 'ok' : undefined);
  }
  $('addFolder').onclick = async () => {
    try {
      const r = await wd.files.pickFolder({ extensions: AUDIO_EXT });
      if (r) await addFiles(r.files, r.name);
    } catch (e) { wd.ui.toast(e.message, 'error'); }
  };
  $('addFiles').onclick = async () => {
    try { await addFiles(await wd.files.pick({ type: 'audio', multiple: true, remember: true })); } catch (e) { wd.ui.toast(e.message, 'error'); }
  };
  $('filter').oninput = renderLibrary;

  function trackRow(t, i, listName) {
    const playing = current && (current.path ? current.path === t.path : current.url === t.url);
    return `<div class="track ${playing ? 'playing' : ''}" data-list="${listName}" data-i="${i}">
      <span class="n" style="${coverStyle(t.album || t.title)}">${playing && !audio.paused ? svg('eq') : esc((t.title || '?').trim().charAt(0).toUpperCase())}</span>
      <div style="min-width:0"><div class="wd-ellipsis">${esc(t.title)}</div><div class="wd-small wd-muted wd-ellipsis">${esc([t.artist, t.album].filter(Boolean).join(' · '))}</div></div>
      ${t._id ? `<button class="icon-btn heart ${t.fav ? 'on' : ''}" data-fav="${t._id}" title="Favorite">${svg(t.fav ? 'heart' : 'heartOutline')}</button>` : '<span></span>'}
      ${t._id ? `<button class="icon-btn" data-rm="${t._id}" title="Remove from library">${svg('close')}</button>` : '<span></span>'}
    </div>`;
  }
  let views = { lib: [], fav: [], free: [] };
  function renderLibrary() {
    const q = $('filter').value.toLowerCase();
    views.lib = library.filter((t) => !q || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));
    $('sub').textContent = `${library.length} song${library.length === 1 ? '' : 's'} in your library`;
    $('tracks').innerHTML = views.lib.map((t, i) => trackRow(t, i, 'lib')).join('') ||
      '<div class="wd-empty"><div class="wd-empty-icon">💿</div>Add a music folder to get started, or explore Free music.</div>';
  }
  function renderFavs() {
    views.fav = library.filter((t) => t.fav);
    $('favTracks').innerHTML = views.fav.map((t, i) => trackRow(t, i, 'fav')).join('') || '<div class="wd-empty">Tap ♡ on any song to add it here.</div>';
  }

  document.addEventListener('click', async (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const t = library.find((x) => x._id === fav.dataset.fav);
      await tracksDb.update(t._id, { fav: !t.fav });
      t.fav = !t.fav;
      renderLibrary(); renderFavs();
      return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) { await tracksDb.remove(rm.dataset.rm); await loadLibrary(); renderFavs(); return; }
    const row = e.target.closest('.track[data-list]');
    if (row) playList(views[row.dataset.list], +row.dataset.i);
  });
  $('playAll').onclick = () => views.lib.length && playList(views.lib, shuffle ? Math.floor(Math.random() * views.lib.length) : 0);

  // ------------------------------------------------------- free music
  $('fForm').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('fq').value.trim();
    if (!q) return;
    const col = $('fcol').value;
    const colQ = col === 'all' ? '(collection:(netlabels OR etree OR opensource_audio OR audio_music))' : `collection:(${col})`;
    $('freeOut').innerHTML = '<div class="wd-muted">Searching…</div>';
    try {
      const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(${q}) AND mediatype:audio AND ${colQ}`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=downloads&sort[]=downloads+desc&rows=40&output=json`;
      const d = (await wd.net.fetch(url, { timeout: 25 })).json();
      const docs = d.response.docs;
      $('freeOut').innerHTML = docs.length ? `<div class="albums">${docs.map((a) => `<div class="album" data-album="${esc(a.identifier)}">
          <img src="https://archive.org/services/img/${esc(a.identifier)}" loading="lazy" alt="">
          <div class="t">${esc(Array.isArray(a.title) ? a.title[0] : a.title)}</div><div class="wd-small wd-muted wd-ellipsis">${esc([].concat(a.creator || []).join(', '))}${a.year ? ' · ' + esc(a.year) : ''}</div></div>`).join('')}</div>`
        : '<div class="wd-empty">Nothing found. Try another search.</div>';
    } catch (err) { $('freeOut').innerHTML = `<div class="wd-error">${esc(err.message)}</div>`; }
  };

  $('freeOut').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-album]');
    if (a) return openAlbum(a.dataset.album);
    if (e.target.id === 'backFree') return $('fForm').requestSubmit ? $('fForm').requestSubmit() : $('fForm').onsubmit(new Event('submit'));
    const dl = e.target.closest('[data-dl]');
    if (dl) {
      const t = views.free[+dl.dataset.dl];
      dl.disabled = true;
      try {
        const d = await wd.net.download(t.url, { name: t.file, subdir: `Music/${t.album.replace(/[\\/:*?"<>|]/g, '').slice(0, 80)}`, onProgress: (p) => (dl.textContent = p.total ? Math.round((p.received / p.total) * 100) + '%' : '…') });
        await tracksDb.insert({ path: d.path, name: d.name, title: t.title, artist: t.artist, album: t.album, fav: false });
        await loadLibrary();
        dl.textContent = '✓ Saved';
      } catch (err) { wd.ui.toast(err.message, 'error'); dl.disabled = false; dl.textContent = 'Download'; }
      return;
    }
    if (e.target.id === 'dlAll') {
      e.target.disabled = true;
      for (const [i] of views.free.entries()) {
        const b = document.querySelector(`[data-dl="${i}"]`);
        if (b && !b.disabled) { b.click(); await new Promise((r) => setTimeout(r, 300)); }
      }
    }
  });

  async function openAlbum(id) {
    $('freeOut').innerHTML = '<div class="wd-muted">Loading tracks…</div>';
    try {
      const meta = (await wd.net.fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, { timeout: 25 })).json();
      const m = meta.metadata || {};
      const album = [].concat(m.title || id)[0];
      const artist = [].concat(m.creator || '')[0];
      // Prefer MP3 derivatives (stream everywhere); fall back to originals.
      let files = (meta.files || []).filter((f) => /\.mp3$/i.test(f.name) && !f.private);
      if (!files.length) files = (meta.files || []).filter((f) => /\.(m4a|ogg|flac|wav)$/i.test(f.name) && !f.private);
      const seen = new Set();
      files = files.filter((f) => { const k = f.name.replace(/\.[^.]+$/, '').replace(/_vbr$|_64kb$/i, ''); if (seen.has(k)) return false; seen.add(k); return true; });
      files.sort((a, b) => (parseInt(a.track, 10) || 0) - (parseInt(b.track, 10) || 0) || a.name.localeCompare(b.name));
      views.free = files.map((f) => ({
        title: f.title || parseName(f.name).title, artist: f.creator || artist || '', album,
        url: `https://archive.org/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`, file: f.name.split('/').pop(),
        length: f.length,
      }));
      $('freeOut').innerHTML = `<div class="wd-row" style="margin-bottom:12px;align-items:flex-start">
          <img src="https://archive.org/services/img/${esc(id)}" style="width:140px;border-radius:10px" alt="">
          <div class="wd-grow"><h2>${esc(album)}</h2><div class="wd-muted">${esc(artist)}${m.date ? ' · ' + esc(String(m.date).slice(0, 10)) : ''}</div>
            <div class="wd-small wd-muted" style="margin-top:4px">${esc(m.licenseurl ? 'License: ' + m.licenseurl : 'Internet Archive')}</div>
            <div class="wd-row" style="margin-top:10px"><button class="wd-btn wd-btn-primary" id="playAlbum">▶ Play</button><button class="wd-btn" id="dlAll">Download all</button><button class="wd-btn wd-btn-ghost" id="backFree">← Results</button></div></div></div>
        ${views.free.map((t, i) => `<div class="track" data-list="free" data-i="${i}"><span class="n">${i + 1}</span><div style="min-width:0"><div class="wd-ellipsis">${esc(t.title)}</div><div class="wd-small wd-muted">${esc(t.artist)}${t.length ? ' · ' + fmtT(+t.length || 0) : ''}</div></div>
          <span></span><button class="wd-btn wd-btn-sm" data-dl="${i}">Download</button></div>`).join('') || '<div class="wd-empty">No playable tracks in this item.</div>'}`;
      $('playAlbum').onclick = () => views.free.length && playList(views.free, 0);
    } catch (err) { $('freeOut').innerHTML = `<div class="wd-error">${esc(err.message)}</div>`; }
  }

  // ----------------------------------------------------------- player
  let queue = [], index = -1, current = null, shuffle = false, repeat = 'off';
  async function playList(list, i) {
    queue = list.slice();
    index = i;
    await playCurrent();
  }
  async function playCurrent() {
    current = queue[index];
    if (!current) return;
    try {
      audio.src = current.path ? (await wd.files.url(current.path)).url : current.url;
      await audio.play();
    } catch (err) {
      wd.ui.toast(`Can't play “${current.title}”: ${err.message}`, 'error');
    }
    $('npTitle').textContent = current.title;
    $('npArt').setAttribute('style', coverStyle(current.album || current.title));
    $('npSub').textContent = [current.artist, current.album].filter(Boolean).join(' · ');
    document.title = `${current.title} · Music`;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist || '', album: current.album || '' });
    }
    renderLibrary(); renderFavs();
    document.querySelectorAll('.track[data-list="free"]').forEach((r) => r.classList.toggle('playing', views.free[+r.dataset.i]?.url === current.url));
  }
  function step(dir) {
    if (!queue.length) return;
    if (shuffle && dir > 0) index = Math.floor(Math.random() * queue.length);
    else index = (index + dir + queue.length) % queue.length;
    playCurrent();
  }
  audio.addEventListener('ended', () => {
    if (repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
    if (!shuffle && index === queue.length - 1 && repeat === 'off') return;
    step(1);
  });
  audio.addEventListener('play', () => { $('play').innerHTML = svg('pause'); renderLibrary(); renderFavs(); });
  audio.addEventListener('pause', () => { $('play').innerHTML = svg('play'); renderLibrary(); renderFavs(); });
  audio.addEventListener('timeupdate', () => {
    $('cur').textContent = fmtT(audio.currentTime);
    $('dur').textContent = fmtT(audio.duration);
    if (!seeking) $('seek').value = audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0;
  });
  audio.addEventListener('error', () => { if (current) wd.ui.toast(`This format can't be played here: ${current.title}`, 'error'); });
  let seeking = false;
  $('seek').oninput = () => { seeking = true; };
  $('seek').onchange = () => { if (audio.duration) audio.currentTime = ($('seek').value / 1000) * audio.duration; seeking = false; };
  $('play').onclick = () => (audio.src ? (audio.paused ? audio.play() : audio.pause()) : $('playAll').click());
  $('next').onclick = () => step(1);
  $('prev').onclick = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : step(-1));
  $('shuffle').onclick = () => { shuffle = !shuffle; $('shuffle').classList.toggle('on', shuffle); };
  $('repeat').onclick = () => {
    repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    $('repeat').classList.toggle('on', repeat !== 'off');
    $('repeat').innerHTML = svg(repeat === 'one' ? 'repeatOne' : 'repeat');
  };
  $('play').innerHTML = svg('play');
  $('next').innerHTML = svg('next');
  $('prev').innerHTML = svg('prev');
  $('shuffle').innerHTML = svg('shuffle');
  $('repeat').innerHTML = svg('repeat');
  // Tap the song info to expand into Now Playing; chevron or Escape to collapse.
  $('npInfo').onclick = () => $('player').classList.toggle('expanded');
  $('npClose').onclick = () => $('player').classList.remove('expanded');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('player').classList.remove('expanded'); });
  $('vol').oninput = () => { audio.volume = $('vol').value / 100; wd.kv.set('volume', audio.volume); };
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
  });

  (async () => {
    audio.volume = await wd.kv.get('volume', 0.8);
    $('vol').value = Math.round(audio.volume * 100);
    await loadLibrary();
  })();
})();
