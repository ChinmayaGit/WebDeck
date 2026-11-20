(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);

  // Tab switching
  document.querySelectorAll('[data-game]').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('[data-game]').forEach(x => x.setAttribute('aria-selected', 'false'));
      b.setAttribute('aria-selected', 'true');
      const g = b.dataset.game;
      $('secChess').className = 'game-section' + (g === 'chess' ? ' active' : '');
      $('secTtt').className = 'game-section' + (g === 'ttt' ? ' active' : '');
      $('sec2048').className = 'game-section' + (g === '2048' ? ' active' : '');
    };
  });

  // -------------------------------------------------------------
  // 1. TIC TAC TOE
  // -------------------------------------------------------------
  let tttState = Array(9).fill(null);
  let tttCurrentPlayer = 'X';
  let tttGameOver = false;
  let tttWins = { X: 0, O: 0, Ties: 0 };

  const WIN_COMBOS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  function initTtt() {
    renderTtt();
    $('btnResetTtt').onclick = resetTtt;
  }

  function renderTtt() {
    $('tttBoard').innerHTML = tttState.map((val, idx) => `
      <div class="ttt-cell ${val ? val.toLowerCase() : ''}" data-ttt-idx="${idx}">${val || ''}</div>
    `).join('');

    document.querySelectorAll('[data-ttt-idx]').forEach(cell => {
      cell.onclick = () => onTttClick(+cell.dataset.tttIdx);
    });
  }

  function onTttClick(idx) {
    if (tttGameOver || tttState[idx]) return;
    tttState[idx] = tttCurrentPlayer;
    renderTtt();

    const winner = checkTttWinner(tttState);
    if (winner) {
      endTtt(winner);
      return;
    }
    if (tttState.every(Boolean)) {
      endTtt('Tie');
      return;
    }

    tttCurrentPlayer = tttCurrentPlayer === 'X' ? 'O' : 'X';
    $('tttTurnText').textContent = `Player ${tttCurrentPlayer}'s Turn`;

    const mode = $('tttMode').value;
    if (mode.startsWith('ai') && tttCurrentPlayer === 'O' && !tttGameOver) {
      setTimeout(() => {
        makeAiMove(mode === 'ai-smart');
      }, 300);
    }
  }

  function checkTttWinner(board) {
    for (const [a, b, c] of WIN_COMBOS) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }
    return null;
  }

  function makeAiMove(isSmart) {
    let bestMove = -1;
    if (isSmart) {
      let bestScore = -Infinity;
      for (let i = 0; i < 9; i++) {
        if (!tttState[i]) {
          tttState[i] = 'O';
          const score = minimax(tttState, 0, false);
          tttState[i] = null;
          if (score > bestScore) {
            bestScore = score;
            bestMove = i;
          }
        }
      }
    } else {
      const avail = tttState.map((v, i) => v === null ? i : null).filter(v => v !== null);
      bestMove = avail[Math.floor(Math.random() * avail.length)];
    }

    if (bestMove !== -1) {
      onTttClick(bestMove);
    }
  }

  function minimax(board, depth, isMaximizing) {
    const winner = checkTttWinner(board);
    if (winner === 'O') return 10 - depth;
    if (winner === 'X') return depth - 10;
    if (board.every(Boolean)) return 0;

    if (isMaximizing) {
      let maxScore = -Infinity;
      for (let i = 0; i < 9; i++) {
        if (!board[i]) {
          board[i] = 'O';
          maxScore = Math.max(maxScore, minimax(board, depth + 1, false));
          board[i] = null;
        }
      }
      return maxScore;
    } else {
      let minScore = Infinity;
      for (let i = 0; i < 9; i++) {
        if (!board[i]) {
          board[i] = 'X';
          minScore = Math.min(minScore, minimax(board, depth + 1, true));
          board[i] = null;
        }
      }
      return minScore;
    }
  }

  function endTtt(result) {
    tttGameOver = true;
    if (result === 'Tie') {
      $('tttTurnText').textContent = "It's a Tie Game!";
      tttWins.Ties++;
    } else {
      $('tttTurnText').textContent = `Player ${result} Wins! 🎉`;
      tttWins[result]++;
    }
    $('tttScore').textContent = `Score — X: ${tttWins.X} | O: ${tttWins.O} | Ties: ${tttWins.Ties}`;
  }

  function resetTtt() {
    tttState = Array(9).fill(null);
    tttCurrentPlayer = 'X';
    tttGameOver = false;
    $('tttTurnText').textContent = "Player X's Turn";
    renderTtt();
  }

  // -------------------------------------------------------------
  // 2. CHESS GAME
  // -------------------------------------------------------------
  const PIECE_UNICODE = {
    'wK': '♔', 'wQ': '♕', 'wR': '♖', 'wB': '♗', 'wN': '♘', 'wP': '♙',
    'bK': '♚', 'bQ': '♛', 'bR': '♜', 'bB': '♝', 'bN': '♞', 'bP': '♟'
  };

  let chessBoard = [];
  let chessTurn = 'w';
  let selectedSquare = null;
  let isFlipped = false;

  function initChess() {
    resetChess();
    $('btnResetChess').onclick = resetChess;
    $('btnFlipChess').onclick = () => { isFlipped = !isFlipped; renderChess(); };
  }

  function resetChess() {
    chessBoard = [
      ['bR','bN','bB','bQ','bK','bB','bN','bR'],
      ['bP','bP','bP','bP','bP','bP','bP','bP'],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      ['wP','wP','wP','wP','wP','wP','wP','wP'],
      ['wR','wN','wB','wQ','wK','wB','wN','wR']
    ];
    chessTurn = 'w';
    selectedSquare = null;
    $('chessTurnText').textContent = "White's Turn";
    $('chessStatus').textContent = "Select a piece to play.";
    renderChess();
  }

  function renderChess() {
    const boardEl = $('chessBoard');
    boardEl.innerHTML = '';

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const row = isFlipped ? 7 - r : r;
        const col = isFlipped ? 7 - c : c;
        const piece = chessBoard[row][col];
        const isLight = (row + col) % 2 === 0;
        const isSelected = selectedSquare && selectedSquare.r === row && selectedSquare.c === col;

        const sq = document.createElement('div');
        sq.className = `sq ${isLight ? 'light' : 'dark'} ${isSelected ? 'selected' : ''}`;
        sq.textContent = piece ? PIECE_UNICODE[piece] : '';
        sq.onclick = () => onChessSquareClick(row, col);
        boardEl.appendChild(sq);
      }
    }
  }

  function onChessSquareClick(r, c) {
    const piece = chessBoard[r][c];

    if (selectedSquare) {
      if (selectedSquare.r === r && selectedSquare.c === c) {
        selectedSquare = null;
        renderChess();
        return;
      }
      // Simple Move logic (destination is different color or empty)
      const srcPiece = chessBoard[selectedSquare.r][selectedSquare.c];
      if (!piece || piece[0] !== srcPiece[0]) {
        chessBoard[r][c] = srcPiece;
        chessBoard[selectedSquare.r][selectedSquare.c] = null;
        selectedSquare = null;
        chessTurn = chessTurn === 'w' ? 'b' : 'w';
        $('chessTurnText').textContent = chessTurn === 'w' ? "White's Turn" : "Black's Turn";
        renderChess();

        if ($('chessMode').value === 'pve' && chessTurn === 'b') {
          setTimeout(makeAiChessMove, 400);
        }
        return;
      }
    }

    if (piece && piece[0] === chessTurn) {
      selectedSquare = { r, c };
      renderChess();
    }
  }

  function makeAiChessMove() {
    const blackPieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (chessBoard[r][c] && chessBoard[r][c][0] === 'b') {
          blackPieces.push({ r, c, piece: chessBoard[r][c] });
        }
      }
    }
    if (!blackPieces.length) return;

    // Pick a piece with a forward or valid move
    for (let attempt = 0; attempt < 20; attempt++) {
      const src = blackPieces[Math.floor(Math.random() * blackPieces.length)];
      const dr = src.piece === 'bP' ? 1 : (Math.random() > 0.5 ? 1 : -1);
      const dc = Math.floor(Math.random() * 3) - 1;
      const targetR = src.r + dr;
      const targetC = src.c + dc;

      if (targetR >= 0 && targetR < 8 && targetC >= 0 && targetC < 8) {
        const dest = chessBoard[targetR][targetC];
        if (!dest || dest[0] === 'w') {
          chessBoard[targetR][targetC] = src.piece;
          chessBoard[src.r][src.c] = null;
          chessTurn = 'w';
          $('chessTurnText').textContent = "White's Turn";
          renderChess();
          return;
        }
      }
    }
    chessTurn = 'w';
    $('chessTurnText').textContent = "White's Turn";
    renderChess();
  }

  // -------------------------------------------------------------
  // 3. 2048 PUZZLE
  // -------------------------------------------------------------
  let b2048 = Array(16).fill(0);
  let score2048 = 0;
  let best2048 = 0;

  function init2048() {
    reset2048();
    $('btnReset2048').onclick = reset2048;
    document.addEventListener('keydown', on2048Key);
  }

  function reset2048() {
    b2048 = Array(16).fill(0);
    score2048 = 0;
    $('score2048').textContent = '0';
    spawn2048();
    spawn2048();
    render2048();
  }

  function spawn2048() {
    const empty = b2048.map((v, i) => v === 0 ? i : null).filter(v => v !== null);
    if (!empty.length) return;
    const idx = empty[Math.floor(Math.random() * empty.length)];
    b2048[idx] = Math.random() > 0.1 ? 2 : 4;
  }

  function render2048() {
    const colors = {
      2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563',
      32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61',
      512: '#edc850', 1024: '#edc53f', 2048: '#edc22e'
    };
    $('board2048').innerHTML = b2048.map(val => `
      <div class="cell-2048" style="background:${colors[val] || (val ? '#3c3a32' : 'rgba(238,228,218,0.35)')};color:${val > 4 ? '#fff' : '#776e65'}">
        ${val || ''}
      </div>
    `).join('');
  }

  function on2048Key(e) {
    if (!$('sec2048').classList.contains('active')) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      slide2048(e.key);
    }
  }

  function slide2048(dir) {
    // Basic 2048 row compressor
    let moved = false;
    const rotate = (m) => [
      m[12], m[8], m[4], m[0],
      m[13], m[9], m[5], m[1],
      m[14], m[10], m[6], m[2],
      m[15], m[11], m[7], m[3]
    ];

    let grid = [...b2048];
    let rotations = dir === 'ArrowLeft' ? 0 : dir === 'ArrowDown' ? 1 : dir === 'ArrowRight' ? 2 : 3;

    for (let r = 0; r < rotations; r++) grid = rotate(grid);

    for (let row = 0; row < 4; row++) {
      let line = [grid[row*4], grid[row*4+1], grid[row*4+2], grid[row*4+3]].filter(v => v !== 0);
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === line[i+1]) {
          line[i] *= 2;
          score2048 += line[i];
          line.splice(i+1, 1);
        }
      }
      while (line.length < 4) line.push(0);
      for (let col = 0; col < 4; col++) {
        if (grid[row*4 + col] !== line[col]) moved = true;
        grid[row*4 + col] = line[col];
      }
    }

    for (let r = 0; r < (4 - rotations) % 4; r++) grid = rotate(grid);

    if (moved) {
      b2048 = grid;
      spawn2048();
      if (score2048 > best2048) best2048 = score2048;
      $('score2048').textContent = score2048;
      $('best2048').textContent = best2048;
      render2048();
    }
  }

  initTtt();
  initChess();
  init2048();
})();
