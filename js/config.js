// ============================================================
//  config.js — Supabase client + app constants
// ============================================================

const SUPABASE_URL  = 'https://aotztjkfsrhproewrtue.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdHp0amtmc3JocHJvZXdydHVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MjMwODEsImV4cCI6MjA4OTM5OTA4MX0.VdnJY5_dnHsx4VtGewe3o_WOO_WMlHWfikdH0ezqfIY';

// Initialise lazily — ensures CDN is ready before createClient is called
let _dbInstance = null;
function getDb() {
  if (!_dbInstance) {
    _dbInstance = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  }
  return _dbInstance;
}
const db = new Proxy({}, { get(_, prop) { return getDb()[prop]; } });

const SPORTS      = ['Pool', 'Bowling', 'Golf'];
const POOL_MODES  = ['Singles', '2v1', '2v2'];
const SPORT_EMOJI = { Pool: '🎱', Bowling: '🎳', Golf: '⛳' };
const SETTINGS_PASSWORD = '123456789';

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function fmtPts(n) {
  const v = parseFloat(n) || 0;
  return v % 1 === 0 ? v.toFixed(0) : v.toFixed(1);
}
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}
function round2(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }
function toISODate(date) { return new Date(date).toISOString().split('T')[0]; }

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekNumber(matchDate, seasonStart) {
  const matchMonday  = getMondayOf(matchDate);
  const seasonMonday = getMondayOf(seasonStart || matchDate);
  const diffWeeks = Math.floor((matchMonday - seasonMonday) / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, diffWeeks + 1);
}

function checkPassword(msg = 'Enter settings password:') {
  return prompt(msg) === SETTINGS_PASSWORD;
}

function showToast(msg, type = '') {
  let container = document.getElementById('toasts');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.id = 'toasts';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function avatarHtml(player, cls = 'player-avatar') {
  if (player && player.photo_url) {
    return `<div class="${cls}"><img src="${player.photo_url}" alt="${player.name}" onerror="this.parentNode.innerHTML='${initials(player.name)}'"></div>`;
  }
  return `<div class="${cls}">${initials((player && player.name) || '?')}</div>`;
}