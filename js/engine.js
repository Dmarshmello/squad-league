// ============================================================
//  engine.js — Scoring engine + full recalculation
// ============================================================

const Engine = {

  // ── RANK / UNDERDOG ──────────────────────────────────────

  buildRankMap(standingsArr, allPlayers) {
    // standingsArr: [{ player_id, total }] sorted desc
    const sorted = [...standingsArr].sort((a, b) => (b.total || 0) - (a.total || 0));
    const rankMap = {};
    sorted.forEach((r, i) => { if (r.player_id) rankMap[r.player_id] = i + 1; });
    const maxRank = sorted.length + 1;
    allPlayers.forEach(p => { if (!rankMap[p.id]) rankMap[p.id] = maxRank; });
    return rankMap;
  },

  // Returns array of player IDs all tied at the lowest season total
  getUnderdogIds(standingsArr, allPlayers) {
    const totals = {};
    allPlayers.forEach(p => { totals[p.id] = 0; });
    standingsArr.forEach(r => {
      if (r.player_id !== undefined) totals[r.player_id] = parseFloat(r.total) || 0;
    });
    const vals = Object.values(totals);
    if (!vals.length) return [];
    const lowest = Math.min(...vals);
    return Object.entries(totals).filter(([, v]) => v === lowest).map(([id]) => id);
  },

  // ── MULTIPLIERS ──────────────────────────────────────────

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
    // Exception: if any winner is still ranked below any loser → no reduction
    for (const wId of winnerIds) {
      for (const lId of loserIds) {
        if ((rankMap[wId] || 999) > (rankMap[lId] || 999)) return false;
      }
    }
    return true;
  },

  // ── CALCULATE POINTS FOR ONE MATCH ──────────────────────

  calcMatch(match, cfg, rankMap, underdogIds, processedSoFar, allPlayerIds) {
    const points = {};
    allPlayerIds.forEach(id => {
      points[id] = { pool: 0, bowling: 0, golf: 0, bonus: 0, underdog: 0, wins: 0, pool_wins: 0, bowling_wins: 0, golf_wins: 0 };
    });

    const sport      = match.sport;
    const poolMode   = match.pool_mode;
    const placements = (match.match_placements || [])
      .sort((a, b) => a.position - b.position)
      .map(p => ({
        player_id: p.player_id,
        position:  p.position,
        // Normalise is_winner from DB field name
        isWinner: typeof p.is_winner === 'boolean' ? p.is_winner
                : typeof p.isWinner  === 'boolean' ? p.isWinner
                : null,
      }));

    if (sport === 'Pool') {
      this._calcPool(match, placements, poolMode, cfg, rankMap, underdogIds, points, processedSoFar);
    } else if (sport === 'Bowling' || sport === 'Golf') {
      this._calcRanked(sport, placements, cfg, rankMap, underdogIds, points);
    }

    return points;
  },

  _calcPool(match, placements, poolMode, cfg, rankMap, underdogIds, points, processedSoFar) {
    let winnerGroup = [];
    let loserGroup  = [];

    if (poolMode === 'Singles') {
      placements.forEach(p => {
        if (p.position === 1) winnerGroup.push(p.player_id);
        else                  loserGroup.push(p.player_id);
      });

    } else if (poolMode === '2v2') {
      placements.forEach(p => {
        if (p.position <= 2) winnerGroup.push(p.player_id);
        else                 loserGroup.push(p.player_id);
      });

    } else if (poolMode === '2v1') {
      // Use isWinner flag — always set by the form
      const hasFlag = placements.some(p => p.isWinner === true || p.isWinner === false);
      if (hasFlag) {
        placements.forEach(p => {
          if (p.isWinner === true)  winnerGroup.push(p.player_id);
          else                      loserGroup.push(p.player_id);
        });
      } else {
        // Fallback: position 1 = solo, positions 2&3 = team
        // We don't know who won, so treat as solo won
        placements.forEach(p => {
          if (p.position === 1) winnerGroup.push(p.player_id);
          else                  loserGroup.push(p.player_id);
        });
      }

    } else {
      // Fallback
      placements.forEach((p, i) => {
        if (i === 0) winnerGroup.push(p.player_id);
        else         loserGroup.push(p.player_id);
      });
    }

    winnerGroup = winnerGroup.filter(Boolean);
    loserGroup  = loserGroup.filter(Boolean);
    if (!winnerGroup.length || !loserGroup.length) return;

    const winsThisWeek = DB.countWinsInMemory(processedSoFar, match.week, 'Pool', winnerGroup, loserGroup);
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
    // Upset bonus portion (above base)
    const upsetBonus = round2((perWinner - (base / winnerGroup.length)));

    winnerGroup.forEach(wId => {
      if (!points[wId]) return;
      const ud = this.applyUnderdogMultiplier(wId, perWinner, underdogIds, cfg.underdogMultiplier);
      points[wId].pool      += round2(ud.finalPoints + kingEach);
      points[wId].bonus     += round2(kingEach);  // only king slay, upset is in pool
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

    const upsetMult = this.getUpsetMultiplier(winnerId, opponents, rankMap, cfg.upsetFactor);
    const firstBase = round2(cfg.firstPts * upsetMult);
    const ud        = this.applyUnderdogMultiplier(winnerId, firstBase, underdogIds, cfg.underdogMultiplier);
    const kingBonus = this.getKingBonus(opponents, cfg._kingId, cfg.kingSlay);
    const upsetBonus = round2(firstBase - cfg.firstPts);

    points[winnerId][key]          += round2(ud.finalPoints + kingBonus);
    points[winnerId].bonus         += round2(kingBonus);  // only king slay, upset is in sport pts
    points[winnerId].underdog      += round2(ud.bonusOnly);
    points[winnerId].wins          += 1;
    points[winnerId][key + '_wins'] = (points[winnerId][key + '_wins'] || 0) + 1;

    if (secondId && points[secondId]) {
      points[secondId][key] += cfg.secondPts;
    }
  },

  // ── FULL RECALCULATION ───────────────────────────────────
  // Clears all points and replays every non-deleted match
  // in chronological order, computing rank/underdog dynamically
  async fullRecalc(seasonId, allMatches, allPlayers, cfg) {
    // 1. Wipe everything
    await DB.clearAllPoints(seasonId);

    const allPlayerIds = allPlayers.map(p => p.id);

    // 2. Sort matches oldest first
    const sorted = [...allMatches]
      .filter(m => !m.deleted)
      .sort((a, b) => {
        const da = new Date(a.match_date || a.created_at);
        const db2 = new Date(b.match_date || b.created_at);
        return da - db2;
      });

    // 3. Track running totals in memory so rank/underdog are
    //    calculated correctly at the time of each match
    const runningTotals = {};
    allPlayerIds.forEach(id => {
      runningTotals[id] = { pool:0, bowling:0, golf:0, bonus:0, underdog:0, total:0,
        wins:0, pool_wins:0, bowling_wins:0, golf_wins:0 };
    });

    const processedSoFar = [];

    // Track week points in memory to derive king per week
    // weekTotals[week][playerId] = total pts that week
    const weekTotals = {};

    for (const match of sorted) {
      // Build rank/underdog from totals at this point in time
      const standingsArr = allPlayerIds.map(id => ({
        player_id: id,
        total: runningTotals[id].total,
      }));

      const rankMap     = this.buildRankMap(standingsArr, allPlayers);
      const underdogIds = this.getUnderdogIds(standingsArr, allPlayers);

      // Derive king for THIS match: whoever scored highest in the previous week
      // Week 1 has no king. Week N uses the top scorer from week N-1.
      const cfgNow = { ...cfg, _kingId: null };
      const prevWeek = match.week - 1;
      if (prevWeek >= 1 && weekTotals[prevWeek]) {
        let topId = null, topPts = -1;
        Object.entries(weekTotals[prevWeek]).forEach(([pid, pts]) => {
          if (pts > topPts) { topPts = pts; topId = pid; }
        });
        cfgNow._kingId = topId || null;
      }

      const pts = this.calcMatch(match, cfgNow, rankMap, underdogIds, processedSoFar, allPlayerIds);

      // Write to DB and update running totals
      for (const [playerId, delta] of Object.entries(pts)) {
        const earned = round2(delta.pool + delta.bowling + delta.golf + delta.bonus + delta.underdog);
        if (earned !== 0 || delta.wins > 0) {
          await DB.upsertWeekPoints(seasonId, match.week, playerId, delta);
          await DB.upsertSeasonPoints(seasonId, playerId, delta);

          // Update in-memory running totals
          const rt = runningTotals[playerId];
          rt.pool         += delta.pool         || 0;
          rt.bowling      += delta.bowling      || 0;
          rt.golf         += delta.golf         || 0;
          rt.bonus        += delta.bonus        || 0;
          rt.underdog     += delta.underdog     || 0;
          rt.wins         += delta.wins         || 0;
          rt.pool_wins    += delta.pool_wins    || 0;
          rt.bowling_wins += delta.bowling_wins || 0;
          rt.golf_wins    += delta.golf_wins    || 0;
          rt.total = round2(rt.pool + rt.bowling + rt.golf + rt.bonus + rt.underdog);

          // Track per-week totals for king derivation
          if (!weekTotals[match.week]) weekTotals[match.week] = {};
          weekTotals[match.week][playerId] = round2(
            (weekTotals[match.week][playerId] || 0) + earned
          );
        }
      }

      processedSoFar.push(match);
    }
  },
};