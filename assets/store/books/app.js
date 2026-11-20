(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const { sources } = window.BookSources;
  const books = wd.db.collection('books');
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = '/__webdeck/vendor/pdf.worker.min.js';

  // ---------------------------------------------------------------- tabs
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  function showTab(t) {
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === t)));
    $('discover').hidden = t !== 'discover';
    $('library').hidden = t !== 'library';
    if (t === 'library') renderShelf();
  }

  // -------------------------------------------------------------- search
  let enabled = new Set(Object.keys(sources));
  $('srcs').innerHTML = Object.entries(sources).map(([k, s]) => `<label class="wd-row" style="gap:4px"><input type="checkbox" data-src="${k}" checked> ${esc(s.label)}</label>`).join('');
  $('srcs').onchange = (e) => { const k = e.target.dataset.src; if (k) e.target.checked ? enabled.add(k) : enabled.delete(k); };

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let results = [];

  $('sForm').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('q').value.trim();
    if (!q) return;
    results = [];
    const status = {};
    const renderStatus = () => {
      $('results').innerHTML = `<div class="wd-small wd-muted" style="margin-bottom:6px">${Object.entries(status).map(([k, v]) => `${esc(sources[k].label)}: ${esc(v)}`).join(' · ')}</div>` + renderResults();
    };
    await Promise.all([...enabled].map(async (k) => {
      status[k] = 'searching…';
      renderStatus();
      try {
        const list = await sources[k].search(q);
        status[k] = `${list.length} found`;
        // Merge duplicates: same title + first author → one row with several sources.
        for (const b of list) {
          const key = norm(b.title).slice(0, 60) + '|' + norm((b.author || '').split(',')[0]).split(' ').pop();
          const existing = results.find((r) => r.key === key);
          if (existing) existing.alts.push(b);
          else results.push({ key, main: b, alts: [] });
        }
      } catch (err) {
        status[k] = 'unavailable';
      }
      renderStatus();
    }));
  };

  const SRC_BADGE = { gutenberg: 'wd-badge-blue', standard: 'wd-badge-green', openlibrary: 'wd-badge-amber', archive: '' };
  function renderResults() {
    if (!results.length) return '<div class="wd-empty">No books yet…</div>';
    const rank = { standard: 0, gutenberg: 1, openlibrary: 2, archive: 3 };
    return results
      .slice()
      .sort((a, b) => b.alts.length - a.alts.length || rank[a.main.source] - rank[b.main.source])
      .map((r, i) => {
        const all = [r.main, ...r.alts];
        const b = r.main;
        return `<div class="book">
          ${b.cover ? `<img class="cover" src="${esc(b.cover)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : '<div class="cover">📖</div>'}
          <div class="wd-grow"><b>${esc(b.title)}</b><div class="wd-small wd-muted">${esc(b.author || 'Unknown author')}${b.year ? ' · ' + esc(b.year) : ''}${b.extra ? ' · ' + esc(b.extra) : ''}</div>
            <div class="wd-row" style="gap:4px;margin-top:4px">${all.map((x) => `<span class="wd-badge src ${SRC_BADGE[x.source]}">${esc(sources[x.source].label)}</span>`).join('')}</div></div>
          <div class="wd-row" style="flex-direction:column;align-items:stretch;gap:6px">
            <button class="wd-btn wd-btn-primary wd-btn-sm" data-get="${i}" data-read="1">Read</button>
            <button class="wd-btn wd-btn-sm" data-get="${i}">Download</button>
            ${b.page ? `<button class="wd-btn wd-btn-sm wd-btn-ghost" data-page="${esc(b.page)}">Website</button>` : ''}
          </div></div>`;
      }).join('');
  }

  $('results').addEventListener('click', async (e) => {
    const page = e.target.closest('[data-page]');
    if (page) return wd.openUrl(page.dataset.page);
    const btn = e.target.closest('[data-get]');
    if (!btn) return;
    const sorted = results.slice().sort((a, b) => b.alts.length - a.alts.length || ({ standard: 0, gutenberg: 1, openlibrary: 2, archive: 3 }[a.main.source] - { standard: 0, gutenberg: 1, openlibrary: 2, archive: 3 }[b.main.source]));
    const r = sorted[+btn.dataset.get];
    btn.disabled = true;
    const label = btn.textContent;
    try {
      const book = await download(r, (msg) => (btn.textContent = msg));
      wd.ui.toast(`“${book.title}” added to your library`, 'ok');
      if (btn.dataset.read) openBook(book);
    } catch (err) {
      wd.ui.toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = label;
  });

  /** Tries each source of a merged result until one yields a downloadable file (EPUB > PDF > TXT). */
  async function download(r, progress) {
    const candidates = [r.main, ...r.alts].sort((a, b) => ({ standard: 0, gutenberg: 1, openlibrary: 2, archive: 3 }[a.source] - { standard: 0, gutenberg: 1, openlibrary: 2, archive: 3 }[b.source]));
    const existing = (await books.find({ sourceId: { $in: candidates.map((c) => c.id) } }))[0];
    if (existing) return existing;
    let lastErr;
    for (const c of candidates) {
      try {
        progress('Finding file…');
        const formats = c.formats && c.formats.length ? c.formats : await c.resolve();
        const f = ['epub', 'pdf', 'txt'].map((t) => formats.find((x) => x.type === t)).find(Boolean);
        const safe = `${c.title}${c.author ? ' - ' + c.author.split(',')[0] : ''}`.replace(/[\\/:*?"<>|]/g, '').slice(0, 120);
        const d = await wd.net.download(f.url, {
          name: `${safe}.${f.type}`, subdir: 'Books',
          onProgress: (p) => progress(p.total ? `${Math.round((p.received / p.total) * 100)}%` : wd.ui.formatBytes(p.received)),
        });
        return books.insert({ title: c.title, author: c.author, year: c.year, cover: c.cover, format: f.type, path: d.path, source: c.source, sourceId: c.id, progress: 0 });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Could not download this book');
  }

  // --------------------------------------------------------------- shelf
  async function renderShelf() {
    const list = await books.find(null, { sort: '-lastOpened' });
    $('libSub').textContent = list.length ? `${list.length} book${list.length === 1 ? '' : 's'}` : '';
    $('shelf').innerHTML = list.map((b) => `<div class="item" data-open="${b._id}">
        ${b.cover ? `<img class="cover" src="${esc(b.cover)}" referrerpolicy="no-referrer" alt="">` : `<div class="cover">${b.format === 'pdf' ? '📕' : '📗'}</div>`}
        <div class="t">${esc(b.title)}</div><div class="wd-small wd-muted wd-ellipsis">${esc(b.author || '')}</div>
        <div class="bar"><div style="width:${Math.round((b.progress || 0) * 100)}%"></div></div>
        <div class="wd-row wd-small" style="gap:6px;margin-top:4px"><span class="wd-badge">${esc(b.format.toUpperCase())}</span><a href="#" data-del="${b._id}" class="wd-muted">Remove</a></div>
      </div>`).join('') || '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">📚</div>Your library is empty. Search in Discover, or add e-books from this computer.</div>';
  }
  $('shelf').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      if (del.dataset.armed) { await books.remove(del.dataset.del); renderShelf(); }
      else { del.dataset.armed = '1'; del.textContent = 'Click to confirm'; }
      return;
    }
    const it = e.target.closest('[data-open]');
    if (it) openBook(await books.get(it.dataset.open));
  });
  $('addLocal').onclick = async () => {
    try {
      const picked = await wd.files.pick({ extensions: ['epub', 'pdf', 'txt'], multiple: true, remember: true });
      for (const f of picked) {
        if ((await books.find({ path: f.path })).length) continue;
        await books.insert({ title: f.name.replace(/\.[^.]+$/, ''), author: '', format: f.ext, path: f.path, source: 'local', progress: 0 });
      }
      renderShelf();
    } catch (err) { wd.ui.toast(err.message, 'error'); }
  };

  // -------------------------------------------------------------- reader
  const THEMES = [
    { name: 'paper', bg: '#faf7f0', fg: '#222' },
    { name: 'sepia', bg: '#f4ecd8', fg: '#5b4636' },
    { name: 'night', bg: '#121212', fg: '#d6d6d6' },
  ];
  let prefs = { theme: 0, size: 100 };
  let current = null; // { book, kind, next(), prev(), destroy() }

  function applyTheme() {
    const t = THEMES[prefs.theme];
    $('reader').style.setProperty('--rd-bg', t.bg);
    $('reader').style.setProperty('--rd-fg', t.fg);
    $('textStage').style.fontSize = `${18 * prefs.size / 100}px`;
    if (current && current.theme) current.theme(t);
  }

  async function openBook(book) {
    if (!book) return;
    prefs = await wd.kv.get('prefs', prefs);
    await books.update(book._id, { lastOpened: new Date().toISOString() });
    if (current) current.destroy();
    $('reader').hidden = false;
    $('rTitle').textContent = book.title;
    $('rPos').textContent = 'Loading…';
    ['viewer', 'pdfStage', 'textStage'].forEach((id) => { $(id).hidden = true; $(id).innerHTML = ''; });
    let file;
    try { file = await wd.files.url(book.path); } catch (err) { wd.ui.toast('The book file is missing: ' + err.message, 'error'); closeReader(); return; }
    try {
      current = book.format === 'epub' ? await openEpub(book, file.url) : book.format === 'pdf' ? await openPdf(book, file.url) : await openText(book, file.url);
    } catch (err) {
      console.warn('Primary reader failed, trying text fallback:', err);
      try {
        current = await openText(book, file.url);
      } catch (fallbackErr) {
        wd.ui.toast('Could not open this book: ' + err.message, 'error');
        closeReader();
        return;
      }
    }
    applyTheme();
  }

  async function openEpub(book, url) {
    $('viewer').hidden = false;
    // Load as ArrayBuffer for 100% reliable offline decompression in sandboxed webviews
    let data;
    try {
      const resp = await fetch(url);
      data = await resp.arrayBuffer();
    } catch (_) {
      data = url;
    }
    const epub = ePub(data);
    const rendition = epub.renderTo('viewer', { width: '100%', height: '100%', flow: 'paginated', spread: 'auto' });
    const theme = (t) => {
      rendition.themes.register('wd', {
        body: { background: t.bg + ' !important', color: t.fg + ' !important', 'font-family': 'Georgia, serif !important' },
        'a': { color: 'inherit' },
        'p': { 'line-height': '1.6 !important' }
      });
      rendition.themes.select('wd');
      rendition.themes.fontSize(prefs.size + '%');
    };
    await rendition.display(book.cfi || undefined);
    rendition.on('relocated', async (loc) => {
      const pct = loc.start.percentage || (epub.locations.length() ? epub.locations.percentageFromCfi(loc.start.cfi) : 0);
      $('rPos').textContent = pct ? `${Math.round(pct * 100)}%` : `p. ${loc.start.displayed.page}/${loc.start.displayed.total}`;
      await books.update(book._id, { cfi: loc.start.cfi, progress: pct || book.progress || 0 });
    });
    epub.ready.then(() => epub.locations.generate(1600)).catch(() => {});
    rendition.on('keyup', (e) => { if (e.key === 'ArrowRight') rendition.next(); if (e.key === 'ArrowLeft') rendition.prev(); });
    return { kind: 'epub', next: () => rendition.next(), prev: () => rendition.prev(), theme, destroy: () => epub.destroy() };
  }

  async function openPdf(book, url) {
    $('pdfStage').hidden = false;
    // Load into Uint8Array for offline sandboxed webviews without HTTP range/stream failures
    let pdfData;
    try {
      const resp = await fetch(url);
      pdfData = new Uint8Array(await resp.arrayBuffer());
    } catch (_) {}
    const pdf = await pdfjsLib.getDocument(pdfData ? { data: pdfData } : url).promise;
    let page = Math.min(pdf.numPages, book.page || 1);
    const draw = async () => {
      const p = await pdf.getPage(page);
      const width = Math.min($('stage').clientWidth - 32, 1100);
      const vp0 = p.getViewport({ scale: 1 });
      const scale = (width / vp0.width) * (prefs.size / 100) * (window.devicePixelRatio || 1);
      const vp = p.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
      await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      $('pdfStage').replaceChildren(canvas);
      $('stage').scrollTop = 0;
      $('rPos').textContent = `${page} / ${pdf.numPages}`;
      await books.update(book._id, { page, progress: page / pdf.numPages });
    };
    await draw();
    return {
      kind: 'pdf',
      next: () => { if (page < pdf.numPages) { page++; draw(); } },
      prev: () => { if (page > 1) { page--; draw(); } },
      zoom: draw,
      destroy: () => pdf.destroy(),
    };
  }

  async function openText(book, url) {
    $('textStage').hidden = false;
    const text = await (await fetch(url)).text();
    $('textStage').textContent = text;
    const stage = $('stage');
    requestAnimationFrame(() => { stage.scrollTop = (book.progress || 0) * (stage.scrollHeight - stage.clientHeight); });
    let t;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const pct = stage.scrollTop / Math.max(1, stage.scrollHeight - stage.clientHeight);
        $('rPos').textContent = `${Math.round(pct * 100)}%`;
        books.update(book._id, { progress: pct });
      }, 400);
    };
    stage.addEventListener('scroll', onScroll);
    const pageBy = (dir) => stage.scrollBy({ top: dir * (stage.clientHeight - 60), behavior: 'smooth' });
    return { kind: 'text', next: () => pageBy(1), prev: () => pageBy(-1), destroy: () => stage.removeEventListener('scroll', onScroll) };
  }

  function closeReader() {
    if (current) current.destroy();
    current = null;
    $('reader').hidden = true;
    renderShelf();
  }

  $('rClose').onclick = closeReader;
  $('rNext').onclick = () => current?.next();
  $('rPrev').onclick = () => current?.prev();
  const resize = async (d) => {
    prefs.size = Math.max(70, Math.min(200, prefs.size + d));
    await wd.kv.set('prefs', prefs);
    applyTheme();
    if (current?.zoom) current.zoom();
  };
  $('rBigger').onclick = () => resize(10);
  $('rSmaller').onclick = () => resize(-10);
  $('rTheme').onclick = async () => { prefs.theme = (prefs.theme + 1) % THEMES.length; await wd.kv.set('prefs', prefs); applyTheme(); };
  document.addEventListener('keydown', (e) => {
    if ($('reader').hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') current?.next();
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') current?.prev();
    if (e.key === 'Escape') closeReader();
  });

  (async () => {
    const count = (await books.find()).length;
    if (count) showTab('library');
  })();
})();
