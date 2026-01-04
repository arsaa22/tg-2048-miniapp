// --- Telegram init (не обязательно, но приятно) ---
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  // подхватим фон темы Telegram (если задан)
  const bg = tg.themeParams?.bg_color;
  if (bg) document.documentElement.style.setProperty('--bg', bg);
  tg.disableVerticalSwipes?.();
}

// --- DOM ---
const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const globalBestEl = document.getElementById('globalBest');
const mathListEl = document.getElementById('mathList');
const restartBtn = document.getElementById('restartBtn');
const shareBtn = document.getElementById('shareBtn');

// --- State ---
const SIZE = 4;
const STORAGE_KEY = 'tg2048_v1';
const API_BASE = 'https://mgt-welding.ru/tg2048-api';
const API_BEST_URL = `${API_BASE}/best`;
const API_SCORE_URL = `${API_BASE}/score`;

const MOVE_MS = 150;               // чуть больше, чем CSS transition (130ms)
let isAnimating = false;

let nextTileId = 1;
const tileEls = new Map();         // tileId -> DOM

let grid = makeEmptyGrid();        // grid[r][c] = tileObject | null
let score = 0;
let mathScore = 0;
let globalBest = 0;
let globalBestSubmitting = false;

let best = Number(localStorage.getItem(`${STORAGE_KEY}_best`) || 0);

// список строк типа "8 + 8 = 16"
let mathHistory = [];

// --- Layers (board) ---
let cellLayerEl, tileLayerEl;

function setupBoardLayers() {
  cellLayerEl = boardEl.querySelector('.cell-layer');
  tileLayerEl = boardEl.querySelector('.tile-layer');

  // Если HTML не обновлён — создадим слои сами
  if (!cellLayerEl || !tileLayerEl) {
    boardEl.innerHTML = `
      <div class="cell-layer"></div>
      <div class="tile-layer"></div>
    `;
    cellLayerEl = boardEl.querySelector('.cell-layer');
    tileLayerEl = boardEl.querySelector('.tile-layer');
  }

  // Фоновые 16 клеток
  if (cellLayerEl.children.length !== SIZE * SIZE) {
    cellLayerEl.innerHTML = '';
    for (let i = 0; i < SIZE * SIZE; i++) {
      const c = document.createElement('div');
      c.className = 'cell';
      cellLayerEl.appendChild(c);
    }
  }
}
setupBoardLayers();

// --- Helpers (grid) ---
function makeEmptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

function gridToValues() {
  return grid.map(row => row.map(t => (t ? t.value : 0)));
}

function valuesToGrid(values) {
  const g = makeEmptyGrid();
  nextTileId = 1; // пересобираем id заново при загрузке
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = Number(values?.[r]?.[c] || 0);
      if (v > 0) {
        const tile = createTile(c, r, v);
        g[r][c] = tile;
      }
    }
  }
  return g;
}

function addMathLine(a, b, c) {
  const line = `${a} + ${b} = ${c}`;
  mathHistory.unshift(line);
  mathHistory = mathHistory.slice(0, 6); // последние 6
}

// --- Colors (как у тебя было) ---
function tileBg(v) {
  if (!v) return '#111827';

  const map = {
    2: '#22c55e',
    4: '#3b82f6',
    8: '#f59e0b',
    16: '#ef4444',
    32: '#a855f7',
    64: '#06b6d4',
    128: '#eab308',
    256: '#fb7185',
    512: '#14b8a6',
    1024: '#f97316',
    2048: '#84cc16',
  };

  return map[v] || '#ffffff';
}

// --- Tile objects ---
function createTile(x, y, value) {
  return {
    id: nextTileId++,
    x, y,
    prevX: x, prevY: y,
    value,
    pendingValue: null,   // сюда кладём итог слияния (чтобы показать после движения)
    removeAfter: false
  };
}

