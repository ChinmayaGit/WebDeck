(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);

  let currentCategory = 'lofi';
  let searchQuery = '';
  let activeStation = null;
  let isPlaying = false;
  let sleepTimeout = null;

  const STATIONS = [
    { id: 'lofi-1', name: 'Lofi Chillhop Radio', cat: 'lofi', country: 'Global', icon: '☕', url: 'https://stream.zeno.fm/f3wvbbqmdg8uv', desc: 'Chill beats to relax and study to' },
    { id: 'lofi-2', name: 'SomaFM Secret Agent', cat: 'lofi', country: 'USA', icon: '🕶️', url: 'https://ice1.somafm.com/secretagent-128-mp3', desc: 'Spy lounge & stylish undercover grooves' },
    { id: 'lofi-3', name: 'Lofi Cafe Tokyo', cat: 'lofi', country: 'Japan', icon: '🌸', url: 'https://stream.zeno.fm/0r0xa792kwzuv', desc: 'Japanese lofi hip hop & nostalgic anime chords' },
    { id: 'class-1', name: 'BBC Radio 3 Classical', cat: 'classical', country: 'UK', icon: '🎻', url: 'https://stream.live.vc.bbcmedia.co.uk/bbc_radio_three', desc: 'World premier classical performances & orchestras' },
    { id: 'class-2', name: 'SomaFM Drone Zone', cat: 'ambient', country: 'USA', icon: '🌌', url: 'https://ice1.somafm.com/dronezone-128-mp3', desc: 'Deep atmospheric ambient soundscapes' },
    { id: 'class-3', name: 'Mozart Symphony Radio', cat: 'classical', country: 'Austria', icon: '🎼', url: 'https://stream.zeno.fm/7k9m7x6qfg8uv', desc: 'Essential Mozart, Beethoven & Bach concertos' },
    { id: 'jazz-1', name: 'Swiss Jazz Radio', cat: 'jazz', country: 'Switzerland', icon: '🎷', url: 'https://stream.srg-ssr.ch/m/rsj/mp3_128', desc: 'Continuous commercial-free classic & smooth jazz' },
    { id: 'jazz-2', name: 'Dinner Jazz Paris', cat: 'jazz', country: 'France', icon: '🍷', url: 'https://stream.zeno.fm/s4k81702kwzuv', desc: 'Acoustic jazz & gentle café saxophone' },
    { id: 'news-1', name: 'BBC World Service News', cat: 'news', country: 'UK', icon: '🎙️', url: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service', desc: 'Live global news, debates & interviews' },
    { id: 'news-2', name: 'NPR 24/7 News Stream', cat: 'news', country: 'USA', icon: '📰', url: 'https://npr-ice.streamguys1.com/live.mp3', desc: 'National public radio, in-depth reports' },
    { id: 'ambient-1', name: 'SomaFM Deep Space One', cat: 'ambient', country: 'USA', icon: '🪐', url: 'https://ice1.somafm.com/deepspaceone-128-mp3', desc: 'Deep ambient electronic space music' }
  ];

  const favorites = new Set();
  const audio = $('audioEl');
  let audioCtx, analyser, dataArray;

  function init() {
    bindEvents();
    renderStations();
    setupVisualizer();
  }

  function bindEvents() {
    document.querySelectorAll('[data-cat]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('[data-cat]').forEach(x => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true');
        currentCategory = b.dataset.cat;
        renderStations();
      };
    });

    $('searchInput').oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderStations();
    };

    $('btnTogglePlay').onclick = () => {
      if (isPlaying) {
        audio.pause();
        isPlaying = false;
        $('btnTogglePlay').textContent = '▶';
      } else {
        if (!activeStation) playStation(STATIONS[0]);
        else audio.play();
        isPlaying = true;
        $('btnTogglePlay').textContent = '⏸';
      }
    };

    $('volSlider').oninput = (e) => {
      audio.volume = parseFloat(e.target.value);
    };

    $('sleepTimerSelect').onchange = (e) => {
      const mins = parseInt(e.target.value, 10);
      if (sleepTimeout) clearTimeout(sleepTimeout);
      if (mins > 0) {
        sleepTimeout = setTimeout(() => {
          audio.pause();
          isPlaying = false;
          $('btnTogglePlay').textContent = '▶';
          wd.ui.toast(`Sleep timer finished. Radio turned off.`, 'ok');
        }, mins * 60 * 1000);
        wd.ui.toast(`Sleep timer set to ${mins} minutes`, 'ok');
      }
    };

    audio.onplaying = () => {
      isPlaying = true;
      $('btnTogglePlay').textContent = '⏸';
    };
    audio.onpause = () => {
      isPlaying = false;
      $('btnTogglePlay').textContent = '▶';
    };
    audio.onerror = () => {
      wd.ui.toast('Stream encountered an error, switching station…', 'error');
      isPlaying = false;
      $('btnTogglePlay').textContent = '▶';
    };
  }

  function renderStations() {
    const list = STATIONS.filter(s => {
      if (currentCategory === 'favs') {
        if (!favorites.has(s.id)) return false;
      } else if (currentCategory !== 'all' && s.cat !== currentCategory) {
        return false;
      }
      if (searchQuery) {
        const nameMatch = s.name.toLowerCase().includes(searchQuery);
        const countryMatch = s.country.toLowerCase().includes(searchQuery);
        const descMatch = s.desc.toLowerCase().includes(searchQuery);
        if (!nameMatch && !countryMatch && !descMatch) return false;
      }
      return true;
    });

    if (list.length === 0) {
      $('stationGrid').innerHTML = '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">📻</div>No radio stations found.</div>';
      return;
    }

    $('stationGrid').innerHTML = list.map(s => {
      const isActive = activeStation && activeStation.id === s.id;
      const isFav = favorites.has(s.id);
      return `
        <div class="station-card ${isActive ? 'active' : ''}" data-play-id="${esc(s.id)}">
          <div class="station-icon">${s.icon}</div>
          <div style="flex:1;overflow:hidden">
            <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</div>
            <div class="wd-small wd-muted">${esc(s.country)} · ${esc(s.desc)}</div>
          </div>
          <button class="wd-btn wd-btn-ghost wd-btn-sm" data-fav-id="${esc(s.id)}" title="Favorite" style="font-size:16px;color:${isFav ? '#f59e0b' : 'var(--wd-muted)'}">★</button>
        </div>
      `;
    }).join('');

    document.querySelectorAll('[data-play-id]').forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest('[data-fav-id]')) return;
        const station = STATIONS.find(s => s.id === card.dataset.playId);
        if (station) playStation(station);
      };
    });

    document.querySelectorAll('[data-fav-id]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.favId;
        if (favorites.has(id)) favorites.delete(id);
        else favorites.add(id);
        renderStations();
      };
    });
  }

  function playStation(s) {
    activeStation = s;
    $('playerTitle').textContent = s.name;
    $('playerMeta').textContent = `${s.country} · ${s.desc}`;
    audio.src = s.url;
    audio.play().catch(e => console.warn('Audio play error:', e));
    isPlaying = true;
    $('btnTogglePlay').textContent = '⏸';
    renderStations();
  }

  function setupVisualizer() {
    const canvas = $('visCanvas');
    const ctx = canvas.getContext('2d');

    function draw() {
      requestAnimationFrame(draw);
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const bars = 36;
      const barWidth = canvas.width / bars;

      for (let i = 0; i < bars; i++) {
        let h = 4;
        if (isPlaying) {
          h = Math.sin(Date.now() / 150 + i * 0.4) * 20 + Math.cos(Date.now() / 250 + i * 0.2) * 15 + 24;
          h = Math.max(4, Math.min(canvas.height - 4, h));
        }
        ctx.fillStyle = isPlaying ? '#14B8A6' : '#475569';
        ctx.fillRect(i * barWidth + 2, (canvas.height - h) / 2, barWidth - 4, h);
      }
    }
    draw();
  }

  init();
})();
