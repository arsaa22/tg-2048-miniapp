// adminPanel.js
(function () {
  const tg = window.Telegram?.WebApp;
  const API_BASE = window.API_BASE || "https://mgt-welding.ru/tg2048-api";

  const fromEl = document.getElementById("admFrom");
  const toEl = document.getElementById("admTo");
  const applyBtn = document.getElementById("admApply");

  const kpiEl = document.getElementById("admKpi");
  const errEl = document.getElementById("admError");

  const backBtn = document.getElementById("backBtn");

  let chartDaily = null;
  let chartRetention = null;

  function showError(msg) {
    if (!errEl) return;
    errEl.hidden = false;
    errEl.textContent = msg;
  }
  function hideError() {
    if (!errEl) return;
    errEl.hidden = true;
    errEl.textContent = "";
  }

  function isoDay(d) { return d.toISOString().slice(0, 10); }

  function setDefaultRange() {
    const to = new Date();
    const from = new Date(Date.now() - 6 * 86400000);
    if (fromEl) fromEl.value = isoDay(from);
    if (toEl) toEl.value = isoDay(to);
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
    const r = await fetch(url, { headers: { "X-Tg-Init-Data": tg.initData } });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`HTTP_${r.status} ${text}`);
    }
    return r.json();
  }

  function renderKpi(summary) {
    if (!kpiEl) return;

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
        <div class="kpiValue">${val ?? "—"}</div>
      </div>
    `).join("");
  }

  function drawDaily(rows) {
    const canvas = document.getElementById("chartDaily");
    if (!canvas) return;

    const labels = rows.map(r => r.day);
    const dau = rows.map(r => r.dau);
    const games = rows.map(r => r.games);

    const ctx = canvas.getContext("2d");
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
    const canvas = document.getElementById("chartRetention");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
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

  function renderTop(top) {
    const root = document.getElementById("admTop");
    if (!root) return;

    root.innerHTML = `
      <div class="adminTableWrap">
        <table class="adminTable">
          <thead>
            <tr>
              <th>#</th>
              <th>User</th>
              <th>Best</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            ${(top.items || []).map(r => `
              <tr>
                <td>${r.rank}</td>
                <td>${r.username ? "@"+r.username : (r.first_name || r.user_id)}</td>
                <td>${r.best_score}</td>
                <td>${r.updated_at}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderSessions(sessions) {
    const root = document.getElementById("admSessions");
    if (!root) return;

    root.innerHTML = `
      <div class="adminTableWrap">
        <table class="adminTable">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Score</th>
              <th>Moves</th>
              <th>Dur(s)</th>
            </tr>
          </thead>
          <tbody>
            ${(sessions.rows || []).map(s => `
              <tr>
                <td>${s.ended_at}</td>
                <td>${s.username ? "@"+s.username : (s.first_name || s.user_id)}</td>
                <td>${s.score_final}</td>
                <td>${s.moves}</td>
                <td>${Math.round((s.duration_ms||0)/1000)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
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

  async function refresh() {
    hideError();

    const from = fromEl?.value;
    const to = toEl?.value;

    await ensureChartsLib();

    const summary = await fetchAdmin(`/admin/summary?from=${from}&to=${to}`);
    renderKpi(summary);

    const daily = await fetchAdmin(`/admin/daily?from=${from}&to=${to}`);
    drawDaily(daily.rows || []);

    const ret1 = await fetchAdmin(`/admin/retention?from=${from}&to=${to}&window=1`);
    const ret7 = await fetchAdmin(`/admin/retention?from=${from}&to=${to}&window=7`);
    const ret30 = await fetchAdmin(`/admin/retention?from=${from}&to=${to}&window=30`);
    drawRetention(ret1, ret7, ret30);

    const top = await fetchAdmin(`/admin/top?limit=20`);
    renderTop(top);

    const sessions = await fetchAdmin(`/admin/sessions?from=${from}&to=${to}&limit=30`);
    renderSessions(sessions);
  }

  // Back button
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      // самый простой вариант навигации назад
      location.href = "index.html";
    });
  }

  // Init
  setDefaultRange();

  (async () => {
    const ok = await checkAdmin();
    if (!ok) {
      showError("Нет доступа к админке (или страница открыта не из Telegram Mini App).");
      return;
    }
    refresh().catch(err => showError(String(err.message || err)));
  })();

  if (applyBtn) applyBtn.addEventListener("click", () => {
    refresh().catch(err => showError(String(err.message || err)));
  });
})();
