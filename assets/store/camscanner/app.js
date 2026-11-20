(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);

  let pages = []; // { id, img, rotation, filter }

  function init() {
    bindEvents();
    renderPages();
  }

  function bindEvents() {
    $('btnAddPage').onclick = () => $('scanInput').click();
    $('scanInput').onchange = handleFilesPicked;

    $('btnClearAll').onclick = () => {
      if (!pages.length || !confirm('Clear all scanned pages?')) return;
      pages = [];
      renderPages();
    };

    $('btnExportPdf').onclick = exportPdf;

    document.querySelectorAll('[data-global-filter]').forEach(b => {
      b.onclick = () => {
        const filter = b.dataset.globalFilter;
        pages.forEach(p => p.filter = filter);
        renderPages();
        wd.ui.toast(`Applied "${filter}" filter to all pages`, 'ok');
      };
    });

    // Drag and drop images onto app window
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
      if (files.length) loadImages(files);
    });
  }

  function handleFilesPicked(e) {
    const files = Array.from(e.target.files || []);
    if (files.length) loadImages(files);
  }

  async function loadImages(files) {
    wd.ui.toast(`Loading ${files.length} document image(s)…`, 'ok');
    for (const file of files) {
      const img = new Image();
      const url = URL.createObjectURL(file);
      await new Promise(resolve => {
        img.onload = resolve;
        img.src = url;
      });
      pages.push({
        id: 'page-' + Math.random().toString(36).substring(2, 9),
        img,
        rotation: 0,
        filter: 'magic'
      });
    }
    renderPages();
  }

  function renderPages() {
    $('pageCountLabel').textContent = `${pages.length} page${pages.length === 1 ? '' : 's'}`;

    if (pages.length === 0) {
      $('pagesGrid').innerHTML = '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">📄</div>No pages added yet. Click "+ Add / Scan Page" or drag & drop documents/photos here.</div>';
      return;
    }

    $('pagesGrid').innerHTML = pages.map((p, idx) => `
      <div class="page-card" data-page-id="${esc(p.id)}">
        <div class="page-thumb-wrap">
          <canvas id="canvas-${esc(p.id)}"></canvas>
        </div>
        <div class="page-footer">
          <span style="font-weight:700;font-size:12px">#${idx + 1}</span>
          <div class="wd-spacer"></div>
          <button class="wd-btn wd-btn-ghost wd-btn-sm" data-action="rotate" data-idx="${idx}" title="Rotate 90°">🔄</button>
          <button class="wd-btn wd-btn-ghost wd-btn-sm" data-action="left" data-idx="${idx}" title="Move Earlier" ${idx === 0 ? 'disabled' : ''}>◀</button>
          <button class="wd-btn wd-btn-ghost wd-btn-sm" data-action="right" data-idx="${idx}" title="Move Later" ${idx === pages.length - 1 ? 'disabled' : ''}>▶</button>
          <button class="wd-btn wd-btn-ghost wd-btn-sm" data-action="delete" data-idx="${idx}" title="Remove" style="color:#ef4444">🗑</button>
        </div>
      </div>
    `).join('');

    // Draw filtered images on each canvas
    pages.forEach(p => {
      const canvas = document.getElementById(`canvas-${p.id}`);
      if (canvas) applyFilterAndDraw(p, canvas);
    });

    // Attach actions
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = (e) => {
        const action = btn.dataset.action;
        const idx = +btn.dataset.idx;
        if (action === 'rotate') {
          pages[idx].rotation = (pages[idx].rotation + 90) % 360;
          renderPages();
        } else if (action === 'left') {
          if (idx > 0) {
            const temp = pages[idx - 1];
            pages[idx - 1] = pages[idx];
            pages[idx] = temp;
            renderPages();
          }
        } else if (action === 'right') {
          if (idx < pages.length - 1) {
            const temp = pages[idx + 1];
            pages[idx + 1] = pages[idx];
            pages[idx] = temp;
            renderPages();
          }
        } else if (action === 'delete') {
          pages.splice(idx, 1);
          renderPages();
        }
      };
    });
  }

  function applyFilterAndDraw(page, canvas) {
    const img = page.img;
    const rot = page.rotation;
    const isRot90 = rot === 90 || rot === 270;

    const w = isRot90 ? img.naturalHeight : img.naturalWidth;
    const h = isRot90 ? img.naturalWidth : img.naturalHeight;

    canvas.width = Math.min(w, 1200);
    canvas.height = Math.round(canvas.width * (h / w));

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);

    const drawW = isRot90 ? canvas.height : canvas.width;
    const drawH = isRot90 ? canvas.width : canvas.height;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // Pixel processing for custom filters
    if (page.filter !== 'original') {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], b = d[i+2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        if (page.filter === 'bw') {
          // B&W threshold with sharp text
          const v = lum > 140 ? 255 : 0;
          d[i] = d[i+1] = d[i+2] = v;
        } else if (page.filter === 'gray') {
          d[i] = d[i+1] = d[i+2] = lum;
        } else if (page.filter === 'contrast') {
          // Boost contrast
          const factor = (259 * (128 + 255)) / (255 * (259 - 128));
          d[i] = Math.min(255, Math.max(0, factor * (r - 128) + 128));
          d[i+1] = Math.min(255, Math.max(0, factor * (g - 128) + 128));
          d[i+2] = Math.min(255, Math.max(0, factor * (b - 128) + 128));
        } else if (page.filter === 'magic') {
          // CamScanner Magic Color: brighten whites & sharpen dark text
          const boost = lum > 130 ? Math.min(255, lum * 1.25) : Math.max(0, lum * 0.75);
          d[i] = Math.min(255, r * (boost / Math.max(1, lum)));
          d[i+1] = Math.min(255, g * (boost / Math.max(1, lum)));
          d[i+2] = Math.min(255, b * (boost / Math.max(1, lum)));
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }
  }

  async function exportPdf() {
    if (!pages.length) {
      wd.ui.toast('Please add at least 1 document page before exporting PDF', 'error');
      return;
    }

    try {
      wd.ui.toast('Generating multi-page PDF…', 'ok');
      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.create();

      for (const p of pages) {
        const tempCanvas = document.createElement('canvas');
        applyFilterAndDraw(p, tempCanvas);

        const imgDataUrl = tempCanvas.toDataURL('image/jpeg', 0.88);
        const imgBytes = await fetch(imgDataUrl).then(r => r.arrayBuffer());
        const embeddedImg = await pdfDoc.embedJpg(imgBytes);

        // A4 Dimensions: 595.28 x 841.89 pt
        const page = pdfDoc.addPage([595.28, 841.89]);
        const imgAspect = embeddedImg.width / embeddedImg.height;
        const pageAspect = page.getWidth() / page.getHeight();

        let renderW = page.getWidth() - 40;
        let renderH = renderW / imgAspect;
        if (renderH > page.getHeight() - 40) {
          renderH = page.getHeight() - 40;
          renderW = renderH * imgAspect;
        }

        page.drawImage(embeddedImg, {
          x: (page.getWidth() - renderW) / 2,
          y: (page.getHeight() - renderH) / 2,
          width: renderW,
          height: renderH
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `WebDeck-Scanned-Doc-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      wd.ui.toast(`Exported ${pages.length}-page PDF document successfully!`, 'ok');
    } catch (err) {
      wd.ui.toast('PDF Export error: ' + err.message, 'error');
    }
  }

  init();
})();
