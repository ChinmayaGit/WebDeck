(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = wd.ui.escape;

  // Input extension -> pandoc reader.
  const PANDOC_IN = {
    md: 'markdown', markdown: 'markdown', txt: 'markdown', docx: 'docx', odt: 'odt', html: 'html', htm: 'html',
    epub: 'epub', rtf: 'rtf', tex: 'latex', rst: 'rst', ipynb: 'ipynb', org: 'org', textile: 'textile', csv: 'csv', tsv: 'tsv',
  };
  // Target -> pandoc writer.
  const PANDOC_OUT = { docx: 'docx', odt: 'odt', rtf: 'rtf', html: 'html', md: 'gfm', txt: 'plain', epub: 'epub' };
  // What kind of document each extension is (decides which targets make sense).
  const KIND = {
    doc: 'text', docx: 'text', odt: 'text', rtf: 'text', wpd: 'text', pages: 'text',
    xls: 'sheet', xlsx: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet', numbers: 'sheet',
    ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  };
  const TARGETS = {
    text: ['pdf', 'docx', 'odt', 'rtf', 'html', 'md', 'txt', 'epub'],
    sheet: ['pdf', 'xlsx', 'ods', 'csv', 'html'],
    slides: ['pdf', 'pptx', 'odp'],
    markup: ['pdf', 'docx', 'odt', 'rtf', 'html', 'md', 'txt', 'epub'],
  };
  const kindOf = (ext) => KIND[ext] || (PANDOC_IN[ext] ? 'markup' : 'text');
  // LibreOffice export filters per target.
  const LO_TARGET = { pdf: 'pdf', docx: 'docx', odt: 'odt', rtf: 'rtf', html: 'html', txt: 'txt:Text', xlsx: 'xlsx', ods: 'ods', csv: 'csv', pptx: 'pptx', odp: 'odp' };
  const OFFICE_ONLY = ['doc', 'xls', 'xlsx', 'ppt', 'pptx', 'odp', 'ods', 'pages', 'wpd', 'csv', 'tsv', 'numbers', 'key'];

  let status = null;
  let files = [];

  async function refreshTools() {
    try {
      status = await wd.tools.status();
    } catch (e) {
      $('toolList').innerHTML = `<div class="wd-error">${esc(e.message)}</div>`;
      return;
    }
    if (!status.supported) {
      $('toolList').innerHTML = '<div class="wd-notice">Document conversion needs WebDeck on macOS, Windows or Linux.</div>';
      return;
    }
    const row = (id, desc, action) => `<div class="tool"><div class="wd-grow"><b>${esc(status[id].name)}</b>
      <div class="wd-small wd-muted" id="msg-${id}">${desc}</div></div>${action}</div>`;
    $('toolList').innerHTML =
      row('pandoc', 'Markdown, Word, HTML, ODT, RTF, EPUB, text',
        status.pandoc.installed ? '<span class="wd-badge wd-badge-green">Ready</span>' : '<button class="wd-btn wd-btn-primary wd-btn-sm" data-install="pandoc">Install</button>') +
      row('libreoffice', 'PDF output, Word, Excel and PowerPoint files',
        status.libreoffice.installed ? '<span class="wd-badge wd-badge-green">Ready</span>' : '<button class="wd-btn wd-btn-sm" data-get="libreoffice">Get LibreOffice</button>');
    render();
  }

  $('toolList').addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.get) {
      wd.openUrl('https://www.libreoffice.org/download/download/');
      wd.ui.toast('Install LibreOffice, then reopen this app.');
      return;
    }
    t.disabled = true; t.textContent = 'Installing…';
    try {
      await wd.tools.install(t.dataset.install, (p) => { const m = $('msg-' + t.dataset.install); if (m) m.textContent = p.message; });
      wd.ui.toast('Pandoc installed', 'ok');
    } catch (err) {
      wd.ui.toast(err.message, 'error');
    }
    refreshTools();
  });

  /** Decides which program converts a file, or why it can't. */
  function plan(file, target) {
    const ext = file.ext;
    const kind = kindOf(ext);
    const hasPandoc = status?.pandoc?.installed;
    const hasLO = status?.libreoffice?.installed;
    if (ext === target || (ext === 'htm' && target === 'html') || (ext === 'markdown' && target === 'md')) return { error: 'Already in this format' };
    if (!TARGETS[kind].includes(target)) {
      const label = { text: 'a text document', sheet: 'a spreadsheet', slides: 'a presentation', markup: 'this document' }[kind];
      return { error: `${target.toUpperCase()} isn't available for ${label}` };
    }
    // Text-like sources Pandoc reads well → Pandoc (PDF goes via HTML + LibreOffice).
    if (kind === 'markup' || (kind === 'text' && PANDOC_IN[ext] && !OFFICE_ONLY.includes(ext) && ['md', 'txt', 'epub'].includes(target))) {
      if (target === 'pdf') {
        if (!hasLO) return { error: 'PDF output needs LibreOffice' };
        if (['html', 'htm'].includes(ext)) return { steps: ['lo'] };
        return hasPandoc ? { steps: ['pandoc-html', 'lo'] } : { error: 'Needs Pandoc and LibreOffice' };
      }
      if (hasPandoc && PANDOC_OUT[target]) return { steps: ['pandoc'] };
      if (!hasPandoc && hasLO && LO_TARGET[target] && kind !== 'markup') return { steps: ['lo'] };
      return { error: 'Needs Pandoc (install above)' };
    }
    // Office formats → LibreOffice (with Pandoc for targets LibreOffice can't write).
    if (LO_TARGET[target]) return hasLO ? { steps: ['lo'] } : { error: 'Needs LibreOffice (see above)' };
    if (PANDOC_IN[ext] && PANDOC_OUT[target]) return hasPandoc ? { steps: ['pandoc'] } : { error: 'Needs Pandoc (install above)' };
    return { error: 'Unsupported conversion' };
  }

  async function runTool(tool, args, file) {
    const task = await wd.tools.run(tool, args, {
      onLine: (l) => { file.log = (file.log || '') + l + '\n'; },
    });
    if (task.status !== 'done') {
      const tail = (task.lines || []).slice(-3).join(' ').trim();
      throw new Error(tail || task.error || `${tool} failed`);
    }
    return task;
  }

  async function convert(file, target) {
    const p = plan(file, target);
    if (p.error) throw new Error(p.error);
    const stem = file.name.replace(/\.[^.]+$/, '');
    let input = file.path;
    let task;
    for (const step of p.steps) {
      if (step === 'pandoc' || step === 'pandoc-html') {
        const to = step === 'pandoc' ? PANDOC_OUT[target] : 'html';
        const outExt = step === 'pandoc' ? (target === 'md' ? 'md' : target) : 'html';
        const out = `${stem}.${outExt}`;
        const args = ['-f', PANDOC_IN[file.ext], '-t', to, '-o', out];
        if (['html', 'rtf', 'txt'].includes(outExt) || step === 'pandoc-html') args.push('-s', '--metadata', `title=${stem}`);
        if (['md', 'html'].includes(outExt) && step === 'pandoc') args.push(`--extract-media=${stem}_media`);
        args.push('--', input);
        task = await runTool('pandoc', args, file);
        input = out; // relative to the app's downloads folder (the tool's cwd)
      } else {
        task = await runTool('libreoffice', ['--headless', '--convert-to', LO_TARGET[target], '--outdir', '.', input], file);
      }
    }
    const expectedExt = target === 'md' ? 'md' : target;
    const out = (task.outputFiles || []).find((f) => f.toLowerCase().endsWith('.' + expectedExt)) || (task.outputFiles || [])[0];
    return out;
  }

  $('pick').onclick = async () => {
    try {
      const picked = await wd.files.pick({ multiple: true });
      for (const f of picked) files.push({ ...f, state: 'ready' });
      render();
    } catch (e) {
      wd.ui.toast(e.message, 'error');
    }
  };

  $('convert').onclick = async () => {
    const target = $('target').value;
    $('convert').disabled = true;
    let ok = 0;
    for (const f of files.filter((x) => x.state === 'ready' || x.state === 'failed')) {
      f.state = 'working'; f.error = null; f.log = '';
      render();
      try {
        f.out = await convert(f, target);
        f.state = 'done'; ok++;
      } catch (e) {
        f.state = 'failed'; f.error = e.message;
      }
      render();
    }
    if (ok) wd.notify('Conversion finished', `${ok} document${ok === 1 ? '' : 's'} converted`).catch(() => {});
    render();
  };

  $('target').onchange = render;
  $('openFolder').onclick = () => wd.files.openFolder().catch((e) => wd.ui.toast(e.message, 'error'));

  function render() {
    const target = $('target').value;
    const ready = files.filter((f) => f.state === 'ready' || f.state === 'failed');
    $('convert').disabled = !ready.length || files.some((f) => f.state === 'working');
    $('hint').textContent = target === 'pdf'
      ? 'PDF uses LibreOffice. Markdown and e-books are first turned into HTML with Pandoc.'
      : 'Converted files are saved to Downloads/WebDeck/Office Converter.';
    if (!files.length) {
      $('files').innerHTML = '<div class="wd-empty"><div class="wd-empty-icon">📂</div>Choose one or more documents to convert.</div>';
      return;
    }
    $('files').innerHTML = files.map((f, i) => {
      const p = status ? plan(f, target) : {};
      let right = '';
      if (f.state === 'working') right = '<span class="wd-badge wd-badge-blue">Converting…</span>';
      else if (f.state === 'done') right = `<span class="wd-badge wd-badge-green">Done</span>${f.out ? `<button class="wd-btn wd-btn-sm" data-open="${i}">Open</button><button class="wd-btn wd-btn-sm" data-reveal="${i}">Show</button>` : ''}`;
      else if (f.state === 'failed') right = '<span class="wd-badge wd-badge-red">Failed</span>';
      else if (p.error) right = `<span class="wd-badge wd-badge-amber">${esc(p.error)}</span>`;
      return `<div class="wd-item file">
        <div class="ext">${esc(f.ext || '?')}</div>
        <div class="wd-grow"><div class="wd-ellipsis">${esc(f.name)}</div>
          <div class="wd-small wd-muted">${wd.ui.formatBytes(f.size)}${f.error ? ` · <span style="color:var(--wd-red)">${esc(f.error)}</span>` : ''}</div></div>
        <div class="wd-row">${right}<button class="wd-btn wd-btn-sm wd-btn-ghost" data-remove="${i}">✕</button></div>
      </div>`;
    }).join('');
  }

  $('files').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const f = files[+(t.dataset.open ?? t.dataset.reveal ?? t.dataset.remove)];
    if (t.dataset.open) wd.files.open(f.out).catch((err) => wd.ui.toast(err.message, 'error'));
    if (t.dataset.reveal) wd.files.reveal(f.out).catch((err) => wd.ui.toast(err.message, 'error'));
    if (t.dataset.remove) { files = files.filter((x) => x !== f); render(); }
  });

  render();
  refreshTools();
})();
