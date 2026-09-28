// ============================================================
// Lógica principal de la app
// ============================================================

// Red de seguridad: si algo revienta antes de que la app termine de
// arrancar, en vez de quedarnos con una pantalla en blanco, mostramos
// el error tal cual en la propia pantalla (para poder diagnosticarlo
// sin necesidad de abrir las herramientas de desarrollador de Safari).
function showFatalError(msg) {
  try {
    const grid = document.getElementById('category-grid');
    if (grid) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; background:#3B0F0F; border:1px solid #7F1D1D; color:#FCA5A5; border-radius:14px; padding:16px; font-size:13px; white-space:pre-wrap; text-align:left;">
          <strong>Error al cargar la app:</strong>\n${msg}
        </div>`;
    }
  } catch (e) { /* si esto también falla, no hay nada más que hacer */ }
}

window.addEventListener('error', (e) => {
  showFatalError((e && e.message) || 'Error desconocido de JavaScript');
});
window.addEventListener('unhandledrejection', (e) => {
  showFatalError((e && e.reason && (e.reason.message || String(e.reason))) || 'Promesa rechazada sin motivo indicado');
});

const QUEUE_KEY = 'habit_tracker_queue_v1';
const DEVICE_KEY = 'habit_tracker_device_v1';

let supabase = null;
let currentCategory = null;
let statsPeriod = 'day';
let donutChart = null;
let trendChart = null;
let allLogsCache = []; // cache local de logs ya traídos, para pintar stats sin re-pedir siempre

// ---------- Utilidades ----------

function getDevice() {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) {
      const isTablet = /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) && window.innerWidth > 700);
      d = isTablet ? 'ipad' : 'iphone';
      localStorage.setItem(DEVICE_KEY, d);
    }
    return d;
  } catch (e) { return 'desconocido'; }
}

function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date) {
  const d = startOfDay(date);
  const day = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - day);
  return d;
}

function startOfMonth(date) {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------- Supabase ----------

function initSupabase() {
  const url = (SUPABASE_URL || '').trim();
  const key = (SUPABASE_ANON_KEY || '').trim();

  if (!url || url.includes('PON_AQUI') || !key || key.includes('PON_AQUI') || !window.supabase) {
    console.warn('Supabase no está configurado todavía (edita config.js).');
    return null;
  }
  try {
    return window.supabase.createClient(url, key);
  } catch (e) {
    console.error('Error creando el cliente de Supabase. Revisa SUPABASE_URL en config.js:', e);
    return null;
  }
}

function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch (e) { return []; }
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

async function logActivity(categoryId, activity, isCustom) {
  const entry = {
    category_id: categoryId,
    activity: activity,
    is_custom: !!isCustom,
    device: getDevice(),
    logged_at: new Date().toISOString()
  };

  // Guarda localmente de inmediato para que las estadísticas se vean al instante
  allLogsCache.push({ ...entry, id: 'local-' + Date.now() });

  if (navigator.onLine && supabase) {
    const { error } = await supabase.from('activity_logs').insert(entry);
    if (error) {
      console.error('Error al insertar, se encola:', error);
      const q = getQueue();
      q.push(entry);
      saveQueue(q);
    }
  } else {
    const q = getQueue();
    q.push(entry);
    saveQueue(q);
  }

  updateSyncBadge();
}

async function flushQueue() {
  if (!navigator.onLine || !supabase) return;
  const q = getQueue();
  if (q.length === 0) return;
  const remaining = [];
  for (const entry of q) {
    const { error } = await supabase.from('activity_logs').insert(entry);
    if (error) remaining.push(entry);
  }
  saveQueue(remaining);
  updateSyncBadge();
  if (remaining.length === 0) await loadLogs();
}

function updateSyncBadge() {
  const badge = document.getElementById('sync-badge');
  const q = getQueue();
  if (!supabase) {
    badge.textContent = '⚠️ Falta configurar Supabase en config.js';
  } else if (q.length > 0) {
    badge.textContent = `⏳ ${q.length} registro(s) pendientes de sincronizar`;
  } else if (!navigator.onLine) {
    badge.textContent = '📴 Sin conexión — se sincronizará al volver';
  } else {
    badge.textContent = '';
  }
}

async function loadLogs() {
  if (!supabase) return;
  const since = new Date();
  since.setDate(since.getDate() - 90); // suficiente para día/semana/mes + tendencia
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .gte('logged_at', since.toISOString())
    .order('logged_at', { ascending: false });
  if (!error && data) {
    allLogsCache = data;
    renderHome();
    if (document.getElementById('view-stats').classList.contains('active')) renderStats();
  }
}

// ---------- Vistas / navegación ----------

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.remove('active'));
  const navBtn = document.querySelector(`.bottom-nav button[data-view="${id}"]`);
  if (navBtn) navBtn.classList.add('active');
}

function renderHome() {
  const grid = document.getElementById('category-grid');
  grid.innerHTML = '';
  const today = startOfDay(new Date());

  CATEGORIES.forEach((cat) => {
    const countToday = allLogsCache.filter(
      (l) => l.category_id === cat.id && new Date(l.logged_at) >= today
    ).length;

    const btn = document.createElement('button');
    btn.className = 'category-card';
    btn.style.background = cat.color;
    btn.innerHTML = `
      <span class="emoji">${cat.icon}</span>
      <div>
        <div class="cat-name">${cat.name}</div>
        <div class="cat-count">${countToday} hoy</div>
      </div>
    `;
    btn.addEventListener('click', () => openCategory(cat.id));
    grid.appendChild(btn);
  });
}

function openCategory(categoryId) {
  currentCategory = categoryId;
  const cat = getCategory(categoryId);
  document.getElementById('activities-title').innerHTML =
    `<span class="dot" style="background:${cat.color}"></span> ${cat.icon} ${cat.name}`;

  const list = document.getElementById('activity-list');
  list.innerHTML = '';
  const today = startOfDay(new Date());

  cat.activities.forEach((activity) => {
    const countToday = allLogsCache.filter(
      (l) => l.category_id === categoryId && l.activity === activity && new Date(l.logged_at) >= today
    ).length;

    const btn = document.createElement('button');
    btn.className = 'activity-btn';
    btn.innerHTML = `<span>${activity}</span>${countToday > 0 ? `<span class="today-badge">${countToday} hoy</span>` : ''}`;
    btn.addEventListener('click', () => handleLog(categoryId, activity, false));
    list.appendChild(btn);
  });

  const customBtn = document.createElement('button');
  customBtn.className = 'activity-btn custom-btn';
  customBtn.innerHTML = `<span>+ Actividad personalizada</span>`;
  customBtn.addEventListener('click', openCustomModal);
  list.appendChild(customBtn);

  showView('view-activities');
}

async function handleLog(categoryId, activity, isCustom) {
  const cat = getCategory(categoryId);
  await logActivity(categoryId, activity, isCustom);
  showConfirmation(cat, activity);
}

function showConfirmation(cat, activity) {
  const overlay = document.getElementById('confirm-overlay');
  document.getElementById('confirm-checkmark').style.background = cat.color;
  document.getElementById('confirm-text').textContent = `${cat.icon} ${activity}`;
  document.getElementById('confirm-sub').textContent = 'Registrado';
  overlay.classList.add('show');
  if (navigator.vibrate) navigator.vibrate(15);

  setTimeout(() => {
    overlay.classList.remove('show');
    showView('view-home');
    renderHome();
  }, 700);
}

// ---------- Modal actividad personalizada ----------

function openCustomModal() {
  document.getElementById('custom-input').value = '';
  document.getElementById('modal-overlay').classList.add('show');
  setTimeout(() => document.getElementById('custom-input').focus(), 150);
}

function closeCustomModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}

// ---------- Estadísticas ----------

function filterByPeriod(logs, period) {
  const now = new Date();
  let from;
  if (period === 'day') from = startOfDay(now);
  else if (period === 'week') from = startOfWeek(now);
  else from = startOfMonth(now);
  return logs.filter((l) => new Date(l.logged_at) >= from);
}

function renderStats() {
  const filtered = filterByPeriod(allLogsCache, statsPeriod);
  renderDonut(filtered);
  renderTotals(filtered);
  renderTrend();
}

function renderDonut(logs) {
  const ctx = document.getElementById('chart-donut');
  const counts = CATEGORIES.map((c) => logs.filter((l) => l.category_id === c.id).length);
  const hasData = counts.some((c) => c > 0);

  if (donutChart) donutChart.destroy();

  if (!hasData) {
    ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
  }

  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: CATEGORIES.map((c) => c.name),
      datasets: [{
        data: hasData ? counts : CATEGORIES.map(() => 1),
        backgroundColor: hasData
          ? CATEGORIES.map((c) => c.color)
          : CATEGORIES.map(() => '#2D3B52'),
        borderWidth: 0
      }]
    },
    options: {
      cutout: '68%',
      plugins: { legend: { display: false }, tooltip: { enabled: hasData } }
    }
  });

  const legend = document.getElementById('donut-legend');
  legend.innerHTML = CATEGORIES.map(
    (c) => `<span class="legend-item"><span class="legend-dot" style="background:${c.color}"></span>${c.name}</span>`
  ).join('');
}

function renderTotals(logs) {
  const title = document.getElementById('totals-title');
  const labelMap = { day: 'Totales de hoy', week: 'Totales de la semana', month: 'Totales del mes' };
  title.textContent = labelMap[statsPeriod];

  const counts = CATEGORIES.map((c) => ({
    cat: c,
    count: logs.filter((l) => l.category_id === c.id).length
  }));
  const max = Math.max(1, ...counts.map((c) => c.count));

  const container = document.getElementById('totals-list');
  if (logs.length === 0) {
    container.innerHTML = '<div class="empty-state">Todavía no hay registros en este periodo.</div>';
    return;
  }

  container.innerHTML = counts
    .sort((a, b) => b.count - a.count)
    .map(
      (c) => `
      <div class="total-row">
        <span class="cat-label"><span class="dot" style="background:${c.cat.color}"></span>${c.cat.icon} ${c.cat.name}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(c.count / max) * 100}%;background:${c.cat.color}"></div></div>
        <span class="count">${c.count}</span>
      </div>`
    )
    .join('');
}

function renderTrend() {
  const ctx = document.getElementById('chart-trend');
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(startOfDay(d));
  }

  const datasets = CATEGORIES.map((cat) => ({
    label: cat.name,
    data: days.map((day) => {
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      return allLogsCache.filter(
        (l) => l.category_id === cat.id && new Date(l.logged_at) >= day && new Date(l.logged_at) < next
      ).length;
    }),
    borderColor: cat.color,
    backgroundColor: hexToRgba(cat.color, 0.15),
    tension: 0.3,
    pointRadius: 0,
    borderWidth: 2
  }));

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: days.map((d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })),
      datasets
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#94A3B8', maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }, grid: { display: false } },
        y: { ticks: { color: '#94A3B8', precision: 0 }, grid: { color: '#2D3B52' } }
      }
    }
  });
}

// ---------- Registro rápido vía URL (Atajos de iOS / Botón de Acción) ----------
// Ejemplo de URL: https://tu-dominio/index.html?log=salud&activity=Beber%20agua
function handleUrlAutoLog() {
  const params = new URLSearchParams(window.location.search);
  const categoryId = params.get('log');
  const activity = params.get('activity');
  if (categoryId && activity && getCategory(categoryId)) {
    handleLog(categoryId, decodeURIComponent(activity), false);
    // Limpia la URL para que un refresco no vuelva a registrar
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ---------- Listeners ----------

function setupListeners() {
  document.getElementById('btn-back-home').addEventListener('click', () => {
    showView('view-home');
    renderHome();
  });

  document.querySelectorAll('.bottom-nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      showView(view);
      if (view === 'view-home') renderHome();
      if (view === 'view-stats') renderStats();
    });
  });

  document.getElementById('btn-refresh').addEventListener('click', loadLogs);
  document.getElementById('btn-refresh-stats').addEventListener('click', loadLogs);

  document.getElementById('btn-cancel-custom').addEventListener('click', closeCustomModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeCustomModal();
  });
  document.getElementById('btn-save-custom').addEventListener('click', () => {
    const val = document.getElementById('custom-input').value.trim();
    if (!val) return;
    closeCustomModal();
    handleLog(currentCategory, val, true);
  });

  document.querySelectorAll('.period-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      statsPeriod = btn.dataset.period;
      renderStats();
    });
  });

  window.addEventListener('online', () => { flushQueue(); updateSyncBadge(); });
  window.addEventListener('offline', updateSyncBadge);
}

// ---------- Arranque ----------

async function init() {
  try {
    supabase = initSupabase();
  } catch (e) {
    console.error('Fallo al inicializar Supabase:', e);
    supabase = null;
  }

  setupListeners();
  renderHome(); // pinta las categorías de inmediato, con o sin Supabase
  updateSyncBadge();

  if (supabase) {
    try {
      await loadLogs();
      await flushQueue();
    } catch (e) {
      console.error('Fallo al sincronizar con Supabase, la app sigue en modo local:', e);
    }
  }

  try {
    handleUrlAutoLog();
  } catch (e) {
    console.error('Fallo en el registro automático por URL:', e);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('SW error', e));
  }

  // Si Supabase todavía no había terminado de cargar desde su CDN,
  // reintenta un par de veces en segundo plano sin bloquear la app.
  if (!supabase) {
    [2000, 5000].forEach((delay) => {
      setTimeout(async () => {
        if (supabase) return; // ya conectó en un intento anterior
        try {
          const client = initSupabase();
          if (client) {
            supabase = client;
            await loadLogs();
            await flushQueue();
            updateSyncBadge();
          }
        } catch (e) {
          console.warn('Reintento de conexión con Supabase fallido:', e);
        }
      }, delay);
    });
  }
}

init().catch((e) => {
  console.error('Fallo crítico al arrancar la app:', e);
  showFatalError((e && e.message) || String(e));
});
