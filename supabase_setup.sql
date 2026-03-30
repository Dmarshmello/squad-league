-- ============================================================
--  SQUAD LEAGUE — Full Database Setup (Clean Slate)
--  Run this in Supabase SQL Editor
--  WARNING: Drops all existing tables and starts fresh
-- ============================================================

-- ── DROP EVERYTHING FIRST ────────────────────────────────────
drop table if exists match_placements cascade;
drop table if exists matches          cascade;
drop table if exists week_points      cascade;
drop table if exists season_points    cascade;
drop table if exists config           cascade;
drop table if exists seasons          cascade;
drop table if exists players          cascade;

-- ── PLAYERS ──────────────────────────────────────────────────
create table players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  photo_url  text,
  created_at timestamptz default now()
);

-- ── SEASONS ──────────────────────────────────────────────────
create table seasons (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  start_date     date,
  end_date       date,
  monthly_reward text default 'Free meal for 6-month King — paid by everyone else',
  is_active      boolean default true,
  created_at     timestamptz default now()
);

-- ── CONFIG ───────────────────────────────────────────────────
create table config (
  key   text primary key,
  value text
);

-- ── MATCHES ──────────────────────────────────────────────────
create table matches (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid references seasons(id),
  week       integer not null,
  sport      text not null check (sport in ('Pool','Bowling','Golf')),
  pool_mode  text check (pool_mode in ('Singles','2v1','2v2')),
  match_date date default current_date,
  notes      text,
  deleted    boolean default false,
  created_at timestamptz default now()
);

-- ── MATCH PLACEMENTS ─────────────────────────────────────────
create table match_placements (
  id        uuid primary key default gen_random_uuid(),
  match_id  uuid references matches(id) on delete cascade,
  player_id uuid references players(id),
  position  integer not null,
  is_winner boolean default null  -- explicitly tracks winning side for 2v1
);

-- ── WEEK POINTS ──────────────────────────────────────────────
create table week_points (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid references seasons(id),
  week         integer not null,
  player_id    uuid references players(id),
  pool         numeric default 0,
  bowling      numeric default 0,
  golf         numeric default 0,
  bonus        numeric default 0,
  underdog     numeric default 0,
  total        numeric default 0,
  wins         integer default 0,
  pool_wins    integer default 0,
  bowling_wins integer default 0,
  golf_wins    integer default 0,
  unique(season_id, week, player_id)
);

-- ── SEASON POINTS ────────────────────────────────────────────
create table season_points (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid references seasons(id),
  player_id    uuid references players(id),
  pool         numeric default 0,
  bowling      numeric default 0,
  golf         numeric default 0,
  bonus        numeric default 0,
  underdog     numeric default 0,
  total        numeric default 0,
  wins         integer default 0,
  pool_wins    integer default 0,
  bowling_wins integer default 0,
  golf_wins    integer default 0,
  unique(season_id, player_id)
);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
alter table players          enable row level security;
alter table seasons          enable row level security;
alter table config           enable row level security;
alter table matches          enable row level security;
alter table match_placements enable row level security;
alter table week_points      enable row level security;
alter table season_points    enable row level security;

-- Public read
create policy "read players"          on players          for select using (true);
create policy "read seasons"          on seasons          for select using (true);
create policy "read config"           on config           for select using (true);
create policy "read matches"          on matches          for select using (true);
create policy "read match_placements" on match_placements for select using (true);
create policy "read week_points"      on week_points      for select using (true);
create policy "read season_points"    on season_points    for select using (true);

-- Open write
create policy "insert matches"          on matches          for insert with check (true);
create policy "update matches"          on matches          for update using (true);
create policy "insert match_placements" on match_placements for insert with check (true);
create policy "insert week_points"      on week_points      for insert with check (true);
create policy "update week_points"      on week_points      for update using (true);
create policy "delete week_points"      on week_points      for delete using (true);
create policy "insert season_points"    on season_points    for insert with check (true);
create policy "update season_points"    on season_points    for update using (true);
create policy "delete season_points"    on season_points    for delete using (true);
create policy "insert config"           on config           for insert with check (true);
create policy "update config"           on config           for update using (true);
create policy "update players"          on players          for update using (true);
create policy "update seasons"          on seasons          for update using (true);

-- ── SEED: SEASON 2 ───────────────────────────────────────────
insert into seasons (name, start_date, end_date, monthly_reward, is_active)
values (
  'Shooting Blanks S2',
  current_date,
  null,
  'Free meal for 6-month King — paid by everyone else',
  true
);

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
  ('season_start',        to_char(current_date, 'YYYY-MM-DD')),
  ('season_end',           ''),
  ('pool_win_pts',        '3'),
  ('first_pts',           '5'),
  ('second_pts',          '2'),
  ('max_full_wins',       '2'),
  ('reduced_pts',         '1'),
  ('king_slay_bonus',     '3'),
  ('underdog_multiplier', '1.5'),
  ('upset_factor',        '0.2');