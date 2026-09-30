/* =========================================================
   ÓRBITA (hábitos) v4.2 · app.js
   Datos en Supabase (tablas activities, habit_logs, goals,
   goal_entries, profile_settings). Cada cambio se aplica al
   instante en pantalla, se guarda en una cola local y se envía
   a Supabase; si no hay conexión, se envía al volver.
   ========================================================= */
'use strict';

/* ---------- Errores visibles (en vez de pantalla en blanco) ---------- */
function showFatalError(msg) {
  const m = document.getElementById('main');
  if (!m) return;
  const box = document.createElement('div');
  box.className = 'pastbar errbar';
  box.innerHTML = '<span>⚠️</span><span><b>Error de la app:</b> ' + String(msg).replace(/</g, '&lt;') + '</span>';
  m.prepend(box);
}
window.addEventListener('error', (e) => showFatalError((e.message || 'Error') + (e.lineno ? ' (línea ' + e.lineno + ')' : '')));
window.addEventListener('unhandledrejection', (e) => showFatalError((e.reason && e.reason.message) || String(e.reason)));

/* ---------- Utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ds = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MON3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYN = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const dowIdx = (d) => (d.getDay() + 6) % 7;
const weekStart = (d) => addDays(d, -dowIdx(d));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtNum = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 1 });
const pct = (x) => Math.round(x * 100);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));
const nowTime = () => { const n = new Date(); return pad(n.getHours()) + ':' + pad(n.getMinutes()); };
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'actividad';
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

let TODAY, TODAY_S;
function refreshToday() { TODAY = new Date(); TODAY.setHours(0, 0, 0, 0); TODAY_S = ds(TODAY); }
refreshToday();
function niceDate(s, long = true) {
  if (s === TODAY_S) return 'Hoy';
  if (s === ds(addDays(TODAY, -1))) return 'Ayer';
  const d = parse(s);
  return long ? cap(DAYN[d.getDay()]) + ' ' + d.getDate() + ' de ' + MONTHS[d.getMonth()] : d.getDate() + ' ' + MON3[d.getMonth()];
}

/* ---------- Configuración ---------- */
const CATS = CATEGORIES;
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
const SLOTS = [['manana', 'Mañana'], ['tarde', 'Tarde'], ['noche', 'Noche'], ['any', 'En cualquier momento']];
const SLOTNAME = Object.fromEntries(SLOTS);
const HISTORY_DAYS = 430;

/* ---------- Estado ---------- */
let db = null;
let ACTS = [];                 // actividades
const LOG = new Map();         // "perfil|actividad|fecha" → { status, qty, note, time }
let CUSTOM = {};               // actividades puntuales: "c:<uuid>" → { name, cat, icon }
let GOALS = [];
let ENTRIES = [];
let SETTINGS = { jose: { profile: 'jose', vac_on: false }, blanca: { profile: 'blanca', vac_on: false } };
const device = lsGet('habitos_device', null);
const S = {
  view: 'hoy', profile: device || 'jose', device: device || 'jose', date: TODAY_S, cat: null,
  histCat: 'all', histQ: '', period: 'week', theme: lsGet('habitos_theme', 'system'), reorder: false,
  hmCat: 'salud', hmOff: 0, loaded: false, syncing: false, syncErr: '', schemaMissing: false
};
const celebrated = new Set(lsGet('habitos_celebrated', []));
let undoStack = null, toastTimer = null, flushing = false;

const key = (p, a, d) => p + '|' + a + '|' + d;
const ACT = (id) => ACTS.find((a) => a.id === id) || CUSTOM[id];
const owns = (a, p) => a.who === 'ambos' || a.who === p;
const peopleFor = (sel) => (sel === 'ambos' ? ['jose', 'blanca'] : [sel]);

/* ---------- Conversión filas ⇄ memoria ---------- */
function actFromRow(r) {
  return {
    id: r.id, cat: r.category_id, name: r.name, icon: r.icon || '⭐', type: r.type || 'check',
    goal: r.goal == null ? null : Number(r.goal), unit: r.unit || '', step: Number(r.step) || 1,
    weekly: r.weekly || 0, slot: r.slot || 'any', who: r.who || 'ambos', order: r.sort_order || 0,
    archived: !!r.archived, created: (r.created_at || '').slice(0, 10) || TODAY_S
  };
}
function actToRow(a) {
  return {
    id: a.id, category_id: a.cat, name: a.name, icon: a.icon, type: a.type,
    goal: a.type === 'qty' ? a.goal : null, unit: a.type === 'qty' ? a.unit : null, step: a.step || 1,
    weekly: a.weekly || 0, slot: a.slot, who: a.who, sort_order: a.order, archived: !!a.archived
  };
}
function rowToLocal(r) {
  let aid = r.activity_id;
  if (!aid) {
    aid = 'c:' + r.id;
    CUSTOM[aid] = { id: aid, name: r.custom_name || 'Actividad', cat: r.category_id, icon: (CAT[r.category_id] || {}).icon || '⭐', type: 'check', custom: true, who: 'ambos', slot: 'any', weekly: 0 };
  }
  LOG.set(key(r.profile, aid, r.log_date), {
    status: r.status || 'done', qty: r.qty == null ? undefined : Number(r.qty), note: r.note || '', time: r.logged_time || ''
  });
}
function localToRow(k, rec) {
  const [p, aid, d] = k.split('|');
  if (aid.startsWith('c:')) {
    const c = CUSTOM[aid];
    return { id: aid.slice(2), profile: p, activity_id: null, custom_name: c.name, category_id: c.cat, log_date: d, status: rec.status, qty: null, note: rec.note || null, logged_time: rec.time || null, updated_at: new Date().toISOString() };
  }
  const a = ACT(aid);
  return { profile: p, activity_id: aid, category_id: a ? a.cat : 'yo', log_date: d, status: rec.status, qty: rec.qty == null ? null : rec.qty, note: rec.note || null, logged_time: rec.time || null, updated_at: new Date().toISOString() };
}
function deleteMatch(k) {
  const [p, aid, d] = k.split('|');
  return aid.startsWith('c:') ? { id: aid.slice(2) } : { profile: p, activity_id: aid, log_date: d };
}

/* ---------- Caché local (arranque instantáneo y uso sin conexión) ---------- */
function saveCache() {
  const logs = [];
  for (const [k, r] of LOG) { const [p, a, d] = k.split('|'); logs.push([p, a, d, r.status, r.qty ?? null, r.note || '', r.time || '']); }
  const custom = Object.values(CUSTOM).map((c) => [c.id, c.name, c.cat]);
  lsSet('habitos_v4_cache', { acts: ACTS, logs, custom, goals: GOALS, entries: ENTRIES, settings: SETTINGS, at: Date.now() });
}
function loadCache() {
  const c = lsGet('habitos_v4_cache', null);
  if (!c) return false;
  ACTS = c.acts || []; GOALS = c.goals || []; ENTRIES = c.entries || []; SETTINGS = c.settings || SETTINGS;
  CUSTOM = {};
  (c.custom || []).forEach(([id, name, cat]) => { CUSTOM[id] = { id, name, cat, icon: (CAT[cat] || {}).icon || '⭐', type: 'check', custom: true, who: 'ambos', slot: 'any', weekly: 0 }; });
  LOG.clear();
  (c.logs || []).forEach(([p, a, d, st, q, n, t]) => LOG.set(key(p, a, d), { status: st, qty: q == null ? undefined : q, note: n, time: t }));
  computeSince();
  return true;
}