// --- Metrics / positioning ---
function cssVarNumber(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getMetrics() {
  const rect = tileLayerEl.getBoundingClientRect();
  const gap = cssVarNumber('--gap', 10);
  const tileSize = (rect.width - gap * (SIZE - 1)) / SIZE;
  const step = tileSize + gap;
  return { tileSize, step };
}

function ensureTileEl(tile) {
  let el = tileEls.get(tile.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'tile';
    tileLayerEl.appendChild(el);
    tileEls.set(tile.id, el);
  }
  return el;
}

function setTileContentAndStyle(tile, showPending = false) {
  const el = ensureTileEl(tile);
  const v = (showPending && tile.pendingValue) ? tile.pendingValue : tile.value;

  el.textContent = String(v);
  el.style.background = tileBg(v);

  // как у тебя: темный текст, но для маленьких значений — белый
  el.style.color = '#0b1220';
  if (v <= 4) el.style.color = '#ffffff';
}

function setTileTransform(tile, scale = 1, noTransition = false) {
  const el = ensureTileEl(tile);
  const { tileSize, step } = getMetrics();

  el.style.width = `${tileSize}px`;
  el.style.height = `${tileSize}px`;
  el.style.fontSize = `${Math.max(18, tileSize * 0.38)}px`;

  const xPx = tile.x * step;
  const yPx = tile.y * step;

  if (noTransition) {
    el.style.transition = 'none';
    el.style.transform = `translate(${xPx}px, ${yPx}px) scale(${scale})`;
    // принудительный reflow
    el.getBoundingClientRect();
    el.style.transition = 'transform 130ms ease-in-out';
  } else {
    el.style.transform = `translate(${xPx}px, ${yPx}px) scale(${scale})`;
  }
}

function popTile(tile) {
  setTileContentAndStyle(tile, false);
  setTileTransform(tile, 0.6, true);
  requestAnimationFrame(() => setTileTransform(tile, 1, false));
}

function bounceTile(tile) {
  setTileContentAndStyle(tile, false);
  setTileTransform(tile, 1.12, true);
  requestAnimationFrame(() => setTileTransform(tile, 1, false));
}

function removeTileEl(tile) {
  const el = tileEls.get(tile.id);
  if (!el) return;
  el.style.transition = 'transform 130ms ease, opacity 130ms ease';
  el.style.opacity = '0';
  // лёгкий уход
  el.style.transform += ' scale(0.85)';
  setTimeout(() => {
    el.remove();
    tileEls.delete(tile.id);
  }, MOVE_MS);
}

function rebuildTilesDOM(noTransition = true) {
  tileLayerEl.innerHTML = '';
  tileEls.clear();

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c];
      if (!t) continue;
      setTileContentAndStyle(t, false);
      setTileTransform(t, 1, noTransition);
    }
  }
}

// ресайз: пересчитать пиксели (Telegram иногда меняет размеры)
window.addEventListener('resize', () => {
  requestAnimationFrame(() => {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const t = grid[r][c];
        if (!t) continue;
        setTileTransform(t, 1, true);
      }
    }
  });
});

// --- Storage ---
function saveGame() {
  const data = {
    grid: gridToValues(),
    score,
    mathScore,
    mathHistory,
    best
  };
  localStorage.setItem(`${STORAGE_KEY}_save`, JSON.stringify(data));
}

