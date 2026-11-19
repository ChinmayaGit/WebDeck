(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const { PDFDocument, StandardFonts, degrees, rgb } = window.PDFLib;
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/__webdeck/vendor/pdf.worker.min.js';

  // --------------------------------------------------------------- helpers
  const stem = (n) => n.replace(/\.[^.]+$/, '') || 'document';
  const bytesOf = async (f) => new Uint8Array(await (await fetch(f.url)).arrayBuffer());

  async function loadPdf(f) {
    try {
      return await PDFDocument.load(await bytesOf(f), { updateMetadata: false });
    } catch (e) {
      if (/encrypt/i.test(e.message)) throw new Error(`“${f.name}” is password-protected. Unlock it first.`);
      throw new Error(`“${f.name}” could not be read as a PDF (${e.message})`);
    }
  }

  /** "1-3, 5, 8-" -> [0,1,2,4,7,...] (0-based, in order, unique) */
  function parseRanges(text, count) {
    const out = [];
    for (const part of String(text || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
      if (!m || (!m[1] && !m[3])) throw new Error(`“${part}” is not a page or range`);
      const a = m[1] ? +m[1] : 1;
      const b = m[2] ? (m[3] ? +m[3] : count) : a;
      if (a < 1 || b > count || a > b) throw new Error(`Pages must be between 1 and ${count} (got “${part}”)`);
      for (let i = a; i <= b; i++) if (!out.includes(i - 1)) out.push(i - 1);
    }
    if (!out.length) throw new Error('Enter at least one page, e.g. 1-3, 5');
    return out;
  }

  /** Splits "1-3, 4-6" into separate groups for Split. */
  function parseGroups(text, count) {
    return String(text).split(',').map((s) => s.trim()).filter(Boolean).map((g) => parseRanges(g, count));
  }

  async function save(name, bytes, subdir, type = 'application/pdf') {
    return wd.files.save({ name, blob: new Blob([bytes], { type }), subdir });
  }

  async function copyInto(out, src, indices) {
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  async function renderPage(pdfjsDoc, index, scale) {
    const page = await pdfjsDoc.getPage(index + 1);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  }
  const openWithPdfjs = async (f) => window.pdfjsLib.getDocument({ data: await bytesOf(f) }).promise;
  const canvasBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

  // ---------------------------------------------------------------- tools
  const RANGE_HINT = 'Examples: 1-3, 5, 8-  (8- means 8 to the end)';
  const tools = [
    {
      id: 'merge', group: 'Organize', name: 'Merge PDFs', input: 'many',
      desc: 'Combine several PDFs into one, in the order listed.',
      async run(c) {
        const out = await PDFDocument.create();
        for (const f of c.files) { const src = await loadPdf(f); await copyInto(out, src, src.getPageIndices()); }
        return [await save(`${stem(c.files[0].name)} (merged).pdf`, await out.save())];
      },
    },
    {
      id: 'split', group: 'Organize', name: 'Split PDF',
      desc: 'Break a PDF into several files: one per page, or by ranges you choose.',
      fields: [
        { id: 'mode', label: 'Split into', type: 'select', options: [['each', 'One file per page'], ['ranges', 'Custom ranges']] },
        { id: 'ranges', label: 'Ranges (each becomes a file)', type: 'text', value: '', placeholder: '1-3, 4-6, 7-', hint: 'Each comma-separated range becomes its own PDF.', show: (v) => v.mode === 'ranges' },
      ],
      async run(c) {
        const src = await loadPdf(c.file);
        const n = src.getPageCount();
        const groups = c.v.mode === 'each' ? src.getPageIndices().map((i) => [i]) : parseGroups(c.v.ranges, n);
        const dir = `${stem(c.file.name)} split`;
        const saved = [];
        for (const g of groups) {
          const out = await PDFDocument.create();
          await copyInto(out, src, g);
          const label = g.length === 1 ? `page ${g[0] + 1}` : `pages ${g[0] + 1}-${g[g.length - 1] + 1}`;
          saved.push(await save(`${stem(c.file.name)} (${label}).pdf`, await out.save(), dir));
        }
        return saved;
      },
    },
    {
      id: 'extract', group: 'Organize', name: 'Extract pages',
      desc: 'Copy selected pages into a new PDF.',
      fields: [{ id: 'pages', label: 'Pages to keep', type: 'text', value: '', placeholder: '1-3, 5', hint: RANGE_HINT }],
      async run(c) {
        const src = await loadPdf(c.file);
        const out = await PDFDocument.create();
        await copyInto(out, src, parseRanges(c.v.pages, src.getPageCount()));
        return [await save(`${stem(c.file.name)} (extracted).pdf`, await out.save())];
      },
    },
    {
      id: 'remove', group: 'Organize', name: 'Remove pages',
      desc: 'Delete selected pages.',
      fields: [{ id: 'pages', label: 'Pages to delete', type: 'text', value: '', placeholder: '2, 4-5', hint: RANGE_HINT }],
      async run(c) {
        const doc = await loadPdf(c.file);
        const drop = parseRanges(c.v.pages, doc.getPageCount());
        if (drop.length >= doc.getPageCount()) throw new Error('That would remove every page.');
        drop.sort((a, b) => b - a).forEach((i) => doc.removePage(i));
        return [await save(`${stem(c.file.name)} (pages removed).pdf`, await doc.save())];
      },
    },
    {
      id: 'organize', group: 'Organize', name: 'Organize pages', custom: 'organize',
      desc: 'See every page, then reorder, rotate or delete them visually.',
    },
    {
      id: 'rotate', group: 'Organize', name: 'Rotate PDF',
      desc: 'Rotate all pages or just some of them.',
      fields: [
        { id: 'angle', label: 'Rotate by', type: 'select', options: [['90', '90° clockwise'], ['270', '90° counter-clockwise'], ['180', '180°']] },
        { id: 'pages', label: 'Pages (empty = all)', type: 'text', value: '', placeholder: 'all', hint: RANGE_HINT },
      ],
      async run(c) {
        const doc = await loadPdf(c.file);
        const idx = String(c.v.pages).trim() ? parseRanges(c.v.pages, doc.getPageCount()) : doc.getPageIndices();
        idx.forEach((i) => { const p = doc.getPage(i); p.setRotation(degrees((p.getRotation().angle + +c.v.angle) % 360)); });
        return [await save(`${stem(c.file.name)} (rotated).pdf`, await doc.save())];
      },
    },
    {
      id: 'numbers', group: 'Edit', name: 'Add page numbers',
      desc: 'Stamp page numbers on every page.',
      fields: [
        { id: 'pos', label: 'Position', type: 'select', options: [['bc', 'Bottom center'], ['br', 'Bottom right'], ['bl', 'Bottom left'], ['tc', 'Top center'], ['tr', 'Top right']] },
        { id: 'fmt', label: 'Format', type: 'select', options: [['n', '1'], ['page', 'Page 1'], ['of', 'Page 1 of 10'], ['slash', '1 / 10']] },
        { id: 'start', label: 'First number', type: 'number', value: '1', min: 0 },
        { id: 'size', label: 'Font size', type: 'select', options: [['9', 'Small'], ['11', 'Medium'], ['14', 'Large']], value: '11' },
      ],
      async run(c) {
        const doc = await loadPdf(c.file);
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const total = doc.getPageCount();
        const size = +c.v.size;
        doc.getPages().forEach((page, i) => {
          const n = i + (+c.v.start || 0);
          const last = total - 1 + (+c.v.start || 0);
          const text = { n: `${n}`, page: `Page ${n}`, of: `Page ${n} of ${last}`, slash: `${n} / ${last}` }[c.v.fmt];
          const { width, height } = page.getSize();
          const tw = font.widthOfTextAtSize(text, size);
          const x = c.v.pos.endsWith('c') ? (width - tw) / 2 : c.v.pos.endsWith('r') ? width - tw - 36 : 36;
          const y = c.v.pos.startsWith('b') ? 24 : height - 24 - size;
          page.drawText(text, { x, y, size, font, color: rgb(0.2, 0.2, 0.2) });
        });
        return [await save(`${stem(c.file.name)} (numbered).pdf`, await doc.save())];
      },
    },
    {
      id: 'watermark', group: 'Edit', name: 'Add watermark',
      desc: 'Stamp text such as CONFIDENTIAL or DRAFT across every page.',
      fields: [
        { id: 'text', label: 'Watermark text', type: 'text', value: 'CONFIDENTIAL' },
        { id: 'style', label: 'Layout', type: 'select', options: [['diag', 'Diagonal, center'], ['center', 'Horizontal, center'], ['footer', 'Small footer']] },
        { id: 'color', label: 'Color', type: 'select', options: [['#9CA3AF', 'Gray'], ['#DC2626', 'Red'], ['#2563EB', 'Blue'], ['#000000', 'Black']] },
        { id: 'opacity', label: 'Opacity', type: 'select', options: [['0.15', 'Light'], ['0.3', 'Medium'], ['0.5', 'Strong']], value: '0.3' },
      ],
      async run(c) {
        const text = String(c.v.text).trim();
        if (!text) throw new Error('Enter the watermark text.');
        const doc = await loadPdf(c.file);
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        for (const page of doc.getPages()) {
          const { width, height } = page.getSize();
          const opts = { font, color: hexToRgb(c.v.color), opacity: +c.v.opacity };
          if (c.v.style === 'footer') {
            const size = 10;
            page.drawText(text, { ...opts, size, x: (width - font.widthOfTextAtSize(text, size)) / 2, y: 14 });
          } else {
            const diag = c.v.style === 'diag';
            const span = diag ? Math.hypot(width, height) * 0.7 : width * 0.8;
            const size = Math.min(110, span / Math.max(1, font.widthOfTextAtSize(text, 1)));
            const tw = font.widthOfTextAtSize(text, size);
            const angle = diag ? Math.atan2(height, width) : 0;
            // Rotate around the page center.
            const x = width / 2 - (Math.cos(angle) * tw) / 2 + (Math.sin(angle) * size) / 3;
            const y = height / 2 - (Math.sin(angle) * tw) / 2 - (Math.cos(angle) * size) / 3;
            page.drawText(text, { ...opts, size, x, y, rotate: degrees((angle * 180) / Math.PI) });
          }
        }
        return [await save(`${stem(c.file.name)} (watermarked).pdf`, await doc.save())];
      },
    },
    {
      id: 'sign', group: 'Edit', name: 'Sign PDF', custom: 'sign',
      desc: 'Draw your signature and place it on a page.',
      fields: [
        { id: 'page', label: 'Page', type: 'select', options: [['last', 'Last page'], ['first', 'First page'], ['all', 'Every page']] },
        { id: 'pos', label: 'Position', type: 'select', options: [['br', 'Bottom right'], ['bl', 'Bottom left'], ['bc', 'Bottom center']] },
        { id: 'w', label: 'Signature width', type: 'select', options: [['120', 'Small'], ['170', 'Medium'], ['230', 'Large']], value: '170' },
      ],
      async run(c) {
        if (!sigHasInk) throw new Error('Draw your signature first.');
        const doc = await loadPdf(c.file);
        const png = await doc.embedPng(await (await canvasBlob(trimmedSignature(), 'image/png')).arrayBuffer());
        const pages = doc.getPages();
        const targets = c.v.page === 'all' ? pages : [c.v.page === 'first' ? pages[0] : pages[pages.length - 1]];
        for (const page of targets) {
          const { width } = page.getSize();
          const w = +c.v.w, h = (png.height / png.width) * w;
          const x = c.v.pos === 'bl' ? 48 : c.v.pos === 'bc' ? (width - w) / 2 : width - w - 48;
          page.drawImage(png, { x, y: 48, width: w, height: h });
        }
        return [await save(`${stem(c.file.name)} (signed).pdf`, await doc.save())];
      },
    },
    {
      id: 'metadata', group: 'Edit', name: 'Edit document info',
      desc: 'Change the title, author, subject and keywords stored inside the PDF.',
      fields: [
        { id: 'title', label: 'Title', type: 'text', value: '' },
        { id: 'author', label: 'Author', type: 'text', value: '' },
        { id: 'subject', label: 'Subject', type: 'text', value: '' },
        { id: 'keywords', label: 'Keywords (comma separated)', type: 'text', value: '' },
      ],
      async run(c) {
        const doc = await loadPdf(c.file);
        doc.setTitle(c.v.title || '');
        doc.setAuthor(c.v.author || '');
        doc.setSubject(c.v.subject || '');
        doc.setKeywords(String(c.v.keywords || '').split(',').map((s) => s.trim()).filter(Boolean));
        doc.setProducer('WebDeck PDF Toolkit');
        doc.setModificationDate(new Date());
        return [await save(`${stem(c.file.name)} (info).pdf`, await doc.save())];
      },
    },
    {
      id: 'img2pdf', group: 'Convert', name: 'Images to PDF', input: 'many', pick: 'image',
      desc: 'Turn JPG, PNG, HEIC, WebP and other images into a single PDF, one image per page.',
      fields: [
        { id: 'size', label: 'Page size', type: 'select', options: [['fit', 'Same as image'], ['a4', 'A4'], ['letter', 'US Letter']] },
        { id: 'margin', label: 'Margin', type: 'select', options: [['0', 'None'], ['24', 'Small'], ['48', 'Large']], value: '0' },
      ],
      async run(c) {
        const out = await PDFDocument.create();
        for (const f of c.files) {
          let img;
          if (/^(jpe?g)$/i.test(f.ext)) img = await out.embedJpg(await bytesOf(f));
          else if (/^png$/i.test(f.ext)) img = await out.embedPng(await bytesOf(f));
          else {
            // Anything else the WebView can display is re-encoded to JPEG first.
            const el = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`Cannot read ${f.name}`)); i.src = f.url; });
            const cv = document.createElement('canvas');
            cv.width = el.naturalWidth; cv.height = el.naturalHeight;
            const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(el, 0, 0);
            img = await out.embedJpg(await (await canvasBlob(cv, 'image/jpeg', 0.92)).arrayBuffer());
          }
          const m = +c.v.margin;
          const [pw, ph] = c.v.size === 'a4' ? [595.28, 841.89] : c.v.size === 'letter' ? [612, 792] : [img.width + 2 * m, img.height + 2 * m];
          const landscape = c.v.size !== 'fit' && img.width > img.height;
          const [W, H] = landscape ? [ph, pw] : [pw, ph];
          const s = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height);
          const page = out.addPage([W, H]);
          page.drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s });
        }
        return [await save(`${stem(c.files[0].name)} (images).pdf`, await out.save())];
      },
    },
    {
      id: 'pdf2img', group: 'Convert', name: 'PDF to images',
      desc: 'Save every page (or chosen pages) as JPG or PNG.',
      fields: [
        { id: 'fmt', label: 'Format', type: 'select', options: [['jpg', 'JPG'], ['png', 'PNG']] },
        { id: 'scale', label: 'Resolution', type: 'select', options: [['1', 'Screen (72 dpi)'], ['2', 'High (144 dpi)'], ['4.17', 'Print (300 dpi)']], value: '2' },
        { id: 'pages', label: 'Pages (empty = all)', type: 'text', value: '', placeholder: 'all', hint: RANGE_HINT },
      ],
      async run(c, progress) {
        const pdf = await openWithPdfjs(c.file);
        const idx = String(c.v.pages).trim() ? parseRanges(c.v.pages, pdf.numPages) : [...Array(pdf.numPages).keys()];
        const dir = `${stem(c.file.name)} pages`;
        const saved = [];
        for (const [k, i] of idx.entries()) {
          progress((k / idx.length) * 100);
          const canvas = await renderPage(pdf, i, +c.v.scale);
          const blob = await canvasBlob(canvas, c.v.fmt === 'png' ? 'image/png' : 'image/jpeg', 0.9);
          saved.push(await wd.files.save({ name: `page-${String(i + 1).padStart(3, '0')}.${c.v.fmt}`, blob, subdir: dir }));
        }
        return saved;
      },
    },
    {
      id: 'compress', group: 'Convert', name: 'Compress scanned PDF',
      desc: 'Shrink large scanned PDFs by re-saving each page as an optimized image.',
      note: 'Best for scans and photos. Pages become images, so text in digital PDFs will no longer be selectable.',
      fields: [
        { id: 'q', label: 'Compression', type: 'select', options: [['150:0.8', 'Light (150 dpi)'], ['110:0.65', 'Medium (110 dpi)'], ['80:0.5', 'Strong (80 dpi)']], value: '110:0.65' },
      ],
      async run(c, progress) {
        const [dpi, q] = c.v.q.split(':').map(Number);
        const pdf = await openWithPdfjs(c.file);
        const out = await PDFDocument.create();
        for (let i = 0; i < pdf.numPages; i++) {
          progress((i / pdf.numPages) * 100);
          const page = await pdf.getPage(i + 1);
          const base = page.getViewport({ scale: 1 });
          const canvas = await renderPage(pdf, i, dpi / 72);
          const jpg = await out.embedJpg(await (await canvasBlob(canvas, 'image/jpeg', q)).arrayBuffer());
          out.addPage([base.width, base.height]).drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
        }
        const bytes = await out.save();
        const r = await save(`${stem(c.file.name)} (compressed).pdf`, bytes);
        r.detail = `${wd.ui.formatBytes(c.file.size)} → ${wd.ui.formatBytes(bytes.length)}`;
        return [r];
      },
    },
  ];

  // ------------------------------------------------------------ signature
  let sigHasInk = false;
  function setupSignaturePad(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * ratio);
    canvas.height = Math.max(1, rect.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b2a6f';
    sigHasInk = false;
    let drawing = false;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.onpointerdown = (e) => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); };
    canvas.onpointermove = (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); sigHasInk = true; };
    canvas.onpointerup = () => { drawing = false; };
  }
  /** Crops the pad to the drawn strokes so the signature is placed tightly. */
  function trimmedSignature() {
    const src = $('sigpad');
    const ctx = src.getContext('2d');
    const { width, height } = src;
    const data = ctx.getImageData(0, 0, width, height).data;
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const pad = 6;
    const out = document.createElement('canvas');
    out.width = Math.max(1, x1 - x0 + pad * 2); out.height = Math.max(1, y1 - y0 + pad * 2);
    out.getContext('2d').drawImage(src, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  // ------------------------------------------------------------- organize
  let org = null; // { file, pdfjs, pages: [{src, rot, del}] }
  async function loadOrganizer(file) {
    org = { file, pdfjs: await openWithPdfjs(file), pages: [] };
    for (let i = 0; i < org.pdfjs.numPages; i++) org.pages.push({ src: i, rot: 0, del: false, canvas: null });
    render();
    for (const p of org.pages) {
      p.canvas = await renderPage(org.pdfjs, p.src, 0.35);
      const slot = document.querySelector(`[data-thumb="${p.src}"]`);
      if (slot) { slot.replaceChildren(p.canvas); p.canvas.style.transform = `rotate(${p.rot}deg)`; }
    }
  }
  function organizerHtml() {
    if (!org) return '';
    return `<div class="thumbs">${org.pages.map((p, i) => `
      <div class="thumb ${p.del ? 'deleted' : ''}">
        <div data-thumb="${p.src}"></div>
        <div class="wd-small wd-muted">Page ${p.src + 1}</div>
        <div class="bar">
          <button class="wd-btn wd-btn-ghost" data-org="left" data-i="${i}" title="Move earlier">←</button>
          <button class="wd-btn wd-btn-ghost" data-org="rot" data-i="${i}" title="Rotate">⟳</button>
          <button class="wd-btn wd-btn-ghost" data-org="del" data-i="${i}" title="${p.del ? 'Restore' : 'Delete'}">${p.del ? '↺' : '✕'}</button>
          <button class="wd-btn wd-btn-ghost" data-org="right" data-i="${i}" title="Move later">→</button>
        </div>
      </div>`).join('')}</div>`;
  }
  function attachThumbs() {
    if (!org) return;
    for (const p of org.pages) {
      const slot = document.querySelector(`[data-thumb="${p.src}"]`);
      if (slot && p.canvas) { slot.replaceChildren(p.canvas); p.canvas.style.transform = `rotate(${p.rot}deg)`; }
    }
  }
  tools.find((t) => t.id === 'organize').run = async () => {
    const kept = org.pages.filter((p) => !p.del);
    if (!kept.length) throw new Error('All pages are deleted.');
    const src = await loadPdf(org.file);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, kept.map((p) => p.src));
    copied.forEach((page, i) => {
      if (kept[i].rot) page.setRotation(degrees((page.getRotation().angle + kept[i].rot) % 360));
      out.addPage(page);
    });
    return [await save(`${stem(org.file.name)} (organized).pdf`, await out.save())];
  };

  // ----------------------------------------------------------------- shell
  const state = { tool: null, files: [], values: {}, busy: false, pct: null, results: [] };
  const groups = [...new Set(tools.map((t) => t.group))];
  $('list').innerHTML = groups.map((g) => `<div class="wd-group">${g}</div>` +
    tools.filter((t) => t.group === g).map((t) => `<button data-tool="${t.id}">${esc(t.name)}</button>`).join('')).join('');
  $('list').onclick = (e) => { const id = e.target.closest('[data-tool]')?.dataset.tool; if (id && !state.busy) select(id); };
  $('folder').onclick = () => wd.files.openFolder().catch((err) => wd.ui.toast(err.message, 'error'));

  function select(id) {
    state.tool = tools.find((t) => t.id === id);
    state.values = Object.fromEntries((state.tool.fields || []).map((f) => [f.id, f.value ?? f.options?.[0]?.[0] ?? '']));
    state.results = [];
    if (state.tool.pick === 'image' || state.files.some((f) => f.ext !== 'pdf')) state.files = [];
    if (state.tool.input !== 'many') state.files = state.files.slice(0, 1);
    org = null;
    document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tool === id)));
    render();
    if (state.tool.custom === 'organize' && state.files[0]) loadOrganizer(state.files[0]).catch((e) => wd.ui.toast(e.message, 'error'));
  }

  function field(f) {
    if (f.show && !f.show(state.values)) return '';
    const v = state.values[f.id];
    const input = f.type === 'select'
      ? `<select class="wd-select" data-field="${f.id}">${f.options.map(([val, l]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : `<input class="wd-input" data-field="${f.id}" type="${f.type === 'number' ? 'number' : 'text'}" placeholder="${esc(f.placeholder || '')}" value="${esc(v)}">`;
    return `<div class="wd-field"><label class="wd-label">${esc(f.label)}</label>${input}${f.hint ? `<div class="wd-small wd-muted" style="margin-top:4px">${esc(f.hint)}</div>` : ''}</div>`;
  }

  function render() {
    const t = state.tool;
    const many = t.input === 'many';
    const what = t.pick === 'image' ? 'images' : many ? 'PDFs' : 'PDF';
    const ready = state.files.length >= (t.id === 'merge' ? 2 : 1);
    $('main').innerHTML = `
      <div class="wd-card"><h2>${esc(t.name)}</h2><p class="wd-muted" style="margin-top:4px">${esc(t.desc)}</p>
        ${t.note ? `<div class="wd-notice" style="margin-top:10px">${esc(t.note)}</div>` : ''}</div>
      <div class="wd-card wd-stack">
        <div class="wd-row"><b class="wd-grow">${many ? `Files (in order)` : 'File'}</b>
          <button class="wd-btn wd-btn-sm" data-act="pick">${many ? 'Add ' + what : state.files.length ? 'Change' : 'Choose ' + what}</button></div>
        ${state.files.map((f, i) => `<div class="wd-item"><div class="wd-grow wd-ellipsis">${esc(f.name)} <span class="wd-small wd-muted">${wd.ui.formatBytes(f.size)}</span></div>
          ${many ? `<button class="wd-btn wd-btn-sm wd-btn-ghost" data-act="up" data-i="${i}" title="Move up">↑</button><button class="wd-btn wd-btn-sm wd-btn-ghost" data-act="rm" data-i="${i}">✕</button>` : ''}</div>`).join('') || `<div class="wd-small wd-muted">Nothing chosen yet.</div>`}
      </div>
      ${t.custom === 'sign' ? `<div class="wd-card wd-stack"><div class="wd-row"><b class="wd-grow">Draw your signature</b><button class="wd-btn wd-btn-sm" data-act="clearsig">Clear</button></div><canvas id="sigpad" class="sigpad"></canvas></div>` : ''}
      ${t.custom === 'organize' && org ? `<div class="wd-card">${organizerHtml()}</div>` : ''}
      ${(t.fields || []).length ? `<div class="wd-card"><div class="wd-fields">${t.fields.map(field).join('')}</div></div>` : ''}
      <div class="wd-card wd-stack">
        <div class="wd-row"><button class="wd-btn wd-btn-primary" data-act="run" ${!ready || state.busy ? 'disabled' : ''}>${state.busy ? 'Working…' : 'Create PDF'.replace('Create PDF', t.id === 'pdf2img' ? 'Export images' : 'Create PDF')}</button></div>
        ${state.busy ? `<div class="wd-progress ${state.pct == null ? 'wd-indeterminate' : ''}"><div style="width:${state.pct || 0}%"></div></div>` : ''}
        ${state.results.map((r) => r.error ? `<div class="wd-error">${esc(r.error)}</div>` : `<div class="wd-item"><div class="wd-grow"><div class="wd-ellipsis">✅ ${esc(r.name)}</div><div class="wd-small wd-muted">${esc(r.detail || wd.ui.formatBytes(r.size))}</div></div>
          <button class="wd-btn wd-btn-sm" data-open="${esc(r.path)}">Open</button><button class="wd-btn wd-btn-sm" data-reveal="${esc(r.path)}">Show</button></div>`).join('')}
      </div>`;
    if (t.custom === 'sign') {
      const keep = sigHasInk && window.__sigData;
      setupSignaturePad($('sigpad'));
      if (keep) { const img = new Image(); img.onload = () => { $('sigpad').getContext('2d').drawImage(img, 0, 0, $('sigpad').clientWidth, $('sigpad').clientHeight); sigHasInk = true; }; img.src = window.__sigData; }
      $('sigpad').addEventListener('pointerup', () => { window.__sigData = $('sigpad').toDataURL(); });
    }
    attachThumbs();
  }

  $('main').addEventListener('input', (e) => {
    const id = e.target.dataset.field;
    if (!id) return;
    state.values[id] = e.target.value;
    if (e.target.tagName === 'SELECT') render();
  });

  $('main').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (b.dataset.open) return wd.files.open(b.dataset.open).catch((err) => wd.ui.toast(err.message, 'error'));
    if (b.dataset.reveal) return wd.files.reveal(b.dataset.reveal).catch((err) => wd.ui.toast(err.message, 'error'));
    if (b.dataset.org && org) {
      const i = +b.dataset.i, p = org.pages;
      if (b.dataset.org === 'rot') p[i].rot = (p[i].rot + 90) % 360;
      if (b.dataset.org === 'del') p[i].del = !p[i].del;
      if (b.dataset.org === 'left' && i > 0) [p[i - 1], p[i]] = [p[i], p[i - 1]];
      if (b.dataset.org === 'right' && i < p.length - 1) [p[i + 1], p[i]] = [p[i], p[i + 1]];
      return render();
    }
    if (act === 'clearsig') { window.__sigData = null; sigHasInk = false; return render(); }
    if (act === 'rm') { state.files.splice(+b.dataset.i, 1); return render(); }
    if (act === 'up') { const i = +b.dataset.i; if (i > 0) [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]]; return render(); }
    if (act === 'pick') {
      try {
        const t = state.tool;
        const picked = await wd.files.pick(t.pick === 'image' ? { type: 'image', multiple: true } : { extensions: ['pdf'], multiple: t.input === 'many' });
        if (!picked.length) return;
        state.files = t.input === 'many' ? [...state.files, ...picked] : [picked[0]];
        state.results = [];
        render();
        if (t.custom === 'organize') await loadOrganizer(state.files[0]);
      } catch (err) { wd.ui.toast(err.message, 'error'); }
      return;
    }
    if (act === 'run') {
      state.busy = true; state.pct = null; state.results = []; render();
      try {
        const c = { file: state.files[0], files: state.files, v: state.values };
        const results = await state.tool.run(c, (p) => { state.pct = p; const bar = document.querySelector('.wd-progress'); if (bar) { bar.classList.remove('wd-indeterminate'); bar.firstElementChild.style.width = p + '%'; } });
        state.results = results.length > 4
          ? [{ ...results[0], name: `${results.length} files saved`, detail: results[0].path.split(/[\\/]/).slice(-2, -1)[0] }]
          : results;
        wd.notify(`${state.tool.name} finished`, state.results.map((r) => r.name).join(', ')).catch(() => {});
      } catch (err) {
        state.results = [{ error: err.message }];
      }
      state.busy = false;
      render();
    }
  });

  select('merge');
})();
