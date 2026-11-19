/*
 * FFKit — a small toolkit shell for FFmpeg-based WebDeck apps.
 * Each tool is a recipe: input kind + option fields + build() returning FFmpeg args.
 * The shell renders the tool list, file pickers, options, progress and results.
 */
window.FFKit = (() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ helpers
  const timeToSec = (t) => {
    const m = /(\d+):(\d+):([\d.]+)/.exec(t || '');
    return m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : null;
  };
  /** "90", "1:30", "00:01:30.5" -> seconds */
  const parseTime = (s) => {
    if (s == null || String(s).trim() === '') return null;
    const parts = String(s).trim().split(':').map(Number);
    if (parts.some((n) => Number.isNaN(n))) return null;
    return parts.reduce((a, b) => a * 60 + b, 0);
  };
  const fmtTime = (sec) => {
    if (sec == null) return '?';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  };
  const stem = (name) => name.replace(/\.[^.]+$/, '') || 'output';
  const ext = (name) => (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';

  /** Audio codec args per output format. */
  function audioCodec(format, bitrate) {
    switch (format) {
      case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', bitrate || '192k'];
      case 'wav': return ['-c:a', 'pcm_s16le'];
      case 'flac': return ['-c:a', 'flac'];
      case 'ogg': return ['-c:a', 'libvorbis', '-b:a', bitrate || '192k'];
      case 'opus': return ['-c:a', 'libopus', '-b:a', bitrate || '128k'];
      case 'aac': case 'm4a': return ['-c:a', 'aac', '-b:a', bitrate || '192k'];
      default: return [];
    }
  }

  /** atempo only accepts 0.5–2, so chain it for bigger changes. */
  function atempo(speed) {
    const parts = [];
    let s = speed;
    while (s > 2) { parts.push(2); s /= 2; }
    while (s < 0.5) { parts.push(0.5); s /= 0.5; }
    parts.push(+s.toFixed(4));
    return parts.map((x) => 'atempo=' + x).join(',');
  }

  /** Reads duration / size / streams using ffmpeg itself (no ffprobe needed). */
  async function probe(path) {
    const t = await wd.tools.run('ffmpeg', ['-hide_banner', '-nostdin', '-i', path, '-f', 'null', '-t', '0', '-']);
    const text = t.lines.join('\n');
    const d = /Duration: (\d+:\d+:[\d.]+)/.exec(text);
    const v = /Stream #[^\n]*Video: ([^,\s(]+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(text);
    const fps = /, ([\d.]+) fps/.exec(text);
    return {
      duration: d ? timeToSec(d[1]) : null,
      vcodec: v ? v[1] : null,
      width: v ? +v[2] : null,
      height: v ? +v[3] : null,
      fps: fps ? +fps[1] : null,
      hasVideo: !!v,
      hasAudio: /Stream #[^\n]*Audio: /.test(text),
      error: !d && /Invalid data|could not find|No such file/i.test(text) ? 'This file could not be read' : null,
    };
  }

  async function run(args, { duration, onProgress, onStart, subdir } = {}) {
    const full = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args];
    const errs = [];
    const task = await wd.tools.run('ffmpeg', full, {
      subdir,
      onStart,
      onLine: (l) => {
        const m = /^out_time=(\d+:\d+:[\d.]+)/.exec(l);
        if (m && duration && onProgress) onProgress(Math.max(0, Math.min(99.5, (timeToSec(m[1]) / duration) * 100)));
        if (!/^[a-z_]+=/.test(l)) errs.push(l);
      },
    });
    if (task.status === 'cancelled') throw new Error('Cancelled');
    if (task.status !== 'done') {
      const useful = errs.filter((l) => /error|invalid|not|fail|unable|cannot|unknown/i.test(l)).slice(-2);
      throw new Error((useful.length ? useful : errs.slice(-2)).join(' — ') || task.error || 'FFmpeg failed');
    }
    return task;
  }

  // ---------------------------------------------------------------- the shell
  /**
   * @param {{title:string, emoji:string, subtitle:string, tools:any[]}} cfg
   */
  function mount(cfg) {
    const state = { tool: null, files: [], audio: null, infos: new Map(), running: null, results: [] };
    let platform = 'macos';
    wd.app.info().then((i) => (platform = i.platform)).catch(() => {});

    document.body.innerHTML = `
      <div class="wd-app">
        <div class="wd-header">
          <div class="wd-icon">${cfg.emoji}</div>
          <div><h1>${esc(cfg.title)}</h1><div class="wd-sub">${esc(cfg.subtitle)}</div></div>
          <div class="wd-spacer"></div>
          <button class="wd-btn" id="ff-folder">Open output folder</button>
        </div>
        <div class="wd-card" id="ff-setup" hidden></div>
        <div class="wd-toolkit">
          <nav class="wd-toollist" id="ff-list"></nav>
          <main class="wd-stack" id="ff-main"></main>
        </div>
      </div>`;

    const groups = [...new Set(cfg.tools.map((t) => t.group))];
    $('ff-list').innerHTML = groups.map((g) => `<div class="wd-group">${esc(g)}</div>` +
      cfg.tools.filter((t) => t.group === g).map((t) => `<button data-tool="${t.id}">${esc(t.name)}</button>`).join('')).join('');
    $('ff-list').addEventListener('click', (e) => {
      const id = e.target.closest('[data-tool]')?.dataset.tool;
      if (id && !state.running) select(id);
    });
    $('ff-folder').onclick = () => wd.files.openFolder().catch((err) => wd.ui.toast(err.message, 'error'));

    async function checkSetup() {
      const s = await wd.tools.status().catch(() => null);
      const box = $('ff-setup');
      if (!s || !s.supported) {
        box.hidden = false;
        box.innerHTML = '<div class="wd-notice">This app needs WebDeck on macOS, Windows or Linux.</div>';
        return false;
      }
      if (s.ffmpeg.installed) { box.hidden = true; return true; }
      box.hidden = false;
      box.innerHTML = `<div class="wd-row"><div class="wd-grow"><h2>One-time setup</h2>
        <p class="wd-muted" id="ff-setup-msg">These tools run on FFmpeg, a free open-source media engine. WebDeck downloads it from its official builds.</p></div>
        <button class="wd-btn wd-btn-primary" id="ff-install">Install FFmpeg</button></div>`;
      $('ff-install').onclick = async () => {
        $('ff-install').disabled = true;
        try {
          await wd.tools.install('ffmpeg', (p) => ($('ff-setup-msg').textContent = p.message));
          wd.ui.toast('FFmpeg installed', 'ok');
        } catch (err) { wd.ui.toast(err.message, 'error'); }
        checkSetup().then(render);
      };
      return false;
    }

    function select(id) {
      state.tool = cfg.tools.find((t) => t.id === id);
      state.values = Object.fromEntries((state.tool.fields || []).map((f) => [f.id, f.value ?? (f.options ? f.options[0][0] : '')]));
      state.results = [];
      if (state.tool.input !== 'many') state.files = state.files.slice(0, 1);
      document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tool === id)));
      try { localStorage.setItem('ffkit-tool-' + cfg.title, id); } catch (_) {}
      render();
    }

    async function pick(kind) {
      try {
        const type = kind === 'audio' ? 'audio' : cfg.pickType || 'video';
        const multiple = kind === 'main' && state.tool.input === 'many';
        const picked = await wd.files.pick({ type, multiple });
        if (!picked.length) return;
        if (kind === 'audio') state.audio = picked[0];
        else state.files = multiple ? [...state.files, ...picked] : [picked[0]];
        state.results = [];
        render();
        for (const f of kind === 'audio' ? [picked[0]] : picked) {
          if (!state.infos.has(f.path)) {
            state.infos.set(f.path, null);
            probe(f.path).then((info) => { state.infos.set(f.path, info); render(); }).catch(() => {});
          }
        }
      } catch (err) { wd.ui.toast(err.message, 'error'); }
    }

    function fileRow(f, removable) {
      const info = state.infos.get(f.path);
      const meta = info === undefined || info === null ? 'Reading…' : info.error ? info.error
        : [fmtTime(info.duration), info.width ? `${info.width}×${info.height}` : '', info.fps ? Math.round(info.fps) + ' fps' : '', info.hasAudio ? 'audio' : (info.hasVideo ? 'no audio' : '')].filter(Boolean).join(' · ');
      return `<div class="wd-item"><div class="wd-grow"><div class="wd-ellipsis">${esc(f.name)}</div>
        <div class="wd-small wd-muted">${wd.ui.formatBytes(f.size)} · ${esc(meta)}</div></div>
        ${removable ? `<button class="wd-btn wd-btn-sm wd-btn-ghost" data-remove="${esc(f.id)}">✕</button>` : ''}</div>`;
    }

    function fieldHtml(f) {
      if (f.show && !f.show(state.values, ctx())) return '';
      const v = state.values[f.id];
      let input;
      if (f.type === 'select') {
        input = `<select class="wd-select" data-field="${f.id}">${f.options.map(([val, label]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
      } else if (f.type === 'range') {
        input = `<input type="range" data-field="${f.id}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${esc(v)}"><div class="wd-small wd-muted">${esc(f.format ? f.format(v) : v)}</div>`;
      } else {
        input = `<input class="wd-input" data-field="${f.id}" type="${f.type === 'number' ? 'number' : 'text'}" ${f.min != null ? `min="${f.min}"` : ''} placeholder="${esc(f.placeholder || '')}" value="${esc(v)}">`;
      }
      return `<div class="wd-field"><label class="wd-label">${esc(f.label)}</label>${input}${f.hint ? `<div class="wd-small wd-muted" style="margin-top:4px">${esc(f.hint)}</div>` : ''}</div>`;
    }

    function ctx() {
      const file = state.files[0];
      return {
        file, files: state.files, audio: state.audio, v: state.values, platform,
        info: file ? state.infos.get(file.path) : null,
        infos: state.files.map((f) => state.infos.get(f.path)),
        audioInfo: state.audio ? state.infos.get(state.audio.path) : null,
        out: (suffix, e) => `${stem(file.name)} (${suffix}).${e || ext(file.name)}`,
        stem: file ? stem(file.name) : '',
        ext: file ? ext(file.name) : '',
      };
    }

    function render() {
      const t = state.tool;
      if (!t) return;
      const c = ctx();
      const needAudio = t.input === 'video+audio';
      const ready = state.files.length >= (t.input === 'many' ? 2 : 1) && (!needAudio || state.audio) &&
        state.files.every((f) => state.infos.get(f.path)) && (!needAudio || state.infos.get(state.audio.path));
      let problem = null;
      if (ready && t.validate) problem = t.validate(c);
      const pickLabel = cfg.pickType === 'audio' ? 'audio' : 'video';
      $('ff-main').innerHTML = `
        <div class="wd-card">
          <h2>${esc(t.name)}</h2>
          <p class="wd-muted" style="margin-top:4px">${esc(t.desc)}</p>
          ${t.note ? `<div class="wd-notice" style="margin-top:10px">${esc(t.note)}</div>` : ''}
        </div>
        <div class="wd-card wd-stack">
          <div class="wd-row"><b class="wd-grow">${t.input === 'many' ? `${pickLabel[0].toUpperCase() + pickLabel.slice(1)} files (in order)` : 'Input'}</b>
            <button class="wd-btn wd-btn-sm" data-pick="main">${state.files.length && t.input !== 'many' ? 'Change' : t.input === 'many' ? 'Add files' : `Choose ${pickLabel}`}</button></div>
          ${state.files.map((f) => fileRow(f, t.input === 'many')).join('') || `<div class="wd-muted wd-small">No ${pickLabel} chosen.</div>`}
          ${needAudio ? `<div class="wd-row"><b class="wd-grow">Music / audio track</b><button class="wd-btn wd-btn-sm" data-pick="audio">${state.audio ? 'Change' : 'Choose audio'}</button></div>
            ${state.audio ? fileRow(state.audio, false) : '<div class="wd-muted wd-small">No audio chosen.</div>'}` : ''}
        </div>
        ${(t.fields || []).length ? `<div class="wd-card"><div class="wd-fields">${t.fields.map(fieldHtml).join('')}</div></div>` : ''}
        <div class="wd-card wd-stack">
          ${problem ? `<div class="wd-error">${esc(problem)}</div>` : ''}
          <div class="wd-row">
            <button class="wd-btn wd-btn-primary" id="ff-run" ${!ready || problem || state.running ? 'disabled' : ''}>${state.running ? 'Working…' : esc(t.action || 'Start')}</button>
            ${state.running ? '<button class="wd-btn" id="ff-cancel">Cancel</button>' : ''}
            <div class="wd-grow"></div>
          </div>
          ${state.running ? `<div class="wd-progress ${state.running.pct == null ? 'wd-indeterminate' : ''}"><div style="width:${state.running.pct || 0}%"></div></div>
            <div class="wd-small wd-muted">${state.running.pct == null ? 'Working…' : state.running.pct.toFixed(1) + '%'}</div>` : ''}
          ${state.results.map((r) => r.error ? `<div class="wd-error">${esc(r.error)}</div>` :
            `<div class="wd-item"><div class="wd-grow"><div class="wd-ellipsis">✅ ${esc(r.name)}</div><div class="wd-small wd-muted">${esc(r.detail || '')}</div></div>
             ${r.path ? `<button class="wd-btn wd-btn-sm" data-open="${esc(r.path)}">Open</button><button class="wd-btn wd-btn-sm" data-reveal="${esc(r.path)}">Show</button>` : ''}</div>`).join('')}
        </div>`;
    }

    $('ff-main').addEventListener('input', (e) => {
      const id = e.target.dataset.field;
      if (!id) return;
      state.values[id] = e.target.value;
      const f = state.tool.fields.find((x) => x.id === id);
      // Selects and sliders re-render immediately; text inputs on blur ("change") to keep focus.
      if (f.type === 'select' || f.type === 'range') render();
    });
    $('ff-main').addEventListener('change', (e) => { if (e.target.dataset.field) render(); });

    $('ff-main').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.pick) return pick(b.dataset.pick);
      if (b.dataset.remove) { state.files = state.files.filter((f) => f.id !== b.dataset.remove); return render(); }
      if (b.dataset.open) return wd.files.open(b.dataset.open).catch((err) => wd.ui.toast(err.message, 'error'));
      if (b.dataset.reveal) return wd.files.reveal(b.dataset.reveal).catch((err) => wd.ui.toast(err.message, 'error'));
      if (b.id === 'ff-cancel' && state.running?.taskId) return wd.tools.cancel(state.running.taskId);
      if (b.id === 'ff-run') return start();
    });

    async function start() {
      if (!(await checkSetup())) return;
      const t = state.tool;
      const c = ctx();
      let job;
      try { job = t.build(c); } catch (err) { wd.ui.toast(err.message, 'error'); return; }
      state.running = { pct: job.duration ? 0 : null, taskId: null };
      state.results = [];
      render();
      try {
        const task = await run(job.args, {
          duration: job.duration,
          subdir: job.subdir,
          onStart: (tk) => (state.running.taskId = tk.id),
          onProgress: (p) => { state.running.pct = p; render(); },
        });
        const files = (task.outputFiles || []).sort();
        if (!files.length) throw new Error('FFmpeg finished but produced no file');
        state.results = files.length > 3 && job.subdir
          ? [{ name: `${files.length} files in “${job.subdir}”`, path: files[0], detail: 'Saved to Downloads/WebDeck' }]
          : files.map((p) => ({ name: p.split(/[\\/]/).pop(), path: p, detail: 'Saved to Downloads/WebDeck' }));
        wd.notify(`${t.name} finished`, state.results.map((r) => r.name).join(', ')).catch(() => {});
      } catch (err) {
        state.results = [{ error: err.message }];
      }
      state.running = null;
      render();
    }

    checkSetup();
    let first = cfg.tools[0].id;
    try { first = localStorage.getItem('ffkit-tool-' + cfg.title) || first; } catch (_) {}
    select(cfg.tools.some((t) => t.id === first) ? first : cfg.tools[0].id);
  }

  return { mount, probe, run, audioCodec, atempo, parseTime, fmtTime, stem, ext };
})();
