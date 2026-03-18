// ============================================================
//  engine.js — Scoring engine (all rules)
// ============================================================

const Engine = {

  // Build rank map: { playerId: rank } — rank 1 = best
  buildRankMap(seasonStandings, allPlayerIds) {
    const rankMap = {};
    // standings already sorted by total desc
    seasonStandings.forEach((row, i) => {
      rankMap[row.player_id || row.players?.id] = i + 1;
    });
    // Players with no points yet get lowest rank
    const maxRank = seasonStandings.length + 1;
    allPlayerIds.forEach(id => {
      if (rankMap[id] === undefined) rankMap[id] = maxRank;
    });
    return rankMap;
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

  applyUnderdogMultiplier(playerId, basePoints, underdogId, multiplier) {
    if (playerId === underdogId) {
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
    // Exception: if any winner is still below any loser, no reduction
    for (const wId of winnerIds) {
      for (const lId of loserIds) {
        if ((rankMap[wId] || 999) > (rankMap[lId] || 999)) return false;
      }
    }
    return true;
  },

  // ── CALCULATE POINTS FOR A MATCH ──────────────────────────
  // Returns: { [playerId]: { pool, bowling, golf, bonus, underdog } }
  async calculate(sport, poolMode, placements, cfg, season, rankMap, allPlayerIds) {
    // placements: [{ playerId, position }] sorted by position
    const points = {};
    allPlayerIds.forEach(id => {
      points[id] = { pool: 0, bowling: 0, golf: 0, bonus: 0, underdog: 0 };
    });

    const underdogId = cfg.currentUnderdog
      ? allPlayerIds.find(id => id === cfg.currentUnderdogId) || null
      : null;

    if (sport === 'Pool') {
      await Engine._calcPool(placements, poolMode, cfg, season, rankMap, points, underdogId);
    } else if (sport === 'Bowling' || sport === 'Golf') {
      Engine._calcRanked(sport, placements, cfg, rankMap, points, underdogId);
    }

    return points;
  },

  async _calcPool(placements, poolMode, cfg, season, rankMap, points, underdogId) {
    // Sort by position
    const sorted = [...placements].sort((a, b) => a.position - b.position);

    let winnerGroup = [];
    let loserGroup  = [];

    if (poolMode === 'Singles') {
      winnerGroup = sorted.slice(0, 1).map(p => p.playerId);
      loserGroup  = sorted.slice(1, 2).map(p => p.playerId);
    } else if (poolMode === '2v2') {
      winnerGroup = sorted.slice(0, 2).map(p => p.playerId);
      loserGroup  = sorted.slice(2, 4).map(p => p.playerId);
    } else if (poolMode === '2v1') {
      // position 1 = winner side (could be 1 or 2 people)
      // positions marked: 1,2 = winners, 3,4 = losers OR 1 = winner, 2,3 = losers
      const pos1 = sorted.filter(p => p.position === 1).map(p => p.playerId);
      const pos2 = sorted.filter(p => p.position === 2).map(p => p.playerId);
      const pos3plus = sorted.filter(p => p.position >= 3).map(p => p.playerId);
      // If there are 2 "winners" (positions 1&2 on same side) use pos3 as losers
      // The form sends: p1=winner1, p2=winner2(blank if 1 winner), p3=opp1, p4=opp2
      // We handle this by checking how many placements are at positions 1-2
      winnerGroup = sorted.filter(p => p.position <= 2 && p.isWinner).map(p => p.playerId);
      loserGroup  = sorted.filter(p => !p.isWinner).map(p => p.playerId);
      // Fallback to positions if isWinner not set
      if (!winnerGroup.length) {
        winnerGroup = pos1;
        loserGroup  = [...pos2, ...pos3plus];
      }
    } else {
      // Fallback singles
      winnerGroup = sorted.slice(0, 1).map(p => p.playerId);
      loserGroup  = sorted.slice(1).map(p => p.playerId);
    }

    if (!winnerGroup.length || !loserGroup.length) return;

    // Anti-farm check
    const winsThisWeek = await DB.countWinsVsSide(
      season.id, cfg.currentWeek, 'Pool', winnerGroup, loserGroup
    );
    const reduce = Engine.shouldReduceForFarm(
      winsThisWeek, cfg.maxFullWins, winnerGroup, loserGroup, rankMap
    );
    const base = reduce ? cfg.reducedPts : cfg.poolWinPts;

    // Upset multiplier (best across winners)
    let bestUpset = 1;
    winnerGroup.forEach(wId => {
      const m = Engine.getUpsetMultiplier(wId, loserGroup, rankMap, cfg.upsetFactor);
      if (m > bestUpset) bestUpset = m;
    });

    const sidePoints   = round2(base * bestUpset);
    const perWinner    = round2(sidePoints / winnerGroup.length);
    const kingBonus    = Engine.getKingBonus(loserGroup, cfg.currentKingId, cfg.kingSlay);
    const kingEach     = round2(kingBonus / winnerGroup.length);

    winnerGroup.forEach(wId => {
      if (!points[wId]) return;
      const ud = Engine.applyUnderdogMultiplier(wId, perWinner, underdogId, cfg.underdogMultiplier);
      points[wId].pool     += round2(ud.finalPoints + kingEach);
      points[wId].bonus    += round2(kingEach + (perWinner - (base / winnerGroup.length)));
      points[wId].underdog += round2(ud.bonusOnly);
    });
  },

  _calcRanked(sport, placements, cfg, rankMap, points, underdogId) {
    const sorted    = [...placements].sort((a, b) => a.position - b.position);
    const winnerId  = sorted[0]?.playerId;
    const secondId  = sorted[1]?.playerId;
    const opponents = sorted.slice(1).map(p => p.playerId);

    if (!winnerId || !points[winnerId]) return;

    const key       = sport.toLowerCase();
    const kingBonus = Engine.getKingBonus(opponents, underdogId?.kingId, cfg.kingSlay);
    const upsetMult = Engine.getUpsetMultiplier(winnerId, opponents, rankMap, cfg.upsetFactor);
    const firstBase = round2(cfg.firstPts * upsetMult);
    const ud        = Engine.applyUnderdogMultiplier(winnerId, firstBase, underdogId, cfg.underdogMultiplier);

    points[winnerId][key]     += round2(ud.finalPoints + kingBonus);
    points[winnerId].bonus    += round2(kingBonus + (firstBase - cfg.firstPts));
    points[winnerId].underdog += round2(ud.bonusOnly);

    if (secondId && points[secondId]) {
      points[secondId][key] += cfg.secondPts;
    }
  },
};
