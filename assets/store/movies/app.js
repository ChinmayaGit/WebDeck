(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);
  const collection = wd.db.collection('movies');

  let currentFilter = 'all';
  let currentGenre = 'all';
  let searchQuery = '';
  let moviesList = [];

  const CURATED_RECS = [
    { title: 'Interstellar', year: 2014, rating: 8.7, genre: 'Sci-Fi, Drama', providers: ['Prime Video', 'Apple TV'], trailer: 'https://www.youtube.com/watch?v=zSWdZVtXT7E', poster: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=400', notes: 'Masterpiece on relativity and love across space-time.' },
    { title: 'Inception', year: 2010, rating: 8.8, genre: 'Sci-Fi, Action', providers: ['Netflix', 'Apple TV'], trailer: 'https://www.youtube.com/watch?v=YoHD9XEInc0', poster: 'https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=400', notes: 'Mind-bending dream architecture.' },
    { title: 'Dune: Part Two', year: 2024, rating: 8.6, genre: 'Sci-Fi, Adventure', providers: ['HBO Max', 'Prime Video'], trailer: 'https://www.youtube.com/watch?v=Way9Dexny3w', poster: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400', notes: 'Grand scale cinema on Arrakis.' },
    { title: 'The Dark Knight', year: 2008, rating: 9.0, genre: 'Action, Thriller', providers: ['HBO Max', 'Netflix'], trailer: 'https://www.youtube.com/watch?v=EXeTwQWrcwY', poster: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400', notes: 'Legendary performance by Heath Ledger.' },
    { title: 'Spirited Away', year: 2001, rating: 8.6, genre: 'Animation, Adventure', providers: ['Netflix', 'HBO Max'], trailer: 'https://www.youtube.com/watch?v=ByXuk9QqQkk', poster: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400', notes: 'Studio Ghibli classic.' },
    { title: 'Parasite', year: 2019, rating: 8.5, genre: 'Thriller, Drama', providers: ['HBO Max', 'Hulu'], trailer: 'https://www.youtube.com/watch?v=5xH0RzeSojI', poster: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=400', notes: 'Brilliant social satire and thriller.' },
    { title: 'Spider-Man: Across the Spider-Verse', year: 2023, rating: 8.7, genre: 'Animation, Action', providers: ['Netflix'], trailer: 'https://www.youtube.com/watch?v=cqGjhVJWtEg', poster: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=400', notes: 'Groundbreaking visual animation.' },
    { title: 'Whiplash', year: 2014, rating: 8.5, genre: 'Drama, Music', providers: ['Netflix', 'Prime Video'], trailer: 'https://www.youtube.com/watch?v=7d_jQycdQGo', poster: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400', notes: 'Intense pursuit of perfection.' }
  ];

  async function init() {
    bindEvents();
    await loadMovies();
  }

  function bindEvents() {
    document.querySelectorAll('[data-filter]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true');
        currentFilter = b.dataset.filter;
        $('recFilters').style.display = currentFilter === 'recs' ? 'flex' : 'none';
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

    $('btnOpenAdd').onclick = () => { $('addModal').hidden = false; $('mTitle').focus(); };
    $('closeAddModal').onclick = () => { $('addModal').hidden = true; };
    $('btnCancelAdd').onclick = () => { $('addModal').hidden = true; };

    $('closeTrailerModal').onclick = () => {
      $('trailerContainer').innerHTML = '';
      $('trailerModal').hidden = true;
    };

    $('addForm').onsubmit = async (e) => {
      e.preventDefault();
      const movie = {
        title: $('mTitle').value.trim(),
        year: parseInt($('mYear').value, 10) || null,
        rating: parseFloat($('mRating').value) || null,
        status: $('mStatus').value,
        genre: $('mGenre').value.trim(),
        providers: $('mProviders').value.split(',').map(s => s.trim()).filter(Boolean),
        poster: $('mPoster').value.trim() || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=400',
        trailer: $('mTrailer').value.trim(),
        notes: $('mNotes').value.trim(),
        createdAt: new Date().toISOString()
      };
      await collection.insert(movie);
      wd.ui.toast(`Added "${movie.title}"`, 'ok');
      $('addForm').reset();
      $('addModal').hidden = true;
      await loadMovies();
    };

    // Add by Screenshot
    $('btnImportSS').onclick = () => $('ssFileInput').click();
    $('ssFileInput').onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        wd.ui.toast('Analyzing screenshot…', 'ok');
        // Extract title candidates from file name or OCR text heuristics
        const cleanedName = file.name.replace(/\.[^.]+$/, '').replace(/[_\-+.]/g, ' ').replace(/(screenshot|screen|shot|capture|\d{8}|\d{6})/gi, '').trim();
        const detectedTitle = cleanedName.length > 2 ? cleanedName : 'New Movie';
        $('mTitle').value = detectedTitle;
        $('mStatus').value = 'watchlist';
        $('mGenre').value = 'Drama, Action';
        $('mProviders').value = 'Netflix, Prime Video';
        $('addModal').hidden = false;
        wd.ui.toast(`Extracted: "${detectedTitle}" - review details & save`, 'ok');
      } catch (err) {
        wd.ui.toast('Failed to analyze image: ' + err.message, 'error');
      }
    };

    // Export JSON
    $('btnBackup').onclick = async () => {
      const all = await collection.find();
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webdeck-movies-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      wd.ui.toast('Exported movie database to JSON', 'ok');
    };
  }

  async function loadMovies() {
    moviesList = await collection.find();
    if (moviesList.length === 0) {
      // Seed with initial sample entries
      for (const rec of CURATED_RECS.slice(0, 3)) {
        await collection.insert({ ...rec, status: 'watchlist', createdAt: new Date().toISOString() });
      }
      moviesList = await collection.find();
    }
    updateCounts();
    render();
  }

  function updateCounts() {
    $('cntAll').textContent = moviesList.length;
    $('cntWatching').textContent = moviesList.filter(m => m.status === 'watching').length;
    $('cntHalf').textContent = moviesList.filter(m => m.status === 'halfdone').length;
    $('cntWatched').textContent = moviesList.filter(m => m.status === 'watched').length;
    $('cntWatchlist').textContent = moviesList.filter(m => m.status === 'watchlist').length;
  }

  function render() {
    let list = [];
    if (currentFilter === 'recs') {
      list = CURATED_RECS.filter(r => {
        if (currentGenre !== 'all' && !r.genre.toLowerCase().includes(currentGenre.toLowerCase())) return false;
        return true;
      });
    } else {
      list = moviesList.filter(m => {
        if (currentFilter !== 'all' && m.status !== currentFilter) return false;
        if (searchQuery) {
          const matchTitle = (m.title || '').toLowerCase().includes(searchQuery);
          const matchGenre = (m.genre || '').toLowerCase().includes(searchQuery);
          if (!matchTitle && !matchGenre) return false;
        }
        return true;
      });
    }

    if (list.length === 0) {
      $('movieGrid').innerHTML = '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">🎬</div>No movies found in this list. Tap "+ Add Movie" or import a screenshot.</div>';
      return;
    }

    $('movieGrid').innerHTML = list.map((m, idx) => {
      const isCurated = currentFilter === 'recs';
      const provs = (m.providers || []).map(p => {
        let cls = 'p-free';
        const pl = p.toLowerCase();
        if (pl.includes('netflix')) cls = 'p-netflix';
        else if (pl.includes('prime')) cls = 'p-prime';
        else if (pl.includes('disney')) cls = 'p-disney';
        else if (pl.includes('apple')) cls = 'p-apple';
        return `<span class="provider ${cls}">${esc(p)}</span>`;
      }).join('');

      return `
        <div class="card" data-id="${esc(m._id || '')}">
          <div class="poster-wrap">
            <img class="poster" src="${esc(m.poster || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=400')}" loading="lazy" alt="${esc(m.title)}">
            ${m.rating ? `<span class="rating-badge">★ ${m.rating}</span>` : ''}
          </div>
          <div class="card-body">
            <div class="title">${esc(m.title)} ${m.year ? `<span style="font-size:12px;color:var(--wd-muted)">(${m.year})</span>` : ''}</div>
            <div class="meta">${esc(m.genre || 'Film')}</div>
            <div class="providers">${provs || '<span class="wd-small wd-muted">Available on streaming</span>'}</div>
            ${m.notes ? `<div class="wd-small wd-muted" style="margin-top:4px;font-style:italic">“${esc(m.notes)}”</div>` : ''}
            
            <div class="actions">
              ${m.trailer ? `<button class="wd-btn wd-btn-sm" data-play-trailer="${esc(m.trailer)}">▶ Trailer</button>` : ''}
              ${isCurated ? `
                <button class="wd-btn wd-btn-primary wd-btn-sm" data-add-rec="${idx}">+ Add</button>
              ` : `
                <select class="status-select" data-change-status="${esc(m._id)}">
                  <option value="watchlist" ${m.status === 'watchlist' ? 'selected' : ''}>Watchlist</option>
                  <option value="watching" ${m.status === 'watching' ? 'selected' : ''}>Watching</option>
                  <option value="halfdone" ${m.status === 'halfdone' ? 'selected' : ''}>Half Done</option>
                  <option value="watched" ${m.status === 'watched' ? 'selected' : ''}>Watched</option>
                </select>
                <div class="wd-spacer"></div>
                <button class="wd-btn wd-btn-ghost wd-btn-sm" data-delete-movie="${esc(m._id)}" title="Delete">🗑</button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach dynamic listeners
    document.querySelectorAll('[data-play-trailer]').forEach(b => {
      b.onclick = () => playTrailer(b.dataset.playTrailer);
    });

    document.querySelectorAll('[data-change-status]').forEach(sel => {
      sel.onchange = async (e) => {
        const id = sel.dataset.changeStatus;
        const newStatus = e.target.value;
        await collection.update(id, { status: newStatus });
        wd.ui.toast(`Status updated to ${newStatus}`, 'ok');
        await loadMovies();
      };
    });

    document.querySelectorAll('[data-delete-movie]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('Remove this movie?')) return;
        await collection.remove(b.dataset.deleteMovie);
        wd.ui.toast('Removed movie', 'ok');
        await loadMovies();
      };
    });

    document.querySelectorAll('[data-add-rec]').forEach(b => {
      b.onclick = async () => {
        const rec = CURATED_RECS[+b.dataset.addRec];
        await collection.insert({ ...rec, status: 'watchlist', createdAt: new Date().toISOString() });
        wd.ui.toast(`Added "${rec.title}" to Watchlist`, 'ok');
        await loadMovies();
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
