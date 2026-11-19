(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = wd.ui.escape;

  /** @type {{id:string,name:string,src:string,size:number,w?:number,h?:number,state:string,out?:any,error?:string}[]} */
  let items = [];
  let busy = false;

  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  // --- options -------------------------------------------------------------
  function opts() {
    return {
      mime: $('format').value,
      quality: Number($('quality').value) / 100,
      resize: $('resize').value,
      maxW: Math.max(1, Number($('maxW').value) || 1),
      maxH: Math.max(1, Number($('maxH').value) || 1),
      pct: Number($('pct').value) / 100,
      bg: $('bg').value,
      subfolder: $('subfolder').checked,
    };
  }

  function syncOptions() {
    const o = opts();
    $('qualityRow').hidden = o.mime === 'image/png';
    $('bgRow').hidden = o.mime !== 'image/jpeg';
    $('maxRow').hidden = o.resize !== 'max';
    $('pctRow').hidden = o.resize !== 'percent';
    $('qualityVal').textContent = $('quality').value;
    $('pctVal').textContent = $('pct').value;
    const note = $('webpNote');
    note.hidden = !(o.mime === 'image/webp' && !webpSupported);
    note.textContent = 'This system WebView cannot encode WebP. Pick JPEG or PNG instead.';
    try { localStorage.setItem('ic-opts', JSON.stringify(o)); } catch (_) {}
  }

  function restoreOptions() {
    try {
      const o = JSON.parse(localStorage.getItem('ic-opts') || 'null');
      if (!o) return;
      $('format').value = o.mime; $('quality').value = Math.round(o.quality * 100);
      $('resize').value = o.resize; $('maxW').value = o.maxW; $('maxH').value = o.maxH;
      $('pct').value = Math.round(o.pct * 100); $('bg').value = o.bg; $('subfolder').checked = o.subfolder;
    } catch (_) {}
  }

  const webpSupported = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    return String(c.toDataURL('image/webp') || '').startsWith('data:image/webp');
  })();

  // --- adding files ---------------------------------------------------------
  function add(list) {
    for (const f of list) {
      items.push({ id: Math.random().toString(36).slice(2), name: f.name, src: f.src, size: f.size || 0, state: 'ready' });
    }
    render();
    items.filter((i) => !i.w).forEach(probe);
  }

  function probe(item) {
    const img = new Image();
    img.onload = () => { item.w = img.naturalWidth; item.h = img.naturalHeight; render(); };
    img.onerror = () => { item.state = 'error'; item.error = 'Cannot read this image format'; render(); };
    img.src = item.src;
  }

  $('pick').onclick = async () => {
    try {
      const files = await wd.files.pick({ type: 'image', multiple: true });
      add(files.map((f) => ({ name: f.name, src: f.url, size: f.size })));
    } catch (e) {
      wd.ui.toast(e.message, 'error');
    }
  };

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('wd-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('wd-over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|tiff?|bmp|gif|avif)$/i.test(f.name));
    add(files.map((f) => ({ name: f.name, src: URL.createObjectURL(f), size: f.size })));
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // --- conversion -----------------------------------------------------------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Cannot read this image format'));
      img.src = src;
    });
  }

  function targetSize(w, h, o) {
    let s = 1;
    if (o.resize === 'max') s = Math.min(1, o.maxW / w, o.maxH / h);
    if (o.resize === 'percent') s = o.pct;
    const MAX = 16384;
    s = Math.min(s, MAX / w, MAX / h);
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
  }

  async function convertOne(item, o, folder) {
    const img = await loadImage(item.src);
    const [w, h] = targetSize(img.naturalWidth, img.naturalHeight, o);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (o.mime === 'image/jpeg') { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, o.mime, o.mime === 'image/png' ? undefined : o.quality));
    if (!blob || blob.type !== o.mime) throw new Error('This system cannot encode ' + EXT[o.mime].toUpperCase());
    const stem = item.name.replace(/\.[^.]+$/, '') || 'image';
    const saved = await wd.files.save({ name: stem + '.' + EXT[o.mime], blob, subdir: folder });
    return { ...saved, w, h };
  }

  $('convert').onclick = async () => {
    const o = opts();
    if (o.mime === 'image/webp' && !webpSupported) { wd.ui.toast('WebP encoding is not available here', 'error'); return; }
    busy = true; render();
    const folder = o.subfolder ? 'Converted ' + new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-') : undefined;
    let ok = 0;
    for (const item of items.filter((i) => i.state !== 'done' && i.state !== 'error')) {
      item.state = 'working'; render();
      try {
        item.out = await convertOne(item, o, folder);
        item.state = 'done'; ok++;
      } catch (e) {
        item.state = 'error'; item.error = e.message;
      }
      render();
    }
    busy = false; render();
    if (ok) wd.ui.toast(`Converted ${ok} image${ok === 1 ? '' : 's'}`, 'ok');
  };

  $('openFolder').onclick = () => wd.files.openFolder().catch((e) => wd.ui.toast(e.message, 'error'));
  $('clear').onclick = () => { items = []; render(); };

  // --- rendering --------------------------------------------------------------
  function render() {
    const pending = items.filter((i) => i.state === 'ready').length;
    $('convert').disabled = busy || pending === 0;
    $('convert').textContent = busy ? 'Converting…' : pending ? `Convert ${pending} image${pending === 1 ? '' : 's'}` : 'Convert';
    $('clear').hidden = items.length === 0 || busy;
    const total = items.reduce((s, i) => s + (i.size || 0), 0);
    $('summary').textContent = items.length ? `${items.length} image${items.length === 1 ? '' : 's'} · ${wd.ui.formatBytes(total)}` : '';

    $('thumbs').innerHTML = items.map((i) => {
      let state = '';
      if (i.state === 'working') state = '<span class="wd-badge wd-badge-blue">Converting…</span>';
      if (i.state === 'done') state = `<span class="wd-badge wd-badge-green">Saved · ${wd.ui.formatBytes(i.out.size)}</span> <a href="#" data-reveal="${esc(i.id)}" class="wd-small">Show</a>`;
      if (i.state === 'error') state = `<span class="wd-badge wd-badge-red" title="${esc(i.error)}">Failed</span>`;
      return `<div class="thumb">
        <div class="pic"><img src="${esc(i.src)}" alt="" loading="lazy">${busy ? '' : `<button class="x" data-remove="${esc(i.id)}" title="Remove">×</button>`}</div>
        <div class="meta"><div class="wd-ellipsis" title="${esc(i.name)}">${esc(i.name)}</div>
        <div class="wd-muted">${i.w ? `${i.w}×${i.h}` : '…'}${i.size ? ' · ' + wd.ui.formatBytes(i.size) : ''}</div>
        <div class="state">${state}</div></div></div>`;
    }).join('');
  }

  $('thumbs').addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.remove) { items = items.filter((i) => i.id !== t.dataset.remove); render(); }
    if (t.dataset.reveal) {
      e.preventDefault();
      const item = items.find((i) => i.id === t.dataset.reveal);
      if (item?.out) wd.files.reveal(item.out.path).catch((err) => wd.ui.toast(err.message, 'error'));
    }
  });

  ['format', 'quality', 'resize', 'maxW', 'maxH', 'pct', 'bg', 'subfolder'].forEach((id) => $(id).addEventListener('input', syncOptions));
  restoreOptions();
  syncOptions();
  render();
})();
