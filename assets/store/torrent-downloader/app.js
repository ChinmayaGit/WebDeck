(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);

  let activeTorrents = [
    {
      id: 'tor-alpine',
      name: 'alpine-standard-3.19.1-x86_64.iso',
      size: '208 MB',
      downloaded: 168,
      total: 208,
      speed: '4.8 MB/s',
      peers: 42,
      status: 'downloading',
      progress: 81
    }
  ];

  const CURATED = [
    {
      name: 'Alpine Linux v3.19 Standard ISO',
      category: 'Operating System',
      size: '208 MB',
      magnet: 'magnet:?xt=urn:btih:alpine-3.19-std-x86_64',
      desc: 'Ultra-lightweight, secure Linux distribution based on musl and BusyBox.'
    },
    {
      name: 'Ubuntu 24.04 LTS Desktop ISO',
      category: 'Operating System',
      size: '5.8 GB',
      magnet: 'magnet:?xt=urn:btih:ubuntu-24.04-desktop-amd64',
      desc: 'Official Noble Numbat 5-year Long Term Support release.'
    },
    {
      name: 'Arch Linux 2026 x86_64 Release',
      category: 'Operating System',
      size: '1.1 GB',
      magnet: 'magnet:?xt=urn:btih:archlinux-2026-x86_64',
      desc: 'Minimal rolling release Linux distribution for advanced users.'
    },
    {
      name: 'Big Buck Bunny (4K 60fps Open Movie)',
      category: 'Creative Commons 3.0',
      size: '840 MB',
      magnet: 'magnet:?xt=urn:btih:big-buck-bunny-4k-open',
      desc: 'Open-source 3D animated film produced by the Blender Foundation.'
    },
    {
      name: 'Sintel (4K Open Movie & Artwork)',
      category: 'Creative Commons 3.0',
      size: '1.2 GB',
      magnet: 'magnet:?xt=urn:btih:sintel-open-film-blender',
      desc: 'Emotional fantasy quest film by Ton Roosendaal and Blender Institute.'
    }
  ];

  function init() {
    bindEvents();
    renderDownloads();
    renderCurated();
    startProgressTicker();
  }

  function bindEvents() {
    $('btnOpenMagnet').onclick = () => {
      const magnet = prompt('Paste Magnet Link or Torrent URL:');
      if (!magnet) return;
      const name = magnet.includes('dn=')
        ? decodeURIComponent(magnet.split('dn=')[1].split('&')[0])
        : 'Download-' + Date.now();
      activeTorrents.push({
        id: 'tor-' + Date.now(),
        name,
        size: '1.2 GB',
        downloaded: 0,
        total: 1200,
        speed: '3.2 MB/s',
        peers: 28,
        status: 'downloading',
        progress: 0
      });
      renderDownloads();
      wd.ui.toast(`Added torrent: "${name}"`, 'ok');
    };
  }

  function renderDownloads() {
    $('activeCount').textContent = activeTorrents.length;
    let totalSpeed = 0;
    activeTorrents.forEach(t => {
      if (t.status === 'downloading') totalSpeed += parseFloat(t.speed) || 0;
    });
    $('speedSummary').textContent = `↓ ${totalSpeed.toFixed(1)} MB/s · ↑ ${(totalSpeed * 0.15).toFixed(1)} MB/s`;

    if (!activeTorrents.length) {
      $('downloadsList').innerHTML = '<div class="wd-empty"><div class="wd-empty-icon">⬇️</div>No active torrent downloads. Pick an open ISO below or add a magnet link.</div>';
      return;
    }

    $('downloadsList').innerHTML = activeTorrents.map(t => `
      <div class="torrent-card">
        <div class="wd-row">
          <span style="font-weight:700;font-size:14px">${esc(t.name)}</span>
          <div class="wd-spacer"></div>
          <span class="stat-pill">↓ ${esc(t.speed)}</span>
          <span class="stat-pill">👥 ${t.peers} peers</span>
          <span class="stat-pill" style="color:#22C55E;font-weight:700">${t.progress}%</span>
        </div>
        <div class="p-bar"><div class="p-fill" style="width:${t.progress}%"></div></div>
        <div class="wd-row" style="margin-top:6px;gap:6px">
          <span class="wd-small wd-muted">${t.downloaded} MB of ${t.size} · Status: <b>${esc(t.status)}</b></span>
          <div class="wd-spacer"></div>
          <button class="wd-btn wd-btn-ghost wd-btn-sm" data-pause-id="${esc(t.id)}">${t.status === 'downloading' ? 'Pause' : 'Resume'}</button>
          <button class="wd-btn wd-btn-ghost wd-btn-sm" data-cancel-id="${esc(t.id)}" style="color:#ef4444">Remove</button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('[data-pause-id]').forEach(btn => {
      btn.onclick = () => {
        const t = activeTorrents.find(x => x.id === btn.dataset.pauseId);
        if (t) {
          t.status = t.status === 'downloading' ? 'paused' : 'downloading';
          t.speed = t.status === 'downloading' ? '3.5 MB/s' : '0 KB/s';
          renderDownloads();
        }
      };
    });

    document.querySelectorAll('[data-cancel-id]').forEach(btn => {
      btn.onclick = () => {
        activeTorrents = activeTorrents.filter(x => x.id !== btn.dataset.cancelId);
        renderDownloads();
        wd.ui.toast('Removed torrent', 'ok');
      };
    });
  }

  function renderCurated() {
    $('catalogGrid').innerHTML = CURATED.map((c, i) => `
      <div class="cat-item">
        <div style="font-weight:700;font-size:14px">${esc(c.name)}</div>
        <div class="wd-small wd-muted">${esc(c.category)} · 📦 ${esc(c.size)}</div>
        <div class="wd-small" style="line-height:1.4">${esc(c.desc)}</div>
        <div class="wd-row" style="margin-top:auto;padding-top:6px">
          <button class="wd-btn wd-btn-primary wd-btn-sm wd-grow" data-start-curated="${i}">⬇ Download ISO</button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('[data-start-curated]').forEach(btn => {
      btn.onclick = () => {
        const item = CURATED[+btn.dataset.startCurated];
        activeTorrents.push({
          id: 'tor-' + Date.now(),
          name: item.name,
          size: item.size,
          downloaded: 0,
          total: 1000,
          speed: '5.2 MB/s',
          peers: 64,
          status: 'downloading',
          progress: 0
        });
        renderDownloads();
        wd.ui.toast(`Started downloading: "${item.name}"`, 'ok');
      };
    });
  }

  function startProgressTicker() {
    setInterval(() => {
      let changed = false;
      activeTorrents.forEach(t => {
        if (t.status === 'downloading' && t.progress < 100) {
          t.progress = Math.min(100, t.progress + 1);
          if (t.progress === 100) {
            t.status = 'seeding';
            t.speed = '0 KB/s';
            wd.ui.toast(`Finished downloading ${t.name}!`, 'ok');
          }
          changed = true;
        }
      });
      if (changed) renderDownloads();
    }, 2000);
  }

  init();
})();
