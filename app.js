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

let db = null;
let lastSyncError = '';
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

// Una actividad en config.js puede ser un texto simple ('Beber agua')
// o un objeto con objetivo semanal ({ name: 'Revisión médica', timesPerWeek: 1 }).
function activityName(a) {
  return typeof a === 'string' ? a : a.name;
}
function activityTimesPerWeek(a) {
  return typeof a === 'string' ? null : (a.timesPerWeek || null);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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

// Inserta en Supabase. Si la base de datos todavía no tiene la columna
// "note" (migración pendiente), reintenta sin ese campo para no perder
// el registro. Devuelve el error final (o null si se guardó).
async function insertLog(entry) {
  lastSyncError = '';
  let { error } = await db.from('activity_logs').insert(entry);
  if (error && /note/i.test((error.message || '') + (error.details || '') + (error.hint || ''))) {
    const { note, ...sinNota } = entry;
    ({ error } = await db.from('activity_logs').insert(sinNota));
    if (!error) lastSyncError = 'Falta la columna "note" en Supabase: las notas no se guardan (ejecuta la migración SQL).';
  }
  if (error) lastSyncError = error.message || String(error);
  return error;
}

async function logActivity(categoryId, activity, isCustom, note) {
  const entry = {
    category_id: categoryId,
    activity: activity,
    is_custom: !!isCustom,
    note: note ? String(note).slice(0, 200) : null,
    device: getDevice(),
    logged_at: new Date().toISOString()
  };

  // Guarda localmente de inmediato para que las estadísticas se vean al instante
  allLogsCache.push({ ...entry, id: 'local-' + Date.now() });

  if (navigator.onLine && db) {
    const error = await insertLog(entry);
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
  if (!navigator.onLine || !db) return;
  const q = getQueue();
  if (q.length === 0) return;
  const remaining = [];
  for (const entry of q) {
    const error = await insertLog(entry);
    if (error) remaining.push(entry);
  }
  saveQueue(remaining);
  updateSyncBadge();
  if (remaining.length === 0) await loadLogs();
}

function updateSyncBadge() {
  const badge = document.getElementById('sync-badge');
  const q = getQueue();
  if (!db) {
    badge.textContent = '⚠️ Falta configurar Supabase en config.js';
  } else if (q.length > 0) {
    badge.textContent = `⏳ ${q.length} registro(s) pendientes de sincronizar` + (lastSyncError ? ` — ${lastSyncError}` : '');
  } else if (lastSyncError) {
    badge.textContent = `⚠️ ${lastSyncError}`;
  } else if (!navigator.onLine) {
    badge.textContent = '📴 Sin conexión — se sincronizará al volver';
  } else {
    badge.textContent = '';
  }
}

async function loadLogs() {
  if (!db) return;
  const since = new Date();
  since.setDate(since.getDate() - 90); // suficiente para día/semana/mes + tendencia
  const { data, error } = await db
    .from('activity_logs')
    .select('*')
    .gte('logged_at', since.toISOString())
    .order('logged_at', { ascending: false });
  if (error) {
    lastSyncError = error.message || String(error);
    updateSyncBadge();
    return;
  }
  if (data) {
    // Los registros que aún no llegaron a Supabase se siguen mostrando
    const pendientes = getQueue().map((e, i) => ({ ...e, id: 'pending-' + i }));
    allLogsCache = data.concat(pendientes);
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
    const { done, total } = getCompletionForDay(cat.id, today);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const streak = getCategoryStreak(cat.id);

    const btn = document.createElement('button');
    btn.className = 'category-card';
    btn.style.background = cat.color;

    const ringHtml =
      total > 0
        ? `<div class="progress-ring" style="background: conic-gradient(#fff ${pct}%, rgba(255,255,255,0.28) 0)">
             <div class="progress-ring-hole">${done}/${total}</div>
           </div>`
        : `<div class="progress-ring progress-ring-empty"><div class="progress-ring-hole">${done}</div></div>`;

    btn.innerHTML = `
      <div class="card-top-row">
        <span class="emoji">${cat.icon}</span>
        ${ringHtml}
      </div>
      <div>
        <div class="cat-name">${cat.name}</div>
        <div class="cat-count">${total > 0 ? `${done} de ${total} hoy` : `${done} hoy`}</div>
        ${streak > 0 ? `<div class="streak-badge">🔥 ${streak} ${streak === 1 ? 'día' : 'días'}</div>` : ''}
      </div>
    `;
    btn.addEventListener('click', () => openCategory(cat.id));
    grid.appendChild(btn);
  });
}

// Cuenta cuántas actividades PREDETERMINADAS distintas de una categoría
// tienen al menos un registro en el día indicado, y el total de
// actividades predeterminadas de esa categoría (las personalizadas no
// cuentan para el total, ya que no forman parte de una lista cerrada).
function getCompletionForDay(categoryId, dayStart) {
  const cat = getCategory(categoryId);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const logsThatDay = allLogsCache.filter(
    (l) => l.category_id === categoryId && new Date(l.logged_at) >= dayStart && new Date(l.logged_at) < dayEnd
  );

  const loggedActivities = new Set(logsThatDay.map((l) => l.activity));
  const total = cat.activities.length;
  const done =
    total > 0
      ? cat.activities.filter((a) => loggedActivities.has(activityName(a))).length
      : loggedActivities.size;

  return { done, total };
}

// Días consecutivos con al menos una actividad registrada en la
// categoría, terminando hoy (si ya registraste algo hoy) o ayer (si
// todavía no has registrado nada hoy, para no "romper" la racha antes
// de tiempo solo porque aún es temprano).
function getCategoryStreak(categoryId) {
  let streak = 0;
  const day = startOfDay(new Date());
  const todayDone = getCompletionForDay(categoryId, day).done > 0;
  if (!todayDone) day.setDate(day.getDate() - 1);

  while (true) {
    const { done } = getCompletionForDay(categoryId, day);
    if (done === 0) break;
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

function openCategory(categoryId) {
  currentCategory = categoryId;
  const cat = getCategory(categoryId);
  document.getElementById('activities-title').innerHTML =
    `<span class="dot" style="background:${cat.color}"></span> ${cat.icon} ${cat.name}`;

  const list = document.getElementById('activity-list');
  list.innerHTML = '';
  const today = startOfDay(new Date());
  const { done, total } = getCompletionForDay(categoryId, today);

  if (total > 0) {
    const pct = Math.round((done / total) * 100);
    const progressHeader = document.createElement('div');
    progressHeader.className = 'day-progress-header';
    progressHeader.innerHTML = `
      <div class="day-progress-label">${done} de ${total} completadas hoy</div>
      <div class="day-progress-track"><div class="day-progress-fill" style="width:${pct}%;background:${cat.color}"></div></div>
    `;
    list.appendChild(progressHeader);
  }

  cat.activities.forEach((a) => {
    const name = activityName(a);
    const timesPerWeek = activityTimesPerWeek(a);
    const logsToday = allLogsCache.filter(
      (l) => l.category_id === categoryId && l.activity === name && new Date(l.logged_at) >= today
    );
    const isDone = logsToday.length > 0;

    let badgeHtml = '';
    if (timesPerWeek) {
      const weekStart = startOfWeek(new Date());
      const logsThisWeek = allLogsCache.filter(
        (l) => l.category_id === categoryId && l.activity === name && new Date(l.logged_at) >= weekStart
      );
      const daysThisWeek = new Set(logsThisWeek.map((l) => startOfDay(new Date(l.logged_at)).getTime())).size;
      const metGoal = daysThisWeek >= timesPerWeek;
      badgeHtml = `<span class="today-badge${metGoal ? ' badge-met' : ''}">${daysThisWeek}/${timesPerWeek} esta semana</span>`;
    } else if (logsToday.length > 0) {
      badgeHtml = `<span class="today-badge">${logsToday.length} hoy</span>`;
    }

    const row = document.createElement('div');
    row.className = 'activity-row' + (isDone ? ' activity-done' : '');
    row.innerHTML = `
      <button type="button" class="activity-main">
        <span class="check-circle">${isDone ? '✓' : ''}</span>
        <span class="activity-name">${name}</span>
      </button>
      <div class="activity-right">
        ${badgeHtml}
        <button type="button" class="note-btn" aria-label="Añadir nota">⋯</button>
      </div>
    `;
    row.querySelector('.activity-main').addEventListener('click', () => handleLog(categoryId, name, false));
    row.querySelector('.note-btn').addEventListener('click', () => openNoteModal(categoryId, name, false));
    list.appendChild(row);
  });

  const customBtn = document.createElement('button');
  customBtn.className = 'activity-btn custom-btn';
  customBtn.innerHTML = `<span>+ Actividad personalizada</span>`;
  customBtn.addEventListener('click', openCustomModal);
  list.appendChild(customBtn);

  showView('view-activities');
}

async function handleLog(categoryId, activity, isCustom, note) {
  const cat = getCategory(categoryId);
  await logActivity(categoryId, activity, isCustom, note);
  showConfirmation(cat, activity, note);
}

function showConfirmation(cat, activity, note) {
  const overlay = document.getElementById('confirm-overlay');
  document.getElementById('confirm-checkmark').style.background = cat.color;
  document.getElementById('confirm-text').textContent = `${cat.icon} ${activity}`;
  document.getElementById('confirm-sub').textContent = note ? note : 'Registrado';
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
  document.getElementById('custom-note-input').value = '';
  document.getElementById('modal-overlay').classList.add('show');
  setTimeout(() => document.getElementById('custom-input').focus(), 150);
}

function closeCustomModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}

// ---------- Modal de nota rápida ----------

let noteModalContext = null;

function openNoteModal(categoryId, activity, isCustom) {
  noteModalContext = { categoryId, activity, isCustom };
  document.getElementById('note-modal-title').textContent = activity;
  document.getElementById('note-input').value = '';
  document.getElementById('note-modal-overlay').classList.add('show');
  setTimeout(() => document.getElementById('note-input').focus(), 150);
}

function closeNoteModal() {
  document.getElementById('note-modal-overlay').classList.remove('show');
  noteModalContext = null;
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
  renderHeatmap();
  renderTrend();
  renderCorrelations();
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

// ---------- Mapa de calor mensual ----------

let heatmapCategoryId = null;

function renderHeatmapPicker() {
  if (!heatmapCategoryId) heatmapCategoryId = CATEGORIES[0].id;
  const picker = document.getElementById('heatmap-category-picker');
  picker.innerHTML = CATEGORIES.map(
    (c) => `
      <button type="button" class="heatmap-pill${c.id === heatmapCategoryId ? ' active' : ''}"
        data-cat="${c.id}" style="--pill-color:${c.color}">${c.icon} ${c.name}</button>`
  ).join('');
  picker.querySelectorAll('.heatmap-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      heatmapCategoryId = btn.dataset.cat;
      document.getElementById('heatmap-detail').innerHTML = '';
      renderHeatmap();
    });
  });
}

