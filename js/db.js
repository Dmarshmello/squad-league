// ============================================================
//  db.js — All Supabase queries
// ============================================================

const DB = {

  // ── CONFIG ───────────────────────────────────────────────
  async getConfig() {
    const { data, error } = await db.from('config').select('key,value');
    if (error) throw error;
    const c = {};
    (data || []).forEach(r => { c[r.key] = r.value; });
    const underdogRaw = c.current_underdog || '';
    return {
      currentWeek:        parseInt(c.current_week)          || 1,
      currentKing:        c.current_king                    || '',
      currentUnderdogs:   underdogRaw ? underdogRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
      monthlyKing:        c.monthly_king                    || '',
      seasonStart:        c.season_start                    || '',
      seasonEnd:          c.season_end                      || '',
      poolWinPts:         parseFloat(c.pool_win_pts)        || 3,
      firstPts:           parseFloat(c.first_pts)           || 5,
      secondPts:          parseFloat(c.second_pts)          || 2,
      maxFullWins:        parseInt(c.max_full_wins)          || 2,
      reducedPts:         parseFloat(c.reduced_pts)         || 1,
      kingSlay:           parseFloat(c.king_slay_bonus)     || 3,
      underdogMultiplier: parseFloat(c.underdog_multiplier) || 1.5,
      upsetFactor:        parseFloat(c.upset_factor)        || 0.2,
    };
  },

  async setConfig(key, value) {
    const { error } = await db.from('config')
      .upsert({ key, value: String(value) }, { onConflict: 'key' });
    if (error) throw error;
  },

  // ── SEASON ───────────────────────────────────────────────
  async getActiveSeason() {
    const { data, error } = await db.from('seasons')
      .select('*').eq('is_active', true).limit(1).single();
    if (error) throw error;
    return data;
  },

  async updateSeason(id, updates) {
    const { error } = await db.from('seasons').update(updates).eq('id', id);
    if (error) throw error;
  },

  // ── PLAYERS ──────────────────────────────────────────────
  async getPlayers() {
    const { data, error } = await db.from('players').select('*').order('name');
    if (error) throw error;
    return data || [];
  },

  async updatePlayerPhoto(id, photoUrl) {
    const { error } = await db.from('players')
      .update({ photo_url: photoUrl || null }).eq('id', id);
    if (error) throw error;
  },

  // ── STANDINGS ────────────────────────────────────────────
  async getSeasonStandings(seasonId) {
    const { data, error } = await db.from('season_points')
      .select('*, players(id,name,photo_url)')
      .eq('season_id', seasonId)
      .order('total', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getWeekStandings(seasonId, week) {
    const { data, error } = await db.from('week_points')
      .select('*, players(id,name,photo_url)')
      .eq('season_id', seasonId)
      .eq('week', week)
      .order('total', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // ── MATCHES ──────────────────────────────────────────────
  // All matches ordered oldest first (for recalc)
  async getAllMatchesAsc(seasonId) {
    const { data, error } = await db.from('matches')
      .select(`id, week, sport, pool_mode, match_date, created_at, notes, deleted,
        match_placements(position, player_id, is_winner, players(id,name,photo_url))`)
      .eq('season_id', seasonId)
      .order('match_date', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  // All matches newest first (for history page)
  async getAllMatchesDesc(seasonId) {
    const { data, error } = await db.from('matches')
      .select(`id, week, sport, pool_mode, match_date, created_at, notes, deleted,
        match_placements(position, player_id, is_winner, players(id,name,photo_url))`)
      .eq('season_id', seasonId)
      .order('match_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Recent non-deleted matches for dashboard
  async getRecentMatches(seasonId, limit = 8) {
    const { data, error } = await db.from('matches')
      .select(`id, week, sport, pool_mode, match_date, created_at, notes,
        match_placements(position, player_id, is_winner, players(id,name,photo_url))`)
      .eq('season_id', seasonId)
      .eq('deleted', false)
      .order('match_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async insertMatch(seasonId, week, sport, poolMode, notes, matchDate) {
    const { data, error } = await db.from('matches')
      .insert({
        season_id: seasonId,
        week,
        sport,
        pool_mode: poolMode || null,
        notes: notes || '',
        match_date: matchDate,
        deleted: false,
      })
      .select().single();
    if (error) throw error;
    return data;
  },

  async insertPlacements(matchId, placements) {
    // placements: [{ playerId, position, isWinner }]
    const rows = placements.map(p => ({
      match_id:  matchId,
      player_id: p.playerId,
      position:  p.position,
      is_winner: typeof p.isWinner === 'boolean' ? p.isWinner : null,
    }));
    const { error } = await db.from('match_placements').insert(rows);
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

  // ── POINTS — CLEAR ───────────────────────────────────────
  async clearAllPoints(seasonId) {
    const { error: e1 } = await db.from('week_points').delete().eq('season_id', seasonId);
    if (e1) throw e1;
    const { error: e2 } = await db.from('season_points').delete().eq('season_id', seasonId);
    if (e2) throw e2;
  },

  // ── POINTS — WRITE ───────────────────────────────────────
  // These use .select().limit(1) instead of maybeSingle() to avoid proxy issues
  async upsertWeekPoints(seasonId, week, playerId, delta) {
    // Fetch existing row
    const { data: rows } = await db.from('week_points')
      .select('pool,bowling,golf,bonus,underdog,wins,pool_wins,bowling_wins,golf_wins')
      .eq('season_id', seasonId).eq('week', week).eq('player_id', playerId)
      .limit(1);

    const ex = rows && rows.length > 0 ? rows[0] : null;

    const pool         = round2((ex?.pool         || 0) + (delta.pool         || 0));
    const bowling      = round2((ex?.bowling      || 0) + (delta.bowling      || 0));
    const golf         = round2((ex?.golf         || 0) + (delta.golf         || 0));
    const bonus        = round2((ex?.bonus        || 0) + (delta.bonus        || 0));
    const underdog     = round2((ex?.underdog     || 0) + (delta.underdog     || 0));
    const wins         = (ex?.wins         || 0) + (delta.wins         || 0);
    const pool_wins    = (ex?.pool_wins    || 0) + (delta.pool_wins    || 0);
    const bowling_wins = (ex?.bowling_wins || 0) + (delta.bowling_wins || 0);
    const golf_wins    = (ex?.golf_wins    || 0) + (delta.golf_wins    || 0);
    const total        = round2(pool + bowling + golf + bonus + underdog);

    const { error } = await db.from('week_points').upsert(
      { season_id: seasonId, week, player_id: playerId, pool, bowling, golf, bonus, underdog, total, wins, pool_wins, bowling_wins, golf_wins },
      { onConflict: 'season_id,week,player_id' }
    );
    if (error) throw error;
  },

  async upsertSeasonPoints(seasonId, playerId, delta) {
    const { data: rows } = await db.from('season_points')
      .select('pool,bowling,golf,bonus,underdog,wins,pool_wins,bowling_wins,golf_wins')
      .eq('season_id', seasonId).eq('player_id', playerId)
      .limit(1);

    const ex = rows && rows.length > 0 ? rows[0] : null;

    const pool         = round2((ex?.pool         || 0) + (delta.pool         || 0));
    const bowling      = round2((ex?.bowling      || 0) + (delta.bowling      || 0));
    const golf         = round2((ex?.golf         || 0) + (delta.golf         || 0));
    const bonus        = round2((ex?.bonus        || 0) + (delta.bonus        || 0));
    const underdog     = round2((ex?.underdog     || 0) + (delta.underdog     || 0));
    const wins         = (ex?.wins         || 0) + (delta.wins         || 0);
    const pool_wins    = (ex?.pool_wins    || 0) + (delta.pool_wins    || 0);
    const bowling_wins = (ex?.bowling_wins || 0) + (delta.bowling_wins || 0);
    const golf_wins    = (ex?.golf_wins    || 0) + (delta.golf_wins    || 0);
    const total        = round2(pool + bowling + golf + bonus + underdog);

    const { error } = await db.from('season_points').upsert(
      { season_id: seasonId, player_id: playerId, pool, bowling, golf, bonus, underdog, total, wins, pool_wins, bowling_wins, golf_wins },
      { onConflict: 'season_id,player_id' }
    );
    if (error) throw error;
  },

  // ── ANTI-FARM (in-memory, used during recalc) ────────────
  // Counts how many times these exact player groups have played
  // each other this week (regardless of who won — for 2v1 we
  // track the pairing of all players involved)
  countWinsInMemory(processedMatches, week, sport, winnerIds, loserIds) {
    const allInvolved = new Set([...winnerIds, ...loserIds]);
    let count = 0;

    for (const m of processedMatches) {
      if (m.week !== week || m.sport !== sport || m.deleted) continue;
      const pl = m.match_placements || [];
      const matchPIds = pl.map(p => p.player_id).filter(Boolean);

      if (matchPIds.length !== allInvolved.size) continue;
      if (!matchPIds.every(id => allInvolved.has(id))) continue;

      if (m.pool_mode === '2v1') {
        // Any match between these 3 players counts toward the pairing limit
        count++;
      } else {
        // Singles / 2v2: exact winner vs loser match
        const winSet = new Set(winnerIds);
        const losSet = new Set(loserIds);
        const mWinners = pl.filter(p => p.is_winner === true).map(p => p.player_id);
        const mLosers  = pl.filter(p => p.is_winner === false).map(p => p.player_id);
        // Fallback to position if is_winner not set
        const wGroup = mWinners.length ? mWinners : pl.filter(p => p.position <= winnerIds.length).map(p => p.player_id);
        const lGroup = mLosers.length  ? mLosers  : pl.filter(p => p.position > winnerIds.length).map(p => p.player_id);
        if (winnerIds.every(id => new Set(wGroup).has(id)) && loserIds.every(id => new Set(lGroup).has(id))) {
          count++;
        }
      }
    }
    return count;
  },

  // ── TAG ROTATIONS ─────────────────────────────────────────
  // Stored in config table as tag_rot_{playerId} = index (integer as string)
  async getTagRotations(playerIds) {
    const keys = playerIds.map(id => `tag_rot_${id}`);
    const { data, error } = await db.from('config').select('key,value').in('key', keys);
    if (error) throw error;
    const result = {};
    playerIds.forEach(id => { result[id] = 0; });
    (data || []).forEach(r => {
      const id = r.key.replace('tag_rot_', '');
      result[id] = parseInt(r.value) || 0;
    });
    return result;
  },

  async setTagRotation(playerId, index) {
    const { error } = await db.from('config')
      .upsert({ key: `tag_rot_${playerId}`, value: String(index) }, { onConflict: 'key' });
    if (error) throw error;
  },
};