// ============================================================
//  db.js — All Supabase queries
// ============================================================

const DB = {

  // ── CONFIG ────────────────────────────────────────────────
  async getConfig() {
    const { data, error } = await db.from('config').select('key,value');
    if (error) throw error;
    const cfg = {};
    data.forEach(row => { cfg[row.key] = row.value; });
    return {
      currentWeek:        parseInt(cfg.current_week)        || 1,
      currentKing:        cfg.current_king                  || '',
      currentUnderdog:    cfg.current_underdog              || '',
      monthlyKing:        cfg.monthly_king                  || '',
      poolWinPts:         parseFloat(cfg.pool_win_pts)      || 3,
      firstPts:           parseFloat(cfg.first_pts)         || 5,
      secondPts:          parseFloat(cfg.second_pts)        || 2,
      maxFullWins:        parseInt(cfg.max_full_wins)        || 2,
      reducedPts:         parseFloat(cfg.reduced_pts)       || 1,
      kingSlay:           parseFloat(cfg.king_slay_bonus)   || 3,
      underdogMultiplier: parseFloat(cfg.underdog_multiplier) || 1.5,
      upsetFactor:        parseFloat(cfg.upset_factor)      || 0.2,
    };
  },

  async setConfig(key, value) {
    const { error } = await db.from('config')
      .upsert({ key, value: String(value) }, { onConflict: 'key' });
    if (error) throw error;
  },

  // ── SEASON ────────────────────────────────────────────────
  async getActiveSeason() {
    const { data, error } = await db.from('seasons')
      .select('*').eq('is_active', true).single();
    if (error) throw error;
    return data;
  },

  // ── PLAYERS ───────────────────────────────────────────────
  async getPlayers() {
    const { data, error } = await db.from('players')
      .select('*').order('name');
    if (error) throw error;
    return data;
  },

  // ── LEADERBOARD ───────────────────────────────────────────
  async getSeasonStandings(seasonId) {
    const { data, error } = await db.from('season_points')
      .select('*, players(id,name,photo_url)')
      .eq('season_id', seasonId)
      .order('total', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getWeekStandings(seasonId, week) {
    const { data, error } = await db.from('week_points')
      .select('*, players(id,name,photo_url)')
      .eq('season_id', seasonId)
      .eq('week', week)
      .order('total', { ascending: false });
    if (error) throw error;
    return data;
  },

  // ── MATCHES ───────────────────────────────────────────────
  async getRecentMatches(seasonId, limit = 10) {
    const { data, error } = await db.from('matches')
      .select(`
        id, week, sport, pool_mode, created_at,
        match_placements(position, players(id,name))
      `)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async getAllMatches(seasonId) {
    const { data, error } = await db.from('matches')
      .select(`
        id, week, sport, pool_mode, created_at, notes,
        match_placements(position, players(id,name))
      `)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Count wins this week between same sides (anti-farm)
  async countWinsVsSide(seasonId, week, sport, winnerIds, loserIds) {
    const { data, error } = await db.from('matches')
      .select(`id, match_placements(position, player_id)`)
      .eq('season_id', seasonId)
      .eq('week', week)
      .eq('sport', sport);
    if (error) throw error;

    const winnerSet = new Set(winnerIds);
    const loserSet  = new Set(loserIds);
    let count = 0;

    for (const match of data) {
      const placements = match.match_placements || [];
      const matchWinners = placements
        .filter(p => p.position <= winnerIds.length)
        .map(p => p.player_id);
      const matchLosers = placements
        .filter(p => p.position > winnerIds.length)
        .map(p => p.player_id);

      const winnersMatch = matchWinners.length === winnerIds.length &&
        matchWinners.every(id => winnerSet.has(id));
      const losersMatch  = matchLosers.length  === loserIds.length  &&
        matchLosers.every(id => loserSet.has(id));

      if (winnersMatch && losersMatch) count++;
    }
    return count;
  },

  // ── INSERT MATCH ──────────────────────────────────────────
  async insertMatch(seasonId, week, sport, poolMode, notes = '') {
    const { data, error } = await db.from('matches')
      .insert({ season_id: seasonId, week, sport, pool_mode: poolMode || null, notes })
      .select().single();
    if (error) throw error;
    return data;
  },

  async insertPlacements(matchId, placements) {
    // placements: [{ player_id, position }]
    const { error } = await db.from('match_placements').insert(
      placements.map(p => ({ match_id: matchId, player_id: p.playerId, position: p.position }))
    );
    if (error) throw error;
  },

  // ── UPSERT POINTS ─────────────────────────────────────────
  async upsertWeekPoints(seasonId, week, playerId, delta) {
    // Try update first
    const { data: existing } = await db.from('week_points')
      .select('*').eq('season_id', seasonId).eq('week', week).eq('player_id', playerId).single();

    if (existing) {
      const updated = {
        pool:     round2((existing.pool     || 0) + (delta.pool     || 0)),
        bowling:  round2((existing.bowling  || 0) + (delta.bowling  || 0)),
        golf:     round2((existing.golf     || 0) + (delta.golf     || 0)),
        bonus:    round2((existing.bonus    || 0) + (delta.bonus    || 0)),
        underdog: round2((existing.underdog || 0) + (delta.underdog || 0)),
      };
      updated.total = round2(updated.pool + updated.bowling + updated.golf + updated.bonus + updated.underdog);
      const { error } = await db.from('week_points').update(updated)
        .eq('season_id', seasonId).eq('week', week).eq('player_id', playerId);
      if (error) throw error;
    } else {
      const row = {
        season_id: seasonId, week, player_id: playerId,
        pool:     round2(delta.pool     || 0),
        bowling:  round2(delta.bowling  || 0),
        golf:     round2(delta.golf     || 0),
        bonus:    round2(delta.bonus    || 0),
        underdog: round2(delta.underdog || 0),
      };
      row.total = round2(row.pool + row.bowling + row.golf + row.bonus + row.underdog);
      const { error } = await db.from('week_points').insert(row);
      if (error) throw error;
    }
  },

  async upsertSeasonPoints(seasonId, playerId, delta) {
    const { data: existing } = await db.from('season_points')
      .select('*').eq('season_id', seasonId).eq('player_id', playerId).single();

    if (existing) {
      const updated = {
        pool:     round2((existing.pool     || 0) + (delta.pool     || 0)),
        bowling:  round2((existing.bowling  || 0) + (delta.bowling  || 0)),
        golf:     round2((existing.golf     || 0) + (delta.golf     || 0)),
        bonus:    round2((existing.bonus    || 0) + (delta.bonus    || 0)),
        underdog: round2((existing.underdog || 0) + (delta.underdog || 0)),
      };
      updated.total = round2(updated.pool + updated.bowling + updated.golf + updated.bonus + updated.underdog);
      const { error } = await db.from('season_points').update(updated)
        .eq('season_id', seasonId).eq('player_id', playerId);
      if (error) throw error;
    } else {
      const row = {
        season_id: seasonId, player_id: playerId,
        pool:     round2(delta.pool     || 0),
        bowling:  round2(delta.bowling  || 0),
        golf:     round2(delta.golf     || 0),
        bonus:    round2(delta.bonus    || 0),
        underdog: round2(delta.underdog || 0),
      };
      row.total = round2(row.pool + row.bowling + row.golf + row.bonus + row.underdog);
      const { error } = await db.from('season_points').insert(row);
      if (error) throw error;
    }
  },
};
