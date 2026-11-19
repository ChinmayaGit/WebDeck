(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = wd.ui.escape;
  const MAX_LINES = 5000;
  let home = '/';
  let history = [];
  let sessions = [];
  let active = 0;

  /** Minimal ANSI SGR → HTML (colors + bold); strips other escape codes. */
  function ansi(text) {
    let open = 0;
    const html = esc(text).replace(/\x1b\[([\d;]*)m|\x1b\[[\d;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, (m, codes) => {
      if (codes === undefined) return '';
      let out = '';
      for (const c of (codes || '0').split(';')) {
        const n = +c;
        if (n === 0 || c === '') { out += '</span>'.repeat(open); open = 0; }
        else if (n === 1 || (n >= 30 && n <= 37) || (n >= 90 && n <= 97)) { out += `<span class="a${n >= 90 ? n - 60 : n}">`; open++; }
      }
      return out;
    });
    return html + '</span>'.repeat(open);
  }

  function newSession(cwd) {
    sessions.push({ cwd: cwd || home, lines: [], task: null, title: 'shell' });
    active = sessions.length - 1;
    drawTabs();
    drawOut();
  }
  const S = () => sessions[active];
  function drawTabs() {
    $('tabs').innerHTML = sessions.map((s, i) => `<button data-tab="${i}" aria-selected="${i === active}">${esc(s.cwd.split(/[\\/]/).pop() || s.cwd)}${s.task ? ' ●' : ''} ${sessions.length > 1 ? `<span data-close="${i}">✕</span>` : ''}</button>`).join('') + '<button data-new title="New tab">＋</button>';
    $('cwd').textContent = S().cwd.replace(home, '~');
    $('stop').hidden = !S().task;
  }
  function drawOut() {
    $('out').innerHTML = S().lines.join('\n');
    $('out').scrollTop = $('out').scrollHeight;
  }
  function print(html, session = S()) {
    session.lines.push(html);
    if (session.lines.length > MAX_LINES) session.lines.splice(0, session.lines.length - MAX_LINES);
    if (session === S()) {
      const atBottom = $('out').scrollHeight - $('out').scrollTop - $('out').clientHeight < 60;
      $('out').insertAdjacentHTML('beforeend', (session.lines.length > 1 ? '\n' : '') + html);
      if (atBottom) $('out').scrollTop = $('out').scrollHeight;
    }
  }
  $('tabs').onclick = (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { const i = +c.dataset.close; if (sessions[i].task) wd.shell.cancel(sessions[i].task.id); sessions.splice(i, 1); active = Math.min(active, sessions.length - 1); drawTabs(); drawOut(); return; }
    if (e.target.closest('[data-new]')) return newSession(S().cwd);
    const t = e.target.closest('[data-tab]');
    if (t) { active = +t.dataset.tab; drawTabs(); drawOut(); $('cmd').focus(); }
  };

  const quote = (p) => `'${p.replace(/'/g, `'\\''`)}'`;
  async function run(line) {
    const s = S();
    const cmd = line.trim();
    print(`<span class="cmd"><span class="cwd">${esc(s.cwd.replace(home, '~'))}</span> ❯ ${esc(cmd)}</span>`, s);
    if (!cmd) return;
    if (history[history.length - 1] !== cmd) { history.push(cmd); if (history.length > 500) history.shift(); wd.kv.set('history', history); }
    if (cmd === 'clear' || cmd === 'cls') { s.lines = []; return drawOut(); }
    if (/^(vim?|nano|top|htop|less|more|man|ssh|emacs)(\s|$)/.test(cmd)) {
      print('<span class="err">Full-screen / interactive programs need a real terminal (try `cat`, `head`, or `ps aux` instead).</span>', s);
    }
    // `cd` changes this tab's directory: let the shell resolve it, then remember the result.
    const cd = /^cd(?:\s+(.*))?$/.exec(cmd);
    const isWin = navigator.platform.startsWith('Win');
    const full = cd ? `cd ${cd[1] ? cd[1] : (isWin ? '%USERPROFILE%' : '~')} && ${isWin ? 'cd' : 'pwd'}` : cmd;
    s.task = { id: null };
    drawTabs();
    try {
      const task = await wd.shell.run(full, {
        cwd: s.cwd,
        onStart: (t) => (s.task = t),
        onLine: (l) => { if (!cd) print(ansi(l), s); else s._last = l; },
      });
      if (cd && task.exitCode === 0 && s._last) s.cwd = s._last.trim();
      else if (cd) print(`<span class="err">cd: no such directory: ${esc(cd[1] || '')}</span>`, s);
      if (!cd && task.status === 'failed' && task.exitCode != null) print(`<span class="muted">exit ${task.exitCode}</span>`, s);
      if (task.status === 'cancelled') print('<span class="muted">^C</span>', s);
    } catch (e) {
      print(`<span class="err">${esc(e.message)}</span>`, s);
    }
    s.task = null;
    drawTabs();
    wd.kv.set('cwd', s.cwd);
  }

  let hIndex = -1;
  $('cmd').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = $('cmd').value; $('cmd').value = ''; hIndex = -1; if (!S().task) run(v); else print('<span class="muted">A command is still running. Press Ctrl+C or open a new tab.</span>'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!history.length) return; hIndex = hIndex < 0 ? history.length - 1 : Math.max(0, hIndex - 1); $('cmd').value = history[hIndex]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (hIndex < 0) return; hIndex++; if (hIndex >= history.length) { hIndex = -1; $('cmd').value = ''; } else $('cmd').value = history[hIndex]; }
    else if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); if (S().task?.id) wd.shell.cancel(S().task.id); }
    else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); S().lines = []; drawOut(); }
    else if (e.key === 't' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); newSession(S().cwd); }
  });
  $('stop').onclick = () => S().task?.id && wd.shell.cancel(S().task.id);
  document.addEventListener('click', (e) => { if (!e.target.closest('button') && !window.getSelection().toString()) $('cmd').focus(); });

  (async () => {
    try { home = await wd.shell.home(); } catch (e) { $('out').innerHTML = `<span class="err">${esc(e.message)}</span>`; return; }
    history = await wd.kv.get('history', []);
    newSession(await wd.kv.get('cwd', home));
    print('<span class="muted">WebDeck Terminal: commands run in your login shell. ↑/↓ history · Ctrl+C stop · Ctrl+L clear · ⌘T new tab</span>');
    $('cmd').focus();
  })();
})();
