(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);

  // Board: 64 squares, index = row * 8 + col, row 0 = rank 8. Pieces are 'wP', 'bK', …
  const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  const VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  const FILES = 'abcdefgh';
  const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
  const other = (c) => (c === 'w' ? 'b' : 'w');

  // Piece-square tables (from White's view, row 0 = rank 8).
  const PST = {
    P: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    N: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    B: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    R: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    Q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    K: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  };

  function initialState() {
    const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    const b = Array(64).fill(null);
    for (let c = 0; c < 8; c++) {
      b[c] = 'b' + back[c];
      b[8 + c] = 'bP';
      b[48 + c] = 'wP';
      b[56 + c] = 'w' + back[c];
    }
    return { b, turn: 'w', castle: { wK: true, wQ: true, bK: true, bQ: true }, ep: -1, half: 0 };
  }

  // ------------------------------------------------------------ rules
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  /** Is square `sq` attacked by side `by`? */
  function attacked(b, sq, by) {
    const r = sq >> 3, c = sq & 7;
    const pr = by === 'w' ? r + 1 : r - 1; // attacking pawn sits "behind" from its view
    for (const dc of [-1, 1]) if (on(pr, c + dc) && b[pr * 8 + c + dc] === by + 'P') return true;
    for (const [dr, dc] of KNIGHT) if (on(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'N') return true;
    for (const [dr, dc] of KING) if (on(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'K') return true;
    const ray = (dirs, kinds) => {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (on(rr, cc)) {
          const p = b[rr * 8 + cc];
          if (p) { if (p[0] === by && kinds.includes(p[1])) return true; break; }
          rr += dr; cc += dc;
        }
      }
      return false;
    };
    return ray(DIAG, 'BQ') || ray(ORTHO, 'RQ');
  }

  const kingSq = (b, color) => b.indexOf(color + 'K');
  const inCheck = (s, color) => attacked(s.b, kingSq(s.b, color), other(color));

  function pseudoMoves(s) {
    const { b, turn: me } = s;
    const out = [];
    const add = (from, to, extra) => out.push({ from, to, cap: b[to], ...extra });
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || p[0] !== me) continue;
      const t = p[1], r = i >> 3, c = i & 7;
      if (t === 'P') {
        const dir = me === 'w' ? -1 : 1, start = me === 'w' ? 6 : 1, last = me === 'w' ? 0 : 7;
        const r1 = r + dir;
        if (on(r1, c) && !b[r1 * 8 + c]) {
          add(i, r1 * 8 + c, r1 === last ? { promo: 'Q' } : {});
          if (r === start && !b[(r + 2 * dir) * 8 + c]) add(i, (r + 2 * dir) * 8 + c, { dbl: true });
        }
        for (const dc of [-1, 1]) {
          if (!on(r1, c + dc)) continue;
          const j = r1 * 8 + c + dc;
          if (b[j] && b[j][0] !== me) add(i, j, r1 === last ? { promo: 'Q' } : {});
          else if (j === s.ep) out.push({ from: i, to: j, cap: other(me) + 'P', ep: true });
        }
      } else if (t === 'N' || t === 'K') {
        for (const [dr, dc] of t === 'N' ? KNIGHT : KING) {
          if (!on(r + dr, c + dc)) continue;
          const j = (r + dr) * 8 + c + dc;
          if (!b[j] || b[j][0] !== me) add(i, j);
        }
        if (t === 'K') {
          const home = me === 'w' ? 60 : 4, op = other(me);
          if (i === home && !attacked(b, home, op)) {
            if (s.castle[me + 'K'] && !b[home + 1] && !b[home + 2] && b[home + 3] === me + 'R' &&
                !attacked(b, home + 1, op) && !attacked(b, home + 2, op)) add(i, home + 2, { castle: 'K' });
            if (s.castle[me + 'Q'] && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === me + 'R' &&
                !attacked(b, home - 1, op) && !attacked(b, home - 2, op)) add(i, home - 2, { castle: 'Q' });
          }
        }
      } else {
        const dirs = t === 'B' ? DIAG : t === 'R' ? ORTHO : [...DIAG, ...ORTHO];
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (on(rr, cc)) {
            const j = rr * 8 + cc;
            if (b[j]) { if (b[j][0] !== me) add(i, j); break; }
            add(i, j);
            rr += dr; cc += dc;
          }
        }
      }
    }
    return out;
  }

  function makeMove(s, m) {
    const b = s.b.slice();
    const castle = { ...s.castle };
    const p = b[m.from];
    const me = p[0];
    b[m.to] = m.promo ? me + m.promo : p;
    b[m.from] = null;
    if (m.ep) b[m.to + (me === 'w' ? 8 : -8)] = null;
    if (m.castle === 'K') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
    if (m.castle === 'Q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
    if (p[1] === 'K') { castle[me + 'K'] = false; castle[me + 'Q'] = false; }
    for (const [sq, key] of [[63, 'wK'], [56, 'wQ'], [7, 'bK'], [0, 'bQ']]) {
      if (m.from === sq || m.to === sq) castle[key] = false;
    }
    return {
      b, castle,
      turn: other(me),
      ep: m.dbl ? (m.from + m.to) / 2 : -1,
      half: p[1] === 'P' || m.cap ? 0 : s.half + 1,
    };
  }

  const legalMoves = (s) => pseudoMoves(s).filter((m) => !inCheck(makeMove(s, m), s.turn));

  function insufficient(b) {
    const pcs = b.filter((p) => p && p[1] !== 'K');
    return pcs.length === 0 || (pcs.length === 1 && 'NB'.includes(pcs[0][1]));
  }

  /** Game result for the side to move, or null if the game goes on. */
  function outcome(s, moves = legalMoves(s)) {
    if (!moves.length) return inCheck(s, s.turn) ? { kind: 'mate', winner: other(s.turn) } : { kind: 'stalemate' };
    if (s.half >= 100) return { kind: 'fifty' };
    if (insufficient(s.b)) return { kind: 'material' };
    return null;
  }

  // -------------------------------------------------------- computer
  function evaluate(b) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const t = p[1];
      const v = VALUE[t] + (p[0] === 'w' ? PST[t][i] : PST[t][(7 - (i >> 3)) * 8 + (i & 7)]);
      score += p[0] === 'w' ? v : -v;
    }
    return score;
  }

  let nodes = 0;
  function negamax(s, depth, alpha, beta, ply) {
    nodes++;
    const moves = pseudoMoves(s);
    // Captures first (most valuable victim) for better pruning.
    moves.sort((a, b) => (b.cap ? VALUE[b.cap[1]] : 0) - (a.cap ? VALUE[a.cap[1]] : 0));
    let best = -Infinity, any = false;
    for (const m of moves) {
      const n = makeMove(s, m);
      if (inCheck(n, s.turn)) continue;
      any = true;
      const score = depth <= 1
        ? (s.turn === 'w' ? 1 : -1) * evaluate(n.b)
        : -negamax(n, depth - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    if (!any) return inCheck(s, s.turn) ? -100000 + ply : 0;
    return best;
  }

  function bestMove(s, depth) {
    nodes = 0;
    const moves = legalMoves(s);
    let best = null, bestScore = -Infinity;
    // Shuffle so equal moves vary between games.
    for (let i = moves.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [moves[i], moves[j]] = [moves[j], moves[i]]; }
    moves.sort((a, b) => (b.cap ? VALUE[b.cap[1]] : 0) - (a.cap ? VALUE[a.cap[1]] : 0));
    for (const m of moves) {
      const n = makeMove(s, m);
      const res = outcome(n);
      let score;
      if (res?.kind === 'mate') score = 100000;
      else if (res) score = 0;
      else score = depth <= 1 ? (s.turn === 'w' ? 1 : -1) * evaluate(n.b) : -negamax(n, depth - 1, -Infinity, -bestScore, 1);
      if (depth === 1) score += Math.random() * 40; // easy: a little sloppy
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  // -------------------------------------------------------------- UI
  let state = initialState();
  let history = []; // previous states for undo
  let log = []; // move notation
  let lastMove = null;
  let selected = -1;
  let targets = [];
  let flipped = false;
  let thinking = false;

  const human = () => $('side').value;
  const vsComputer = () => $('mode').value === 'pve';

  function notation(s, m) {
    const p = s.b[m.from];
    if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';
    const piece = p[1] === 'P' ? '' : p[1];
    const sep = m.cap ? 'x' : '-';
    const after = makeMove(s, m);
    const res = outcome(after);
    const mark = res?.kind === 'mate' ? '#' : inCheck(after, after.turn) ? '+' : '';
    return `${piece}${sqName(m.from)}${sep}${sqName(m.to)}${m.promo ? '=' + m.promo : ''}${mark}`;
  }

  function render() {
    const board = $('board');
    const checkSq = inCheck(state, state.turn) ? kingSq(state.b, state.turn) : -1;
    let html = '';
    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        const r = flipped ? 7 - vr : vr, c = flipped ? 7 - vc : vc, i = r * 8 + c;
        const p = state.b[i];
        const cls = ['sq', (r + c) % 2 ? 'dark' : 'light'];
        if (lastMove && (i === lastMove.from || i === lastMove.to)) cls.push('last');
        if (i === selected) cls.push('sel');
        if (i === checkSq) cls.push('check');
        const tgt = targets.find((m) => m.to === i);
        if (tgt) cls.push(tgt.cap ? 'capture' : 'move');
        html += `<div class="${cls.join(' ')}" data-i="${i}">${p ? `<span class="pc ${p[0]}">${GLYPH[p[1]]}</span>` : ''}`
          + (vc === 7 ? `<span class="coord r">${8 - r}</span>` : '')
          + (vr === 7 ? `<span class="coord f">${FILES[c]}</span>` : '') + '</div>';
      }
    }
    board.innerHTML = html;

    // Status
    const res = outcome(state);
    const name = (c) => (c === 'w' ? 'White' : 'Black');
    $('status').textContent = res
      ? res.kind === 'mate' ? `Checkmate! ${name(res.winner)} wins 🎉`
        : res.kind === 'stalemate' ? 'Stalemate: draw'
        : res.kind === 'fifty' ? 'Draw by 50-move rule' : 'Draw: insufficient material'
      : `${name(state.turn)} to move${inCheck(state, state.turn) ? ' · check!' : ''}`;

    // Captured pieces
    const count = (color) => {
      const start = { P: 8, N: 2, B: 2, R: 2, Q: 1 };
      state.b.forEach((p) => { if (p && p[0] === color && start[p[1]] !== undefined) start[p[1]]--; });
      return ['Q', 'R', 'B', 'N', 'P'].map((t) => `<span class="pc ${color}">${GLYPH[t]}</span>`.repeat(Math.max(0, start[t]))).join('');
    };
    $('capW').innerHTML = count('b');
    $('capB').innerHTML = count('w');

    $('moves').innerHTML = log.reduce((acc, mv, k) => k % 2 === 0
      ? acc + `<span class="n">${k / 2 + 1}.</span><span>${mv}</span>` + (k === log.length - 1 ? '<span></span>' : '')
      : acc + `<span>${mv}</span>`, '');
    $('moves').scrollTop = 1e6;
    $('thinking').textContent = thinking ? 'Computer is thinking…' : '';
  }

  function commit(m) {
    log.push(notation(state, m));
    history.push(state);
    state = makeMove(state, m);
    lastMove = m;
    selected = -1;
    targets = [];
    save();
    render();
    if (!outcome(state)) maybeComputer();
  }

  function maybeComputer() {
    if (!vsComputer() || state.turn === human() || thinking) return;
    thinking = true;
    render();
    // Let the UI paint before searching.
    setTimeout(() => {
      const m = bestMove(state, Number($('level').value));
      thinking = false;
      if (m) commit(m); else render();
    }, 60);
  }

  $('board').addEventListener('click', (e) => {
    const sq = e.target.closest('[data-i]');
    if (!sq || thinking || outcome(state)) return;
    if (vsComputer() && state.turn !== human()) return;
    const i = Number(sq.dataset.i);
    const move = targets.find((m) => m.to === i);
    if (move) return commit(move);
    const p = state.b[i];
    if (p && p[0] === state.turn) {
      selected = i;
      targets = legalMoves(state).filter((m) => m.from === i);
    } else {
      selected = -1;
      targets = [];
    }
    render();
  });

  function newGame() {
    state = initialState();
    history = [];
    log = [];
    lastMove = null;
    selected = -1;
    targets = [];
    flipped = vsComputer() && human() === 'b';
    save();
    render();
    maybeComputer();
  }

  $('newGame').onclick = newGame;
  $('flip').onclick = () => { flipped = !flipped; render(); save(); };
  $('undo').onclick = () => {
    if (thinking || !history.length) return;
    // Against the computer, take back your move and its reply.
    const steps = vsComputer() && history.length >= 2 && state.turn === human() ? 2 : 1;
    for (let k = 0; k < steps && history.length; k++) { state = history.pop(); log.pop(); }
    lastMove = null; selected = -1; targets = [];
    save();
    render();
    maybeComputer();
  };
  for (const id of ['mode', 'level', 'side']) $(id).onchange = () => { save(); if (id !== 'level') newGame(); };

  // ------------------------------------------------------------ persistence
  function save() {
    wd.kv.set('game', { state, history: history.slice(-300), log, lastMove, flipped, mode: $('mode').value, level: $('level').value, side: $('side').value }).catch(() => {});
  }

  (async () => {
    const g = await wd.kv.get('game', null).catch(() => null);
    if (g && g.state) {
      ({ state, history, log, lastMove, flipped } = { history: [], log: [], ...g });
      $('mode').value = g.mode || 'pve';
      $('level').value = ['1', '3', '4'].includes(g.level) ? g.level : '3';
      $('side').value = g.side || 'w';
    }
    render();
    if (!outcome(state)) maybeComputer();
  })();
})();