function loadGame() {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_save`);
    if (!raw) return false;

    const data = JSON.parse(raw);
    if (!data || !data.grid) return false;

    grid = valuesToGrid(data.grid);
    score = Number(data.score || 0);
    mathScore = Number(data.mathScore || 0);
    mathHistory = Array.isArray(data.mathHistory) ? data.mathHistory : [];
    best = Number(data.best || best);

    return true;
  } catch {
    return false;
  }
}

function clearSave() {
  localStorage.removeItem(`${STORAGE_KEY}_save`);
}

function saveBest() {
  localStorage.setItem(`${STORAGE_KEY}_best`, String(best));
}

// --- HUD (score/best/math/global) ---
function renderHUD() {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  globalBestEl.textContent = globalBest ? String(globalBest) : '—';

  mathListEl.innerHTML = '';
  if (!mathHistory.length) {
    const e = document.createElement('div');
    e.className = 'mathItem';
    e.textContent = 'Пока нет слияний...';
    mathListEl.appendChild(e);
  } else {
    for (const s of mathHistory) {
      const e = document.createElement('div');
      e.className = 'mathItem';
      e.textContent = s;
      mathListEl.appendChild(e);
    }
  }
}

// --- Spawning ---
function spawnTile(animated = true) {
  const empty = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!grid[r][c]) empty.push([r, c]);
    }
  }
  if (!empty.length) return false;

  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  const value = Math.random() < 0.9 ? 2 : 4;

  const tile = createTile(c, r, value);
  grid[r][c] = tile;

  if (animated) popTile(tile);
  else {
    setTileContentAndStyle(tile, false);
    setTileTransform(tile, 1, true);
  }

  return true;
}

// --- Moves check ---
function canMove() {
  // пустые есть?
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!grid[r][c]) return true;
    }
  }
  // соседние равные?
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = grid[r][c]?.value;
      if (r + 1 < SIZE && grid[r + 1][c]?.value === v) return true;
      if (c + 1 < SIZE && grid[r][c + 1]?.value === v) return true;
    }
  }
  return false;
}

// --- Core move with animation ---
function processLine(lineTiles) {
  const arr = lineTiles.filter(Boolean);
  const result = [];
  const merges = []; // {into, from, newValue, oldValue}

  let i = 0;
  while (i < arr.length) {
    const a = arr[i];
    const b = arr[i + 1];

    if (b && a.value === b.value) {
      const old = a.value;
      const newValue = old * 2;

      a.pendingValue = newValue;
      b.removeAfter = true;

      merges.push({ into: a, from: b, newValue, oldValue: old });

      // score и mathScore как у тебя
      score += newValue;
      mathScore += newValue;
      addMathLine(old, old, newValue);

      tg?.HapticFeedback?.impactOccurred?.('light');

      result.push(a);
      i += 2;
    } else {
      result.push(a);
      i += 1;
    }
  }

  return { kept: result, merges };
}

function doMove(dir) {
  if (isAnimating) return;

  // Собираем список всех плиток + сохраняем prev позиции
  const allTiles = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c];
      if (!t) continue;
      t.prevX = t.x;
      t.prevY = t.y;
      t.pendingValue = null;
      t.removeAfter = false;
      allTiles.push(t);
    }
  }

  const newGrid = makeEmptyGrid();
  const mergesAll = [];
  const removedTiles = [];

  const range = [0, 1, 2, 3];

  function placeLine(lineTiles, fixedIndex, isRow, reverse) {
    const { kept, merges } = processLine(lineTiles);

    // расставляем kept
    for (let i = 0; i < kept.length; i++) {
      const t = kept[i];
      const pos = reverse ? (SIZE - 1 - i) : i;

      if (isRow) {
        t.x = pos;
        t.y = fixedIndex;
        newGrid[fixedIndex][pos] = t;
      } else {
        t.x = fixedIndex;
        t.y = pos;
        newGrid[pos][fixedIndex] = t;
      }
    }

    // исчезающие плитки: они должны “доехать” в ту же клетку, что и into
    for (const m of merges) {
      m.from.x = m.into.x;
      m.from.y = m.into.y;
      removedTiles.push(m.from);
      mergesAll.push(m);
    }
  }

  if (dir === 'L' || dir === 'R') {
    const reverse = (dir === 'R');
    for (let r = 0; r < SIZE; r++) {
      const xs = reverse ? [...range].reverse() : range;
      const line = xs.map(c => grid[r][c]);
      placeLine(line, r, true, reverse);
    }
  }

  if (dir === 'U' || dir === 'D') {
    const reverse = (dir === 'D');
    for (let c = 0; c < SIZE; c++) {
      const ys = reverse ? [...range].reverse() : range;
      const line = ys.map(r => grid[r][c]);
      placeLine(line, c, false, reverse);
    }
  }

  // Определяем: было ли изменение
  let changed = mergesAll.length > 0;
  if (!changed) {
    for (const t of allTiles) {
      if (t.x !== t.prevX || t.y !== t.prevY) { changed = true; break; }
    }
  }
  if (!changed) return;

  // применяем новую сетку
  grid = newGrid;

  // best
  if (score > best) {
    best = score;
    saveBest();
  }

  // === анимация движения ===
  isAnimating = true;

  // Плитки едут (показываем старые значения во время движения)
  for (const t of allTiles) {
    setTileContentAndStyle(t, false);
    setTileTransform(t, 1, false);
  }
  for (const t of removedTiles) {
    setTileContentAndStyle(t, false);
    setTileTransform(t, 1, false);
  }

  // После движения — применяем слияния, удаляем лишние, спавним новую
  setTimeout(() => {
    for (const m of mergesAll) {
      // итоговое значение
      m.into.value = m.newValue;
      m.into.pendingValue = null;

      setTileContentAndStyle(m.into, false);
      bounceTile(m.into);

      // удаляем "въехавшую"
      removeTileEl(m.from);
    }

    spawnTile(true);

    renderHUD();
    saveGame();

    // game over
    if (!canMove()) {
      submitScoreToServer(score).finally(() => loadGlobalBest());

      if (tg?.showPopup) {
        tg.showPopup({
          title: "Игра окончена",
          message: `🎯 Результат: ${score}\n🏅 Личный рекорд: ${best}\n🌍 Глобальный рекорд: ${globalBest || '—'}`,
          buttons: [
            { id: "new", type: "default", text: "Новая игра" },
            { id: "close", type: "cancel", text: "Закрыть" }
          ]
        }, (btnId) => {
          if (btnId === "new") newGame();
        });
      } else {
        alert("Игра окончена!");
      }
    }

    isAnimating = false;
  }, MOVE_MS);
}

// --- Init game ---
function newGame() {
  clearSave();
  grid = makeEmptyGrid();
  score = 0;
  mathScore = 0;
  mathHistory = [];

  // очистить DOM плиток
  tileLayerEl.innerHTML = '';
  tileEls.clear();

  spawnTile(false);
  spawnTile(false);

  rebuildTilesDOM(true);
  renderHUD();
  saveGame();
}

restartBtn?.addEventListener('click', newGame);

// Keyboard controls
window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'ArrowLeft') doMove('L');
  if (k === 'ArrowRight') doMove('R');
  if (k === 'ArrowUp') doMove('U');
  if (k === 'ArrowDown') doMove('D');
});

// Touch/swipe controls
let touchStartX = 0, touchStartY = 0;

boardEl.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

boardEl.addEventListener('touchend', (e) => {
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;

  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < 25) return;

  if (ax > ay) {
    doMove(dx > 0 ? 'R' : 'L');
  } else {
    doMove(dy > 0 ? 'D' : 'U');
  }
});

// старт / загрузка
if (!loadGame()) {
  newGame();
} else {
  // после загрузки: пересобрать DOM плиток и отрисовать HUD
  rebuildTilesDOM(true);
  renderHUD();
}

loadGlobalBest();

// Share
shareBtn?.addEventListener('click', () => {
  const text = `Мой рекорд в 2048: ${best} 🔥\nГлобальный рекорд: ${globalBest || '—'}`;
  tg?.openTelegramLink?.(`https://t.me/share/url?text=${encodeURIComponent(text)}`);
});