function renderHeatmap() {
  renderHeatmapPicker();
  const cat = getCategory(heatmapCategoryId);
  const now = new Date();
  const monthStart = startOfMonth(now);

  document.getElementById('heatmap-month-label').textContent =
    now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const grid = document.getElementById('heatmap-grid');
  grid.innerHTML = '';

  ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach((l) => {
    const el = document.createElement('div');
    el.className = 'heatmap-dow';
    el.textContent = l;
    grid.appendChild(el);
  });

  const firstDow = (monthStart.getDay() + 6) % 7; // lunes = 0
  for (let i = 0; i < firstDow; i++) {
    const el = document.createElement('div');
    el.className = 'heatmap-cell heatmap-cell-empty';
    grid.appendChild(el);
  }

  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const todayKey = startOfDay(now).getTime();

  for (let d = 1; d <= daysInMonth; d++) {
    const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
    const { done, total } = getCompletionForDay(heatmapCategoryId, dayDate);
    const pct = total > 0 ? done / total : done > 0 ? 1 : 0;
    const isFuture = dayDate.getTime() > todayKey;

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'heatmap-cell' + (dayDate.getTime() === todayKey ? ' heatmap-cell-today' : '');
    cell.textContent = String(d);

    if (isFuture) {
      cell.classList.add('heatmap-cell-future');
      cell.disabled = true;
    } else {
      cell.style.background = pct > 0 ? hexToRgba(cat.color, 0.18 + pct * 0.72) : 'rgba(255,255,255,0.05)';
      cell.addEventListener('click', () => showHeatmapDetail(heatmapCategoryId, dayDate));
    }
    grid.appendChild(cell);
  }
}

