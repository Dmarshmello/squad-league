// ============================================================
//  db.js — All Supabase queries
// ============================================================

const DB = {

  async getConfig() {
    const { data, error } = await db.from('config').select('key,value');
    if (error) throw error;
    const cfg = {};
    data.forEach(r => { cfg[r.key] = r.value; });
    // parse underdog as array
    const underdogRaw = cfg.current_underdog || '';
    const underdogs = underdogRaw ? underdogRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    return {
      currentWeek:        parseInt(cfg.current_week)         || 1,
      currentKing:        cfg.current_king                   || '',
      currentUnderdogs:   underdogs,
      monthlyKing:        cfg.monthly_king                   || '',
      seasonStart:        cfg.season_start                   || '',
      seasonEnd:          cfg.season_end                     || '',
      poolWinPts:         parseFloat(cfg.pool_win_pts)       || 3,
      firstPts:           parseFloat(cfg.first_pts)          || 5,
      secondPts:          parseFloat(cfg.second_pts)         || 2,
      maxFullWins:        parseInt(cfg.max_full_wins)        || 2,
      reducedPts:         parseFloat(cfg.reduced_pts)        || 1,
      kingSlay:           parseFloat(cfg.king_slay_bonus)    || 3,
      underdogMultiplier: parseFloat(cfg.underdog_multiplier)|| 1.5,
      upsetFactor:        parseFloat(cfg.upset_factor)       || 0.2,
    };
  },

  async setConfig(key, value) {
    const { error } = await db.from('config').upsert({ key, value: String(value) }, { onConflict: 'key' });
    if (error) throw error;
  },

  async getActiveSeason() {
    const { data, error } = await db.from('seasons').select('*').eq('is_active', true).single();
    if (error) throw error;
    return data;
  },

  async updateSeason(id, updates) {
    const { error } = await db.from('seasons').update(updates).eq('id', id);
    if (error) throw error;
  },

  async getPlayers() {
    const { data, error } = await db.from('players').select('*').order('name');
    if (error) throw error;
    return data;
  },

  async updatePlayerPhoto(id, photoUrl) {
    const { error } = await db.from('players').update({ photo_url: photoUrl }).eq('id', id);
    if (error) throw error;
  },

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
      .eq('season_id', seasonId).eq('week', week)
      .order('total', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Returns all matches ordered by match_date asc (for recalc)
  async getAllMatchesOrdered(seasonId) {
    const { data, error } = await db.from('matches')
      .select(`id, week, sport, pool_mode, match_date, created_at, notes, deleted,
        match_placements(position, player_id, players(id,name,photo_url))`)
      .eq('season_id', seasonId)
      .order('match_date', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  },

  async getAllMatchesDesc(seasonId) {
    const { data, error } = await db.from('matches')
      .select(`id, week, sport, pool_mode, match_date, created_at, notes, deleted,
        match_placements(position, player_id, players(id,name,photo_url))`)
      .eq('season_id', seasonId)
      .order('match_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getRecentMatches(seasonId, limit = 10) {
    const { data, error } = await db.from('matches')
      .select(`id, week, sport, pool_mode, match_date, created_at, notes, deleted,
        match_placements(position, player_id, players(id,name,photo_url))`)
      .eq('season_id', seasonId).eq('deleted', false)
      .order('match_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async insertMatch(seasonId, week, sport, poolMode, notes, matchDate) {
    const { data, error } = await db.from('matches')
      .insert({ season_id: seasonId, week, sport, pool_mode: poolMode || null, notes: notes || '', match_date: matchDate, deleted: false })
      .select().single();
    if (error) throw error;
    return data;
  },

  async insertPlacements(matchId, placements) {
    const { error } = await db.from('match_placements').insert(
      placements.map(p => ({ match_id: matchId, player_id: p.playerId, position: p.position }))
    );
    if (error) throw error;
  },

  async softDeleteMatch(matchId) {
    const { error } = await db.from('matches').update({ deleted: true }).eq('id', matchId);
    if (error) throw error;
  },

  async restoreMatch(matchId) {
    const { error } = await db.from('matches').update({ deleted: false }).eq('id', matchId);
    if (error) throw error;
  },

  // ── POINTS ──────────────────────────────────────────────────

  async clearAllPoints(seasonId) {
    await db.from('season_points').delete().eq('season_id', seasonId);
    await db.from('week_points').delete().eq('season_id', seasonId);
  },

  async clearPointsFromWeek(seasonId, fromWeek) {
    await db.from('week_points').delete().eq('season_id', seasonId).gte('week', fromWeek);
    // For season points we clear all and rebuild since they're cumulative
    await db.from('season_points').delete().eq('season_id', seasonId);
  },

  async upsertWeekPoints(seasonId, week, playerId, delta) {
    const { data: ex } = await db.from('week_points')
      .select('*').eq('season_id', seasonId).eq('week', week).eq('player_id', playerId).maybeSingle();
    const pool     = round2((ex?.pool     || 0) + (delta.pool     || 0));
    const bowling  = round2((ex?.bowling  || 0) + (delta.bowling  || 0));
    const golf     = round2((ex?.golf     || 0) + (delta.golf     || 0));
    const bonus    = round2((ex?.bonus    || 0) + (delta.bonus    || 0));
    const underdog = round2((ex?.underdog || 0) + (delta.underdog || 0));
    const wins     = (ex?.wins || 0) + (delta.wins || 0);
    const total    = round2(pool + bowling + golf + bonus + underdog);
    const row      = { season_id: seasonId, week, player_id: playerId, pool, bowling, golf, bonus, underdog, total, wins };
    if (ex) {
      const { error } = await db.from('week_points').update(row).eq('season_id', seasonId).eq('week', week).eq('player_id', playerId);
      if (error) throw error;
    } else {
      const { error } = await db.from('week_points').insert(row);
      if (error) throw error;
    }
  },

  async upsertSeasonPoints(seasonId, playerId, delta) {
    const { data: ex } = await db.from('season_points')
      .select('*').eq('season_id', seasonId).eq('player_id', playerId).maybeSingle();
    const pool     = round2((ex?.pool     || 0) + (delta.pool     || 0));
    const bowling  = round2((ex?.bowling  || 0) + (delta.bowling  || 0));
    const golf     = round2((ex?.golf     || 0) + (delta.golf     || 0));
    const bonus    = round2((ex?.bonus    || 0) + (delta.bonus    || 0));
    const underdog = round2((ex?.underdog || 0) + (delta.underdog || 0));
    const wins     = (ex?.wins || 0) + (delta.wins || 0);
    const pool_wins    = (ex?.pool_wins    || 0) + (delta.pool_wins    || 0);
    const bowling_wins = (ex?.bowling_wins || 0) + (delta.bowling_wins || 0);
    const golf_wins    = (ex?.golf_wins    || 0) + (delta.golf_wins    || 0);
    const total    = round2(pool + bowling + golf + bonus + underdog);
    const row      = { season_id: seasonId, player_id: playerId, pool, bowling, golf, bonus, underdog, total, wins, pool_wins, bowling_wins, golf_wins };
    if (ex) {
      const { error } = await db.from('season_points').update(row).eq('season_id', seasonId).eq('player_id', playerId);
      if (error) throw error;
    } else {
      const { error } = await db.from('season_points').insert(row);
      if (error) throw error;
    }
  },

  // Count wins this week between same sides (for anti-farm) — uses in-memory data during recalc
  countWinsVsSideInMemory(processedMatches, week, sport, winnerIds, loserIds) {
    const winnerSet = new Set(winnerIds);
    const loserSet  = new Set(loserIds);
    let count = 0;
    for (const m of processedMatches) {
      if (m.week !== week || m.sport !== sport || m.deleted) continue;
      const pl = m.match_placements || [];
      const mWinners = pl.filter(p => p.position <= winnerIds.length).map(p => p.player_id);
      const mLosers  = pl.filter(p => p.position > winnerIds.length).map(p => p.player_id);
      if (mWinners.length === winnerIds.length && mWinners.every(id => winnerSet.has(id)) &&
          mLosers.length  === loserIds.length  && mLosers.every(id => loserSet.has(id))) {
        count++;
      }
    }
    return count;
  },
};
