// ============================================================
//  config.js — Supabase client + app constants
//  REPLACE the two values below with your own project details
// ============================================================

// ── SUPABASE CREDENTIALS ─────────────────────────────────────
// Find these in: Supabase dashboard → Settings → API
const SUPABASE_URL  = 'https://aotztjkfsrhproewrtue.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdHp0amtmc3JocHJvZXdydHVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MjMwODEsImV4cCI6MjA4OTM5OTA4MX0.VdnJY5_dnHsx4VtGewe3o_WOO_WMlHWfikdH0ezqfIY';

// ── SUPABASE CLIENT ──────────────────────────────────────────
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── APP CONSTANTS ────────────────────────────────────────────
const SPORTS    = ['Pool', 'Bowling', 'Golf'];
const POOL_MODES = ['Singles', '2v1', '2v2'];

const SPORT_EMOJI = { Pool: '🎱', Bowling: '🎳', Golf: '⛳' };
const SPORT_COLOR = {
  Pool:    { bg: 'rgba(0,212,170,0.1)',  border: 'rgba(0,212,170,0.25)',  text: '#00d4aa' },
  Bowling: { bg: 'rgba(124,108,250,0.1)', border: 'rgba(124,108,250,0.25)', text: '#7c6cfa' },
  Golf:    { bg: 'rgba(56,189,248,0.1)',  border: 'rgba(56,189,248,0.25)',  text: '#38bdf8' }
};

// ── HELPERS ──────────────────────────────────────────────────
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
  return d.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' });
}

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Animated counter
function animateCount(el, target, duration = 800) {
  const start = parseFloat(el.textContent) || 0;
  const diff  = target - start;
  const steps = 40;
  let step    = 0;
  const timer = setInterval(() => {
    step++;
    const progress = step / steps;
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = start + diff * ease;
    el.textContent = fmtPts(current);
    if (step >= steps) { el.textContent = fmtPts(target); clearInterval(timer); }
  }, duration / steps);
}
