// adminPanel.js
(function () {
  const tg = window.Telegram?.WebApp;
  const API_BASE = window.API_BASE || "https://mgt-welding.ru/tg2048-api"; // можно оставить так

  const adminBtn = document.getElementById("adminBtn");
  const panel = document.getElementById("adminPanel");
  const closeBtn = document.getElementById("adminCloseBtn");

  const fromEl = document.getElementById("admFrom");
  const toEl = document.getElementById("admTo");
  const applyBtn = document.getElementById("admApply");

  const kpiEl = document.getElementById("admKpi");

  let chartDaily = null;
  let chartRetention = null;

  function isoDay(d) { return d.toISOString().slice(0, 10); }

  function setDefaultRange() {
    const to = new Date();
    const from = new Date(Date.now() - 6 * 86400000);
    fromEl.value = isoDay(from);
    toEl.value = isoDay(to);
  }

  async function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function ensureChartsLib() {
    if (window.Chart) return;
    await loadScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js");
  }

  async function fetchAdmin(path) {
    if (!tg?.initData) throw new Error("NO_INITDATA");
    const url = `${API_BASE}${path}`;
    const r = await fetch(url, {
      headers: { "X-Tg-Init-Data": tg.initData }
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`HTTP_${r.status} ${text}`);
    }
    return r.json();
  }

  function renderKpi(summary) {
    const cards = [
      ["Всего игроков", summary.total_users],
      ["Новые", summary.new_users],
      ["Активные", summary.active_users],
      ["Игр", summary.games_played],
      ["Средн. score", summary.avg_score],
      ["Средн. длит. (с)", summary.avg_duration_sec],
      ["Средн. ходы", summary.avg_moves],
      ["Global Best", summary.global_best],
    ];

    kpiEl.innerHTML = cards.map(([label, val]) => `
      <div class="kpiCard">
        <div class="kpiLabel">${label}</div>
        <div class="kpiValue">${val}</div>
      </div>
    `).join("");
  }

  function drawDaily(rows) {
    const labels = rows.map(r => r.day);
    const dau = rows.map(r => r.dau);
    const games = rows.map(r => r.games);

    const ctx = document.getElementById("chartDaily").getContext("2d");
    if (chartDaily) chartDaily.destroy();

    chartDaily = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "DAU", data: dau, tension: 0.25 },
          { label: "Games", data: games, tension: 0.25 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true } }
      }
    });
  }

  function drawRetention(ret1, ret7, ret30) {
    const ctx = document.getElementById("chartRetention").getContext("2d");
    if (chartRetention) chartRetention.destroy();

    chartRetention = new Chart(ctx, {
      type: "bar",
      data: {
        labels: ["D+1", "D+7", "D+30"],
        datasets: [{
          label: "Retention %",
          data: [ret1.retention_pct, ret7.retention_pct, ret30.retention_pct]
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true } }
      }
    });
  }

  async function refresh() {
    const from = fromEl.value;
    const to = toEl.value;

    const summary = await fetchAdmin(`/admin/summary?from=${from}&to=${to}`);
    renderKpi(summary);

    const daily = await fetchAdmin(`/admin/daily?from=${from}&to=${to}`);
    await ensureChartsLib();
    drawDaily(daily.rows);

    const ret1 = await fetchAdmin(`/admin/retention?from=${from}&to=${to}&window=1`);
    const ret7 = await fetchAdmin(`/admin/retention?from=${from}&to=${to}&window=7`);
    const ret30 = await fetchAdmin(`/admin/retention?from=${from}&to=${to}&window=30`);
    drawRetention(ret1, ret7, ret30);

    // простые таблицы без табулятора (для старта)
    const top = await fetchAdmin(`/admin/top?limit=20`);
    document.getElementById("admTop").innerHTML =
      `<div style="overflow:auto">
        <table style="width:100%; border-collapse:collapse">
          <thead>
            <tr>
              <th style="text-align:left; padding:6px">#</th>
              <th style="text-align:left; padding:6px">User</th>
              <th style="text-align:left; padding:6px">Best</th>
              <th style="text-align:left; padding:6px">Updated</th>
            </tr>
          </thead>
          <tbody>
            ${top.items.map(r => `
              <tr>
                <td style="padding:6px">${r.rank}</td>
                <td style="padding:6px">${r.username ? "@"+r.username : (r.first_name || r.user_id)}</td>
                <td style="padding:6px">${r.best_score}</td>
                <td style="padding:6px">${r.updated_at}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;

    const sessions = await fetchAdmin(`/admin/sessions?from=${from}&to=${to}&limit=30`);
    document.getElementById("admSessions").innerHTML =
      `<div style="overflow:auto">
        <table style="width:100%; border-collapse:collapse">
          <thead>
            <tr>
              <th style="text-align:left; padding:6px">When</th>
              <th style="text-align:left; padding:6px">User</th>
              <th style="text-align:left; padding:6px">Score</th>
              <th style="text-align:left; padding:6px">Moves</th>
              <th style="text-align:left; padding:6px">Dur(s)</th>
            </tr>
          </thead>
          <tbody>
            ${sessions.rows.map(s => `
              <tr>
                <td style="padding:6px">${s.ended_at}</td>
                <td style="padding:6px">${s.username ? "@"+s.username : (s.first_name || s.user_id)}</td>
                <td style="padding:6px">${s.score_final}</td>
                <td style="padding:6px">${s.moves}</td>
                <td style="padding:6px">${Math.round((s.duration_ms||0)/1000)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
  }

  async function checkAdmin() {
    if (!tg?.initData) return false;
    try {
      const r = await fetch(`${API_BASE}/admin/ping`, { headers: { "X-Tg-Init-Data": tg.initData } });
      return r.ok;
    } catch {
      return false;
    }
  }

  function openPanel() {
    panel.hidden = false;
    refresh().catch(err => {
      panel.innerHTML = `<div style="color:#ffb4b4">Нет доступа / ошибка: ${String(err.message || err)}</div>`;
    });
  }
  function closePanel() { panel.hidden = true; }

  setDefaultRange();

  if (adminBtn) {
    adminBtn.addEventListener("click", () => {
      if (panel.hidden) openPanel();
      else closePanel();
    });
  }
  if (closeBtn) closeBtn.addEventListener("click", closePanel);
  if (applyBtn) applyBtn.addEventListener("click", () => refresh().catch(() => {}));

  // показываем кнопку админки только админу
  checkAdmin().then(isAdmin => {
    if (!adminBtn) return;
    adminBtn.style.display = isAdmin ? "" : "none";
  });
})();
