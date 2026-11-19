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
    document.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== m; });
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
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('url').value.trim();
    if (!/^https?:\/\//i.test(url)) { wd.ui.toast('Paste a full http(s) link', 'error'); return; }
    if (!(await checkTools())) return;
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