function showHeatmapDetail(categoryId, dayDate) {
  const dayStart = startOfDay(dayDate);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const logs = allLogsCache
    .filter((l) => l.category_id === categoryId && new Date(l.logged_at) >= dayStart && new Date(l.logged_at) < dayEnd)
    .sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at));

  const detail = document.getElementById('heatmap-detail');
  const dateLabel = dayDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  if (logs.length === 0) {
    detail.innerHTML = `<div class="heatmap-detail-date">${dateLabel}</div><div class="empty-state" style="padding:8px 0;">Sin registros ese día.</div>`;
    return;
  }

  detail.innerHTML = `
    <div class="heatmap-detail-date">${dateLabel}</div>
    ${logs
      .map(
        (l) => `
      <div class="heatmap-detail-item">
        ${escapeHtml(l.activity)}${l.note ? ` — <span class="heatmap-detail-note">${escapeHtml(l.note)}</span>` : ''}
      </div>`
      )
      .join('')}
  `;
}

// ---------- Correlaciones entre categorías ----------

function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n === 0) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

function renderCorrelations() {
  const container = document.getElementById('correlations-list');
  const catsWithActivities = CATEGORIES.filter((c) => c.activities.length > 0);
  const MIN_DAYS = 14;

  if (allLogsCache.length === 0) {
    container.innerHTML = '<div class="empty-state">Aún no hay registros suficientes.</div>';
    return;
  }

  const oldestLogMs = allLogsCache.reduce((min, l) => Math.min(min, new Date(l.logged_at).getTime()), Date.now());
  const daysOfHistory = Math.floor((Date.now() - oldestLogMs) / 86400000) + 1;

  if (daysOfHistory < MIN_DAYS || catsWithActivities.length < 2) {
    container.innerHTML = `<div class="empty-state">Sigue registrando unos días más para ver patrones (mínimo ${MIN_DAYS} días de historial; llevas ${daysOfHistory}).</div>`;
    return;
  }

  const rangeDays = Math.min(daysOfHistory, 60);
  const days = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(startOfDay(d));
  }

  const seriesByCategory = {};
  catsWithActivities.forEach((cat) => {
    seriesByCategory[cat.id] = days.map((day) => {
      const { done, total } = getCompletionForDay(cat.id, day);
      return total > 0 ? done / total : 0;
    });
  });

  const pairs = [];
  for (let i = 0; i < catsWithActivities.length; i++) {
    for (let j = i + 1; j < catsWithActivities.length; j++) {
      const a = catsWithActivities[i];
      const b = catsWithActivities[j];
      const r = pearsonCorrelation(seriesByCategory[a.id], seriesByCategory[b.id]);
      if (!isNaN(r) && Math.abs(r) >= 0.3) pairs.push({ a, b, r });
    }
  }
  pairs.sort((p1, p2) => Math.abs(p2.r) - Math.abs(p1.r));

  if (pairs.length === 0) {
    container.innerHTML = '<div class="empty-state">Todavía no se detectan patrones claros entre categorías.</div>';
    return;
  }

  container.innerHTML = pairs
    .slice(0, 3)
    .map((p) => {
      const strength = Math.abs(p.r) >= 0.6 ? 'fuerte' : 'moderada';
      const direction =
        p.r > 0
          ? `cuando completas más <strong>${p.a.name}</strong>, también sueles completar más <strong>${p.b.name}</strong>`
          : `cuando completas más <strong>${p.a.name}</strong>, sueles completar menos <strong>${p.b.name}</strong>`;
      return `<div class="correlation-item">${p.a.icon}${p.b.icon} Correlación ${strength}: ${direction}.</div>`;
    })
    .join('');
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
    const note = document.getElementById('custom-note-input').value.trim();
    closeCustomModal();
    handleLog(currentCategory, val, true, note || null);
  });

  document.getElementById('btn-cancel-note').addEventListener('click', closeNoteModal);
  document.getElementById('note-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'note-modal-overlay') closeNoteModal();
  });
  document.getElementById('btn-save-note').addEventListener('click', () => {
    const ctx = noteModalContext;
    if (!ctx) return;
    const note = document.getElementById('note-input').value.trim();
    closeNoteModal();
    handleLog(ctx.categoryId, ctx.activity, ctx.isCustom, note || null);
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
    db = initSupabase();
  } catch (e) {
    console.error('Fallo al inicializar Supabase:', e);
    db = null;
  }

  setupListeners();
  renderHome(); // pinta las categorías de inmediato, con o sin Supabase
  updateSyncBadge();

  if (db) {
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
  if (!db) {
    [2000, 5000].forEach((delay) => {
      setTimeout(async () => {
        if (db) return; // ya conectó en un intento anterior
        try {
          const client = initSupabase();
          if (client) {
            db = client;
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
