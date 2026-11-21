(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

  let board = Array(9).fill(null);
  let turn = 'X';
  let over = false;
  let winLine = null;
  let lastPlaced = -1;
  let score = { X: 0, O: 0, T: 0 };
  let starter = 'X'; // alternate who starts each round

  const vsAi = () => $('mode').value !== 'pvp';
  const winnerOf = (b) => {
    for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { who: b[l[0]], line: l };
    return null;
  };

  function render() {
    $('board').innerHTML = board.map((v, i) =>
      `<div class="cell ${v ? v.toLowerCase() : ''} ${winLine?.includes(i) ? 'win' : ''} ${i === lastPlaced ? 'pop' : ''}" data-i="${i}">${v || ''}</div>`).join('');
    $('sx').textContent = score.X;
    $('so').textContent = score.O;
    $('st').textContent = score.T;
  }

  function place(i) {
    board[i] = turn;
    lastPlaced = i;
    const w = winnerOf(board);
    if (w) {
      over = true;
      winLine = w.line;
      score[w.who]++;
      $('status').textContent = vsAi() ? (w.who === 'X' ? 'You win! 🎉' : 'Computer wins') : `${w.who} wins! 🎉`;
    } else if (board.every(Boolean)) {
      over = true;
      score.T++;
      $('status').textContent = "It's a tie";
    } else {
      turn = turn === 'X' ? 'O' : 'X';
      $('status').textContent = vsAi() ? (turn === 'X' ? 'Your move' : 'Computer is thinking…') : `${turn} to move`;
    }
    render();
    if (over) wd.kv.set('score', score);
    else if (vsAi() && turn === 'O') setTimeout(aiMove, 350);
  }

  function minimax(b, player, depth) {
    const w = winnerOf(b);
    if (w) return w.who === 'O' ? 10 - depth : depth - 10;
    if (b.every(Boolean)) return 0;
    let best = player === 'O' ? -Infinity : Infinity;
    for (let i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = player;
      const s = minimax(b, player === 'O' ? 'X' : 'O', depth + 1);
      b[i] = null;
      best = player === 'O' ? Math.max(best, s) : Math.min(best, s);
    }
    return best;
  }

  function aiMove() {
    if (over) return;
    const free = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    let pick;
    if ($('mode').value === 'ai-easy' && Math.random() < 0.6) {
      pick = free[Math.floor(Math.random() * free.length)];
    } else {
      let best = -Infinity;
      for (const i of free) {
        board[i] = 'O';
        const s = minimax(board, 'X', 0) + Math.random() * 0.1; // vary between equal moves
        board[i] = null;
        if (s > best) { best = s; pick = i; }
      }
    }
    place(pick);
  }

  $('board').addEventListener('click', (e) => {
    const c = e.target.closest('[data-i]');
    if (!c || over) return;
    const i = Number(c.dataset.i);
    if (board[i]) return;
    if (vsAi() && turn !== 'X') return; // wait for the computer
    place(i);
  });

  function newRound() {
    board = Array(9).fill(null);
    over = false;
    winLine = null;
    lastPlaced = -1;
    starter = vsAi() ? (starter === 'X' ? 'O' : 'X') : 'X';
    turn = starter;
    $('status').textContent = vsAi() ? (turn === 'X' ? 'Your move' : 'Computer starts…') : 'X to move';
    render();
    if (vsAi() && turn === 'O') setTimeout(aiMove, 400);
  }

  $('reset').onclick = newRound;
  $('clearScore').onclick = () => { score = { X: 0, O: 0, T: 0 }; wd.kv.set('score', score); render(); };
  $('mode').onchange = () => { wd.kv.set('mode', $('mode').value); starter = 'O'; newRound(); };

  (async () => {
    score = await wd.kv.get('score', score).catch(() => score);
    $('mode').value = await wd.kv.get('mode', 'ai-smart').catch(() => 'ai-smart');
    starter = 'O';
    newRound();
  })();
})();
