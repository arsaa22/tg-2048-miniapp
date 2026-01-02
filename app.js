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
const mathScoreEl = document.getElementById('mathScore');
const mathListEl = document.getElementById('mathList');
const restartBtn = document.getElementById('restartBtn');

// --- State ---
const SIZE = 4;
const STORAGE_KEY = 'tg2048_v1';

let grid = makeEmptyGrid();
let score = 0;
let mathScore = 0; // сумма результатов всех слияний (видимая "просчитанная математика")
let best = Number(localStorage.getItem(`${STORAGE_KEY}_best`) || 0);

// список строк типа "8 + 8 = 16"
let mathHistory = [];

// --- Helpers ---
function makeEmptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function saveBest() {
  localStorage.setItem(`${STORAGE_KEY}_best`, String(best));
}

function addMathLine(a, b, c) {
  // a и b всегда равны в 2048, но оставим универсально
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
  // классика: 90% = 2, 10% = 4
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  return true;
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
      cell.style.color = '#0b1220'; // тёмный текст на ярких плитках
if (v <= 4) cell.style.color = '#ffffff'; // для маленьких оставим белый

      boardEl.appendChild(cell);
    }
  }

  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  mathScoreEl.textContent = String(mathScore);

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

function tileBg(v) {
  if (!v) return '#111827'; // пустая клетка (тёмная)

  // яркая палитра как в "блок 2048" играх
  const map = {
    2:    '#22c55e', // ярко-зелёный
    4:    '#3b82f6', // ярко-синий
    8:    '#f59e0b', // оранжевый
    16:   '#ef4444', // красный
    32:   '#a855f7', // фиолетовый
    64:   '#06b6d4', // бирюзовый
    128:  '#eab308', // жёлтый
    256:  '#fb7185', // розовый
    512:  '#14b8a6', // зелёно-бирюзовый
    1024: '#f97316', // ярко-оранжевый
    2048: '#84cc16', // лайм
  };

  // для значений больше 2048 — делаем "неон" по циклу
  return map[v] || '#ffffff';
}

function canMove() {
  // есть пустые клетки
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (grid[r][c] === 0) return true;
  }
  // есть соседние равные
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const v = grid[r][c];
    if (r + 1 < SIZE && grid[r + 1][c] === v) return true;
    if (c + 1 < SIZE && grid[r][c + 1] === v) return true;
  }
  return false;
}

// сдвиг/слияние одной линии (массив из 4 чисел) влево
function slideAndMerge(line) {
  const arr = line.filter(x => x !== 0);
  const out = [];
  let i = 0;

  while (i < arr.length) {
    if (i + 1 < arr.length && arr[i] === arr[i + 1]) {
      const a = arr[i];
      const merged = a + arr[i + 1]; // математика
      out.push(merged);

      // score: обычно добавляют merged
      score += merged;

      // mathScore: считаем "просчитанную математику" (сумма результатов всех слияний)
      mathScore += merged;

      // история операций
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

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
    // вернём score обратно, если вдруг не менялось (на всякий)
    score = prevScore;
    mathScore = prevMath;
    grid = JSON.parse(snapshot);
    return;
  }

  spawnTile();

  if (score > best) { best = score; saveBest(); }

  render();

  if (!canMove()) {
    setTimeout(() => alert('Игра окончена!'), 50);
  }
}

// --- Init game ---
function newGame() {
  grid = makeEmptyGrid();
  score = 0;
  mathScore = 0;
  mathHistory = [];
  spawnTile();
  spawnTile();
  render();
}

restartBtn.addEventListener('click', newGame);

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
  if (Math.max(ax, ay) < 25) return; // маленькое движение — игнор

  if (ax > ay) {
    doMove(dx > 0 ? 'R' : 'L');
  } else {
    doMove(dy > 0 ? 'D' : 'U');
  }
});

newGame();