(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const COLORS = {
    2: ['#EEE4DA', '#776E65'], 4: ['#EDE0C8', '#776E65'], 8: ['#F2B179', '#fff'], 16: ['#F59563', '#fff'],
    32: ['#F67C5F', '#fff'], 64: ['#F65E3B', '#fff'], 128: ['#EDCF72', '#fff'], 256: ['#EDCC61', '#fff'],
    512: ['#EDC850', '#fff'], 1024: ['#EDC53F', '#fff'], 2048: ['#EDC22E', '#fff'],
  };

  let grid = Array(16).fill(0);
  let score = 0;
  let best = 0;
  let won = false;       // reached 2048 (and chose to keep going)
  let showWin = false;
  let prev = null;       // one-step undo
  let fresh = -1;
  let merged = new Set();

  function spawn() {
    const empty = grid.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (!empty.length) return;
    fresh = empty[Math.floor(Math.random() * empty.length)];
    grid[fresh] = Math.random() < 0.9 ? 2 : 4;
  }

  /** Slides one line toward index 0; each tile merges at most once. */
  function slideLine(line) {
    const vals = line.filter(Boolean);
    const out = [];
    const mergedAt = [];
    let gained = 0;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] === vals[i + 1]) {
        out.push(vals[i] * 2);
        gained += vals[i] * 2;
        mergedAt.push(out.length - 1);
        i++;
      } else out.push(vals[i]);
    }
    while (out.length < 4) out.push(0);
    return { out, gained, mergedAt };
  }

  // Index of the k-th cell in line `l` when moving in `dir`.
  const cellIndex = (dir, l, k) => ({
    left: l * 4 + k, right: l * 4 + (3 - k), up: k * 4 + l, down: (3 - k) * 4 + l,
  })[dir];

  function move(dir) {
    if (showWin || isOver()) return;
    const before = grid.slice();
    let gained = 0;
    merged = new Set();
    for (let l = 0; l < 4; l++) {
      const idx = [0, 1, 2, 3].map((k) => cellIndex(dir, l, k));
      const res = slideLine(idx.map((i) => grid[i]));
      idx.forEach((i, k) => (grid[i] = res.out[k]));
      res.mergedAt.forEach((k) => merged.add(idx[k]));
      gained += res.gained;
    }
    if (grid.every((v, i) => v === before[i])) return; // nothing moved
    prev = { grid: before, score };
    score += gained;
    spawn();
    if (score > best) best = score;
    if (!won && grid.includes(2048)) { won = true; showWin = true; }
    save();
    render();
  }

  function isOver() {
    if (grid.includes(0)) return false;
    for (let i = 0; i < 16; i++) {
      if ((i & 3) < 3 && grid[i] === grid[i + 1]) return false;
      if (i < 12 && grid[i] === grid[i + 4]) return false;
    }
    return true;
  }

  function render() {
    const tiles = grid.map((v, i) => {
      const [bg, fg] = COLORS[v] || ['#3C3A32', '#fff'];
      const size = v >= 1024 ? 'font-size:calc(var(--t)*.3)' : v >= 128 ? 'font-size:calc(var(--t)*.34)' : '';
      return `<div class="tile ${i === fresh ? 'new' : ''} ${merged.has(i) ? 'merged' : ''}" style="${v ? `background:${bg};color:${fg};${size}` : ''}">${v || ''}</div>`;
    }).join('');
    let overlay = '';
    if (showWin) overlay = '<div class="overlay"><h2>You made 2048! 🎉</h2><div><button class="wd-btn wd-btn-primary" id="keepGoing">Keep going</button> <button class="wd-btn" id="again">New game</button></div></div>';
    else if (isOver()) overlay = `<div class="overlay"><h2>Game over</h2><div>Score ${score}</div><div><button class="wd-btn wd-btn-primary" id="again">Try again</button></div></div>`;
    $('grid').innerHTML = tiles + overlay;
    $('score').textContent = score;
    $('best').textContent = best;
    $('undo').disabled = !prev;
    const keep = $('keepGoing');
    if (keep) keep.onclick = () => { showWin = false; save(); render(); };
    const again = $('again');
    if (again) again.onclick = newGame;
  }

  function newGame() {
    grid = Array(16).fill(0);
    score = 0;
    won = false;
    showWin = false;
    prev = null;
    merged = new Set();
    spawn();
    spawn();
    save();
    render();
  }

  function save() {
    wd.kv.set('state', { grid, score, won, showWin }).catch(() => {});
    wd.kv.set('best', best).catch(() => {});
  }

  // Keyboard
  const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
  document.addEventListener('keydown', (e) => {
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    move(dir);
  });

  // Swipe (touch, pen or mouse drag)
  let start = null;
  $('grid').addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; });
  $('grid').addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });

  $('newGame').onclick = newGame;
  $('undo').onclick = () => {
    if (!prev) return;
    grid = prev.grid;
    score = prev.score;
    prev = null;
    fresh = -1;
    merged = new Set();
    save();
    render();
  };

  (async () => {
    best = await wd.kv.get('best', 0).catch(() => 0);
    const s = await wd.kv.get('state', null).catch(() => null);
    if (s && Array.isArray(s.grid) && s.grid.length === 16) {
      ({ grid, score, won, showWin } = s);
      render();
    } else newGame();
  })();
})();