/* ---------- Cola de sincronización ---------- */
const QKEY = 'habitos_v4_queue';
const getQueue = () => lsGet(QKEY, []);
const saveQueue = (q) => lsSet(QKEY, q);
function applyOp(op) {
  switch (op.kind) {
    case 'log-upsert': rowToLocal(op.row); break;
    case 'log-delete': LOG.delete(op.k); break;
    case 'act-upsert': { const a = actFromRow(op.row), i = ACTS.findIndex((x) => x.id === a.id); if (i >= 0) { a.created = ACTS[i].created; a.since = ACTS[i].since; ACTS[i] = a; } else { a.since = TODAY_S; ACTS.push(a); } break; }
    case 'goal-upsert': { const i = GOALS.findIndex((g) => g.id === op.row.id); if (i >= 0) GOALS[i] = op.row; else GOALS.push(op.row); break; }
    case 'goal-entry': if (!ENTRIES.some((e) => e.id === op.row.id)) ENTRIES.push(op.row); break;
    case 'settings': SETTINGS[op.row.profile] = op.row; break;
  }
}
async function sendOp(op) {
  let res;
  switch (op.kind) {
    case 'log-upsert':
      res = await db.from('habit_logs').upsert(op.row, { onConflict: op.row.activity_id ? 'profile,activity_id,log_date' : 'id' }); break;
    case 'log-delete':
      res = op.match.id ? await db.from('habit_logs').delete().eq('id', op.match.id) : await db.from('habit_logs').delete().match(op.match); break;
    case 'act-upsert': res = await db.from('activities').upsert(op.row, { onConflict: 'id' }); break;
    case 'goal-upsert': res = await db.from('goals').upsert(op.row, { onConflict: 'id' }); break;
    case 'goal-entry': res = await db.from('goal_entries').upsert(op.row, { onConflict: 'id' }); break;
    case 'settings': res = await db.from('profile_settings').upsert(op.row, { onConflict: 'profile' }); break;
    default: return null;
  }
  return res.error || null;
}
function describeError(err) {
  const m = (err && (err.message || err.details || String(err))) || 'Error desconocido';
  if (/does not exist|Could not find the (table|function)|PGRST20[25]|42P01/i.test(m + ' ' + (err.code || ''))) {
    S.schemaMissing = true;
    return 'Falta ejecutar el script supabase-v4.sql en Supabase';
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión con Supabase';
  return m;
}
function persist(op) {
  const q = getQueue(); q.push(op); saveQueue(q);
  saveCache();
  flush();
}
async function flush() {
  if (flushing || !db || !navigator.onLine) { updateSync(); return; }
  flushing = true; updateSync();
  try {
    for (;;) {
      const q = getQueue();
      if (!q.length) { S.syncErr = ''; break; }
      let err = null;
      try { err = await sendOp(q[0]); } catch (e) { err = e; }
      if (err) { S.syncErr = describeError(err); break; }
      const q2 = getQueue(); q2.shift(); saveQueue(q2);
    }
  } finally { flushing = false; updateSync(); }
}

/* ---------- Carga desde Supabase ---------- */
function computeSince() {
  const first = {};
  for (const k of LOG.keys()) { const [, a, d] = k.split('|'); if (!first[a] || d < first[a]) first[a] = d; }
  ACTS.forEach((a) => { const c = a.created || TODAY_S; a.since = first[a.id] && first[a.id] < c ? first[a.id] : c; });
}
async function fetchAllLogs(from) {
  const out = [], size = 1000;
  for (let page = 0; page < 100; page++) {
    const { data, error } = await db.from('habit_logs')
      .select('id,profile,activity_id,custom_name,category_id,log_date,status,qty,note,logged_time')
      .gte('log_date', from).order('log_date', { ascending: true }).order('id', { ascending: true })
      .range(page * size, page * size + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}
async function loadAll() {
  if (!db) { updateSync(); return; }
  if (!navigator.onLine) { updateSync(); return; }
  S.syncing = true; updateSync();
  try {
    await flush();
    refreshToday();
    const acts = await db.from('activities').select('*');
    if (acts.error) throw acts.error;
    const logs = await fetchAllLogs(ds(addDays(TODAY, -HISTORY_DAYS)));
    const [goals, entries, settings] = await Promise.all([
      db.from('goals').select('*'), db.from('goal_entries').select('*'), db.from('profile_settings').select('*')
    ]);
    for (const r of [goals, entries, settings]) if (r.error) throw r.error;
    ACTS = acts.data.map(actFromRow);
    LOG.clear(); CUSTOM = {};
    logs.forEach(rowToLocal);
    GOALS = goals.data.map((g) => ({ ...g, target: Number(g.target), step: Number(g.step) }));
    ENTRIES = entries.data.map((e) => ({ ...e, amount: Number(e.amount) }));
    settings.data.forEach((s) => { SETTINGS[s.profile] = s; });
    getQueue().forEach(applyOp);      // cambios aún pendientes de enviar
    computeSince();
    S.loaded = true; S.schemaMissing = false;
    if (!getQueue().length) S.syncErr = '';
    saveCache();
  } catch (e) {
    S.syncErr = describeError(e);
  } finally {
    S.syncing = false;
    render();
  }
}

/* ---------- Cálculos ---------- */
function isVac(p, d) { const s = SETTINGS[p]; return !!(s && s.vac_on && s.vac_from && s.vac_to && d >= s.vac_from && d <= s.vac_to); }
function status(a, p, d) {
  if (a.since && d < a.since) return 'none';
  if (isVac(p, d)) return 'vac';
  const r = LOG.get(key(p, a.id, d));
  if (a.type === 'avoid') return r && r.status === 'fail' ? 'fail' : 'done';
  if (!r) return 'pending';
  if (r.status === 'skip') return 'skip';
  if (r.status === 'fail') return 'fail';
  if (a.type === 'qty') { const q = r.qty || 0; return q >= a.goal ? 'done' : q > 0 ? 'partial' : 'pending'; }
  return 'done';
}
const neutral = (st) => st === 'skip' || st === 'vac' || st === 'none';
function activeActs(p, cat) { return ACTS.filter((a) => !a.archived && owns(a, p) && (!cat || a.cat === cat)).sort((x, y) => x.order - y.order); }
function dayComp(p, d, cat) {
  let done = 0, total = 0, skip = 0;
  for (const a of activeActs(p, cat)) {
    if (a.weekly) continue;
    const st = status(a, p, d);
    if (st === 'none') continue;
    if (st === 'skip' || st === 'vac') { skip++; continue; }
    total++; if (st === 'done') done++;
  }
  return { done, total, skip };
}
function dayCompSel(d, cat) { let done = 0, total = 0, skip = 0; peopleFor(S.profile).forEach((p) => { const c = dayComp(p, d, cat); done += c.done; total += c.total; skip += c.skip; }); return { done, total, skip }; }
function weekCount(a, p, d) { const ws = weekStart(parse(d)); let n = 0; for (let x = ws; ds(x) <= d; x = addDays(x, 1)) if (status(a, p, ds(x)) === 'done') n++; return n; }
function streak(a, p) {
  if (a.type === 'avoid') { let n = 0; for (let i = 0; i < HISTORY_DAYS; i++) { const st = status(a, p, ds(addDays(TODAY, -i))); if (st === 'fail' || st === 'none') break; n++; } return Math.max(0, n - 1); }
  if (a.weekly) {
    const met = (w) => { let n = 0; for (let i = 0; i < 7; i++) { const x = addDays(w, i); if (x > TODAY) break; if (status(a, p, ds(x)) === 'done') n++; } return n >= a.weekly; };
    let w = weekStart(TODAY), n = 0; if (!met(w)) w = addDays(w, -7);
    while (met(w) && n < 80) { n++; w = addDays(w, -7); }
    return n;
  }
  let i = status(a, p, TODAY_S) === 'done' ? 0 : 1, n = 0;
  for (; i < HISTORY_DAYS; i++) { const st = status(a, p, ds(addDays(TODAY, -i))); if (st === 'done') n++; else if (st === 'skip' || st === 'vac') continue; else break; }
  return n;
}
function bestStreak(a, p) {
  let best = 0, cur = 0;
  if (a.type === 'avoid') { for (let i = HISTORY_DAYS; i >= 0; i--) { const st = status(a, p, ds(addDays(TODAY, -i))); if (st === 'none') continue; if (st === 'fail') cur = 0; else { cur++; best = Math.max(best, cur); } } return Math.max(0, best - 1); }
  if (a.weekly) return streak(a, p);
  for (let i = HISTORY_DAYS; i >= 0; i--) { const st = status(a, p, ds(addDays(TODAY, -i))); if (st === 'done') { cur++; best = Math.max(best, cur); } else if (neutral(st) || (i === 0 && st !== 'fail')) continue; else cur = 0; }
  return best;
}
// Fuerza del hábito (fórmula tipo Loop Habit Tracker)
function strengthSeries(a, p) {
  const out = []; let s = 0;
  if (a.weekly) {
    const m = Math.pow(0.5, 1 / 6);
    for (let w = 60; w >= 0; w--) {
      const ws = addDays(weekStart(TODAY), -7 * w); let n = 0, valid = false;
      for (let i = 0; i < 7; i++) { const x = addDays(ws, i); if (x > TODAY) continue; const st = status(a, p, ds(x)); if (st !== 'none') valid = true; if (st === 'done') n++; }
      if (valid && !(w === 0 && n < a.weekly)) s = s * m + (1 - m) * Math.min(1, n / a.weekly);
      out.push(s);
    }
    return out;
  }
  const m = Math.pow(0.5, 1 / 13);
  for (let i = HISTORY_DAYS; i >= 0; i--) {
    const st = status(a, p, ds(addDays(TODAY, -i)));
    if (neutral(st) || (i === 0 && st !== 'done' && st !== 'fail')) { out.push(s); continue; }
    s = s * m + (1 - m) * (st === 'done' ? 1 : 0); out.push(s);
  }
  return out;
}
const strength = (a, p) => { const s = strengthSeries(a, p); return s[s.length - 1]; };
function actRate(a, p, from, to) {
  let d = 0, t = 0;
  for (let x = new Date(from); x <= to; x = addDays(x, 1)) { const st = status(a, p, ds(x)); if (neutral(st) || (ds(x) === TODAY_S && st !== 'done')) continue; t++; if (st === 'done') d++; }
  return t ? d / t : 0;
}
function catStreak(p, cat) {
  let i = dayComp(p, TODAY_S, cat).done > 0 ? 0 : 1, n = 0;
  for (; i < HISTORY_DAYS; i++) { if (dayComp(p, ds(addDays(TODAY, -i)), cat).done > 0) n++; else break; }
  return n;
}
// Periodos móviles: últimos 7 o 30 días (sin contar hoy) frente a los 7 o 30 anteriores
function periodRange(period, off) { const n = period === 'week' ? 7 : 30, end = addDays(TODAY, -1 - n * off); return [addDays(end, -(n - 1)), end]; }
function periodStats(people, from, to, cat) {
  let done = 0, total = 0, perfect = 0; const days = [];
  for (let x = new Date(from); x <= to; x = addDays(x, 1)) {
    let dd = 0, tt = 0; const s = ds(x);
    people.forEach((p) => { const c = dayComp(p, s, cat); dd += c.done; tt += c.total; });
    done += dd; total += tt; if (tt > 0 && dd === tt) perfect++;
    days.push({ s, r: tt ? dd / tt : 0, has: tt > 0 });
  }
  return { rate: total ? done / total : 0, perfect, done, total, days };
}
const goalCurrent = (g) => ENTRIES.filter((e) => e.goal_id === g.id).reduce((s, e) => s + Number(e.amount), 0);

/* ---------- SVG ---------- */
function ring(p, size, sw, color) {
  const r = (size - sw) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, p)), h = size / 2;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${sw}"/>${v > 0 ? `<circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v)).toFixed(2)}" transform="rotate(-90 ${h} ${h})"/>` : ''}</svg>`;
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  dash: '<svg viewBox="0 0 24 24"><path d="M7 12h10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
};
const BRAND_LOGO = `<svg class="brand-logo" viewBox="0 0 1024 1024" aria-hidden="true">   <g class="ring"><path class="arc a0" d="M424.3 225.1A300 300 0 0 1 599.7 225.1" stroke="#8B5CF6" stroke-width="96" stroke-linecap="round" fill="none" pathLength="100"/>   <path class="arc a1" d="M716.6 292.6A300 300 0 0 1 804.3 444.5" stroke="#10B981" stroke-width="96" stroke-linecap="round" fill="none" pathLength="100"/>   <path class="arc a2" d="M804.3 579.5A300 300 0 0 1 716.6 731.4" stroke="#EC4899" stroke-width="96" stroke-linecap="round" fill="none" pathLength="100"/>   <path class="arc a3" d="M599.7 798.9A300 300 0 0 1 424.3 798.9" stroke="#F59E0B" stroke-width="96" stroke-linecap="round" fill="none" pathLength="100"/>   <path class="arc a4" d="M307.4 731.4A300 300 0 0 1 219.7 579.5" stroke="#3B82F6" stroke-width="96" stroke-linecap="round" fill="none" pathLength="100"/>   <path class="arc a5" d="M219.7 444.5A300 300 0 0 1 307.4 292.6" stroke="#14B8A6" stroke-width="96" stroke-linecap="round" fill="none" pathLength="100"/></g>   <path class="chk" d="M404 520L480 596L632 440" stroke="currentColor" stroke-width="80" stroke-linecap="round" stroke-linejoin="round" fill="none" pathLength="100"/> </svg>`;
const TABS = [
  ['hoy', 'Hoy', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12.3l2.7 2.7L16.5 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
  ['categorias', 'Categorías', '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>'],
  ['historial', 'Historial', '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4v4.6h4.6M12 8v4.5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
  ['stats', 'Estadísticas', '<svg viewBox="0 0 24 24"><path d="M5 20V11M12 20V4M19 20v-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'],
  ['ajustes', 'Ajustes', '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>']
];
const av = (p, on = true) => `<span class="av ${on ? '' : 'off'}" style="--p:${PEOPLE[p].color}" title="${PEOPLE[p].name}">${PEOPLE[p].ini}</span>`;
const freqText = (a) => (a.weekly ? (a.weekly === 1 ? '1 vez por semana' : a.weekly + ' veces por semana') : 'Diaria');
const typeText = (a) => (a.type === 'qty' ? `Meta: ${fmtNum(a.goal)} ${a.unit}` : a.type === 'avoid' ? 'Hábito a evitar' : 'Sí / No');
const whoText = (w) => (w === 'ambos' ? 'José y Blanca' : PEOPLE[w].name);

/* ---------- Render ---------- */
function render() {
  refreshToday();
  if (S.date > TODAY_S) S.date = TODAY_S;
  $('#tabbar').innerHTML = `<div class="side-brand">${BRAND_LOGO}<span>${APP_NAME}</span></div>` + TABS.map(([id, label, svg]) =>
    `<button class="tab ${S.view === id || (id === 'categorias' && S.view === 'categoria') || (id === 'ajustes' && (S.view === 'gestionar' || S.view === 'atajos')) ? 'on' : ''}" data-act="nav" data-v="${id}">${svg}<span>${label}</span></button>`).join('');
  if (!S.loaded && !ACTS.length) {
    $('#main').innerHTML = `<div class="top"><div><h1>${APP_NAME}</h1></div>${syncChip()}</div>${globalBanners()}<div class="loading">${S.syncErr ? 'No se pudieron cargar los datos.' : 'Cargando tus hábitos…'}</div>`;
    return;
  }
  const views = { hoy: viewHoy, categorias: viewCats, categoria: viewCat, historial: viewHist, stats: viewStats, ajustes: viewAjustes, gestionar: viewManage, atajos: viewShortcuts };
  $('#main').innerHTML = (views[S.view] || viewHoy)();
}
function syncChip() {
  const q = getQueue().length;
  let cls = 'ok', txt = '✓ Sincronizado';
  if (!db) { cls = 'err'; txt = '⚠️ Sin Supabase'; }
  else if (S.syncErr) { cls = 'err'; txt = '⚠️ ' + (q ? q + ' sin enviar' : 'Error'); }
  else if (!navigator.onLine) { cls = 'wait'; txt = '📴 Sin conexión' + (q ? ' · ' + q : ''); }
  else if (S.syncing || flushing || q) { cls = 'wait'; txt = '⏳ Sincronizando'; }
  return `<button class="sync ${cls}" id="sync-chip" data-act="sync" aria-label="Estado de sincronización">${txt}</button>`;
}
function updateSync() { const c = $('#sync-chip'); if (c) c.outerHTML = syncChip(); const b = $('#global-banners'); if (b) b.outerHTML = globalBanners(); }
function globalBanners() {
  let h = '';
  if (S.schemaMissing) h += `<div class="pastbar errbar"><span>🛠️</span><span><b>Falta un paso de instalación:</b> ejecuta el archivo <b>supabase-v4.sql</b> en Supabase → SQL Editor. Mientras tanto, lo que registres se guarda en este dispositivo.</span></div>`;
  else if (S.syncErr) h += `<div class="pastbar errbar"><span>⚠️</span><span>${esc(S.syncErr)}. Tus registros están a salvo en este dispositivo y se enviarán en cuanto se pueda.</span><button data-act="sync">Reintentar</button></div>`;
  return `<div id="global-banners">${h}</div>`;
}
function topBar(title, sub) {
  return `<div class="top"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="top-actions">${syncChip()}</div></div>${globalBanners()}`;
}
function profileSeg() {
  return `<div class="seg" role="tablist" aria-label="Perfil">${['jose', 'blanca', 'ambos'].map((p) =>
    `<button class="${S.profile === p ? 'on' : ''}" data-act="profile" data-p="${p}">${p === 'ambos' ? 'Ambos' : PEOPLE[p].name}</button>`).join('')}</div>`;
}
function dateNav() {
  const prev = ds(addDays(parse(S.date), -1)), next = ds(addDays(parse(S.date), 1));
  return `<div class="datenav"><button class="icon-btn" data-act="date" data-d="${prev}" aria-label="Día anterior">${ICON.left}</button>
    <span class="datepill">${S.date === TODAY_S ? 'Hoy' : niceDate(S.date, false)}<input type="date" id="date-pick" max="${TODAY_S}" value="${S.date}" aria-label="Elegir fecha"></span>
    <button class="icon-btn" data-act="date" data-d="${next}" ${S.date >= TODAY_S ? 'disabled' : ''} aria-label="Día siguiente">${ICON.right}</button></div>`;
}
function banners() {
  let h = '';
  if (S.date !== TODAY_S) h += `<div class="pastbar"><span>✏️</span><span>Estás registrando en <b>${niceDate(S.date)}</b>. Lo que marques se guarda en ese día.</span><button data-act="date" data-d="${TODAY_S}">Volver a hoy</button></div>`;
  peopleFor(S.profile).forEach((p) => { const s = SETTINGS[p]; if (s && s.vac_on && s.vac_to >= TODAY_S) h += `<div class="pastbar vacbar"><span>🏝️</span><span>Modo vacaciones de ${PEOPLE[p].name} del ${niceDate(s.vac_from, false)} al ${niceDate(s.vac_to, false)}: las rachas están congeladas.</span><button data-act="nav" data-v="ajustes">Cambiar</button></div>`; });
  if (S.profile === 'ambos') h += `<div class="pastbar vacbar"><span>👥</span><span>Vista conjunta: para registrar, elige José o Blanca.</span></div>`;
  return h;
}

/* ---------- Fila de actividad ---------- */
function rowHTML(a, d) {
  const c = CAT[a.cat].color, sel = S.profile;
  if (sel === 'ambos') {
    const ppl = ['jose', 'blanca'].filter((p) => owns(a, p));
    const meta = a.weekly ? freqText(a) : a.type === 'avoid' ? ppl.map((p) => `${PEOPLE[p].name}: ${streak(a, p)} días sin`).join(' · ') : CAT[a.cat].name;
    return `<div class="row" style="--c:${c}"><button class="row-main" data-act="detail" data-a="${a.id}"><span class="tile">${a.icon}</span><span style="min-width:0"><div class="row-name">${esc(a.name)}</div><div class="row-meta"><span class="dot"></span>${esc(meta)}</div></span></button>
      <span class="who">${ppl.map((p) => av(p, status(a, p, d) === 'done')).join('')}</span><span></span></div>`;
  }
  const st = status(a, sel, d), r = LOG.get(key(sel, a.id, d));
  let meta = '', ctrl = '';
  if (a.type === 'qty') {
    const q = (r && r.qty) || 0;
    meta = `${fmtNum(q)} de ${fmtNum(a.goal)} ${esc(a.unit)}`;
    ctrl = `<div class="qty"><span class="qty-ring">${ring(q / a.goal, 40, 4, c)}<span class="num">${q >= a.goal ? '✓' : pct(q / a.goal) + '%'}</span></span><button class="plus" data-act="inc" data-a="${a.id}" aria-label="Sumar ${a.step} ${esc(a.unit)}">+</button></div>`;
  } else if (a.type === 'avoid') {
    const n = streak(a, sel);
    meta = st === 'fail' ? 'Recaída registrada este día' : `Récord: ${bestStreak(a, sel)} días`;
    ctrl = `<div class="avoid ${st === 'fail' ? 'fail' : ''}"><b>${st === 'fail' ? 0 : n}</b><span>días sin</span></div>`;
  } else {
    if (a.weekly) meta = `${weekCount(a, sel, d)}/${a.weekly} esta semana`;
    else { const n = streak(a, sel); meta = st === 'skip' ? 'Saltado · no rompe la racha' : st === 'fail' ? 'Marcado como fallido' : n > 1 ? `🔥 Racha de ${n} días` : CAT[a.cat].name; }
    const ic = st === 'skip' ? ICON.dash : st === 'fail' ? ICON.x : ICON.check;
    ctrl = `<button class="chk st-${st}" data-act="toggle" data-a="${a.id}" aria-label="${st === 'done' ? 'Desmarcar' : 'Marcar como hecho'}">${ic}</button>`;
  }
  if (r && r.note) meta += ' · 📝';
  return `<div class="row ${st === 'done' && a.type !== 'avoid' ? 'is-done' : ''}" style="--c:${c}">
    <button class="row-main" data-act="detail" data-a="${a.id}"><span class="tile">${a.icon}</span><span style="min-width:0"><div class="row-name">${esc(a.name)}</div><div class="row-meta"><span class="dot"></span>${meta}</div></span></button>
    ${ctrl}<button class="more" data-act="menu" data-a="${a.id}" aria-label="Más opciones">${ICON.more}</button></div>`;
}

/* ---------- Vista: Hoy ---------- */
function viewHoy() {
  const d = S.date, comp = dayCompSel(d);
  const acts = ACTS.filter((a) => !a.archived && peopleFor(S.profile).some((p) => owns(a, p))).sort((x, y) => (CATS.findIndex((c) => c.id === x.cat) - CATS.findIndex((c) => c.id === y.cat)) || x.order - y.order);
  const ws = weekStart(parse(d));
  const week = DOW.map((l, i) => {
    const x = addDays(ws, i), s = ds(x), fut = x > TODAY, c = fut ? { done: 0, total: 0 } : dayCompSel(s);
    return `<button class="wd ${s === d ? 'sel' : ''}" data-act="date" data-d="${s}" ${fut ? 'disabled' : ''}><span class="lbl">${l}</span><span class="mini">${ring(c.total ? c.done / c.total : 0, 34, 3.5, 'var(--accent)')}<span class="num">${x.getDate()}</span></span></button>`;
  }).join('');
  const sections = SLOTS.map(([slot, label]) => {
    const list = acts.filter((a) => a.slot === slot);
    if (!list.length) return '';
    const done = list.filter((a) => S.profile !== 'ambos' && status(a, S.profile, d) === 'done').length;
    return `<div class="sec-h"><h2>${label}</h2><span>${S.profile === 'ambos' ? list.length + ' hábitos' : done + ' de ' + list.length}</span></div><div class="group">${list.map((a) => rowHTML(a, d)).join('')}</div>`;
  }).join('') || `<div class="card empty">No hay actividades. Créalas en Ajustes → Gestionar actividades.</div>`;
  const title = d === TODAY_S ? 'Hoy' : niceDate(d);
  const sub = d === TODAY_S ? cap(DAYN[TODAY.getDay()]) + ', ' + TODAY.getDate() + ' de ' + MONTHS[TODAY.getMonth()] : 'Registro de un día pasado';
  return `${topBar(title, sub)}
  <div class="controls">${profileSeg()}${dateNav()}</div>${banners()}
  <div class="hoy"><div class="side"><div class="card"><div class="summary">
      <div class="big-ring">${ring(comp.total ? comp.done / comp.total : 0, 118, 11, 'var(--accent)')}<div class="in"><b class="num">${comp.total ? pct(comp.done / comp.total) : 0}%</b><span>${comp.done} de ${comp.total}</span></div></div>
      <div class="trio"><div><b class="num" style="color:var(--good)">${comp.done}</b><span>Hechos</span></div><div><b class="num">${comp.total - comp.done}</b><span>Pendientes</span></div><div><b class="num" style="color:var(--faint)">${comp.skip}</b><span>Saltados</span></div></div>
    </div><div class="week">${week}</div><div class="hint">Toca cualquier día de la semana para registrar lo que se te olvidó.</div></div></div>
  <div>${sections}</div></div>`;
}

/* ---------- Vista: Categorías ---------- */
function viewCats() {
  const people = peopleFor(S.profile);
  const cards = CATS.map((c) => {
    const comp = dayCompSel(TODAY_S, c.id), n = Math.max(0, ...people.map((p) => catStreak(p, c.id)));
    const acts = ACTS.filter((a) => a.cat === c.id && !a.archived && people.some((p) => owns(a, p)));
    const str = acts.length ? acts.reduce((s, a) => s + strength(a, people.find((p) => owns(a, p))), 0) / acts.length : 0;
    return `<button class="cat-card" style="--c:${c.color}" data-act="opencat" data-c="${c.id}">
      <div class="hd"><span class="emo">${c.icon}</span><span class="cat-ring">${ring(comp.total ? comp.done / comp.total : 0, 52, 5, c.color)}<span class="num">${comp.done}/${comp.total}</span></span></div>
      <h3>${c.name}</h3><div class="ft">${n > 0 ? `<span class="pill warn">🔥 ${n} ${n === 1 ? 'día' : 'días'}</span>` : '<span class="pill">Sin racha</span>'}<span class="pill">Fuerza ${pct(str)}%</span></div></button>`;
  }).join('');
  return `${topBar('Categorías', 'Progreso de hoy por área de tu vida')}<div class="controls">${profileSeg()}</div>${S.profile === 'ambos' ? banners() : ''}<div class="cat-grid">${cards}</div>`;
}
function viewCat() {
  const c = CAT[S.cat], comp = dayCompSel(S.date, c.id);
  const acts = ACTS.filter((a) => a.cat === c.id && !a.archived && peopleFor(S.profile).some((p) => owns(a, p))).sort((x, y) => x.order - y.order);
  return `<button class="back" data-act="nav" data-v="categorias">${ICON.left}Categorías</button>
    ${topBar(c.icon + ' ' + c.name, `${comp.done} de ${comp.total} completadas · ${niceDate(S.date)}`)}
    <div class="controls">${profileSeg()}${dateNav()}</div>${banners()}
    <div class="bar" style="--c:${c.color};margin-bottom:12px"><i style="width:${comp.total ? pct(comp.done / comp.total) : 0}%"></i></div>
    <div class="group">${acts.map((a) => rowHTML(a, S.date)).join('') || '<div class="set-row">Sin actividades en esta categoría.</div>'}</div>
    <button class="custom-row" data-act="custom" data-c="${c.id}">+ Actividad puntual (sin crear hábito)</button>`;
}

/* ---------- Vista: Historial ---------- */
function histEntries() {
  const out = [], people = peopleFor(S.profile), q = S.histQ.trim().toLowerCase(), from = ds(addDays(TODAY, -90));
  for (const [k, r] of LOG) {
    const [p, aid, d] = k.split('|');
    if (!people.includes(p) || d < from) continue;
    const a = ACT(aid); if (!a) continue;
    if (S.histCat !== 'all' && a.cat !== S.histCat) continue;
    if (q && !(a.name.toLowerCase().includes(q) || (r.note || '').toLowerCase().includes(q))) continue;
    out.push({ k, p, a, d, r });
  }
  return out.sort((x, y) => (y.d + (y.r.time || '')).localeCompare(x.d + (x.r.time || '')));
}
function statusPill(a, r) {
  if (r.status === 'skip') return '<span class="pill">Saltado</span>';
  if (r.status === 'fail') return `<span class="pill bad">${a.type === 'avoid' ? 'Recaída' : 'Fallido'}</span>`;
  if (a.type === 'qty') return `<span class="pill ${(r.qty || 0) >= a.goal ? 'good' : 'warn'}">${fmtNum(r.qty || 0)} ${esc(a.unit)}</span>`;
  return `<span class="pill good">${a.custom ? 'Puntual' : 'Hecho'}</span>`;
}
function viewHist() {
  const list = histEntries(); let html = '', cur = '';
  list.slice(0, 200).forEach((e) => {
    if (e.d !== cur) { if (cur) html += '</div>'; cur = e.d; html += `<div class="sec-h"><h2>${niceDate(e.d)}</h2><span>${list.filter((x) => x.d === e.d).length} registros</span></div><div class="group">`; }
    html += `<button class="h-row" style="--c:${CAT[e.a.cat].color}" data-act="edit" data-k="${esc(e.k)}"><span class="h-time">${esc(e.r.time || '')}</span><span class="tile">${e.a.icon}</span>
      <span style="min-width:0"><div class="row-name">${esc(e.a.name)}</div>${e.r.note ? `<div class="h-note">«${esc(e.r.note)}»</div>` : ''}</span>
      <span class="h-right">${statusPill(e.a, e.r)}${S.profile === 'ambos' ? av(e.p) : ''}</span></button>`;
  });
  if (cur) html += '</div>';
  const chips = [['all', 'Todas']].concat(CATS.map((c) => [c.id, c.icon + ' ' + c.name])).map(([id, l]) => `<button class="chip ${S.histCat === id ? 'on' : ''}" data-act="hcat" data-c="${id}">${l}</button>`).join('');
  return `${topBar('Historial', 'Últimos 90 días · toca un registro para editarlo o borrarlo')}<div class="controls">${profileSeg()}</div>
    <input class="search" id="hist-q" type="search" placeholder="Buscar actividad o nota" value="${esc(S.histQ)}">
    <div class="chips">${chips}</div>${html || '<div class="card empty">Todavía no hay registros con ese filtro.</div>'}`;
}

/* ---------- Vista: Estadísticas ---------- */
function barsChart(days, period) {
  const W = 320, H = 150, L = 34, B = 20, T = 8, n = days.length, bw = (W - L) / n;
  const y = (v) => T + (H - T - B) * (1 - v);
  let g = [0, 0.5, 1].map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v * 100}%</text>`).join('');
  g += `<line x1="${L}" x2="${W}" y1="${y(0.8)}" y2="${y(0.8)}" stroke="var(--good)" stroke-width="1" stroke-dasharray="4 3"/><text x="${W}" y="${y(0.8) - 4}" text-anchor="end" style="fill:var(--good)">objetivo 80%</text>`;
  days.forEach((d, i) => {
    const x = L + i * bw + bw * 0.18, w = bw * 0.64, h = (H - T - B) * d.r, dt = parse(d.s);
    if (d.has) g += `<rect x="${x.toFixed(1)}" y="${y(d.r).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, 1.5).toFixed(1)}" rx="${Math.min(4, w / 2).toFixed(1)}" fill="${d.r >= 0.8 ? 'var(--good)' : 'var(--accent)'}"/>`;
    const lab = period === 'week' ? DOW[dowIdx(dt)] : (dt.getDate() === 1 || dt.getDate() % 5 === 0 ? dt.getDate() : '');
    if (lab !== '') g += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${lab}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Cumplimiento diario">${g}</svg>`;
}
function paceChart(g) {
  const W = 300, H = 110, L = 4, R = 4, T = 10, B = 18, s = parse(g.start_date), e = parse(g.end_date), span = Math.max(1, (e - s) / 864e5);
  const cur = goalCurrent(g);
  const x = (d) => L + (W - L - R) * Math.min(1, Math.max(0, ((d - s) / 864e5) / span)), y = (v) => T + (H - T - B) * (1 - Math.min(1, v / g.target));
  const ents = ENTRIES.filter((en) => en.goal_id === g.id).sort((a, b) => (a.entry_date + a.created_at).localeCompare(b.entry_date + b.created_at));
  let acc = 0; const pts = [[x(s), y(0)]];
  ents.forEach((en) => { acc += Number(en.amount); pts.push([x(parse(en.entry_date)), y(acc)]); });
  pts.push([x(TODAY), y(cur)]);
  const c = CAT[g.category_id].color;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Progreso frente al ritmo necesario">
    <line x1="${x(s)}" y1="${y(0)}" x2="${x(e)}" y2="${y(g.target)}" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="5 4"/>
    <polyline points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x(TODAY)}" cy="${y(cur)}" r="4.5" fill="${c}" stroke="var(--surface)" stroke-width="2"/>
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>
    <text x="${L}" y="${H - 4}">${MON3[s.getMonth()]}</text><text x="${x(TODAY)}" y="${H - 4}" text-anchor="middle">hoy</text><text x="${W - R}" y="${H - 4}" text-anchor="end">${MON3[e.getMonth()]}</text></svg>`;
}
function achievements() {
  const p = S.profile === 'ambos' ? S.device : S.profile;
  const acts = ACTS.filter((a) => owns(a, p) && !a.weekly);
  const best = Math.max(0, ...acts.filter((a) => a.type !== 'avoid').map((a) => bestStreak(a, p)));
  const avoidBest = Math.max(0, ...acts.filter((a) => a.type === 'avoid').map((a) => bestStreak(a, p)));
  let perfect = 0, total = 0;
  for (let i = 1; i <= HISTORY_DAYS; i++) { const s = ds(addDays(TODAY, -i)); const c = dayComp(p, s); if (c.total && c.done === c.total) perfect++; }
  for (const [k, r] of LOG) if (k.startsWith(p + '|') && r.status === 'done') total++;
  return [
    ['🔥', 'Primera semana', 'Racha de 7 días', best, 7], ['⚡', 'Un mes sin fallar', 'Racha de 30 días', best, 30],
    ['🏆', 'Centenario', 'Racha de 100 días', best, 100], ['⭐', 'Día completo', 'Todos los hábitos del día', perfect, 1],
    ['🌟', '10 días completos', 'Diez días al 100 %', perfect, 10], ['✅', '500 registros', 'Actividades completadas', total, 500],
    ['🛡️', '30 días sin recaer', 'Hábito a evitar', avoidBest, 30], ['💎', '1.000 registros', 'Actividades completadas', total, 1000]
  ];
}
function heatmapCard() {
  const people = peopleFor(S.profile), c = CAT[S.hmCat];
  const m0 = new Date(TODAY.getFullYear(), TODAY.getMonth() - S.hmOff, 1), mEnd = new Date(m0.getFullYear(), m0.getMonth() + 1, 0);
  let cells = DOW.map((l) => `<div class="hm-dow">${l}</div>`).join('');
  for (let i = 0; i < dowIdx(m0); i++) cells += '<div></div>';
  for (let x = new Date(m0); x <= mEnd; x = addDays(x, 1)) {
    const s = ds(x), fut = x > TODAY;
    let st = '';
    if (!fut) { const cp = dayCompSel(s, c.id); const r = cp.total ? cp.done / cp.total : 0; if (cp.total) st = `background:${hexA(c.color, 0.14 + r * 0.86)}`; if (r >= 0.6) st += ';color:#fff'; }
    cells += `<button class="hm-cell ${fut ? 'fut' : ''} ${s === TODAY_S ? 'today' : ''}" style="${st}" data-act="hmday" data-d="${s}" ${fut ? 'disabled' : ''}>${x.getDate()}</button>`;
  }
  const pills = CATS.map((k) => `<button class="chip ${S.hmCat === k.id ? 'on' : ''}" data-act="hmcat" data-c="${k.id}">${k.icon} ${k.name}</button>`).join('');
  return `<div class="card"><h3>Mapa de calor mensual</h3><p class="cap">Más intenso = más actividades completadas ese día. Toca un día para verlo o completarlo.</p>
    <div class="hm-pills">${pills}</div><div class="hm-nav"><button class="icon-btn" data-act="hmoff" data-v="1" aria-label="Mes anterior">${ICON.left}</button><span>${cap(MONTHS[m0.getMonth()])} ${m0.getFullYear()}</span><button class="icon-btn" data-act="hmoff" data-v="-1" ${S.hmOff === 0 ? 'disabled' : ''} aria-label="Mes siguiente">${ICON.right}</button></div>
    <div class="hm-grid">${cells}</div></div>`;
}
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
function correlationsCard() {
  const people = peopleFor(S.profile), series = {};
  CATS.forEach((c) => { series[c.id] = {}; });
  for (let i = 1; i <= 60; i++) {
    const s = ds(addDays(TODAY, -i));
    CATS.forEach((c) => { let d = 0, t = 0; people.forEach((p) => { const cp = dayComp(p, s, c.id); d += cp.done; t += cp.total; }); if (t) series[c.id][s] = d / t; });
  }
  const res = [];
  for (let i = 0; i < CATS.length; i++) for (let j = i + 1; j < CATS.length; j++) {
    const a = series[CATS[i].id], b = series[CATS[j].id], days = Object.keys(a).filter((d) => d in b);
    if (days.length < 14) continue;
    const r = pearson(days.map((d) => a[d]), days.map((d) => b[d]));
    if (Math.abs(r) >= 0.3) res.push({ a: CATS[i], b: CATS[j], r, n: days.length });
  }
  res.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const body = res.length ? res.slice(0, 3).map((x) => `<div class="corr"><span>${x.r > 0 ? '🔗' : '↔️'}</span><span>${x.r > 0 ? `Los días que cumples más en <b>${x.a.icon} ${x.a.name}</b>, también cumples más en <b>${x.b.icon} ${x.b.name}</b>.` : `Cuando subes en <b>${x.a.icon} ${x.a.name}</b>, tiendes a bajar en <b>${x.b.icon} ${x.b.name}</b>.`} <span style="color:var(--faint)">(r = ${x.r.toFixed(2).replace('.', ',')} · ${x.n} días)</span></span></div>`).join('')
    : '<p class="cap" style="margin:0">Aún no hay patrones claros. Hacen falta al menos 14 días con registros en las dos categorías que se comparan.</p>';
  return `<div class="card"><h3>Patrones entre categorías</h3><p class="cap">Últimos 60 días.</p>${body}</div>`;
}
function viewStats() {
  const people = peopleFor(S.profile), per = S.period;
  const [f0, t0] = periodRange(per, 0), [f1, t1] = periodRange(per, 1);
  const now = periodStats(people, f0, t0), prev = periodStats(people, f1, t1);
  const dlt = Math.round((now.rate - prev.rate) * 100);
  const catRows = CATS.map((c) => {
    const a = periodStats(people, f0, t0, c.id), b = periodStats(people, f1, t1, c.id);
    return a.total ? { c, a: a.rate, b: b.rate, hasPrev: b.total > 0 } : null;
  }).filter(Boolean);
  const best = catRows.length ? catRows.reduce((m, r) => (r.a > m.a ? r : m), catRows[0]) : null;
  const worstC = catRows.length > 1 ? catRows.reduce((m, r) => (r.a < m.a ? r : m), catRows[0]) : null;
  const worst = worstC && best && worstC.a < best.a ? worstC : null;
  let topAct = null, topRate = -1, topStreak = null, topN = 0;
  people.forEach((p) => ACTS.filter((a) => owns(a, p) && !a.archived && !a.weekly && a.type !== 'avoid').forEach((a) => {
    const r = actRate(a, p, f0, t0); if (r > topRate) { topRate = r; topAct = a; }
    const n = streak(a, p); if (n > topN) { topN = n; topStreak = a; }
  }));
  const label = per === 'week' ? 'Últimos 7 días' : 'Últimos 30 días';
  const prevLabel = per === 'week' ? 'los 7 días anteriores' : 'los 30 días anteriores';
  const vs = CATS.map((c) => {
    const vals = ['jose', 'blanca'].map((p) => { const st = periodStats([p], f0, t0, c.id); return st.total ? st.rate : null; });
    return `<div class="vs"><span class="nm">${c.icon} ${c.name}</span><div class="bars">${['jose', 'blanca'].map((p, i) => `<div class="b"><div class="bar" style="--c:${PEOPLE[p].color}"><i style="width:${vals[i] === null ? 0 : pct(vals[i])}%"></i></div><span>${vals[i] === null ? '—' : pct(vals[i]) + '%'}</span></div>`).join('')}</div></div>`;
  }).join('');
  const goals = GOALS.filter((g) => !g.archived).map((g) => {
    const s = parse(g.start_date), e = parse(g.end_date), frac = Math.max(0, Math.min(1, (TODAY - s) / Math.max(1, e - s)));
    const cur = goalCurrent(g), expected = g.target * frac, diff = cur - expected, ok = diff >= 0;
    const round = (v) => (g.target >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
    const dtxt = cur >= g.target ? '¡Meta conseguida!' : Math.abs(diff) < g.target * 0.01 ? 'Justo al ritmo' : `${fmtNum(round(Math.abs(diff)))} ${esc(g.unit)} ${ok ? 'por delante' : 'por detrás'} del ritmo`;
    return `<div class="goal"><div class="goal-h"><div><b>${esc(g.name)}</b><div class="row-meta" style="--c:${CAT[g.category_id].color}"><span class="dot"></span>${CAT[g.category_id].name} · hasta el ${e.getDate()} de ${MONTHS[e.getMonth()]}</div></div><span class="goal-n num">${fmtNum(cur)}<span style="font-size:13px;color:var(--muted)"> / ${fmtNum(g.target)} ${esc(g.unit)}</span></span></div>
      ${paceChart(g)}<div class="goal-actions"><span class="pill ${ok || cur >= g.target ? 'good' : 'warn'}">${dtxt}</span><button class="btn small" data-act="goalinc" data-g="${esc(g.id)}">+ ${fmtNum(g.step)} ${esc(g.unit)}</button><button class="btn small" data-act="goaladd" data-g="${esc(g.id)}">Otra cantidad</button></div></div>`;
  }).join('') || '<p class="cap" style="margin:0">Todavía no tienes metas. Ejemplos: «Leer 12 libros este año», «Ahorrar 1.000 USD para el viaje».</p>';
  const badges = achievements().map(([ic, t, d, v, goal]) => { const ok = v >= goal; return `<div class="badge ${ok ? 'ok' : ''}"><span class="medal">${ic}</span><b>${t}</b><span>${ok ? d + ' · conseguido' : `${fmtNum(Math.min(v, goal))} / ${fmtNum(goal)}`}</span>${ok ? '' : `<div class="bar"><i style="width:${pct(Math.min(1, v / goal))}%"></i></div>`}</div>`; }).join('');
  const noData = !now.total;
  return `${topBar('Estadísticas', S.profile === 'ambos' ? 'José y Blanca' : PEOPLE[S.profile].name)}
  <div class="controls">${profileSeg()}<div class="seg"><button class="${per === 'week' ? 'on' : ''}" data-act="period" data-p="week">7 días</button><button class="${per === 'month' ? 'on' : ''}" data-act="period" data-p="month">30 días</button></div></div>
  <div class="stats-grid">
    <div class="card wide"><h3>Informe · ${label}</h3><p class="cap">Sin contar hoy, que todavía está en curso.</p>
      ${noData ? '<p class="cap" style="margin:0">Todavía no hay días completos registrados en este periodo. Vuelve mañana.</p>' : `
      <div class="headline"><b class="num">${pct(now.rate)}%</b><span>de cumplimiento</span>${prev.total ? `<span class="pill ${dlt > 0 ? 'good' : dlt < 0 ? 'bad' : ''}">${dlt > 0 ? '▲ +' : dlt < 0 ? '▼ ' : ''}${dlt} pts frente a ${prevLabel}</span>` : ''}</div>
      <dl class="kv"><dt>Mejor categoría</dt><dd>${best ? best.c.icon + ' ' + best.c.name + ' · ' + pct(best.a) + '%' : '—'}</dd><dt>Categoría a reforzar</dt><dd>${worst ? worst.c.icon + ' ' + worst.c.name + ' · ' + pct(worst.a) + '%' : '—'}</dd>
      <dt>Días completos (100 %)</dt><dd>${now.perfect}</dd><dt>Hábito más constante</dt><dd>${topAct && topRate > 0 ? topAct.icon + ' ' + esc(topAct.name) + ' · ' + pct(topRate) + '%' : '—'}</dd>
      <dt>Racha activa más larga</dt><dd>${topStreak ? topStreak.icon + ' ' + esc(topStreak.name) + ' · ' + topN + (topStreak.weekly ? ' semanas' : ' días') : '—'}</dd></dl>`}</div>
    <div class="card"><h3>Cumplimiento diario</h3><p class="cap">Verde: días por encima del 80 %.</p>${barsChart(now.days, per)}</div>
    <div class="card"><h3>Por categoría</h3><p class="cap">Frente a ${prevLabel}.</p>${catRows.map((r) => { const d = Math.round((r.a - r.b) * 100); return `<div class="cbar" style="--c:${r.c.color}"><span class="nm">${r.c.icon} ${r.c.name}</span><div class="bar"><i style="width:${pct(r.a)}%"></i></div><span class="pc">${pct(r.a)}%</span><span class="delta ${!r.hasPrev ? 'eq' : d > 0 ? 'up' : d < 0 ? 'down' : 'eq'}">${!r.hasPrev ? '' : d > 0 ? '▲' + d : d < 0 ? '▼' + Math.abs(d) : '='}</span></div>`; }).join('') || '<p class="cap" style="margin:0">Sin datos todavía.</p>'}</div>
    <div class="card"><h3>José y Blanca</h3><p class="cap">Cumplimiento por categoría en el periodo.</p><div class="legend"><span style="--p:${PEOPLE.jose.color}"><i></i>José</span><span style="--p:${PEOPLE.blanca.color}"><i></i>Blanca</span></div>${vs}</div>
    <div class="card"><h3>Metas a largo plazo</h3><p class="cap">La línea discontinua marca el ritmo necesario para llegar a tiempo.</p>${goals}<button class="btn block" style="margin-top:10px" data-act="newgoal">+ Nueva meta</button></div>
    ${heatmapCard()}
    ${correlationsCard()}
    <div class="card wide"><h3>Logros${S.profile === 'ambos' ? ' · ' + PEOPLE[S.device].name : ''}</h3><p class="cap">Se desbloquean solos. Al alcanzar una racha de 7, 30 o 100 días aparece una celebración.</p><div class="badges">${badges}</div></div>
  </div>`;
}

/* ---------- Vista: Ajustes, gestión y atajos ---------- */
function viewAjustes() {
  const n = ACTS.filter((a) => !a.archived).length, arch = ACTS.filter((a) => a.archived).length, vs = SETTINGS[S.device] || {};
  return `${topBar('Ajustes')}
  <div class="sec-h"><h2>Perfil de este dispositivo</h2></div>
  <div class="group"><div class="set-row"><span class="lab">Quién usa este dispositivo</span><div class="seg">${['jose', 'blanca'].map((p) => `<button class="${S.device === p ? 'on' : ''}" data-act="device" data-p="${p}">${PEOPLE[p].name}</button>`).join('')}</div></div></div>
  <p class="set-note">Cada registro guarda quién lo hizo, así las estadísticas de cada uno no se mezclan.</p>
  <div class="sec-h"><h2>Actividades</h2></div>
  <div class="group"><button class="set-row" data-act="nav" data-v="gestionar"><span class="lab">Gestionar actividades</span><span class="val">${n} activas${arch ? ' · ' + arch + ' archivadas' : ''}${ICON.right}</span></button>
  <button class="set-row" data-act="newact"><span class="lab" style="color:var(--accent)">+ Nueva actividad</span><span></span></button></div>
  <div class="sec-h"><h2>Registro rápido</h2></div>
  <div class="group"><button class="set-row" data-act="nav" data-v="atajos"><span class="lab">Atajos de iOS y widget</span><span class="val">Configurar${ICON.right}</span></button></div>
  <div class="sec-h"><h2>Modo vacaciones · ${PEOPLE[S.device].name}</h2></div>
  <div class="group"><div class="set-row"><span class="lab">Congelar rachas</span><button class="switch ${vs.vac_on ? 'on' : ''}" data-act="vac" role="switch" aria-checked="${!!vs.vac_on}" aria-label="Modo vacaciones"></button></div>
  ${vs.vac_on ? `<div class="set-row"><span class="lab">Desde</span><input type="date" id="vac-from" value="${vs.vac_from || TODAY_S}" class="search" style="width:auto;margin:0"></div><div class="set-row"><span class="lab">Hasta</span><input type="date" id="vac-to" value="${vs.vac_to || TODAY_S}" class="search" style="width:auto;margin:0"></div>` : ''}</div>
  <p class="set-note">Durante esas fechas los hábitos no cuentan como pendientes y ninguna racha se rompe. Para un solo día, usa «Saltar» en el menú ⋯ de la actividad.</p>
  <div class="sec-h"><h2>Apariencia</h2></div>
  <div class="group"><div class="set-row"><span class="lab">Tema</span><div class="seg">${[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([id, l]) => `<button class="${S.theme === id ? 'on' : ''}" data-act="theme" data-t="${id}">${l}</button>`).join('')}</div></div></div>
  <div class="sec-h"><h2>Datos</h2></div>
  <div class="group"><div class="set-row"><span class="lab">Sincronización</span>${syncChip()}</div><button class="set-row" data-act="sync"><span class="lab" style="color:var(--accent)">Actualizar ahora</span><span></span></button></div>
  <p class="set-note">${APP_NAME} v4.2</p>`;
}
function viewManage() {
  const blocks = CATS.map((c) => {
    const list = ACTS.filter((a) => a.cat === c.id && !a.archived).sort((x, y) => x.order - y.order);
    return `<div class="sec-h"><h2>${c.icon} ${c.name}</h2><span>${list.length}</span></div><div class="group">${list.map((a, i) => `<div class="m-row" style="--c:${c.color}"><span class="tile">${a.icon}</span><span style="min-width:0"><div class="row-name">${esc(a.name)}</div><div class="m-meta">${typeText(a)} · ${freqText(a)} · ${SLOTNAME[a.slot]} · ${whoText(a.who)}</div></span>
      <span class="m-act">${S.reorder ? `<button class="icon-btn" data-act="mv" data-a="${a.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${ICON.up}</button><button class="icon-btn" data-act="mv" data-a="${a.id}" data-dir="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Bajar">${ICON.down}</button>` : `<button class="icon-btn" data-act="editact" data-a="${a.id}" aria-label="Editar">${ICON.edit}</button>`}</span></div>`).join('') || '<div class="set-row" style="color:var(--muted)">Sin actividades</div>'}</div>`;
  }).join('');
  const arch = ACTS.filter((a) => a.archived);
  return `<button class="back" data-act="nav" data-v="ajustes">${ICON.left}Ajustes</button>
    ${topBar('Actividades', 'Crea, edita, reordena o archiva sin tocar el código')}
    <div class="controls"><button class="btn primary" data-act="newact">+ Nueva actividad</button><button class="btn" data-act="reorder">${S.reorder ? 'Listo' : 'Reordenar'}</button></div>
    ${blocks}${arch.length ? `<div class="sec-h"><h2>Archivadas</h2><span>Su historial se conserva</span></div><div class="group">${arch.map((a) => `<div class="m-row" style="--c:${CAT[a.cat].color}"><span class="tile">${a.icon}</span><span class="row-name">${esc(a.name)}</span><button class="btn small" data-act="unarchive" data-a="${a.id}">Restaurar</button></div>`).join('')}</div>` : ''}`;
}
function viewShortcuts() {
  const p = S.device, base = SUPABASE_URL.replace(/\/+$/, '');
  const menuUrl = `${base}/rest/v1/rpc/shortcut_menu?p_profile=${p}`, logUrl = `${base}/rest/v1/rpc/quick_log`;
  const copyRow = (lab, val) => `<div class="copy"><div style="min-width:0"><div class="lab">${lab}</div><code>${esc(val)}</code></div><button class="btn small" data-act="copy" data-v="${esc(val)}">Copiar</button></div>`;
  const acts = ACTS.filter((a) => !a.archived && owns(a, p) && a.type !== 'avoid').sort((x, y) => (CATS.findIndex((c) => c.id === x.cat) - CATS.findIndex((c) => c.id === y.cat)) || x.order - y.order);
  return `<button class="back" data-act="nav" data-v="ajustes">${ICON.left}Ajustes</button>
  ${topBar('Atajos y widget', 'Registra con un toque desde la pantalla de inicio, sin abrir la app')}
  <div class="card"><ol class="steps">
    <li>Abre la app <b>Atajos</b> de Apple y crea el atajo «Registrar hábito» siguiendo la guía de instalación.</li>
    <li>Cuando la guía te pida un dato, cópialo de esta pantalla con el botón <b>Copiar</b>.</li>
    <li>Añade el widget de <b>Atajos</b> a tu pantalla de inicio, o asigna el atajo al <b>Botón de Acción</b>.</li>
  </ol></div>
  <div class="sec-h"><h2>Datos para ${PEOPLE[p].name}</h2><span>perfil de este dispositivo</span></div>
  <div class="group">${copyRow('1 · URL del menú (Obtener contenido de URL)', menuUrl)}${copyRow('2 · URL para registrar (Obtener contenido de URL, método POST)', logUrl)}${copyRow('3 · Cabecera «apikey»', SUPABASE_ANON_KEY)}${copyRow('4 · Campo «p_profile» del cuerpo JSON', p)}</div>
  <div class="actions" style="margin-top:12px"><button class="btn" data-act="testsc">Probar conexión</button></div><div id="sc-test" class="set-note"></div>
  <div class="sec-h"><h2>Para atajos de una sola actividad</h2><span>valor de «p_activity»</span></div>
  <div class="group">${acts.map((a) => copyRow(CAT[a.cat].name, a.icon + ' ' + a.name)).join('')}</div>
  <p class="set-note">En las actividades con cantidad, cada toque suma ${'un paso'} (por ejemplo, +1 vaso). Los hábitos a evitar no aparecen para no registrar una recaída por error.</p>`;
}

/* ---------- Hojas ---------- */
function openSheet(html) { $('#layer').innerHTML = `<div class="overlay" data-act="closeov"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`; }
function closeSheet() { $('#layer').innerHTML = ''; }
function menuSheet(aid) {
  const a = ACT(aid), p = S.profile, d = S.date, r = LOG.get(key(p, aid, d));
  let items = '';
  if (a.type === 'avoid') items = `<button data-act="set" data-a="${aid}" data-s="fail">🔴 Registrar recaída<span class="desc">&nbsp;· reinicia el contador</span></button>`;
  else {
    items = `<button data-act="set" data-a="${aid}" data-s="done">✅ ${a.type === 'qty' ? 'Completar la meta' : 'Marcar como hecho'}</button>`;
    if (a.type === 'qty') items += `<button data-act="qtysheet" data-a="${aid}">🔢 Ajustar cantidad</button>`;
    if (!a.weekly) items += `<button data-act="set" data-a="${aid}" data-s="skip">⏭️ Saltar este día<span class="desc">&nbsp;· no rompe la racha</span></button>`;
    items += `<button data-act="set" data-a="${aid}" data-s="fail">❌ Marcar como fallido</button>`;
  }
  items += `<button data-act="note" data-a="${aid}">📝 ${r && r.note ? 'Editar nota' : 'Añadir nota'}</button><button data-act="detail" data-a="${aid}">📈 Ver ficha y estadísticas</button>`;
  if (r) items += `<button class="red" data-act="set" data-a="${aid}" data-s="clear">↩️ Quitar el registro de ${d === TODAY_S ? 'hoy' : 'ese día'}</button>`;
  openSheet(`<h3>${a.icon} ${esc(a.name)}</h3><div class="sheet-list">${items}</div><div class="actions" style="margin-top:12px"><button class="btn" data-act="close">Cancelar</button></div>`);
}
function noteSheet(aid) {
  const a = ACT(aid), r = LOG.get(key(S.profile, aid, S.date));
  openSheet(`<h3>Nota · ${esc(a.name)}</h3><div class="field"><label for="note-in">Nota corta</label><textarea id="note-in" maxlength="200" placeholder="Ej. 5 km, con Blanca, capítulo 4…">${esc((r && r.note) || '')}</textarea></div>
    <div class="actions"><button class="btn" data-act="close">Cancelar</button><button class="btn primary" data-act="savenote" data-a="${aid}">${r ? 'Guardar nota' : 'Registrar con nota'}</button></div>`);
  setTimeout(() => $('#note-in') && $('#note-in').focus(), 50);
}
function qtySheet(aid) {
  const a = ACT(aid), r = LOG.get(key(S.profile, aid, S.date));
  openSheet(`<h3>${a.icon} ${esc(a.name)}</h3><div class="field"><label for="qty-in">Cantidad (${esc(a.unit)}) · meta ${fmtNum(a.goal)}</label><input id="qty-in" type="number" inputmode="decimal" min="0" step="any" value="${(r && r.qty) || 0}"></div>
    <div class="actions"><button class="btn" data-act="close">Cancelar</button><button class="btn primary" data-act="saveqty" data-a="${aid}">Guardar</button></div>`);
}
function customSheet(cid) {
  openSheet(`<h3>Actividad puntual · ${CAT[cid].icon} ${CAT[cid].name}</h3><div class="field"><label for="cu-name">Qué hiciste</label><input id="cu-name" maxlength="60" placeholder="Ej. Organizar el garaje"></div>
    <div class="field"><label for="cu-note">Nota (opcional)</label><input id="cu-note" maxlength="200"></div><p class="set-note" style="padding:0 0 10px">Se registra una sola vez. Si quieres seguirla a diario, créala como actividad en Ajustes.</p>
    <div class="actions"><button class="btn" data-act="close">Cancelar</button><button class="btn primary" data-act="savecustom" data-c="${cid}">Registrar</button></div>`);
}
function editSheet(k) {
  const r = LOG.get(k); if (!r) return;
  const [p, aid, d] = k.split('|'), a = ACT(aid);
  const stSeg = a.type === 'avoid' || a.custom ? '' : `<div class="field"><label>Estado</label><div class="seg">${[['done', 'Hecho'], ['skip', 'Saltado'], ['fail', 'Fallido']].map(([id, l]) => `<button class="${r.status === id ? 'on' : ''}" data-act="edst" data-s="${id}">${l}</button>`).join('')}</div></div>`;
  openSheet(`<h3>${a.icon} ${esc(a.name)}</h3><p class="set-note" style="padding:0 0 12px">Registrado por ${PEOPLE[p].name}</p>
    <div class="two"><div class="field"><label for="ed-date">Fecha</label><input id="ed-date" type="date" max="${TODAY_S}" value="${d}"></div><div class="field"><label for="ed-time">Hora</label><input id="ed-time" type="time" value="${esc(r.time || '')}"></div></div>
    ${stSeg}${a.type === 'qty' ? `<div class="field"><label for="ed-qty">Cantidad (${esc(a.unit)})</label><input id="ed-qty" type="number" min="0" step="any" value="${r.qty || 0}"></div>` : ''}
    <div class="field"><label for="ed-note">Nota</label><textarea id="ed-note" maxlength="200">${esc(r.note || '')}</textarea></div>
    <div class="actions"><button class="btn" data-act="close">Cancelar</button><button class="btn primary" data-act="saveedit" data-k="${esc(k)}">Guardar cambios</button></div>
    <div id="del-zone"><button class="btn danger block" style="margin-top:10px" data-act="askdel">Borrar registro</button></div>`);
  $('#layer').dataset.st = r.status;
}
const EMOJIS = ['🧘', '📓', '🙏', '🌿', '💧', '💊', '🚶', '🏃', '🏋️', '🥗', '😴', '🩺', '❤️', '📞', '🎁', '✈️', '💰', '🧾', '📊', '💼', '🎯', '📚', '📖', '🎧', '🌳', '🎸', '✍️', '🧹', '🚭', '📵', '🍬', '🍷'];
function actForm(aid) {
  const a = aid ? ACT(aid) : { name: '', cat: S.cat || 'salud', icon: '⭐', type: 'check', goal: 8, unit: '', step: 1, weekly: 0, slot: 'any', who: 'ambos' };
  const emojis = EMOJIS.includes(a.icon) ? EMOJIS : [a.icon].concat(EMOJIS.slice(0, 31));
  const seg = (name, opts, val) => `<div class="seg" data-name="${name}" style="flex-wrap:wrap">${opts.map(([v, l]) => `<button type="button" class="${String(val) === String(v) ? 'on' : ''}" data-act="fseg" data-v="${v}">${l}</button>`).join('')}</div>`;
  openSheet(`<h3>${aid ? 'Editar actividad' : 'Nueva actividad'}</h3>
    <div class="field"><label for="f-name">Nombre</label><input id="f-name" maxlength="60" value="${esc(a.name)}" placeholder="Ej. Estirar 10 minutos"></div>
    <div class="field"><label for="f-cat">Categoría</label><select id="f-cat">${CATS.map((c) => `<option value="${c.id}" ${a.cat === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}</select></div>
    <div class="field"><label>Icono</label><div class="emoji-grid" id="f-icon">${emojis.map((e) => `<button type="button" class="${a.icon === e ? 'on' : ''}" data-act="femoji" data-e="${e}">${e}</button>`).join('')}</div></div>
    <div class="field"><label>Tipo</label>${seg('type', [['check', 'Sí / No'], ['qty', 'Cantidad'], ['avoid', 'Evitar']], a.type)}</div>
    <div id="f-qty" ${a.type === 'qty' ? '' : 'hidden'}><div class="two"><div class="field"><label for="f-goal">Meta diaria</label><input id="f-goal" type="number" min="1" step="any" value="${a.goal || 8}"></div><div class="field"><label for="f-unit">Unidad</label><input id="f-unit" maxlength="15" value="${esc(a.unit || '')}" placeholder="vasos, páginas, min"></div></div>
      <div class="field"><label for="f-step">Cuánto suma cada toque en +</label><input id="f-step" type="number" min="0.1" step="any" value="${a.step || 1}"></div></div>
    <div class="field" id="f-freq-box" ${a.type === 'avoid' ? 'hidden' : ''}><label>Frecuencia</label>${seg('weekly', [[0, 'Diaria'], [1, '1× semana'], [2, '2× semana'], [3, '3× semana'], [5, '5× semana']], a.weekly)}</div>
    <div class="field"><label>Momento del día</label>${seg('slot', SLOTS, a.slot)}</div>
    <div class="field"><label>Quién la sigue</label>${seg('who', [['jose', 'José'], ['blanca', 'Blanca'], ['ambos', 'Ambos']], a.who)}</div>
    <div class="actions"><button class="btn" data-act="close">Cancelar</button><button class="btn primary" data-act="saveact" data-a="${aid || ''}">${aid ? 'Guardar' : 'Crear actividad'}</button></div>
    ${aid ? `<button class="btn danger block" style="margin-top:10px" data-act="archive" data-a="${aid}">Archivar (se conserva el historial)</button>` : ''}`);
}
function goalForm() {
  openSheet(`<h3>Nueva meta a largo plazo</h3><div class="field"><label for="g-name">Meta</label><input id="g-name" maxlength="60" placeholder="Ej. Leer 12 libros este año"></div>
  <div class="field"><label for="g-cat">Categoría</label><select id="g-cat">${CATS.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}</select></div>
  <div class="two"><div class="field"><label for="g-target">Objetivo</label><input id="g-target" type="number" min="1" step="any" value="12"></div><div class="field"><label for="g-unit">Unidad</label><input id="g-unit" maxlength="15" value="libros"></div></div>
  <div class="two"><div class="field"><label for="g-start">Desde</label><input id="g-start" type="date" value="${TODAY.getFullYear()}-01-01"></div><div class="field"><label for="g-end">Fecha límite</label><input id="g-end" type="date" min="${TODAY_S}" value="${TODAY.getFullYear()}-12-31"></div></div>
  <div class="field"><label for="g-init">Llevas hasta hoy (opcional)</label><input id="g-init" type="number" min="0" step="any" value="0"></div>
  <div class="actions"><button class="btn" data-act="close">Cancelar</button><button class="btn primary" data-act="savegoal">Crear meta</button></div>`);
}
function goalAddSheet(gid) {
  const g = GOALS.find((x) => x.id === gid);
  openSheet(`<h3>${esc(g.name)}</h3><div class="field"><label for="ga-amt">Cantidad a sumar (${esc(g.unit)}). Usa un número negativo para corregir.</label><input id="ga-amt" type="number" step="any" value="${g.step}"></div>
  <div class="actions"><button class="btn" data-act="close">Cancelar</button><button class="btn primary" data-act="goaladdsave" data-g="${esc(gid)}">Sumar</button></div>
  <button class="btn danger block" style="margin-top:10px" data-act="goalarchive" data-g="${esc(gid)}">Archivar meta</button>`);
}
function deviceSheet() {
  openSheet(`<h3>¿Quién usa este dispositivo?</h3><p class="set-note" style="padding:0 0 12px">Tus registros se guardarán con tu nombre. Puedes cambiarlo en Ajustes.</p>
    <div class="actions"><button class="btn primary" data-act="device" data-p="jose">${PEOPLE.jose.name}</button><button class="btn primary" data-act="device" data-p="blanca" style="background:${PEOPLE.blanca.color}">${PEOPLE.blanca.name}</button></div>`);
}

/* ---------- Ficha de detalle ---------- */
function detailSheet(aid) {
  const a = ACT(aid);
  if (a.custom) { toast('Las actividades puntuales no tienen ficha'); return; }
  const p = S.profile === 'ambos' ? (owns(a, S.device) ? S.device : (owns(a, 'jose') ? 'jose' : 'blanca')) : S.profile, c = CAT[a.cat].color;
  const ser = strengthSeries(a, p), strNow = ser[ser.length - 1], cur = streak(a, p), best = bestStreak(a, p);
  const r30 = actRate(a, p, addDays(TODAY, -29), TODAY);
  const tail = a.weekly ? ser : ser.slice(-90), W = 300, H = 70;
  const pts = tail.map((v, i) => [(i / Math.max(1, tail.length - 1)) * W, H - 6 - v * (H - 12)]);
  const line = pts.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' ');
  const spark = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Evolución de la fuerza del hábito"><polygon points="0,${H} ${line} ${W},${H}" fill="${c}" opacity=".14"/><polyline points="${line}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${pts[pts.length - 1][0] - 3}" cy="${pts[pts.length - 1][1]}" r="4" fill="${c}"/></svg>`;
  const start = addDays(weekStart(TODAY), -52 * 7); let cells = '', months = '', lastM = -1;
  for (let w = 0; w <= 52; w++) {
    const wd = addDays(start, w * 7); months += `<span>${wd.getMonth() !== lastM && wd.getDate() <= 7 ? MON3[wd.getMonth()] : ''}</span>`; if (wd.getDate() <= 7) lastM = wd.getMonth();
    for (let i = 0; i < 7; i++) {
      const x = addDays(wd, i); if (x > TODAY) { cells += '<span class="yg" style="opacity:.25"></span>'; continue; }
      const s = ds(x), st = status(a, p, s), rec = LOG.get(key(p, a.id, s));
      let cls = 'yg', style = '';
      if (st === 'done') { const op = a.type === 'qty' ? Math.min(1, 0.45 + 0.55 * ((rec && rec.qty) || 0) / a.goal) : 1; style = `background:${c};opacity:${a.type === 'avoid' ? 0.55 : op}`; }
      else if (st === 'partial') style = `background:${c};opacity:.28`;
      else if (st === 'skip' || st === 'vac') cls += ' skip'; else if (st === 'fail') cls += ' fail'; else if (st === 'none') style = 'opacity:.35';
      cells += `<span class="${cls}" style="${style}" title="${s}"></span>`;
    }
  }
  const wk = DOW.map((l, i) => { let d = 0, t = 0; for (let k = 1; k <= 91; k++) { const x = addDays(TODAY, -k); if (dowIdx(x) !== i) continue; const st = status(a, p, ds(x)); if (neutral(st)) continue; t++; if (st === 'done') d++; } return { l, r: t ? d / t : 0, t }; });
  const bw = 300 / 7, wkSvg = `<svg viewBox="0 0 300 120" width="100%" role="img" aria-label="Cumplimiento por día de la semana">${wk.map((w, i) => `<rect x="${(i * bw + bw * 0.2).toFixed(1)}" y="${(18 + 78 * (1 - w.r)).toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${Math.max(2, 78 * w.r).toFixed(1)}" rx="5" fill="${c}" opacity="${0.45 + 0.55 * w.r}"/><text x="${(i * bw + bw / 2).toFixed(1)}" y="114" text-anchor="middle">${w.l}</text><text x="${(i * bw + bw / 2).toFixed(1)}" y="${(13 + 78 * (1 - w.r)).toFixed(1)}" text-anchor="middle">${w.t ? pct(w.r) + '%' : ''}</text>`).join('')}</svg>`;
  const notes = [];
  for (let i = 0; i < HISTORY_DAYS && notes.length < 5; i++) { const s = ds(addDays(TODAY, -i)), r = LOG.get(key(p, a.id, s)); if (r && r.note) notes.push(`<div class="note-it"><span>${niceDate(s)}</span>${esc(r.note)}</div>`); }
  const unitStreak = a.weekly ? 'semanas' : 'días';
  openSheet(`<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;--c:${c}"><span class="tile" style="width:52px;height:52px;font-size:26px;border-radius:15px">${a.icon}</span><div style="min-width:0"><h3 style="margin:0">${esc(a.name)}</h3><div class="row-meta"><span class="dot"></span>${CAT[a.cat].name} · ${typeText(a)} · ${freqText(a)}${S.profile === 'ambos' ? ' · ' + PEOPLE[p].name : ''}</div></div></div>
    <div class="tiles"><div class="st"><b class="num">${cur}</b><span>${a.type === 'avoid' ? 'Días sin recaer' : 'Racha actual (' + unitStreak + ')'}</span></div><div class="st"><b class="num">${best}</b><span>Mejor racha (${unitStreak})</span></div>
    <div class="st"><b class="num">${pct(r30)}%</b><span>Cumplimiento, 30 días</span></div><div class="st"><b class="num" style="color:${c}">${pct(strNow)}</b><span>Fuerza del hábito (0–100)</span></div></div>
    <div class="sec-h"><h2>Fuerza del hábito</h2><span>${a.weekly ? 'últimas 60 semanas' : 'últimos 90 días'}</span></div><div class="card" style="box-shadow:none;background:var(--surface-2)">${spark}<p class="cap" style="margin:6px 0 0">Sube con cada día cumplido y baja poco a poco con los fallos. Un mal día no borra meses de trabajo.</p></div>
    <div class="sec-h"><h2>Último año</h2><span>un cuadro por día</span></div><div class="gridwrap" id="gw"><div class="months">${months}</div><div class="yeargrid">${cells}</div></div>
    <div class="sec-h"><h2>Por día de la semana</h2><span>% de cumplimiento, 13 semanas</span></div>${wkSvg}
    ${notes.length ? `<div class="sec-h"><h2>Notas recientes</h2></div><div class="notes-list">${notes.join('')}</div>` : ''}
    <div class="actions" style="margin-top:16px"><button class="btn" data-act="close">Cerrar</button><button class="btn primary" data-act="editact" data-a="${a.id}">Editar actividad</button></div>`);
  const gw = $('#gw'); if (gw) gw.scrollLeft = gw.scrollWidth;
}

/* ---------- Registrar, deshacer y celebrar ---------- */
function toast(msg, undo) {
  clearTimeout(toastTimer);
  let el = $('#toast'); if (el) el.remove();
  el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${msg}</span>${undo ? '<button data-act="undo">Deshacer</button>' : ''}`;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 4200);
}
// Guarda (o borra, si rec es null) el registro k en memoria y en Supabase
function putLog(k, rec) {
  if (rec) { LOG.set(k, rec); persist({ kind: 'log-upsert', row: localToRow(k, rec) }); }
  else { LOG.delete(k); persist({ kind: 'log-delete', k, match: deleteMatch(k) }); }
}
function writeRec(k, rec, msg) {
  const prev = LOG.has(k) ? { ...LOG.get(k) } : null;
  putLog(k, rec);
  undoStack = { k, prev };
  if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate(12);
  render(); if (msg) toast(msg, true);
}
function afterDone(a) {
  if (S.date !== TODAY_S || a.type === 'avoid') return;
  const n = streak(a, S.profile), ms = [7, 30, 100].find((m) => m === n);
  const id = S.profile + ':' + a.id + ':' + ms + ':' + TODAY_S;
  if (ms && !celebrated.has(id)) { celebrated.add(id); lsSet('habitos_celebrated', [...celebrated].slice(-200)); setTimeout(() => celebrate(a, n), 350); }
}
function celebrate(a, n) {
  const c = CAT[a.cat].color, p = S.profile === 'ambos' ? S.device : S.profile;
  const last = Array.from({ length: 14 }, (_, i) => status(a, p, ds(addDays(TODAY, i - 13))) === 'done');
  const el = document.createElement('div'); el.className = 'celebrate'; el.dataset.act = 'closecel';
  el.innerHTML = `<div class="cel-card" style="--c:${c}"><div class="big">🔥</div><h3>¡${n} días seguidos!</h3><div style="color:var(--muted)">${esc(a.name)} · logro «${n === 7 ? 'Primera semana' : n === 30 ? 'Un mes sin fallar' : 'Centenario'}» desbloqueado</div>
    <div class="share"><div class="s-top"><span>${PEOPLE[p].name} · ${APP_NAME}</span><span>${TODAY.getDate()} ${MON3[TODAY.getMonth()]} ${TODAY.getFullYear()}</span></div><div class="s-n">${n} días</div><div>${a.icon} ${esc(a.name)}</div><div class="s-d">${last.map((on) => `<i class="${on ? 'on' : ''}"></i>`).join('')}</div></div>
    <div class="actions"><button class="btn primary" data-act="closecel">Genial</button></div><p class="set-note" style="padding:8px 0 0">Para compartirla, haz una captura de pantalla.</p></div>`;
  document.body.appendChild(el); confetti(c);
}
function confetti(color) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas'); cv.id = 'confetti'; document.body.appendChild(cv);
  const ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const cols = [color, '#F7C948', '#4C92FF', '#EC4899', '#10B981'];
  const ps = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.38, vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 12 - 4, s: 5 + Math.random() * 6, r: Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)] }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ps.forEach((q) => { q.vy += 0.35; q.x += q.vx; q.y += q.vy; q.r += 0.12; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.r); ctx.fillStyle = q.c; ctx.fillRect(-q.s / 2, -q.s / 4, q.s, q.s / 2); ctx.restore(); });
    if (t - t0 < 2200) requestAnimationFrame(frame); else cv.remove();
  })(t0);
}
function quickLog(a, p) {
  const k = key(p, a.id, TODAY_S), r = LOG.get(k);
  if (a.type === 'qty') { const q = ((r && r.qty) || 0) + a.step; S.date = TODAY_S; writeRec(k, { status: 'done', time: nowTime(), note: (r && r.note) || '', qty: q }, `${a.icon} ${fmtNum(q)} de ${fmtNum(a.goal)} ${esc(a.unit)}`); }
  else if (a.type === 'avoid') toast('Los hábitos a evitar se registran desde la app, con el menú ⋯');
  else { S.date = TODAY_S; writeRec(k, { status: 'done', time: nowTime(), note: (r && r.note) || '' }, `✓ ${esc(a.name)}`); afterDone(a); }
}

/* ---------- Eventos ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, aid = el.dataset.a, a = aid && ACT(aid), p = S.profile, d = S.date;
  if ((act === 'closeov' && e.target !== el) || (act === 'closecel' && e.target.closest('.cel-card') && !e.target.closest('button'))) return;
  const k = aid ? key(p, aid, d) : null;
  switch (act) {
    case 'nav': S.view = el.dataset.v; S.reorder = false; closeSheet(); render(); window.scrollTo(0, 0); break;
    case 'profile': S.profile = el.dataset.p; render(); break;
    case 'device': S.device = el.dataset.p; S.profile = el.dataset.p; lsSet('habitos_device', S.device); closeSheet(); render(); toast('Este dispositivo registra como ' + PEOPLE[S.device].name); break;
    case 'date': S.date = el.dataset.d > TODAY_S ? TODAY_S : el.dataset.d; render(); break;
    case 'opencat': S.cat = el.dataset.c; S.view = 'categoria'; render(); window.scrollTo(0, 0); break;
    case 'sync': loadAll(); break;
    case 'toggle': {
      const st = status(a, p, d);
      if (st === 'done' || st === 'skip' || st === 'fail') writeRec(k, null, `${esc(a.name)}: registro quitado`);
      else { writeRec(k, { status: 'done', time: nowTime(), note: '' }, `✓ ${esc(a.name)}`); const b = document.querySelector(`[data-act="toggle"][data-a="${aid}"]`); if (b) b.classList.add('pop'); afterDone(a); }
      break;
    }
    case 'inc': {
      const r = LOG.get(k), q = ((r && r.qty) || 0) + a.step;
      writeRec(k, { status: 'done', time: nowTime(), note: (r && r.note) || '', qty: q }, `${a.icon} ${fmtNum(q)} de ${fmtNum(a.goal)} ${esc(a.unit)}`);
      if (q >= a.goal && q - a.step < a.goal) afterDone(a);
      break;
    }
    case 'menu': if (p === 'ambos') return; menuSheet(aid); break;
    case 'set': {
      const s = el.dataset.s, r = LOG.get(k); closeSheet();
      if (s === 'clear') writeRec(k, null, `${esc(a.name)}: registro quitado`);
      else if (s === 'done') { writeRec(k, { status: 'done', time: nowTime(), note: (r && r.note) || '', qty: a.type === 'qty' ? Math.max(a.goal, (r && r.qty) || 0) : undefined }, `✓ ${esc(a.name)}`); afterDone(a); }
      else writeRec(k, { status: s, time: nowTime(), note: (r && r.note) || '', qty: r && r.qty }, s === 'skip' ? `${esc(a.name)}: saltado, la racha sigue intacta` : a.type === 'avoid' ? `${esc(a.name)}: recaída registrada` : `${esc(a.name)}: marcado como fallido`);
      break;
    }
    case 'note': noteSheet(aid); break;
    case 'savenote': { const r = LOG.get(k), v = $('#note-in').value.trim(); closeSheet(); writeRec(k, r ? { ...r, note: v } : { status: 'done', time: nowTime(), note: v, qty: a.type === 'qty' ? a.step : undefined }, `📝 Nota guardada · ${esc(a.name)}`); break; }
    case 'qtysheet': qtySheet(aid); break;
    case 'saveqty': { const v = Math.max(0, Number($('#qty-in').value) || 0), r = LOG.get(k); closeSheet(); writeRec(k, v ? { status: 'done', time: (r && r.time) || nowTime(), note: (r && r.note) || '', qty: v } : null, `${a.icon} ${fmtNum(v)} ${esc(a.unit)}`); if (v >= a.goal) afterDone(a); break; }
    case 'detail': closeSheet(); detailSheet(aid); break;
    case 'close': case 'closeov': closeSheet(); break;
    case 'closecel': document.querySelectorAll('.celebrate').forEach((x) => x.remove()); break;
    case 'undo': if (undoStack) { const { k: uk, prev } = undoStack; putLog(uk, prev); undoStack = null; render(); toast('Deshecho'); } break;
    case 'custom': customSheet(el.dataset.c); break;
    case 'savecustom': {
      const name = $('#cu-name').value.trim(); if (!name) { $('#cu-name').focus(); return; }
      if (p === 'ambos') { closeSheet(); toast('Elige José o Blanca para registrar'); return; }
      const id = 'c:' + uuid(), cnote = $('#cu-note').value.trim(), cat = el.dataset.c;
      CUSTOM[id] = { id, name, cat, icon: CAT[cat].icon, type: 'check', custom: true, who: 'ambos', slot: 'any', weekly: 0 };
      closeSheet(); writeRec(key(p, id, d), { status: 'done', time: nowTime(), note: cnote }, `✓ ${esc(name)} (puntual)`); break;
    }
    case 'hcat': S.histCat = el.dataset.c; render(); break;
    case 'edit': editSheet(el.dataset.k); break;
    case 'edst': $('#layer').dataset.st = el.dataset.s; el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); break;
    case 'saveedit': {
      const ok = el.dataset.k, r = LOG.get(ok), [pp, ai, od] = ok.split('|'); let nd = $('#ed-date').value || od; if (nd > TODAY_S) nd = TODAY_S;
      const nr = { ...r, time: $('#ed-time').value || r.time, note: $('#ed-note').value.trim(), status: $('#layer').dataset.st || r.status };
      if ($('#ed-qty')) nr.qty = Math.max(0, Number($('#ed-qty').value) || 0);
      const nk = key(pp, ai, nd);
      if (nk !== ok) putLog(ok, null);
      putLog(nk, nr); undoStack = null; closeSheet(); render(); toast('Registro actualizado'); break;
    }
    case 'askdel': $('#del-zone').innerHTML = `<div class="confirm">¿Borrar este registro? No se puede deshacer.<div class="actions"><button class="btn" data-act="canceldel">Cancelar</button><button class="btn danger" data-act="dodel">Borrar</button></div></div>`; break;
    case 'canceldel': $('#del-zone').innerHTML = `<button class="btn danger block" style="margin-top:10px" data-act="askdel">Borrar registro</button>`; break;
    case 'dodel': { const ok = document.querySelector('[data-act="saveedit"]').dataset.k; putLog(ok, null); closeSheet(); render(); toast('Registro borrado'); break; }
    case 'period': S.period = el.dataset.p; render(); break;
    case 'hmcat': S.hmCat = el.dataset.c; render(); break;
    case 'hmoff': S.hmOff = Math.max(0, S.hmOff + Number(el.dataset.v)); render(); break;
    case 'hmday': S.cat = S.hmCat; S.date = el.dataset.d; S.view = 'categoria'; render(); window.scrollTo(0, 0); break;
    case 'goalinc': { const g = GOALS.find((x) => x.id === el.dataset.g), row = { id: uuid(), goal_id: g.id, amount: g.step, entry_date: TODAY_S, created_at: new Date().toISOString() }; applyOp({ kind: 'goal-entry', row }); persist({ kind: 'goal-entry', row }); render(); toast(`${esc(g.name)}: ${fmtNum(goalCurrent(g))} ${esc(g.unit)}`); break; }
    case 'goaladd': goalAddSheet(el.dataset.g); break;
    case 'goaladdsave': { const g = GOALS.find((x) => x.id === el.dataset.g), v = Number($('#ga-amt').value) || 0; closeSheet(); if (!v) return; const row = { id: uuid(), goal_id: g.id, amount: v, entry_date: TODAY_S, created_at: new Date().toISOString() }; applyOp({ kind: 'goal-entry', row }); persist({ kind: 'goal-entry', row }); render(); toast(`${esc(g.name)}: ${fmtNum(goalCurrent(g))} ${esc(g.unit)}`); break; }
    case 'goalarchive': { const g = GOALS.find((x) => x.id === el.dataset.g), row = { ...g, archived: true }; applyOp({ kind: 'goal-upsert', row }); persist({ kind: 'goal-upsert', row: goalRow(row) }); closeSheet(); render(); toast('Meta archivada'); break; }
    case 'newgoal': goalForm(); break;
    case 'savegoal': {
      const name = $('#g-name').value.trim(); if (!name) { $('#g-name').focus(); return; }
      const t = Math.max(0.1, Number($('#g-target').value) || 1), start = $('#g-start').value || TODAY_S;
      const g = { id: 'g-' + uuid().slice(0, 8), name, category_id: $('#g-cat').value, target: t, unit: $('#g-unit').value.trim() || 'unidades', step: t >= 20 ? Math.round(t / 20) : 1, start_date: start > TODAY_S ? TODAY_S : start, end_date: $('#g-end').value || TODAY.getFullYear() + '-12-31', profile: S.device, archived: false };
      applyOp({ kind: 'goal-upsert', row: g }); persist({ kind: 'goal-upsert', row: goalRow(g) });
      const init = Number($('#g-init').value) || 0;
      if (init) { const row = { id: uuid(), goal_id: g.id, amount: init, entry_date: TODAY_S, created_at: new Date().toISOString() }; applyOp({ kind: 'goal-entry', row }); persist({ kind: 'goal-entry', row }); }
      closeSheet(); render(); toast('Meta creada'); break;
    }
    case 'vac': {
      const cur = SETTINGS[S.device] || { profile: S.device };
      const row = { profile: S.device, vac_on: !cur.vac_on, vac_from: cur.vac_from || TODAY_S, vac_to: cur.vac_to || ds(addDays(TODAY, 7)) };
      applyOp({ kind: 'settings', row }); persist({ kind: 'settings', row }); render(); toast(row.vac_on ? 'Modo vacaciones activado' : 'Modo vacaciones desactivado'); break;
    }
    case 'theme': S.theme = el.dataset.t; lsSet('habitos_theme', S.theme); applyTheme(); render(); break;
    case 'newact': actForm(null); break;
    case 'editact': closeSheet(); actForm(aid); break;
    case 'fseg': { const box = el.parentElement; box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); if (box.dataset.name === 'type') { $('#f-qty').hidden = el.dataset.v !== 'qty'; $('#f-freq-box').hidden = el.dataset.v === 'avoid'; } break; }
    case 'femoji': el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); break;
    case 'saveact': {
      const name = $('#f-name').value.trim(); if (!name) { $('#f-name').focus(); return; }
      const segv = (n) => { const b = document.querySelector(`.seg[data-name="${n}"] button.on`); return b ? b.dataset.v : null; };
      const type = segv('type') || 'check';
      const data = { name, cat: $('#f-cat').value, icon: (document.querySelector('#f-icon button.on') || {}).textContent || '⭐', type, slot: segv('slot') || 'any', who: segv('who') || 'ambos', weekly: type === 'avoid' ? 0 : Number(segv('weekly') || 0) };
      if (type === 'qty') Object.assign(data, { goal: Math.max(0.1, Number($('#f-goal').value) || 1), unit: $('#f-unit').value.trim() || 'veces', step: Math.max(0.1, Number($('#f-step').value) || 1) });
      let a2;
      if (el.dataset.a) { a2 = { ...ACT(el.dataset.a), ...data }; }
      else { const maxO = Math.max(0, ...ACTS.filter((x) => x.cat === data.cat).map((x) => x.order)); a2 = { id: slug(name) + '-' + uuid().slice(0, 4), order: maxO + 10, archived: false, step: 1, goal: null, unit: '', ...data }; }
      applyOp({ kind: 'act-upsert', row: actToRow(a2) }); persist({ kind: 'act-upsert', row: actToRow(a2) });
      closeSheet(); render(); toast(el.dataset.a ? 'Actividad actualizada' : 'Actividad creada: ' + esc(name)); break;
    }
    case 'archive': case 'unarchive': { const a2 = { ...ACT(aid), archived: act === 'archive' }; applyOp({ kind: 'act-upsert', row: actToRow(a2) }); persist({ kind: 'act-upsert', row: actToRow(a2) }); closeSheet(); render(); toast(act === 'archive' ? `${esc(a2.name)} archivada` : 'Restaurada'); break; }
    case 'reorder': S.reorder = !S.reorder; render(); break;
    case 'mv': {
      const list = ACTS.filter((x) => x.cat === a.cat && !x.archived).sort((x, y) => x.order - y.order);
      list.forEach((x, i) => { x.order = i * 10; });
      const i = list.indexOf(a), j = i + Number(el.dataset.dir); if (j < 0 || j >= list.length) return;
      const o = list[j].order; list[j].order = a.order; a.order = o;
      list.forEach((x) => persist({ kind: 'act-upsert', row: actToRow(x) }));
      render(); break;
    }
    case 'copy': {
      const v = el.dataset.v;
      const done = () => { el.textContent = 'Copiado'; setTimeout(() => { el.textContent = 'Copiar'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(done).catch(() => toast('No se pudo copiar; mantén pulsado el texto'));
      break;
    }
    case 'testsc': {
      const out = $('#sc-test'); out.textContent = 'Probando…';
      if (!db) { out.textContent = 'Supabase no está disponible.'; return; }
      db.rpc('shortcut_menu', { p_profile: S.device }).then(({ data, error }) => {
        out.textContent = error ? '⚠️ ' + describeError(error) : `✓ Conexión correcta: el atajo mostrará ${data.length} actividades.`;
      }).catch((err) => { out.textContent = '⚠️ ' + describeError(err); });
      break;
    }
  }
});
function goalRow(g) { return { id: g.id, name: g.name, category_id: g.category_id, target: g.target, unit: g.unit, step: g.step, start_date: g.start_date, end_date: g.end_date, profile: g.profile || S.device, archived: !!g.archived }; }
document.addEventListener('change', (e) => {
  if (e.target.id === 'date-pick' && e.target.value) { S.date = e.target.value > TODAY_S ? TODAY_S : e.target.value; render(); }
  if (e.target.id === 'vac-from' || e.target.id === 'vac-to') {
    const cur = SETTINGS[S.device] || { profile: S.device, vac_on: true };
    const row = { profile: S.device, vac_on: true, vac_from: $('#vac-from').value || TODAY_S, vac_to: $('#vac-to').value || TODAY_S };
    if (row.vac_to < row.vac_from) row.vac_to = row.vac_from;
    applyOp({ kind: 'settings', row: { ...cur, ...row } }); persist({ kind: 'settings', row }); render();
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'hist-q') { S.histQ = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#hist-q'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); document.querySelectorAll('.celebrate').forEach((x) => x.remove()); } });

/* ---------- Registro desde enlace (compatibilidad con atajos antiguos) ---------- */
// ?log=agua&p=jose   ·   ?log=salud&activity=Beber%20agua (formato de la v3)
function handleUrlLog() {
  const q = new URLSearchParams(location.search);
  const target = q.get('activity') || q.get('log');
  if (!target) return;
  const p = PEOPLE[q.get('p')] ? q.get('p') : S.device;
  const t = target.trim().toLowerCase();
  const a = ACTS.find((x) => !x.archived && (x.id === t || x.name.toLowerCase() === t || (x.icon + ' ' + x.name).toLowerCase() === t));
  history.replaceState(null, '', location.pathname);
  if (!a) { toast('No encuentro la actividad «' + esc(target) + '»'); return; }
  S.profile = p; quickLog(a, p);
}

/* ---------- Arranque ---------- */
function applyTheme() { if (S.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.theme; }
async function init() {
  applyTheme();
  loadCache();
  try {
    const url = (typeof SUPABASE_URL === 'string' ? SUPABASE_URL : '').trim().replace(/\/rest\/v1\/?$/, '');
    if (window.supabase && url && SUPABASE_ANON_KEY) db = window.supabase.createClient(url, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  } catch (e) { S.syncErr = 'No se pudo iniciar Supabase: ' + e.message; }
  render();
  if (!device) deviceSheet();
  if (ACTS.length) handleUrlLog();
  await loadAll();
  if (location.search) handleUrlLog();
  window.addEventListener('online', () => loadAll());
  window.addEventListener('offline', () => updateSync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadAll(); });
  setInterval(() => { if (getQueue().length) flush(); }, 30000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
