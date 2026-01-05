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
const soundBtn = document.getElementById('soundBtn');   // ✅ new
const musicBtn = document.getElementById('musicBtn');   // ✅ new

// --- State ---
const SIZE = 4;
const STORAGE_KEY = 'tg2048_v1';
const AUDIO_KEY = `${STORAGE_KEY}_audio`;               // ✅ new

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

// =======================
// AudioManager (SFX + BGM)
// =======================
const AudioManager = (() => {
  const saved = JSON.parse(localStorage.getItem(AUDIO_KEY) || "{}");

  let soundOn = saved.soundOn ?? true;     // эффекты
  let musicOn = saved.musicOn ?? true;     // музыка
  let sfxVolume = saved.sfxVolume ?? 0.8;
  let bgmVolume = saved.bgmVolume ?? 0.35;

  let unlocked = false;

  // BGM
  const bgm = new Audio("audio/bgm.mp3");
  bgm.loop = true;
  bgm.preload = "auto";
  bgm.volume = bgmVolume;

  // Pools for SFX
  const sfxPool = {
    move: makePool("audio/move.mp3", 6),
    merge: makePool("audio/merge.mp3", 8),
    block: makePool("audio/block.mp3", 4),
    click: makePool("audio/click.mp3", 4),
    gameover: makePool("audio/gameover.mp3", 2),
  };

  function makePool(src, size) {
    const arr = [];
    for (let i = 0; i < size; i++) {
      const a = new Audio(src);
      a.preload = "auto";
      a.volume = sfxVolume;
      arr.push(a);
    }
    let idx = 0;
    return {
      play(volOverride) {
        const a = arr[idx];
        idx = (idx + 1) % arr.length;
        try {
          a.pause();
          a.currentTime = 0;
          a.volume = (volOverride ?? sfxVolume);
          a.play().catch(() => {});
        } catch {}
      },
      setVolume(v) {
        arr.forEach(x => x.volume = v);
      }
    };
  }

  function save() {
    localStorage.setItem(AUDIO_KEY, JSON.stringify({
      soundOn, musicOn, sfxVolume, bgmVolume
    }));
  }

  function syncButtons() {
    if (soundBtn) soundBtn.textContent = soundOn ? "🔊" : "🔇";
    if (musicBtn) musicBtn.textContent = musicOn ? "🎵" : "🚫🎵";
  }

  async function unlock() {
    if (unlocked) return;
    unlocked = true;

    // "прогрев" аудио (важно для мобилок)
    try {
      bgm.volume = 0;
      await bgm.play();
      bgm.pause();
      bgm.currentTime = 0;
      bgm.volume = bgmVolume;
    } catch {}

    if (musicOn) startMusic();
  }

  function startMusic() {
  if (!musicOn) return;

  try {
    bgm.volume = bgmVolume;
    bgm.muted = false;

    // иногда помогает “сброс”, если WebView завис
    if (bgm.paused === false) return;

    // важный момент: не трогаем currentTime если файл ещё не прогрузился
    // но если уже был stopMusic — currentTime=0 ок
    const p = bgm.play();
    if (p && typeof p.catch === "function") {
      p.catch((err) => {
        console.warn("BGM play failed:", err?.name, err?.message);
        tg?.showAlert?.(`Музыка не стартует: ${err?.name || 'unknown'}`);
      });
    }
  } catch (e) {
    console.warn("BGM start error:", e);
  }
}


  function stopMusic() {
    try {
      bgm.pause();
      bgm.currentTime = 0;
    } catch {}
  }

  function playSfx(name, volOverride) {
    if (!soundOn || !unlocked) return;
    const p = sfxPool[name];
    if (p) p.play(volOverride);
  }

  function toggleSound() {
    soundOn = !soundOn;
    save();
    syncButtons();
    if (soundOn) playSfx("click", 0.6);
  }

  function toggleMusic() {
    musicOn = !musicOn;
    save();
    syncButtons();
    if (musicOn) startMusic();
    else stopMusic();
  }

  syncButtons();

  return {
    unlock,
    startMusic,
    stopMusic,
    playSfx,
    toggleSound,
    toggleMusic,
    syncButtons,
  };
})();

// Разблокировка звука после первого взаимодействия
window.addEventListener("pointerdown", () => {
  AudioManager.unlock();
}, { once: true });

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
    pendingValue: null,
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
  el.dataset.value = String(v);

  el.style.background = '';
  el.style.color = '';
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

// ресайз
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

// --- HUD ---
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
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!grid[r][c]) return true;
    }
  }
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
  const merges = [];

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

  // Было ли изменение?
  let changed = mergesAll.length > 0;
  if (!changed) {
    for (const t of allTiles) {
      if (t.x !== t.prevX || t.y !== t.prevY) { changed = true; break; }
    }
  }

  // ❗ если ход невозможен — звук "block"
  if (!changed) {
    AudioManager.playSfx("block", 0.6);
    tg?.HapticFeedback?.notificationOccurred?.("warning");
    return;
  }

  // ✅ звук "move" или "merge" (один раз за ход)
  AudioManager.playSfx(mergesAll.length ? "merge" : "move", mergesAll.length ? 0.8 : 0.4);

  grid = newGrid;

  if (score > best) {
    best = score;
    saveBest();
  }

  isAnimating = true;

  for (const t of allTiles) {
    setTileContentAndStyle(t, false);
    setTileTransform(t, 1, false);
  }
  for (const t of removedTiles) {
    setTileContentAndStyle(t, false);
    setTileTransform(t, 1, false);
  }

  setTimeout(() => {
    for (const m of mergesAll) {
      m.into.value = m.newValue;
      m.into.pendingValue = null;

      setTileContentAndStyle(m.into, false);
      bounceTile(m.into);

      removeTileEl(m.from);
    }

    spawnTile(true);

    renderHUD();
    saveGame();

    if (!canMove()) {
      // звук проигрыша + стоп музыки
      AudioManager.playSfx("gameover", 0.9);
      AudioManager.stopMusic();

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
          if (btnId === "new") {
            AudioManager.playSfx("click", 0.7);
            AudioManager.startMusic();
            newGame();
          }
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

  tileLayerEl.innerHTML = '';
  tileEls.clear();

  spawnTile(false);
  spawnTile(false);

  rebuildTilesDOM(true);
  renderHUD();
  saveGame();
}

// ✅ кнопки звука/музыки
soundBtn?.addEventListener("click", () => {
  AudioManager.unlock();
  AudioManager.toggleSound();
});

musicBtn?.addEventListener("click", () => {
  AudioManager.unlock();       // на всякий случай
  AudioManager.toggleMusic();  // переключили состояние

  // ✅ ВАЖНО: стартуем музыку прямо здесь, в жесте клика
  AudioManager.startMusic();
});


// ✅ restart с кликом и запуском музыки
restartBtn?.addEventListener('click', () => {
  AudioManager.unlock();
  AudioManager.playSfx("click", 0.7);
  AudioManager.startMusic();
  newGame();
});

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
  rebuildTilesDOM(true);
  renderHUD();
}

loadGlobalBest();

// Share
shareBtn?.addEventListener('click', () => {
  AudioManager.unlock();
  AudioManager.playSfx("click", 0.7);

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
