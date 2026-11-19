(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const vids = wd.db.collection('videos');
  const video = $('video');
  const EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv', '3gp'];
  const PLAYABLE = ['mp4', 'm4v', 'mov', 'webm', 'ogv', '3gp'];
  const fmtT = (s) => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };

  let list = [];
  async function load() { list = await vids.find(); render(); }
  function render() {
    const q = $('filter').value.toLowerCase();
    const sort = $('sort').value;
    const shown = list.filter((v) => !q || v.name.toLowerCase().includes(q)).sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'added' ? b._createdAt.localeCompare(a._createdAt) : (b.watchedAt || '').localeCompare(a.watchedAt || ''));
    $('sub').textContent = list.length ? `${list.length} video${list.length === 1 ? '' : 's'}` : 'Your videos, resumed where you left off';
    $('grid').innerHTML = shown.map((v) => `<div class="vid" data-id="${v._id}">
      <div class="thumb" ${v.poster ? `style="background-image:url('${esc(v.poster)}')"` : ''}>${v.poster ? '' : '🎬'}${v.duration ? `<span class="len">${fmtT(v.duration)}</span>` : ''}</div>
      <div class="prog"><div style="width:${v.duration ? Math.min(100, (v.position || 0) / v.duration * 100) : 0}%"></div></div>
      <div class="meta"><div class="wd-ellipsis" title="${esc(v.name)}">${esc(v.name)}</div>
        <div class="wd-row wd-small wd-muted" style="gap:6px">${esc(v.folder || '')}${PLAYABLE.includes(v.ext) ? '' : '<span class="wd-badge wd-badge-amber" title="Convert to MP4 with Video Toolkit">needs MP4</span>'}<span class="wd-spacer"></span><a href="#" data-rm="${v._id}">Remove</a></div></div></div>`).join('') ||
      '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">📼</div>Add a folder of videos to build your library.</div>';
  }
  $('filter').oninput = render;
  $('sort').onchange = render;

  async function add(files, folder) {
    const known = new Set(list.map((v) => v.path));
    let n = 0;
    for (const f of files) {
      if (known.has(f.path) || !EXT.includes(f.ext)) continue;
      await vids.insert({ path: f.path, name: f.name.replace(/\.[^.]+$/, ''), ext: f.ext, size: f.size, folder: folder || '', position: 0 });
      n++;
    }
    await load();
    wd.ui.toast(n ? `Added ${n} video${n === 1 ? '' : 's'}` : 'No new videos found', n ? 'ok' : undefined);
  }
  $('addFolder').onclick = async () => { try { const r = await wd.files.pickFolder({ extensions: EXT }); if (r) await add(r.files, r.name); } catch (e) { wd.ui.toast(e.message, 'error'); } };
  $('addFiles').onclick = async () => { try { await add(await wd.files.pick({ type: 'video', multiple: true, remember: true })); } catch (e) { wd.ui.toast(e.message, 'error'); } };

  $('grid').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.preventDefault(); e.stopPropagation(); await vids.remove(rm.dataset.rm); return load(); }
    const card = e.target.closest('[data-id]');
    if (card) play(list.find((v) => v._id === card.dataset.id));
  });

  // ------------------------------------------------------------ player
  let playing = null;
  $('speed').innerHTML = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => `<option value="${s}" ${s === 1 ? 'selected' : ''}>${s}×</option>`).join('');
  async function play(v, url) {
    playing = v || null;
    $('playerWrap').hidden = false;
    $('ptitle').textContent = v ? v.name : url;
    [...video.querySelectorAll('track')].forEach((t) => t.remove());
    try {
      video.src = v ? (await wd.files.url(v.path)).url : url;
      if (v && v.position && (!v.duration || v.position < v.duration - 10)) video.currentTime = v.position;
      video.playbackRate = +$('speed').value;
      await video.play();
    } catch (err) {
      if (err.name !== 'AbortError') wd.ui.toast(v && !PLAYABLE.includes(v.ext) ? `.${v.ext} can't play here. Convert it to MP4 with Video Toolkit.` : err.message, 'error');
    }
  }
  video.addEventListener('error', () => {
    const ext = playing?.ext;
    wd.ui.toast(ext && !PLAYABLE.includes(ext) ? `.${ext} files can't play in the built-in player. Convert to MP4 with Video Toolkit.` : 'This video could not be played.', 'error');
  });
  video.addEventListener('loadedmetadata', async () => {
    if (!playing || playing.duration) return;
    // Grab a poster frame once for the library card.
    await vids.update(playing._id, { duration: video.duration });
    playing.duration = video.duration;
  });
  let lastSave = 0;
  video.addEventListener('timeupdate', () => {
    if (!playing || Date.now() - lastSave < 4000) return;
    lastSave = Date.now();
    vids.update(playing._id, { position: video.currentTime, watchedAt: new Date().toISOString() });
  });
  video.addEventListener('seeked', async () => {
    if (!playing || playing.poster || video.videoWidth === 0) return;
    try {
      const c = document.createElement('canvas');
      c.width = 320; c.height = Math.round(320 * video.videoHeight / video.videoWidth);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      const poster = c.toDataURL('image/jpeg', 0.7);
      if (poster.length > 1000) { playing.poster = poster; await vids.update(playing._id, { poster }); }
    } catch (_) { /* cross-origin or not ready */ }
  });
  async function closePlayer() {
    if (playing) await vids.update(playing._id, { position: video.currentTime, watchedAt: new Date().toISOString() });
    video.pause();
    video.removeAttribute('src');
    video.load();
    $('playerWrap').hidden = true;
    playing = null;
    load();
  }
  $('back').onclick = closePlayer;
  $('speed').onchange = () => (video.playbackRate = +$('speed').value);
  $('pip').onclick = () => (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture?.().catch((e) => wd.ui.toast(e.message, 'error')));
  $('subs').onclick = async () => {
    try {
      const [f] = await wd.files.pick({ extensions: ['srt', 'vtt'] });
      if (!f) return;
      let text = await (await fetch(f.url)).text();
      if (f.ext === 'srt') text = 'WEBVTT\n\n' + text.replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
      const track = document.createElement('track');
      track.kind = 'subtitles'; track.label = f.name; track.default = true;
      track.src = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
      video.appendChild(track);
      track.track.mode = 'showing';
      wd.ui.toast('Subtitles loaded', 'ok');
    } catch (e) { wd.ui.toast(e.message, 'error'); }
  };
  let idle;
  $('playerWrap').addEventListener('mousemove', () => { $('playerWrap').classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => $('playerWrap').classList.add('idle'), 2500); });
  document.addEventListener('keydown', (e) => {
    if ($('playerWrap').hidden || e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') closePlayer();
    if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    if (e.key === 'ArrowRight') video.currentTime += 10;
    if (e.key === 'ArrowLeft') video.currentTime -= 10;
    if (e.key === 'f') (document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen?.());
  });
  $('urlForm').onsubmit = (e) => { e.preventDefault(); const u = $('url').value.trim(); if (/^https?:\/\//.test(u)) play(null, u); };

  load();
})();
