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
const API_BEST_URL = '/api/best';

let grid = makeEmptyGrid();
let score = 0;
let mathScore = 0;               // оставляем: это “сумма слияний” для внутренней логики/истории
let globalBest = 0;              // глобальный рекорд (лучший счёт среди всех игроков)
let globalBestSubmitting = false;

let best = Number(localStorage.getItem(`${STORAGE_KEY}_best`) || 0);

// список строк типа "8 + 8 = 16"
let mathHistory = [];

// --- Storage ---
function saveGame() {
  const data = { grid, score, mathScore, mathHistory, best };
  localStorage.setItem(`${STORAGE_KEY}_save`, JSON.stringify(data));
}

function loadGame() {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_save`);
    if (!raw) return false;

    const data = JSON.parse(raw);
    if (!data || !data.grid) return false;

    grid = data.grid;
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

// --- Helpers ---
function makeEmptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function addMathLine(a, b, c) {
  const line = `${a} + ${b} = ${c}`;
  mathHistory.unshift(line);
  mathHistory = mathHistory.slice(0, 6); // последние 6
}

function spawnTile() {
  const empty = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) empty.push([r, c]);
    }
  }
  if (!empty.length) return false;

  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  return true;
}

function tileBg(v) {
  if (!v) return '#111827'; // пустая клетка

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

function render() {
  boardEl.innerHTML = '';

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = grid[r][c];
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.textContent = v ? String(v) : '';
      cell.style.background = tileBg(v);

      // текст
      cell.style.color = '#0b1220';
      if (v <= 4) cell.style.color = '#ffffff';

      boardEl.appendChild(cell);
    }
  }

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

function canMove() {
  // есть пустые клетки
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) return true;
    }
  }
  // есть соседние равные
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = grid[r][c];
      if (r + 1 < SIZE && grid[r + 1][c] === v) return true;
      if (c + 1 < SIZE && grid[r][c + 1] === v) return true;
    }
  }
  return false;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// сдвиг/слияние одной линии (массив из 4 чисел) влево
function slideAndMerge(line) {
  const arr = line.filter(x => x !== 0);
  const out = [];
  let i = 0;

  while (i < arr.length) {
    if (i + 1 < arr.length && arr[i] === arr[i + 1]) {
      const a = arr[i];
      const merged = a + arr[i + 1];

      out.push(merged);

      // score: обычно добавляют merged
      score += merged;

      // mathScore: сумма результатов всех слияний (оставляем для "математики")
      mathScore += merged;

      addMathLine(a, a, merged);

      // haptic
      tg?.HapticFeedback?.impactOccurred('light');

      i += 2;
    } else {
      out.push(arr[i]);
      i += 1;
    }
  }

  while (out.length < SIZE) out.push(0);
  return out;
}

function moveLeft() {
  let changed = false;
  for (let r = 0; r < SIZE; r++) {
    const before = grid[r].slice();
    const after = slideAndMerge(before);
    grid[r] = after;
    if (!arraysEqual(before, after)) changed = true;
  }
  return changed;
}

function moveRight() {
  let changed = false;
  for (let r = 0; r < SIZE; r++) {
    const before = grid[r].slice();
    const after = slideAndMerge(before.slice().reverse()).reverse();
    grid[r] = after;
    if (!arraysEqual(before, after)) changed = true;
  }
  return changed;
}

function moveUp() {
  let changed = false;
  for (let c = 0; c < SIZE; c++) {
    const before = [];
    for (let r = 0; r < SIZE; r++) before.push(grid[r][c]);

    const after = slideAndMerge(before);

    for (let r = 0; r < SIZE; r++) grid[r][c] = after[r];
    if (!arraysEqual(before, after)) changed = true;
  }
  return changed;
}

function moveDown() {
  let changed = false;
  for (let c = 0; c < SIZE; c++) {
    const before = [];
    for (let r = 0; r < SIZE; r++) before.push(grid[r][c]);

    const after = slideAndMerge(before.slice().reverse()).reverse();

    for (let r = 0; r < SIZE; r++) grid[r][c] = after[r];
    if (!arraysEqual(before, after)) changed = true;
  }
  return changed;
}

function doMove(dir) {
  const snapshot = JSON.stringify(grid);
  const prevScore = score;
  const prevMath = mathScore;

  let changed = false;
  if (dir === 'L') changed = moveLeft();
  if (dir === 'R') changed = moveRight();
  if (dir === 'U') changed = moveUp();
  if (dir === 'D') changed = moveDown();

  if (!changed) {
    score = prevScore;
    mathScore = prevMath;
    grid = JSON.parse(snapshot);
    return;
  }

  spawnTile();

  if (score > best) {
    best = score;
    saveBest();
  }

  // ✅ отправляем глобальный рекорд сразу, когда он может обновиться
  submitGlobalBestIfNeeded();

  render();
  saveGame();

  if (!canMove()) {
    if (tg?.showPopup) {
      tg.showPopup({
        title: "Игра окончена",
        message: `Score: ${score}\nBest: ${best}\nGlobal Best: ${globalBest || '—'}`,
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
} // ✅ закрыли doMove()

// --- Init game ---
function newGame() {
  clearSave();
  grid = makeEmptyGrid();
  score = 0;
  mathScore = 0;
  mathHistory = [];
  spawnTile();
  spawnTile();
  render();
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
  render();
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

async function submitGlobalBestIfNeeded() {
  if (!Number.isFinite(score)) return;
  if (score <= globalBest) return;
  if (globalBestSubmitting) return;

  globalBestSubmitting = true;

  const user = tg?.initDataUnsafe?.user;
  const payload = {
    score,
    user: user ? {
      id: user.id,
      username: user.username || null,
      name: [user.first_name, user.last_name].filter(Boolean).join(' ')
    } : null
  };

  try {
    const r = await fetch(API_BEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    globalBest = Number(data.best || globalBest);
    globalBestEl.textContent = globalBest ? String(globalBest) : '—';
  } catch (e) {
    // молча
  } finally {
    globalBestSubmitting = false;
  }
}
