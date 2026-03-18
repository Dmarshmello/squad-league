-- ============================================================
--  SQUAD LEAGUE — Supabase Setup
--  Run this entire file in Supabase SQL Editor once
-- ============================================================

-- ── PLAYERS ──────────────────────────────────────────────────
create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  photo_url   text,
  created_at  timestamptz default now()
);

-- ── SEASONS ──────────────────────────────────────────────────
create table if not exists seasons (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  start_date      date,
  end_date        date,
  monthly_reward  text default 'Free meal paid by all players',
  is_active       boolean default true,
  created_at      timestamptz default now()
);

-- ── CONFIG ───────────────────────────────────────────────────
create table if not exists config (
  key    text primary key,
  value  text
);

-- ── MATCHES ──────────────────────────────────────────────────
create table if not exists matches (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid references seasons(id),
  week        integer not null,
  sport       text not null check (sport in ('Pool','Bowling','Golf')),
  pool_mode   text check (pool_mode in ('Singles','2v1','2v2')),
  notes       text,
  created_at  timestamptz default now()
);

-- ── MATCH PLACEMENTS ─────────────────────────────────────────
create table if not exists match_placements (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid references matches(id) on delete cascade,
  player_id  uuid references players(id),
  position   integer not null  -- 1 = winner, 2 = second, etc.
);

-- ── WEEK POINTS ──────────────────────────────────────────────
create table if not exists week_points (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid references seasons(id),
  week        integer not null,
  player_id   uuid references players(id),
  pool        numeric default 0,
  bowling     numeric default 0,
  golf        numeric default 0,
  bonus       numeric default 0,
  underdog    numeric default 0,
  total       numeric default 0,
  unique(season_id, week, player_id)
);

-- ── SEASON POINTS ─────────────────────────────────────────────
create table if not exists season_points (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid references seasons(id),
  player_id   uuid references players(id),
  pool        numeric default 0,
  bowling     numeric default 0,
  golf        numeric default 0,
  bonus       numeric default 0,
  underdog    numeric default 0,
  total       numeric default 0,
  unique(season_id, player_id)
);

-- ── ENABLE ROW LEVEL SECURITY (public read, open write) ──────
alter table players         enable row level security;
alter table seasons         enable row level security;
alter table config          enable row level security;
alter table matches         enable row level security;
alter table match_placements enable row level security;
alter table week_points     enable row level security;
alter table season_points   enable row level security;

-- Public read
create policy "Public read players"          on players          for select using (true);
create policy "Public read seasons"          on seasons          for select using (true);
create policy "Public read config"           on config           for select using (true);
create policy "Public read matches"          on matches          for select using (true);
create policy "Public read match_placements" on match_placements for select using (true);
create policy "Public read week_points"      on week_points      for select using (true);
create policy "Public read season_points"    on season_points    for select using (true);

-- Open write (anon key can insert/update — fine for a friends app)
create policy "Public insert matches"          on matches          for insert with check (true);
create policy "Public insert match_placements" on match_placements for insert with check (true);
create policy "Public insert week_points"      on week_points      for insert with check (true);
create policy "Public upsert week_points"      on week_points      for update using (true);
create policy "Public insert season_points"    on season_points    for insert with check (true);
create policy "Public upsert season_points"    on season_points    for update using (true);
create policy "Public update config"           on config           for update using (true);
create policy "Public insert config"           on config           for insert with check (true);

-- ── SEED: SEASON 2 ───────────────────────────────────────────
insert into seasons (name, start_date, end_date, monthly_reward, is_active)
values ('Shooting Blanks S2', '2026-03-18', '2026-07-18', 'Free meal — paid by everyone else', true);

-- ── SEED: PLAYERS ────────────────────────────────────────────
insert into players (name) values
  ('Ethan'),
  ('Russell'),
  ('Elgin'),
  ('Christian'),
  ('Shyan'),
  ('George');

-- ── SEED: CONFIG ─────────────────────────────────────────────
insert into config (key, value) values
  ('current_week',        '1'),
  ('current_king',        ''),
  ('current_underdog',    ''),
  ('monthly_king',        ''),
  ('pool_win_pts',        '3'),
  ('first_pts',           '5'),
  ('second_pts',          '2'),
  ('max_full_wins',       '2'),
  ('reduced_pts',         '1'),
  ('king_slay_bonus',     '3'),
  ('underdog_multiplier', '1.5'),
  ('upset_factor',        '0.2');
