(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = wd.ui.escape;
  const ICONS = { android: '📱', ios: '📱', macos: '💻', windows: '🖥️', linux: '🐧' };
  const samples = []; // { t, ms | null }
  const WINDOW_MS = 120000;

  // ---- latency: time a tiny request (server-side fetch, so no CORS)
  async function ping() {
    const t0 = performance.now();
    try {
      const r = await wd.net.fetch('https://1.1.1.1/cdn-cgi/trace', { timeout: 5, maxBytes: 2048 });
      const ms = Math.round(performance.now() - t0);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const loc = /loc=(\w+)/.exec(r.text || '');
      return { ms, loc: loc ? loc[1] : null };
    } catch (_) {
      return { ms: null };
    }
  }

  async function sampleLatency() {
    const res = await ping();
    const now = Date.now();
    samples.push({ t: now, ms: res.ms });
    while (samples.length && now - samples[0].t > WINDOW_MS) samples.shift();

    if (res.ms == null) {
      $('netState').innerHTML = '<span class="dot bad"></span>Offline';
      $('netSub').textContent = 'No response from the internet';
      $('latency').textContent = '–';
    } else {
      const q = res.ms < 80 ? 'ok' : res.ms < 200 ? 'warn' : 'bad';
      $('netState').innerHTML = `<span class="dot ${q}"></span>Online`;
      $('netSub').textContent = res.loc ? `Nearest edge: ${res.loc}` : 'Connected';
      $('latency').textContent = `${res.ms} ms`;
    }
    const good = samples.filter((s) => s.ms != null).map((s) => s.ms);
    if (good.length > 1) {
      const avg = good.reduce((a, b) => a + b, 0) / good.length;
      const jitter = good.slice(1).reduce((a, v, i) => a + Math.abs(v - good[i]), 0) / (good.length - 1);
      const loss = Math.round((100 * samples.filter((s) => s.ms == null).length) / samples.length);
      $('jitter').textContent = `avg ${Math.round(avg)} ms · jitter ${Math.round(jitter)} ms · loss ${loss}%`;
    }
    drawChart();
  }

  function drawChart() {
    const c = $('chart');
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const vals = samples.filter((s) => s.ms != null).map((s) => s.ms);
    const max = Math.max(100, ...vals) * 1.15;
    const now = Date.now();
    const x = (t) => w - ((now - t) / WINDOW_MS) * w;
    const y = (ms) => h - (ms / max) * (h - 6) - 3;
    g.strokeStyle = 'rgba(148,163,184,.25)';
    g.lineWidth = 1;
    for (const level of [50, 100, 200]) {
      if (level > max) continue;
      g.beginPath(); g.moveTo(0, y(level)); g.lineTo(w, y(level)); g.stroke();
    }
    g.strokeStyle = '#0EA5E9';
    g.lineWidth = 2;
    g.beginPath();
    let started = false;
    for (const s of samples) {
      if (s.ms == null) { started = false; continue; }
      if (!started) { g.moveTo(x(s.t), y(s.ms)); started = true; } else g.lineTo(x(s.t), y(s.ms));
    }
    g.stroke();
    g.fillStyle = '#EF4444';
    for (const s of samples) if (s.ms == null) g.fillRect(x(s.t) - 1, h - 6, 3, 6);
  }

  // ---- devices on this network
  async function refreshDevices() {
    let st;
    try { st = await wd.link.status(); } catch (e) {
      $('thisDevice').textContent = e.message;
      return;
    }
    $('linkBadge').textContent = st.enabled ? (st.running ? 'Device Link on' : 'Device Link starting') : 'Device Link off';
    $('linkBadge').className = 'wd-badge ' + (st.enabled ? 'wd-badge-green' : '');
    $('thisDevice').innerHTML = `<b>${esc(st.deviceName)}</b><br>
      <span class="wd-muted">Addresses:</span> ${esc((st.addresses || []).join(', ') || 'none')}
      ${st.enabled ? ` · <span class="wd-muted">port</span> ${st.port}` : ''}
      ${st.error ? `<div class="wd-notice" style="margin-top:6px">${esc(st.error)}</div>` : ''}`;
    $('btnEnableLink').hidden = st.enabled;

    if (!st.enabled) {
      $('connected').textContent = '–';
      $('connectedSub').textContent = 'Device Link is off';
      $('devices').innerHTML = '<div class="wd-empty">Turn on Device Link to see other WebDeck devices on this network.</div>';
      return;
    }
    const peers = await wd.link.peers();
    const online = peers.filter((p) => p.online);
    $('connected').textContent = String(online.length);
    $('connectedSub').textContent = `${peers.filter((p) => p.paired).length} paired · ${online.filter((p) => !p.paired).length} nearby`;
    if (!peers.length) {
      $('devices').innerHTML = '<div class="wd-empty">No other WebDeck devices seen yet. Open WebDeck with Device Link on another device on this Wi-Fi.</div>';
      return;
    }
    peers.sort((a, b) => (b.online - a.online) || (b.paired - a.paired) || a.name.localeCompare(b.name));
    $('devices').innerHTML = peers.map((p) => {
      const state = p.online ? (p.paired ? ['ok', 'Online · paired'] : ['warn', 'Online · not paired']) : ['off', 'Offline'];
      const seen = p.lastSeen ? wd.ui.timeAgo(p.lastSeen) : 'never';
      return `<div class="nm-device">
        <div class="ic">${ICONS[p.platform] || '💻'}</div>
        <div class="meta">
          <div class="name">${esc(p.name)}</div>
          <div class="wd-small wd-muted">${esc(p.addr || '')}${p.port ? ':' + p.port : ''} · ${esc(p.platform || 'unknown')} · seen ${esc(seen)}</div>
        </div>
        <span class="wd-small"><span class="dot ${state[0]}"></span>${state[1]}</span>
      </div>`;
    }).join('');
  }

  async function refreshCloud() {
    if (!wd.cloud) { $('cloudState').textContent = 'n/a'; return; }
    try {
      const st = await wd.cloud.status();
      if (st.connected) {
        $('cloudState').innerHTML = '<span class="dot ok"></span>Connected';
        $('cloudSub').textContent = st.profile ? `Your number: ${st.profile.number}` : 'Signed in';
      } else {
        $('cloudState').innerHTML = '<span class="dot warn"></span>Offline';
        $('cloudSub').textContent = st.error || 'Connecting…';
      }
    } catch (e) {
      $('cloudState').innerHTML = '<span class="dot bad"></span>Error';
      $('cloudSub').textContent = e.message;
    }
  }

  // ---- speed test
  async function speedTest() {
    const btn = $('btnSpeed');
    btn.disabled = true;
    $('speedProgress').hidden = false;
    const bar = $('speedProgress').firstElementChild;
    const sizes = [1e6, 4e6, 10e6];
    let best = 0;
    try {
      for (let i = 0; i < sizes.length; i++) {
        bar.style.width = `${Math.round((i / sizes.length) * 100)}%`;
        $('speedResult').textContent = `Downloading ${sizes[i] / 1e6} MB…`;
        const t0 = performance.now();
        const r = await wd.net.fetch(`https://speed.cloudflare.com/__down?bytes=${sizes[i]}`, { timeout: 30 });
        const secs = (performance.now() - t0) / 1000;
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const mbps = (sizes[i] * 8) / secs / 1e6;
        best = Math.max(best, mbps);
        if (secs > 6) break; // slow link: don't push bigger downloads
      }
      bar.style.width = '100%';
      $('speedResult').innerHTML = `Download ≈ <b>${best.toFixed(1)} Mbps</b> <span class="wd-muted">(includes request overhead; run again for a steadier number)</span>`;
    } catch (e) {
      $('speedResult').textContent = `Speed test failed: ${e.message}`;
    } finally {
      btn.disabled = false;
      setTimeout(() => { $('speedProgress').hidden = true; bar.style.width = '0%'; }, 800);
    }
  }

  $('btnSpeed').onclick = speedTest;
  $('btnEnableLink').onclick = async () => {
    try { await wd.link.enable(true); } catch (e) { wd.ui.toast(e.message, 'error'); }
    refreshDevices();
  };
  window.addEventListener('resize', drawChart);

  async function tick() {
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    await Promise.all([refreshDevices(), refreshCloud()]);
  }
  tick();
  sampleLatency();
  setInterval(tick, 3000);
  setInterval(sampleLatency, 2000);
})();