// --- Global best API ---
async function loadGlobalBest() {
  try {
    const r = await fetch(API_BEST_URL, { method: 'GET' });
    const data = await r.json();
    globalBest = Number(data.best || 0);
    globalBestEl.textContent = globalBest ? String(globalBest) : '—';
  } catch (e) {
    globalBestEl.textContent = '—';
  }
}

async function submitScoreToServer(finalScore) {
  if (!Number.isFinite(finalScore) || finalScore < 0) return;
  if (globalBestSubmitting) return;

  const originInfo = `origin: ${location.origin}`;

  if (!tg?.initData) {
    tg?.showAlert?.(`Нет tg.initData\n${originInfo}`);
    return;
  }

  globalBestSubmitting = true;

  try {
    const r = await fetch(API_SCORE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: finalScore, initData: tg.initData })
    });

    const text = await r.text().catch(() => "");

    if (!r.ok) {
      tg?.showAlert?.(
        `Score НЕ принят: ${r.status}\n${originInfo}\nURL: ${API_SCORE_URL}\n${text.slice(0, 200)}`
      );
      return;
    }

    tg?.showAlert?.(`Score отправлен ✅\n${originInfo}`);
  } catch (e) {
    tg?.showAlert?.(`Ошибка сети\n${originInfo}\nURL: ${API_SCORE_URL}`);
  } finally {
    globalBestSubmitting = false;
  }
}
