// ============================================================
//  engine.js — Scoring engine + full recalculation
// ============================================================

const Engine = {

  // Build rank map from season standings array
  buildRankMap(seasonStandings, allPlayers) {
    const rankMap = {};
    const sorted = [...seasonStandings].sort((a, b) => (b.total || 0) - (a.total || 0));
    sorted.forEach((row, i) => {
      const pid = row.player_id || row.players?.id;
      if (pid) rankMap[pid] = i + 1;
    });
    const maxRank = sorted.length + 1;
    allPlayers.forEach(p => { if (!rankMap[p.id]) rankMap[p.id] = maxRank; });
    return rankMap;
  },

  // Get all players tied at lowest score — returns array of player ids
  getUnderdogIds(seasonStandings, allPlayers) {
    const totals = {};
    allPlayers.forEach(p => { totals[p.id] = 0; });
    seasonStandings.forEach(r => {
      const pid = r.player_id || r.players?.id;
      if (pid !== undefined) totals[pid] = parseFloat(r.total) || 0;
    });
    const values = Object.values(totals);
    if (!values.length) return [];
    const lowest = Math.min(...values);
    return Object.entries(totals)
      .filter(([, v]) => v === lowest)
      .map(([id]) => id);
  },

  getUpsetMultiplier(winnerId, opponentIds, rankMap, upsetFactor) {
    const winnerRank = rankMap[winnerId] || 999;
    let best = 1;
    opponentIds.forEach(oppId => {
      const oppRank = rankMap[oppId] || 999;
      if (winnerRank > oppRank) {
        const m = 1 + upsetFactor * (winnerRank - oppRank);
        if (m > best) best = m;
      }
    });
    return best;
  },

  applyUnderdogMultiplier(playerId, basePoints, underdogIds, multiplier) {
    if (underdogIds.includes(playerId)) {
      const final = round2(basePoints * multiplier);
      return { finalPoints: final, bonusOnly: round2(final - basePoints) };
    }
    return { finalPoints: basePoints, bonusOnly: 0 };
  },

  getKingBonus(loserIds, kingId, kingSlay) {
    if (!kingId) return 0;
    return loserIds.includes(kingId) ? kingSlay : 0;
  },

  shouldReduceForFarm(winsThisWeek, maxFullWins, winnerIds, loserIds, rankMap) {
    if (winsThisWeek <= maxFullWins) return false;
    for (const wId of winnerIds) {
      for (const lId of loserIds) {
        if ((rankMap[wId] || 999) > (rankMap[lId] || 999)) return false;
      }
    }
    return true;
  },

  // ── CALCULATE POINTS FOR ONE MATCH ──────────────────────────
  // processedSoFar = matches already counted this week (for anti-farm in-memory)
  calcMatch(match, cfg, rankMap, underdogIds, processedSoFar, allPlayerIds) {
    const points = {};
    allPlayerIds.forEach(id => {
      points[id] = { pool: 0, bowling: 0, golf: 0, bonus: 0, underdog: 0, wins: 0, pool_wins: 0, bowling_wins: 0, golf_wins: 0 };
    });

    const sport    = match.sport;
    const poolMode = match.pool_mode;
    // Map is_winner from DB field onto placements
    const placements = (match.match_placements || [])
      .sort((a, b) => a.position - b.position)
      .map(p => ({
        ...p,
        player_id: p.player_id,
        isWinner: p.is_winner !== undefined && p.is_winner !== null ? p.is_winner : (p.isWinner !== undefined ? p.isWinner : null),
      }));
    const kingId   = allPlayerIds.find ? undefined : null; // resolved below

    if (sport === 'Pool') {
      this._calcPool(match, placements, poolMode, cfg, rankMap, underdogIds, points, processedSoFar, allPlayerIds);
    } else if (sport === 'Bowling' || sport === 'Golf') {
      this._calcRanked(sport, placements, cfg, rankMap, underdogIds, points);
    }
    return points;
  },

  _calcPool(match, placements, poolMode, cfg, rankMap, underdogIds, points, processedSoFar, allPlayerIds) {
    let winnerGroup = [];
    let loserGroup  = [];

    if (poolMode === 'Singles') {
      // position 1 = winner, position 2 = loser
      placements.forEach(p => {
        if (p.position === 1) winnerGroup.push(p.player_id);
        else                  loserGroup.push(p.player_id);
      });

    } else if (poolMode === '2v2') {
      // positions 1,2 = winners; positions 3,4 = losers
      placements.forEach(p => {
        if (p.position <= 2) winnerGroup.push(p.player_id);
        else                 loserGroup.push(p.player_id);
      });

    } else if (poolMode === '2v1') {
      // Each placement has an isWinner boolean stored on it
      // solo player vs team of 2 — isWinner tells us which side won
      placements.forEach(p => {
        if (p.isWinner) winnerGroup.push(p.player_id);
        else            loserGroup.push(p.player_id);
      });

    } else {
      // Fallback: first placement wins, rest lose
      placements.forEach((p, i) => {
        if (i === 0) winnerGroup.push(p.player_id);
        else         loserGroup.push(p.player_id);
      });
    }

    winnerGroup = winnerGroup.filter(Boolean);
    loserGroup  = loserGroup.filter(Boolean);
    if (!winnerGroup.length || !loserGroup.length) return;

    // Anti-farm: normalise the matchup as a sorted pair of sides
    // so p1 vs {p2,p3} and {p2,p3} vs p1 are treated as the same pairing
    const winsThisWeek = DB.countWinsVsSideInMemory(
      processedSoFar, match.week, 'Pool', winnerGroup, loserGroup
    );
    const reduce = this.shouldReduceForFarm(winsThisWeek, cfg.maxFullWins, winnerGroup, loserGroup, rankMap);
    const base   = reduce ? cfg.reducedPts : cfg.poolWinPts;

    let bestUpset = 1;
    winnerGroup.forEach(wId => {
      const m = this.getUpsetMultiplier(wId, loserGroup, rankMap, cfg.upsetFactor);
      if (m > bestUpset) bestUpset = m;
    });

    const sidePoints = round2(base * bestUpset);
    const perWinner  = round2(sidePoints / winnerGroup.length);
    const kingBonus  = this.getKingBonus(loserGroup, cfg._kingId, cfg.kingSlay);
    const kingEach   = round2(kingBonus / winnerGroup.length);

    winnerGroup.forEach(wId => {
      if (!points[wId]) return;
      const ud = this.applyUnderdogMultiplier(wId, perWinner, underdogIds, cfg.underdogMultiplier);
      points[wId].pool      += round2(ud.finalPoints + kingEach);
      points[wId].bonus     += round2(kingEach + (perWinner - (base / winnerGroup.length)));
      points[wId].underdog  += round2(ud.bonusOnly);
      points[wId].wins      += 1;
      points[wId].pool_wins += 1;
    });
  },

  _calcRanked(sport, placements, cfg, rankMap, underdogIds, points) {
    const key      = sport.toLowerCase();
    const winnerId = placements[0]?.player_id;
    const secondId = placements[1]?.player_id;
    const opponents = placements.slice(1).map(p => p.player_id).filter(Boolean);
    if (!winnerId || !points[winnerId]) return;

    const kingBonus = this.getKingBonus(opponents, cfg._kingId, cfg.kingSlay);
    const upsetMult = this.getUpsetMultiplier(winnerId, opponents, rankMap, cfg.upsetFactor);
    const firstBase = round2(cfg.firstPts * upsetMult);
    const ud        = this.applyUnderdogMultiplier(winnerId, firstBase, underdogIds, cfg.underdogMultiplier);

    points[winnerId][key]          += round2(ud.finalPoints + kingBonus);
    points[winnerId].bonus         += round2(kingBonus + (firstBase - cfg.firstPts));
    points[winnerId].underdog      += round2(ud.bonusOnly);
    points[winnerId].wins          += 1;
    points[winnerId][key + '_wins'] = (points[winnerId][key + '_wins'] || 0) + 1;

    if (secondId && points[secondId]) {
      points[secondId][key] += cfg.secondPts;
    }
  },

  // ── FULL RECALCULATION ───────────────────────────────────────
  // Replays all non-deleted matches in chronological order
  // fromWeek: only clear/rebuild from this week onward
  async fullRecalc(seasonId, fromWeek, allMatches, allPlayers, cfg) {
    // Clear points from fromWeek onward
    await DB.clearPointsFromWeek(seasonId, fromWeek);

    // Sort all matches by date asc
    const sorted = [...allMatches]
      .filter(m => !m.deleted)
      .sort((a, b) => {
        const da = new Date(a.match_date || a.created_at);
        const db2 = new Date(b.match_date || b.created_at);
        return da - db2;
      });

    const allPlayerIds = allPlayers.map(p => p.id);

    // We need to track running season totals to compute rank/underdog at each match
    // Split into: before fromWeek (already in DB) and fromWeek+ (to replay)
    const beforeMatches = sorted.filter(m => m.week < fromWeek);
    const replayMatches = sorted.filter(m => m.week >= fromWeek);

    // Build initial season state from matches BEFORE fromWeek
    // We do this by replaying them all in memory
    const runningTotals = {}; // playerId -> { pool, bowling, golf, bonus, underdog, total, wins, pool_wins, bowling_wins, golf_wins }
    allPlayerIds.forEach(id => {
      runningTotals[id] = { pool: 0, bowling: 0, golf: 0, bonus: 0, underdog: 0, total: 0, wins: 0, pool_wins: 0, bowling_wins: 0, golf_wins: 0 };
    });

    // Load existing season points for weeks before fromWeek if they exist
    const { data: existingSeasonPts } = await db.from('season_points')
      .select('*').eq('season_id', seasonId);
    // Actually for simplicity, replay everything from scratch
    // Clear ALL and replay ALL
    await DB.clearAllPoints(seasonId);

    const processedSoFar = [];

    for (const match of sorted) {
      // Build current rank map from running totals
      const standingsArr = allPlayerIds.map(id => ({
        player_id: id,
        total: runningTotals[id].total,
      }));
      const rankMap     = this.buildRankMap(standingsArr, allPlayers);
      const underdogIds = this.getUnderdogIds(standingsArr, allPlayers);

      // Attach king id to cfg
      const cfgWithKing = { ...cfg };
      if (cfg.currentKing) {
        const kingPlayer = allPlayers.find(p => p.name === cfg.currentKing);
        cfgWithKing._kingId = kingPlayer?.id || null;
      }

      const pts = this.calcMatch(match, cfgWithKing, rankMap, underdogIds, processedSoFar, allPlayerIds);

      // Write to DB
      for (const [playerId, delta] of Object.entries(pts)) {
        const total = round2(delta.pool + delta.bowling + delta.golf + delta.bonus + delta.underdog);
        if (total !== 0 || delta.wins > 0) {
          await DB.upsertWeekPoints(seasonId, match.week, playerId, delta);
          await DB.upsertSeasonPoints(seasonId, playerId, delta);
          // Update running totals
          Object.keys(delta).forEach(k => {
            runningTotals[playerId][k] = (runningTotals[playerId][k] || 0) + (delta[k] || 0);
          });
          runningTotals[playerId].total = round2(
            runningTotals[playerId].pool + runningTotals[playerId].bowling +
            runningTotals[playerId].golf + runningTotals[playerId].bonus +
            runningTotals[playerId].underdog
          );
        }
      }

      processedSoFar.push(match);
    }
  },
};