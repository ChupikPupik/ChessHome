// ══════════════════════════════════════════════════════════════════
//  Chess Home — Полная логика шахмат
//  Включает: генерацию ходов, проверку шаха, мат, пат, рокировку,
//  взятие на проходе, превращение пешки, FEN, PGN
// ══════════════════════════════════════════════════════════════════

const ChessEngine = (() => {

  // ─── КОНСТАНТЫ ────────────────────────────────────────────────
  const PIECES = { K:'K', Q:'Q', R:'R', B:'B', N:'N', P:'P' };
  const WHITE = 'w', BLACK = 'b';

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // ─── СОСТОЯНИЕ ────────────────────────────────────────────────
  function createState() {
    return {
      board: Array(64).fill(null),
      turn: WHITE,
      castling: { K: true, Q: true, k: true, q: true },
      enPassant: null, // square index or null
      halfmove: 0,
      fullmove: 1,
      history: [],     // [{from, to, piece, captured, promotion, fen, san}]
      capturedWhite: [],
      capturedBlack: []
    };
  }

  // ─── FEN ──────────────────────────────────────────────────────
  function parseFEN(fen) {
    const state = createState();
    const parts = fen.trim().split(' ');
    const rows = parts[0].split('/');

    let idx = 0;
    for (let r = 7; r >= 0; r--) {
      for (const ch of rows[7 - r]) {
        if ('12345678'.includes(ch)) { idx += parseInt(ch); }
        else {
          const color = ch === ch.toUpperCase() ? WHITE : BLACK;
          const type = ch.toUpperCase();
          state.board[r * 8 + (idx % 8)] = { type, color };
          idx++;
        }
      }
    }

    state.turn = parts[1] || WHITE;

    if (parts[2] && parts[2] !== '-') {
      state.castling.K = parts[2].includes('K');
      state.castling.Q = parts[2].includes('Q');
      state.castling.k = parts[2].includes('k');
      state.castling.q = parts[2].includes('q');
    }

    state.enPassant = parts[3] && parts[3] !== '-' ? squareToIndex(parts[3]) : null;
    state.halfmove = parseInt(parts[4]) || 0;
    state.fullmove = parseInt(parts[5]) || 1;
    return state;
  }

  function toFEN(state) {
    let fen = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = state.board[r * 8 + f];
        if (!p) { empty++; }
        else {
          if (empty) { fen += empty; empty = 0; }
          fen += p.color === WHITE ? p.type : p.type.toLowerCase();
        }
      }
      if (empty) fen += empty;
      if (r > 0) fen += '/';
    }
    fen += ' ' + state.turn;
    let cas = '';
    if (state.castling.K) cas += 'K';
    if (state.castling.Q) cas += 'Q';
    if (state.castling.k) cas += 'k';
    if (state.castling.q) cas += 'q';
    fen += ' ' + (cas || '-');
    fen += ' ' + (state.enPassant !== null ? indexToSquare(state.enPassant) : '-');
    fen += ' ' + state.halfmove + ' ' + state.fullmove;
    return fen;
  }

  // ─── КООРДИНАТЫ ───────────────────────────────────────────────
  function squareToIndex(sq) {
    const f = sq.charCodeAt(0) - 97;
    const r = parseInt(sq[1]) - 1;
    return r * 8 + f;
  }

  function indexToSquare(idx) {
    const f = idx % 8;
    const r = Math.floor(idx / 8);
    return String.fromCharCode(97 + f) + (r + 1);
  }

  function rank(idx) { return Math.floor(idx / 8); }
  function file(idx) { return idx % 8; }

  // ─── ГЕНЕРАЦИЯ ПСЕВДО-ХОДОВ ───────────────────────────────────
  function pseudoMoves(state, sq) {
    const piece = state.board[sq];
    if (!piece) return [];
    const moves = [];
    const { type, color } = piece;
    const dir = color === WHITE ? 1 : -1;

    const add = (to, flags = {}) => moves.push({ from: sq, to, ...flags });

    const slide = (deltas) => {
      for (const [df, dr] of deltas) {
        let f = file(sq) + df, r = rank(sq) + dr;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const target = r * 8 + f;
          const tp = state.board[target];
          if (tp) { if (tp.color !== color) add(target); break; }
          add(target);
          f += df; r += dr;
        }
      }
    };

    const jump = (deltas) => {
      for (const [df, dr] of deltas) {
        const f2 = file(sq) + df, r2 = rank(sq) + dr;
        if (f2 < 0 || f2 > 7 || r2 < 0 || r2 > 7) continue;
        const target = r2 * 8 + f2;
        const tp = state.board[target];
        if (!tp || tp.color !== color) add(target);
      }
    };

    switch (type) {
      case 'P': {
        const r1 = rank(sq), f1 = file(sq);
        const fwd = sq + dir * 8;
        // Forward
        if (rank(fwd) >= 0 && rank(fwd) < 8 && !state.board[fwd]) {
          if (rank(fwd) === (color === WHITE ? 7 : 0)) {
            for (const promo of ['Q','R','B','N']) add(fwd, { promotion: promo });
          } else {
            add(fwd);
            // Double push
            const startRank = color === WHITE ? 1 : 6;
            const fwd2 = sq + dir * 16;
            if (r1 === startRank && !state.board[fwd2]) add(fwd2, { doublePush: true });
          }
        }
        // Captures
        for (const df of [-1, 1]) {
          const f2 = f1 + df;
          if (f2 < 0 || f2 > 7) continue;
          const cap = fwd - (f1 - f2);  // Actually fwd ± df doesn't work cleanly, recalc:
          const capSq = (r1 + dir) * 8 + f2;
          if (capSq < 0 || capSq >= 64) continue;
          const tp = state.board[capSq];
          if (tp && tp.color !== color) {
            if (rank(capSq) === (color === WHITE ? 7 : 0)) {
              for (const promo of ['Q','R','B','N']) add(capSq, { promotion: promo });
            } else add(capSq);
          }
          // En passant
          if (state.enPassant === capSq) add(capSq, { enPassant: true });
        }
        break;
      }
      case 'N': jump([[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]); break;
      case 'B': slide([[1,1],[-1,1],[1,-1],[-1,-1]]); break;
      case 'R': slide([[1,0],[-1,0],[0,1],[0,-1]]); break;
      case 'Q': slide([[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]); break;
      case 'K': {
        jump([[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]);
        // Castling
        const row = color === WHITE ? 0 : 7;
        const kingSq = row * 8 + 4;
        if (sq === kingSq) {
          // Kingside
          const ksKey = color === WHITE ? 'K' : 'k';
          if (state.castling[ksKey] && !state.board[kingSq+1] && !state.board[kingSq+2]
              && !isAttacked(state, kingSq, opposite(color))
              && !isAttacked(state, kingSq+1, opposite(color))
              && !isAttacked(state, kingSq+2, opposite(color))) {
            add(kingSq + 2, { castle: 'K' });
          }
          // Queenside
          const qsKey = color === WHITE ? 'Q' : 'q';
          if (state.castling[qsKey] && !state.board[kingSq-1] && !state.board[kingSq-2] && !state.board[kingSq-3]
              && !isAttacked(state, kingSq, opposite(color))
              && !isAttacked(state, kingSq-1, opposite(color))
              && !isAttacked(state, kingSq-2, opposite(color))) {
            add(kingSq - 2, { castle: 'Q' });
          }
        }
        break;
      }
    }
    return moves;
  }

  function opposite(color) { return color === WHITE ? BLACK : WHITE; }

  // ─── ПРОВЕРКА АТАК ────────────────────────────────────────────
  function isAttacked(state, sq, byColor) {
    // Check all enemy pieces
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (!p || p.color !== byColor) continue;
      const moves = pseudoMovesNoKingCastle(state, i);
      if (moves.some(m => m.to === sq)) return true;
    }
    return false;
  }

  function pseudoMovesNoKingCastle(state, sq) {
    const piece = state.board[sq];
    if (!piece) return [];
    if (piece.type === 'K') {
      const moves = [];
      const { color } = piece;
      for (const [df, dr] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
        const f2 = file(sq) + df, r2 = rank(sq) + dr;
        if (f2 < 0 || f2 > 7 || r2 < 0 || r2 > 7) continue;
        const target = r2 * 8 + f2;
        const tp = state.board[target];
        if (!tp || tp.color !== color) moves.push({ from: sq, to: target });
      }
      return moves;
    }
    return pseudoMoves(state, sq).filter(m => !m.castle);
  }

  // ─── ПРИМЕНЕНИЕ ХОДА ──────────────────────────────────────────
  function applyMove(state, move) {
    const newState = deepClone(state);
    const { from, to, promotion, enPassant, castle, doublePush } = move;
    const piece = newState.board[from];
    const captured = newState.board[to];

    // En passant capture
    if (enPassant) {
      const capSq = to - (piece.color === WHITE ? 8 : -8);
      if (newState.board[capSq]) {
        if (newState.board[capSq].color === WHITE) newState.capturedBlack.push(newState.board[capSq]);
        else newState.capturedWhite.push(newState.board[capSq]);
      }
      newState.board[capSq] = null;
    }

    // Move piece
    newState.board[to] = promotion ? { type: promotion, color: piece.color } : piece;
    newState.board[from] = null;

    // Castle — move rook
    if (castle) {
      const row = piece.color === WHITE ? 0 : 7;
      if (castle === 'K') {
        newState.board[row * 8 + 5] = newState.board[row * 8 + 7];
        newState.board[row * 8 + 7] = null;
      } else {
        newState.board[row * 8 + 3] = newState.board[row * 8 + 0];
        newState.board[row * 8 + 0] = null;
      }
    }

    // Track captures
    if (captured) {
      if (captured.color === WHITE) newState.capturedWhite.push(captured);
      else newState.capturedBlack.push(captured);
    }

    // Update castling rights
    if (piece.type === 'K') {
      if (piece.color === WHITE) { newState.castling.K = false; newState.castling.Q = false; }
      else { newState.castling.k = false; newState.castling.q = false; }
    }
    if (piece.type === 'R') {
      const row = piece.color === WHITE ? 0 : 7;
      if (from === row * 8 + 7) newState.castling[piece.color === WHITE ? 'K' : 'k'] = false;
      if (from === row * 8 + 0) newState.castling[piece.color === WHITE ? 'Q' : 'q'] = false;
    }

    // En passant square
    newState.enPassant = doublePush ? (to + from) / 2 : null;

    // Halfmove clock
    if (piece.type === 'P' || captured) newState.halfmove = 0;
    else newState.halfmove++;

    // Fullmove
    if (newState.turn === BLACK) newState.fullmove++;

    newState.turn = opposite(newState.turn);
    return newState;
  }

  // ─── ЛЕГАЛЬНЫЕ ХОДЫ ───────────────────────────────────────────
  function legalMoves(state, sq) {
    const piece = state.board[sq];
    if (!piece || piece.color !== state.turn) return [];
    const pseudo = pseudoMoves(state, sq);
    return pseudo.filter(move => {
      const next = applyMove(state, move);
      // Find king of moving color
      const kingSq = findKing(next, piece.color);
      if (kingSq === -1) return false;
      return !isAttacked(next, kingSq, next.turn); // next.turn is now opponent
    });
  }

  function allLegalMoves(state) {
    const moves = [];
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (p && p.color === state.turn) {
        moves.push(...legalMoves(state, i));
      }
    }
    return moves;
  }

  function findKing(state, color) {
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (p && p.type === 'K' && p.color === color) return i;
    }
    return -1;
  }

  // ─── СТАТУС ИГРЫ ──────────────────────────────────────────────
  function getStatus(state) {
    const moves = allLegalMoves(state);
    const kingSq = findKing(state, state.turn);
    const inCheck = isAttacked(state, kingSq, opposite(state.turn));

    if (moves.length === 0) {
      return inCheck ? { status: 'checkmate', winner: opposite(state.turn) } : { status: 'stalemate' };
    }
    if (state.halfmove >= 100) return { status: 'draw', reason: '50-move rule' };
    if (isInsufficientMaterial(state)) return { status: 'draw', reason: 'Insufficient material' };
    return { status: inCheck ? 'check' : 'playing', inCheck };
  }

  function isInsufficientMaterial(state) {
    const pieces = state.board.filter(Boolean);
    if (pieces.length === 2) return true; // KK
    if (pieces.length === 3) {
      const minor = pieces.find(p => p.type === 'B' || p.type === 'N');
      if (minor) return true; // KBK or KNK
    }
    return false;
  }

  // ─── SAN НОТАЦИЯ ─────────────────────────────────────────────
  function toSAN(state, move) {
    const { from, to, promotion, castle, enPassant } = move;
    if (castle === 'K') return 'O-O';
    if (castle === 'Q') return 'O-O-O';

    const piece = state.board[from];
    const captured = state.board[to] || (enPassant ? { type: 'P' } : null);
    let san = '';

    if (piece.type !== 'P') {
      san += piece.type;
      // Disambiguation
      const ambig = [];
      for (let i = 0; i < 64; i++) {
        if (i === from) continue;
        const p = state.board[i];
        if (p && p.type === piece.type && p.color === piece.color) {
          const lm = legalMoves(state, i);
          if (lm.some(m => m.to === to)) ambig.push(i);
        }
      }
      if (ambig.length) {
        const sameFile = ambig.some(s => file(s) === file(from));
        const sameRank = ambig.some(s => rank(s) === rank(from));
        if (!sameFile) san += String.fromCharCode(97 + file(from));
        else if (!sameRank) san += (rank(from) + 1);
        else san += indexToSquare(from);
      }
    }

    if (captured) {
      if (piece.type === 'P') san += String.fromCharCode(97 + file(from));
      san += 'x';
    }

    san += indexToSquare(to);
    if (promotion) san += '=' + promotion;

    // Check/Checkmate
    const next = applyMove(state, move);
    const status = getStatus(next);
    if (status.status === 'checkmate') san += '#';
    else if (status.inCheck) san += '+';

    return san;
  }

  // ─── PGN ──────────────────────────────────────────────────────
  function toPGN(state, metadata = {}) {
    const tags = {
      Event: metadata.event || 'Chess Home Game',
      Site: metadata.site || 'chesshome.app',
      Date: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
      White: metadata.white || '?',
      Black: metadata.black || '?',
      Result: metadata.result || '*',
      ...metadata.extra
    };
    let pgn = Object.entries(tags).map(([k, v]) => `[${k} "${v}"]`).join('\n') + '\n\n';
    const moves = state.history;
    for (let i = 0; i < moves.length; i++) {
      if (i % 2 === 0) pgn += `${Math.floor(i/2)+1}. `;
      pgn += moves[i].san + ' ';
    }
    pgn += (metadata.result || '*');
    return pgn;
  }

  // ─── УТИЛИТЫ ──────────────────────────────────────────────────
  function deepClone(state) {
    return {
      board: state.board.map(p => p ? { ...p } : null),
      turn: state.turn,
      castling: { ...state.castling },
      enPassant: state.enPassant,
      halfmove: state.halfmove,
      fullmove: state.fullmove,
      history: [...state.history],
      capturedWhite: [...state.capturedWhite],
      capturedBlack: [...state.capturedBlack]
    };
  }

  // ─── ПУБЛИЧНЫЙ API ────────────────────────────────────────────
  return {
    START_FEN,
    parseFEN,
    toFEN,
    createState,
    legalMoves,
    allLegalMoves,
    applyMove,
    getStatus,
    toSAN,
    toPGN,
    squareToIndex,
    indexToSquare,
    findKing,
    isAttacked,
    opposite,
    deepClone,
    rank,
    file
  };
})();

if (typeof module !== 'undefined') module.exports = ChessEngine;