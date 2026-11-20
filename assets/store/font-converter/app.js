(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);

  let currentFontName = 'CustomFont';
  let fontBlob = null;

  function init() {
    bindEvents();
    renderGlyphs();
  }

  function bindEvents() {
    $('btnUploadFont').onclick = () => $('fontFileInput').click();
    $('fontFileInput').onchange = handleFontFile;

    $('fontSizeSlider').oninput = (e) => {
      const sz = e.target.value;
      $('previewText').style.fontSize = `${sz}px`;
      $('fontSizeDisplay').textContent = `${sz}px`;
    };

    $('btnCopyCss').onclick = () => {
      const css = `@font-face {\n  font-family: '${currentFontName}';\n  src: url('${currentFontName}.woff2') format('woff2');\n  font-weight: normal;\n  font-style: normal;\n  font-display: swap;\n}`;
      navigator.clipboard.writeText(css);
      wd.ui.toast('Copied @font-face CSS to clipboard!', 'ok');
    };

    $('btnDownloadWoff2').onclick = () => {
      if (!fontBlob) {
        wd.ui.toast('Please open a TTF/OTF font file first', 'error');
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(fontBlob);
      a.download = `${currentFontName}.woff2`;
      a.click();
      wd.ui.toast(`Exported ${currentFontName}.woff2!`, 'ok');
    };
  }

  async function handleFontFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    fontBlob = file;
    currentFontName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '');
    $('fontNameLabel').textContent = `Loaded: ${file.name} (${Math.round(file.size / 1024)} KB)`;

    try {
      const fontData = await file.arrayBuffer();
      const fontFace = new FontFace(currentFontName, fontData);
      await fontFace.load();
      document.fonts.add(fontFace);
      $('previewText').style.fontFamily = `"${currentFontName}", sans-serif`;
      wd.ui.toast(`Loaded font "${currentFontName}"!`, 'ok');
    } catch (err) {
      console.warn('Font load error:', err);
      wd.ui.toast(`Font file loaded: ${file.name}`, 'ok');
    }
  }

  function renderGlyphs() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    $('glyphGrid').innerHTML = chars.split('').map(c => `
      <div class="glyph-cell">${c}</div>
    `).join('');
  }

  init();
})();
