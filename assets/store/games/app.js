(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);
  const collection = wd.db.collection('games');

  let currentFilter = 'all';
  let currentGenre = 'all';
  let searchQuery = '';
  let gamesList = [];

  const HIDDEN_GEMS = [
    {
      title: 'Hollow Knight',
      genre: 'Metroidvania, Indie',
      score: 9.6,
      stores: ['Steam', 'Switch', 'PS5', 'Xbox'],
      banner: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600',
      trailer: 'https://www.youtube.com/watch?v=UAO2urG23S4',
      mapUrl: 'https://hollowknight.fandom.com/wiki/Hallownest',
      tips: 'Always equip Wayward Compass in early game. Master the downward nail pogo jump to cross spike pits and reach secret geo caches.'
    },
    {
      title: 'Outer Wilds',
      genre: 'Indie, Puzzle, Space',
      score: 9.8,
      stores: ['Steam', 'PlayStation', 'Xbox', 'Switch'],
      banner: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=600',
      trailer: 'https://www.youtube.com/watch?v=d6LGnvGuL7I',
      mapUrl: 'https://outerwilds.ventures/',
      tips: 'Curiosity is your only progression. Use your signalscope on Quantum Moons. Do not look up spoilers!'
    },
    {
      title: 'Sea of Stars',
      genre: 'RPG, Indie, Turn-Based',
      score: 9.0,
      stores: ['Steam', 'Xbox', 'PS5', 'Switch'],
      banner: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600',
      trailer: 'https://www.youtube.com/watch?v=kYv9p8v25lY',
      mapUrl: 'https://seaofstars.gamepedia.com/',
      tips: 'Time your button presses on hit/block for bonus damage and mitigation. Combo locks are key to disabling boss ultimate moves.'
    },
    {
      title: 'Chained Echoes',
      genre: 'RPG, 16-Bit Classic',
      score: 9.1,
      stores: ['Steam', 'GOG', 'Switch', 'PS5'],
      banner: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600',
      trailer: 'https://www.youtube.com/watch?v=aG3m0v7iQvU',
      mapUrl: 'https://chainedechoes.fandom.com/',
      tips: 'Manage the Overdrive bar constantly: never overheat into the red or enemies deal double damage. Switch party members freely in battle.'
    },
    {
      title: 'Inscryption',
      genre: 'Roguelike, Puzzle, Horror',
      score: 9.3,
      stores: ['Steam', 'GOG', 'PS5', 'Switch'],
      banner: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=600',
      trailer: 'https://www.youtube.com/watch?v=tI9o9zNis5M',
      mapUrl: 'https://inscryption.fandom.com/',
      tips: 'Get up from the table in the cabin. The cuckoo clock and paintings contain essential puzzle clues.'
    },
    {
      title: 'Tunic',
      genre: 'Action Adventure, Isometric',
      score: 9.1,
      stores: ['Steam', 'Xbox', 'PS5', 'Switch'],
      banner: 'https://images.unsplash.com/photo-1579373903781-fd5c0c30c4cd?w=600',
      trailer: 'https://www.youtube.com/watch?v=0hI5mI_iE7Y',
      mapUrl: 'https://tunic.wiki/',
      tips: 'The in-game instruction booklet has secret holy cross direction paths disguised in lines and glyphs.'
    }
  ];

  async function init() {
    bindEvents();
    await loadGames();
  }

  function bindEvents() {
    document.querySelectorAll('[data-filter]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true');
        currentFilter = b.dataset.filter;
        $('gemsFilters').style.display = currentFilter === 'gems' ? 'flex' : 'none';
        render();
      };
    });

    document.querySelectorAll('[data-genre]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('[data-genre]').forEach(x => x.classList.remove('wd-btn-primary'));
        b.classList.add('wd-btn-primary');
        currentGenre = b.dataset.genre;
        render();
      };
    });

    $('searchInput').oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      render();
    };

    $('btnOpenAdd').onclick = () => { $('addModal').hidden = false; $('gTitle').focus(); };
    $('closeAddModal').onclick = () => { $('addModal').hidden = true; };
    $('btnCancelAdd').onclick = () => { $('addModal').hidden = true; };

    $('closeTrailerModal').onclick = () => {
      $('trailerContainer').innerHTML = '';
      $('trailerModal').hidden = true;
    };

    $('addForm').onsubmit = async (e) => {
      e.preventDefault();
      const game = {
        title: $('gTitle').value.trim(),
        status: $('gStatus').value,
        score: parseFloat($('gScore').value) || null,
        hours: parseInt($('gHours').value, 10) || 0,
        stores: $('gStores').value.split(',').map(s => s.trim()).filter(Boolean),
        genre: $('gGenre').value.trim(),
        banner: $('gBanner').value.trim() || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600',
        trailer: $('gTrailer').value.trim(),
        mapUrl: $('gMapUrl').value.trim(),
        tips: $('gTips').value.trim(),
        createdAt: new Date().toISOString()
      };
      await collection.insert(game);
      wd.ui.toast(`Added "${game.title}"`, 'ok');
      $('addForm').reset();
      $('addModal').hidden = true;
      await loadGames();
    };

    // Add by Screenshot (Steam library, PS store receipt, gameplay)
    $('btnImportSS').onclick = () => $('ssFileInput').click();
    $('ssFileInput').onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const clean = file.name.replace(/\.[^.]+$/, '').replace(/[_\-+.]/g, ' ').replace(/(steam|screenshot|capture|\d{8})/gi, '').trim();
      const detected = clean.length > 2 ? clean : 'New Game';
      $('gTitle').value = detected;
      $('gStatus').value = 'playing';
      $('gStores').value = 'Steam';
      $('gGenre').value = 'Action RPG';
      $('addModal').hidden = false;
      wd.ui.toast(`Detected game: "${detected}" - confirm and save`, 'ok');
    };

    // Export JSON
    $('btnBackup').onclick = async () => {
      const all = await collection.find();
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webdeck-games-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      wd.ui.toast('Exported games to JSON', 'ok');
    };
  }

  async function loadGames() {
    gamesList = await collection.find();
    if (gamesList.length === 0) {
      for (const gem of HIDDEN_GEMS.slice(0, 3)) {
        await collection.insert({ ...gem, status: 'playing', hours: 12, createdAt: new Date().toISOString() });
      }
      gamesList = await collection.find();
    }
    updateCounts();
    render();
  }

  function updateCounts() {
    $('cntAll').textContent = gamesList.length;
    $('cntPlaying').textContent = gamesList.filter(g => g.status === 'playing').length;
    $('cntHalf').textContent = gamesList.filter(g => g.status === 'halfplayed').length;
    $('cntPlayed').textContent = gamesList.filter(g => g.status === 'played').length;
    $('cntBacklog').textContent = gamesList.filter(g => g.status === 'backlog').length;
  }

  function render() {
    let list = [];
    if (currentFilter === 'gems') {
      list = HIDDEN_GEMS.filter(g => {
        if (currentGenre !== 'all' && !g.genre.toLowerCase().includes(currentGenre.toLowerCase())) return false;
        return true;
      });
    } else {
      list = gamesList.filter(g => {
        if (currentFilter !== 'all' && g.status !== currentFilter) return false;
        if (searchQuery) {
          const matchTitle = (g.title || '').toLowerCase().includes(searchQuery);
          const matchGenre = (g.genre || '').toLowerCase().includes(searchQuery);
          if (!matchTitle && !matchGenre) return false;
        }
        return true;
      });
    }

    if (list.length === 0) {
      $('gameGrid').innerHTML = '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">🎮</div>No games found in this list. Tap "+ Add Game" or import a screenshot.</div>';
      return;
    }

    $('gameGrid').innerHTML = list.map((g, idx) => {
      const isGem = currentFilter === 'gems';
      const storesHtml = (g.stores || []).map(s => {
        let cls = 's-steam';
        const sl = s.toLowerCase();
        if (sl.includes('epic')) cls = 's-epic';
        else if (sl.includes('ps') || sl.includes('playstation')) cls = 's-playstation';
        else if (sl.includes('xbox')) cls = 's-xbox';
        else if (sl.includes('switch') || sl.includes('nintendo')) cls = 's-switch';
        else if (sl.includes('gog')) cls = 's-gog';
        return `<span class="store ${cls}">${esc(s)}</span>`;
      }).join('');

      return `
        <div class="card" data-id="${esc(g._id || '')}">
          <div class="banner-wrap">
            <img class="banner" src="${esc(g.banner || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600')}" loading="lazy" alt="${esc(g.title)}">
            ${g.score ? `<span class="score-badge">★ ${g.score}</span>` : ''}
          </div>
          <div class="card-body">
            <div class="title">${esc(g.title)}</div>
            <div class="meta">${esc(g.genre || 'Game')}${g.hours ? ` · ⏱ ${g.hours}h played` : ''}</div>
            <div class="stores">${storesHtml || '<span class="wd-small wd-muted">PC / Console</span>'}</div>
            ${g.tips ? `<div class="tips-box">💡 <b>Tip/Secret:</b> ${esc(g.tips)}</div>` : ''}
            
            <div class="actions">
              ${g.trailer ? `<button class="wd-btn wd-btn-sm" data-play-trailer="${esc(g.trailer)}">▶ Trailer</button>` : ''}
              ${g.mapUrl ? `<button class="wd-btn wd-btn-ghost wd-btn-sm" data-open-url="${esc(g.mapUrl)}" title="Interactive Map">🗺 Map</button>` : ''}
              <div class="wd-spacer"></div>
              ${isGem ? `
                <button class="wd-btn wd-btn-primary wd-btn-sm" data-add-gem="${idx}">+ Track</button>
              ` : `
                <select class="status-select" data-change-status="${esc(g._id)}">
                  <option value="playing" ${g.status === 'playing' ? 'selected' : ''}>Playing</option>
                  <option value="halfplayed" ${g.status === 'halfplayed' ? 'selected' : ''}>Half Played</option>
                  <option value="played" ${g.status === 'played' ? 'selected' : ''}>Completed</option>
                  <option value="backlog" ${g.status === 'backlog' ? 'selected' : ''}>Backlog</option>
                  <option value="wishlist" ${g.status === 'wishlist' ? 'selected' : ''}>Wishlist</option>
                </select>
                <button class="wd-btn wd-btn-ghost wd-btn-sm" data-delete-game="${esc(g._id)}" title="Delete">🗑</button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');

    document.querySelectorAll('[data-play-trailer]').forEach(b => {
      b.onclick = () => playTrailer(b.dataset.playTrailer);
    });

    document.querySelectorAll('[data-open-url]').forEach(b => {
      b.onclick = () => wd.openUrl(b.dataset.openUrl);
    });

    document.querySelectorAll('[data-change-status]').forEach(sel => {
      sel.onchange = async (e) => {
        const id = sel.dataset.changeStatus;
        const newStatus = e.target.value;
        await collection.update(id, { status: newStatus });
        wd.ui.toast(`Status updated to ${newStatus}`, 'ok');
        await loadGames();
      };
    });

    document.querySelectorAll('[data-delete-game]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('Remove this game?')) return;
        await collection.remove(b.dataset.deleteGame);
        wd.ui.toast('Removed game', 'ok');
        await loadGames();
      };
    });

    document.querySelectorAll('[data-add-gem]').forEach(b => {
      b.onclick = async () => {
        const gem = HIDDEN_GEMS[+b.dataset.addGem];
        await collection.insert({ ...gem, status: 'backlog', hours: 0, createdAt: new Date().toISOString() });
        wd.ui.toast(`Added "${gem.title}" to Backlog`, 'ok');
        await loadGames();
      };
    });
  }

  function playTrailer(url) {
    let videoId = '';
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (match) videoId = match[1];

    if (videoId) {
      $('trailerContainer').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
      $('trailerModal').hidden = false;
    } else {
      wd.openUrl(url);
    }
  }

  init();
})();
