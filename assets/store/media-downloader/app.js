(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = wd.ui.escape;
  const col = wd.db.collection('downloads');
  const REQUIRED = ['yt-dlp', 'ffmpeg'];

  let mode = 'video';
  let downloads = []; // newest first
  const live = {}; // _id -> {progress, speed, eta, file, item, of}

  // ------------------------------------------------------------------ setup
  async function checkTools() {
    let status;
    try {
      status = await wd.tools.status();
    } catch (e) {
      $('setup').hidden = false;
      $('setupTools').innerHTML = `<div class="wd-error">${esc(e.message)}</div>`;
      return false;
    }
    if (!status.supported) {
      $('setup').hidden = false;
      $('setupTools').innerHTML = '<div class="wd-notice">Downloading needs WebDeck on macOS, Windows or Linux.</div>';
      $('go').disabled = true;
      return false;
    }
    const missing = REQUIRED.filter((t) => !status[t].installed);
    $('setup').hidden = missing.length === 0;
    $('go').disabled = missing.length > 0;
    $('setupTools').innerHTML = REQUIRED.map((t) => {
      const s = status[t];
      const right = s.installed
        ? '<span class="wd-badge wd-badge-green">Ready</span>'
        : `<button class="wd-btn wd-btn-primary wd-btn-sm" data-install="${t}">Install</button>`;
      return `<div class="setup-tool"><div class="wd-grow"><b>${esc(s.name)}</b>
        <div class="wd-small wd-muted" id="msg-${t}">${t === 'yt-dlp' ? 'Fetches the media' : 'Merges video + audio and converts music'}</div></div>${right}</div>`;
    }).join('');
    return missing.length === 0;
  }

  $('setupTools').addEventListener('click', async (e) => {
    const tool = e.target.dataset.install;
    if (!tool) return;
    e.target.disabled = true;
    e.target.textContent = 'Installing…';
    try {
      await wd.tools.install(tool, (p) => {
        const msg = $('msg-' + tool);
        if (msg) msg.textContent = p.message;
      });
      wd.ui.toast(tool + ' installed', 'ok');
    } catch (err) {
      wd.ui.toast(err.message, 'error');
    }
    checkTools();
  });

  // ---------------------------------------------------------------- options
  function setMode(m) {
    mode = m;
    document.querySelectorAll('.wd-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
    document.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== m || (el.dataset.preset === '1' && !$('playlist').checked); });
    if (typeof renderPicker === 'function' && analyzed) renderPicker();
    try { localStorage.setItem('md-mode', m); } catch (_) {}
  }
  document.querySelectorAll('.wd-tab').forEach((t) => (t.onclick = () => setMode(t.dataset.mode)));

  function buildArgs(url) {
    const playlist = $('playlist').checked;
    const meta = $('meta').checked;
    const out = playlist
      ? '%(playlist_title).80B/%(playlist_index)03d - %(title).150B [%(id)s].%(ext)s'
      : '%(title).150B [%(id)s].%(ext)s';
    const args = ['--newline', '--no-mtime', '--no-colors', '-o', out, playlist ? '--yes-playlist' : '--no-playlist'];

    if (mode === 'video') {
      const q = $('vq').value;
      const container = $('vc').value;
      const res = q === 'best' ? 'res' : 'res:' + q;
      const codecs = container === 'mp4' ? ',vcodec:h264,acodec:m4a' : container === 'webm' ? ',vcodec:vp9,acodec:opus' : '';
      args.push('-f', 'bv*+ba/b', '-S', res + codecs, '--merge-output-format', container);
      if (meta) args.push('--embed-metadata', '--embed-chapters', ...(container === 'webm' ? [] : ['--embed-thumbnail']));
      if ($('subs').checked) args.push('--write-subs', '--sub-langs', 'en.*,en', '--embed-subs');
      return { args, label: `Video · ${q === 'best' ? 'best' : q + 'p'} · ${container.toUpperCase()}` };
    }
    const fmt = $('af').value;
    const aq = $('aq').value;
    args.push('-f', 'ba/b', '-x', '--audio-format', fmt, '--audio-quality', aq);
    if (meta) args.push('--embed-metadata', ...(fmt === 'wav' ? [] : ['--embed-thumbnail']));
    return { args, label: `Music · ${fmt.toUpperCase()}${aq !== '0' && fmt !== 'flac' && fmt !== 'wav' ? ' · ' + aq.replace('K', ' kbps') : ''}` };
  }

  // -------------------------------------------------------------- downloads
  // ------------------------------------------------- format picker (yt-dlp -J)
  let analyzed = null; // { url, info, video:[], audio:[] }
  let choice = null;

  const mb = (n) => (n ? (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : Math.max(0.1, n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB') : '');
  const sizeOf = (f, dur) => f.filesize || f.filesize_approx || (f.tbr && dur ? (f.tbr * 1000 / 8) * dur : 0);
  const fmtDur = (s) => (s ? `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');

  async function analyze(url) {
    $('go').disabled = true;
    $('go').textContent = 'Reading link…';
    $('picker').hidden = false;
    $('picker').innerHTML = '<div class="wd-progress wd-indeterminate"><div></div></div><p class="wd-small wd-muted" style="margin-top:8px">Fetching available qualities…</p>';
    try {
      const task = await wd.tools.run('yt-dlp', ['-J', '--no-playlist', '--no-warnings', '--', url]);
      const jsonLine = task.lines.find((l) => l.startsWith('{'));
      if (task.status !== 'done' || !jsonLine) {
        const err = task.lines.filter((l) => l.startsWith('ERROR')).pop() || task.error || 'Could not read this link';
        throw new Error(err.replace(/^ERROR:\s*/, ''));
      }
      const info = JSON.parse(jsonLine);
      const dur = info.duration || 0;
      const formats = info.formats || [];
      const audioOnly = formats.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
      const bestAudio = audioOnly.slice().sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];
      // Best stream per resolution, preferring H.264/MP4 for compatibility at equal height.
      const byHeight = new Map();
      for (const f of formats.filter((x) => x.vcodec && x.vcodec !== 'none' && x.height)) {
        const cur = byHeight.get(f.height);
        const score = (x) => (x.tbr || 0) + (/avc|h264/.test(x.vcodec) ? 1e5 : 0) + (x.fps > 30 ? 5e4 : 0);
        if (!cur || score(f) > score(cur)) byHeight.set(f.height, f);
      }
      const video = [...byHeight.values()].sort((a, b) => b.height - a.height).map((f) => {
        const needsAudio = !f.acodec || f.acodec === 'none';
        return {
          id: needsAudio ? `${f.format_id}+bestaudio/best` : f.format_id,
          label: `${f.height}p`,
          detail: [f.ext.toUpperCase(), f.fps ? Math.round(f.fps) + ' fps' : '', (f.vcodec || '').split('.')[0], mb(sizeOf(f, dur) + (needsAudio && bestAudio ? sizeOf(bestAudio, dur) : 0)) ? '~' + mb(sizeOf(f, dur) + (needsAudio && bestAudio ? sizeOf(bestAudio, dur) : 0)) : ''].filter(Boolean).join(' · '),
          height: f.height,
        };
      });
      const audio = audioOnly.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0)).map((f) => ({
        id: f.format_id,
        label: `${Math.round(f.abr || f.tbr || 0) || '?'} kbps`,
        detail: [f.ext.toUpperCase(), (f.acodec || '').split('.')[0], f.format_note || '', mb(sizeOf(f, dur)) ? '~' + mb(sizeOf(f, dur)) : ''].filter(Boolean).join(' · '),
        ext: f.ext,
      }));
      if (!video.length && !audio.length) {
        // Some sites only expose a single combined format.
        video.push({ id: 'best', label: 'Best', detail: (info.ext || '').toUpperCase(), height: info.height || 0 });
      }
      analyzed = { url, info, video, audio };
      choice = mode === 'audio' ? audio[0] || null : video.find((v) => v.height <= 1080) || video[0] || null;
      renderPicker();
    } catch (err) {
      $('picker').innerHTML = `<div class="wd-error">${esc(err.message)}</div>`;
    } finally {
      $('go').disabled = false;
      $('go').textContent = 'Get formats';
    }
  }

  function renderPicker() {
    if (!analyzed) return;
    const { info, video, audio } = analyzed;
    const list = mode === 'audio' ? audio : video;
    if (choice && !list.includes(choice)) choice = list[0] || null;
    const outSel = mode === 'audio'
      ? `<select class="wd-select" id="pickOut" style="width:auto">${[['mp3', 'MP3'], ['m4a', 'M4A'], ['opus', 'Opus'], ['flac', 'FLAC'], ['wav', 'WAV'], ['original', 'Keep original']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`
      : `<select class="wd-select" id="pickOut" style="width:auto">${[['mp4', 'MP4'], ['mkv', 'MKV'], ['webm', 'WebM']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
    $('picker').innerHTML = `
      <div class="media-head">${info.thumbnail ? `<img src="${esc(info.thumbnail)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div class="wd-grow"><h2 style="margin-bottom:4px">${esc(info.title || analyzed.url)}</h2>
        <div class="wd-small wd-muted">${esc([info.uploader || info.channel, fmtDur(info.duration), info.extractor_key].filter(Boolean).join(' · '))}</div></div></div>
      <label class="wd-label">${mode === 'audio' ? 'Audio quality' : 'Video quality'}</label>
      ${list.length ? `<div class="choices">${list.map((c, i) => `<button class="choice" data-choice="${i}" aria-pressed="${c === choice}"><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></button>`).join('')}</div>`
        : `<div class="wd-notice">No ${mode === 'audio' ? 'separate audio' : 'video'} streams found${mode === 'audio' ? '. The audio will be extracted from the video instead.' : ''}</div>`}
      <div class="wd-row" style="margin-top:14px"><label class="wd-label" style="margin:0">Save as</label>${outSel}<div class="wd-spacer"></div>
        <button class="wd-btn" id="pickCancel">Cancel</button><button class="wd-btn wd-btn-primary" id="pickGo">Download</button></div>`;
  }

  $('picker').addEventListener('click', async (e) => {
    const c = e.target.closest('[data-choice]');
    if (c) { choice = (mode === 'audio' ? analyzed.audio : analyzed.video)[+c.dataset.choice]; renderPicker(); return; }
    if (e.target.id === 'pickCancel') { analyzed = null; $('picker').hidden = true; return; }
    if (e.target.id !== 'pickGo') return;
    const out = $('pickOut').value;
    const meta = $('meta').checked;
    const args = ['--newline', '--no-mtime', '--no-colors', '--no-playlist', '-o', '%(title).150B [%(id)s].%(ext)s'];
    let label;
    if (mode === 'audio') {
      args.push('-f', choice ? `${choice.id}/bestaudio/best` : 'bestaudio/best');
      if (out !== 'original') args.push('-x', '--audio-format', out, '--audio-quality', '0');
      if (meta) args.push('--embed-metadata', ...(['wav', 'original'].includes(out) ? [] : ['--embed-thumbnail']));
      label = `Music · ${choice ? choice.label : 'best'} · ${out === 'original' ? (choice?.ext || 'original').toUpperCase() : out.toUpperCase()}`;
    } else {
      args.push('-f', choice ? choice.id : 'bv*+ba/b', '--merge-output-format', out);
      if (meta) args.push('--embed-metadata', '--embed-chapters', ...(out === 'webm' ? [] : ['--embed-thumbnail']));
      if ($('subs').checked) args.push('--write-subs', '--sub-langs', 'en.*,en', '--embed-subs');
      label = `Video · ${choice ? choice.label : 'best'} · ${out.toUpperCase()}`;
    }
    const url = analyzed.url;
    analyzed = null;
    $('picker').hidden = true;
    $('url').value = '';
    await startDownload(url, args, label);
  });

  async function startDownload(url, args, label) {
    args.push('--', url);
    const doc = await col.insert({ url, mode, label, status: 'starting', files: [], playlist: false });
    downloads.unshift(doc);
    render();
    try {
      const task = await wd.call('tools.run', { tool: 'yt-dlp', args });
      Object.assign(doc, await col.update(doc._id, { status: 'running', taskId: task.id }));
      track(doc);
    } catch (err) {
      Object.assign(doc, await col.update(doc._id, { status: 'failed', error: err.message }));
      render();
    }
  }

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('url').value.trim();
    if (!/^https?:\/\//i.test(url)) { wd.ui.toast('Paste a full http(s) link', 'error'); return; }
    if (!(await checkTools())) return;
    // Single videos: let the user pick the exact quality. Playlists use the quick presets below.
    if (!$('playlist').checked) { await analyze(url); return; }
    const { args, label } = buildArgs(url);
    // "--" stops option parsing so a URL can never be read as a yt-dlp flag.
    args.push('--', url);
    const doc = await col.insert({ url, mode, label, status: 'starting', files: [], playlist: $('playlist').checked });
    downloads.unshift(doc);
    $('url').value = '';
    render();
    try {
      const task = await wd.call('tools.run', { tool: 'yt-dlp', args });
      Object.assign(doc, await col.update(doc._id, { status: 'running', taskId: task.id }));
      track(doc);
    } catch (err) {
      Object.assign(doc, await col.update(doc._id, { status: 'failed', error: err.message }));
      render();
    }
  });

  function parseLine(state, line) {
    let m;
    if ((m = line.match(/^\[download\]\s+([\d.]+)%(?:\s+of\s+~?\s*(\S+))?(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/))) {
      state.progress = parseFloat(m[1]);
      state.size = m[2] || state.size;
      state.speed = m[3] && !m[3].startsWith('Unknown') ? m[3] : state.speed;
      state.eta = m[4] && m[4] !== 'Unknown' ? m[4] : state.eta;
    } else if ((m = line.match(/^\[download\] Downloading (?:item|video) (\d+) of (\d+)/))) {
      state.item = +m[1];
      state.of = +m[2];
    } else if ((m = line.match(/^\[(?:download|ExtractAudio)\] Destination: (.+)$/))) {
      state.file = m[1].split(/[\\/]/).pop();
    } else if ((m = line.match(/^\[Merger\] Merging formats into "(.+)"$/))) {
      state.file = m[1].split(/[\\/]/).pop();
      state.phase = 'Merging…';
    } else if ((m = line.match(/^\[download\] (.+) has already been downloaded/))) {
      state.file = m[1].split(/[\\/]/).pop();
      state.progress = 100;
    } else if (/^\[(ExtractAudio|EmbedThumbnail|Metadata|FixupM3u8|VideoConvertor)\]/.test(line)) {
      state.phase = 'Processing…';
    } else if (line.startsWith('ERROR:')) {
      state.error = line.replace(/^ERROR:\s*/, '');
    }
  }

  async function track(doc) {
    const state = (live[doc._id] = live[doc._id] || { progress: 0 });
    let cursor = 0;
    for (;;) {
      let task;
      try {
        task = await wd.call('tasks.get', { id: doc.taskId, since: cursor });
      } catch (e) {
        // Task unknown: WebDeck restarted while this was running.
        Object.assign(doc, await col.update(doc._id, { status: 'failed', error: 'Interrupted (WebDeck was closed)' }));
        render();
        return;
      }
      cursor = task.cursor;
      task.lines.forEach((l) => parseLine(state, l));
      if (task.status !== 'running') {
        const files = (task.outputFiles || []).filter((f) => !/\.(jpe?g|png|webp|vtt|srt|ass|json|description)$/i.test(f));
        const status = task.status === 'done' ? 'done' : task.status;
        const error = status === 'failed' ? state.error || task.error || 'Download failed' : null;
        Object.assign(doc, await col.update(doc._id, { status, files, error, file: state.file || null }));
        delete live[doc._id];
        render();
        if (status === 'done') {
          const name = doc.file || (files[0] || '').split(/[\\/]/).pop() || doc.url;
          wd.notify('Download finished', name).catch(() => {});
        }
        return;
      }
      render();
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  function render() {
    const list = $('list');
    if (!downloads.length) {
      list.innerHTML = '<div class="wd-empty"><div class="wd-empty-icon">📥</div>Paste a link above to start.</div>';
      return;
    }
    list.innerHTML = downloads.map((d) => {
      const s = live[d._id];
      const name = (s && s.file) || d.file || d.url;
      let body = '';
      let actions = '';
      if (d.status === 'running' || d.status === 'starting') {
        const pct = s ? s.progress || 0 : 0;
        const indet = !s || (!s.progress && !s.phase) || s.phase;
        body = `<div class="wd-progress ${indet ? 'wd-indeterminate' : ''}" style="margin-top:8px"><div style="width:${pct}%"></div></div>
          <div class="progress-line"><span>${s && s.phase ? esc(s.phase) : pct.toFixed(1) + '%'}</span>
          ${s && s.of ? `<span>item ${s.item}/${s.of}</span>` : ''}
          ${s && s.size ? `<span>${esc(s.size)}</span>` : ''}${s && s.speed ? `<span>${esc(s.speed)}</span>` : ''}${s && s.eta ? `<span>ETA ${esc(s.eta)}</span>` : ''}</div>`;
        actions = `<button class="wd-btn wd-btn-sm" data-cancel="${d._id}">Cancel</button>`;
      } else if (d.status === 'done') {
        body = `<div class="wd-small wd-muted">${esc(d.label)} · ${wd.ui.timeAgo(d._updatedAt)}</div>`;
        actions = d.files && d.files.length && !d.playlist
          ? `<button class="wd-btn wd-btn-sm" data-open="${d._id}">Play</button><button class="wd-btn wd-btn-sm" data-reveal="${d._id}">Show</button>`
          : '<button class="wd-btn wd-btn-sm" data-folder="1">Open folder</button>';
      } else {
        body = `<div class="wd-small" style="color:var(--wd-red)">${esc(d.error || d.status)}</div>`;
        actions = `<button class="wd-btn wd-btn-sm" data-retry="${d._id}">Retry</button>`;
      }
      const badge = d.status === 'done' ? '<span class="wd-badge wd-badge-green">Done</span>'
        : d.status === 'cancelled' ? '<span class="wd-badge">Cancelled</span>'
        : d.status === 'failed' ? '<span class="wd-badge wd-badge-red">Failed</span>' : '';
      return `<div class="wd-item dl">
        <div class="kind">${d.mode === 'audio' ? '🎵' : '🎬'}</div>
        <div class="wd-grow"><div class="wd-row"><div class="title wd-ellipsis wd-grow" title="${esc(name)}">${esc(name)}</div>${badge}</div>${body}</div>
        <div class="wd-row">${actions}<button class="wd-btn wd-btn-sm wd-btn-ghost" data-remove="${d._id}" title="Remove from list">✕</button></div>
      </div>`;
    }).join('');
  }

  $('list').addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const find = (id) => downloads.find((d) => d._id === id);
    try {
      if (t.dataset.cancel) await wd.tools.cancel(find(t.dataset.cancel).taskId);
      if (t.dataset.reveal) await wd.files.reveal(find(t.dataset.reveal).files[0]);
      if (t.dataset.open) await wd.files.open(find(t.dataset.open).files[0]);
      if (t.dataset.folder) await wd.files.openFolder();
      if (t.dataset.retry) {
        const d = find(t.dataset.retry);
        $('url').value = d.url;
        setMode(d.mode);
        $('url').focus();
      }
      if (t.dataset.remove) {
        const d = find(t.dataset.remove);
        if (d.status === 'running') await wd.tools.cancel(d.taskId).catch(() => {});
        await col.remove(d._id);
        downloads = downloads.filter((x) => x !== d);
        render();
      }
    } catch (err) {
      wd.ui.toast(err.message, 'error');
    }
  });

  $('clearDone').onclick = async () => {
    for (const d of downloads.filter((x) => x.status !== 'running' && x.status !== 'starting')) await col.remove(d._id);
    downloads = downloads.filter((x) => x.status === 'running' || x.status === 'starting');
    render();
  };
  $('openFolder').onclick = () => wd.files.openFolder().catch((e) => wd.ui.toast(e.message, 'error'));

  // Playlists download with quick presets; single links go through the format picker.
  $('playlist').addEventListener('change', () => {
    $('go').textContent = $('playlist').checked ? 'Download playlist' : 'Get formats';
    setMode(mode);
  });

  // ------------------------------------------------------------------- init
  (async () => {
    try { setMode(localStorage.getItem('md-mode') || 'video'); } catch (_) { setMode('video'); }
    downloads = await col.find(null, { sort: '-_createdAt', limit: 100 });
    render();
    downloads.filter((d) => d.status === 'running' && d.taskId).forEach(track);
    for (const d of downloads.filter((x) => x.status === 'starting')) {
      Object.assign(d, await col.update(d._id, { status: 'failed', error: 'Interrupted' }));
    }
    render();
    await checkTools();
  })();
})();
