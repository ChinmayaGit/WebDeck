(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);
  const collection = wd.db.collection('manga');

  let currentTitle = null;
  let currentPages = [];
  let currentPageIndex = 0;
  let viewMode = 'webtoon';

  const SAMPLE_MANGA = [
    {
      id: 'sample-sololeveling',
      title: 'Shadow Monarch Awakening',
      author: 'Webtoon Studio',
      pagesCount: 6,
      cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500',
      pages: [
        'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800',
        'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800',
        'https://images.unsplash.com/photo-1563089145-599997674d42?w=800',
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800',
        'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=800',
        'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800'
      ]
    },
    {
      id: 'sample-cyberpunk',
      title: 'Neon Odyssey 2088',
      author: 'Cyber Comics',
      pagesCount: 5,
      cover: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500',
      pages: [
        'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800',
        'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800',
        'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800',
        'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800',
        'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800'
      ]
    }
  ];

  async function init() {
    bindEvents();
    await renderShelf();
  }

  function bindEvents() {
    $('btnOpenFiles').onclick = () => $('mangaFileInput').click();
    $('mangaFileInput').onchange = handleFilesPicked;

    $('btnCloseReader').onclick = closeReader;
    $('btnPrevPage').onclick = prevPage;
    $('btnNextPage').onclick = nextPage;

    $('readerMode').onchange = (e) => {
      viewMode = e.target.value;
      renderReaderPages();
    };

    document.addEventListener('keydown', (e) => {
      if ($('readerStage').hidden) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') nextPage();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevPage();
      if (e.key === 'Escape') closeReader();
    });
  }

  async function renderShelf() {
    const list = [...SAMPLE_MANGA, ...(await collection.find())];
    $('mangaCount').textContent = `${list.length} title${list.length === 1 ? '' : 's'}`;

    $('mangaShelf').innerHTML = list.map(m => `
      <div class="manga-card" data-open-manga="${esc(m.id)}">
        <div class="cover-wrap">
          <img class="cover" src="${esc(m.cover || m.pages[0])}" alt="${esc(m.title)}">
        </div>
        <div class="card-info">
          <div class="title">${esc(m.title)}</div>
          <div class="wd-small wd-muted">${m.pages.length} pages · ${esc(m.author || 'Local')}</div>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('[data-open-manga]').forEach(card => {
      card.onclick = () => {
        const id = card.dataset.openManga;
        const manga = list.find(m => m.id === id);
        if (manga) openManga(manga);
      };
    });
  }

  async function handleFilesPicked(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      if (file.name.endsWith('.cbz') || file.name.endsWith('.zip')) {
        wd.ui.toast(`Extracting ${file.name}…`, 'ok');
        const zip = await JSZip.loadAsync(file);
        const imgEntries = Object.values(zip.files).filter(f => !f.dir && /\.(jpe?g|png|webp|avif)$/i.test(f.name)).sort((a,b) => a.name.localeCompare(b.name));
        
        const pageUrls = [];
        for (const entry of imgEntries.slice(0, 50)) {
          const blob = await entry.async('blob');
          pageUrls.push(URL.createObjectURL(blob));
        }

        if (pageUrls.length) {
          const item = {
            id: 'local-' + Date.now(),
            title: file.name.replace(/\.[^.]+$/, ''),
            author: 'Local Comic',
            cover: pageUrls[0],
            pages: pageUrls
          };
          await collection.insert(item);
          wd.ui.toast(`Added "${item.title}" with ${pageUrls.length} pages`, 'ok');
        }
      } else {
        // Individual image
        const url = URL.createObjectURL(file);
        const item = {
          id: 'local-' + Date.now(),
          title: file.name.replace(/\.[^.]+$/, ''),
          author: 'Gallery Image',
          cover: url,
          pages: [url]
        };
        await collection.insert(item);
      }
    }
    await renderShelf();
  }

  function openManga(manga) {
    currentTitle = manga;
    currentPages = manga.pages || [];
    currentPageIndex = 0;

    $('readerTitle').textContent = manga.title;
    $('readerStage').hidden = false;
    renderReaderPages();
  }

  function renderReaderPages() {
    const body = $('readerBody');
    body.innerHTML = '';
    $('pageIndicator').textContent = `Page ${currentPageIndex + 1} / ${currentPages.length}`;

    if (viewMode === 'webtoon') {
      // Continuous vertical strip
      currentPages.forEach((url, i) => {
        const img = document.createElement('img');
        img.className = 'webtoon-page';
        img.src = url;
        img.loading = 'lazy';
        body.appendChild(img);
      });
      body.scrollTop = 0;
    } else if (viewMode === 'single') {
      const wrap = document.createElement('div');
      wrap.className = 'single-page-wrap';
      const img = document.createElement('img');
      img.src = currentPages[currentPageIndex];
      wrap.appendChild(img);
      body.appendChild(wrap);
    } else {
      // Double page
      const wrap = document.createElement('div');
      wrap.className = 'single-page-wrap';
      wrap.style.gap = '10px';

      const img1 = document.createElement('img');
      img1.src = currentPages[currentPageIndex];

      const p2Index = Math.min(currentPageIndex + 1, currentPages.length - 1);
      const img2 = document.createElement('img');
      img2.src = currentPages[p2Index];

      wrap.appendChild(img2); // Manga right-to-left layout
      wrap.appendChild(img1);
      body.appendChild(wrap);
    }
  }

  function prevPage() {
    if (viewMode === 'webtoon') {
      $('readerBody').scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
    } else {
      const step = viewMode === 'double' ? 2 : 1;
      if (currentPageIndex > 0) {
        currentPageIndex = Math.max(0, currentPageIndex - step);
        renderReaderPages();
      }
    }
  }

  function nextPage() {
    if (viewMode === 'webtoon') {
      $('readerBody').scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
    } else {
      const step = viewMode === 'double' ? 2 : 1;
      if (currentPageIndex < currentPages.length - step) {
        currentPageIndex += step;
        renderReaderPages();
      }
    }
  }

  function closeReader() {
    $('readerStage').hidden = true;
  }

  init();
})();
