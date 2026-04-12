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

  // Returns array of player IDs all tied at the lowest season total.
  // Only considers players who appear in standingsArr (have earned points).
  // If no one has points yet, returns empty — no underdog before week 1 results.
  getUnderdogIds(standingsArr, allPlayers) {
    // Build totals only from players who have a standings row
    const totals = {};
    standingsArr.forEach(r => {
      if (r.player_id !== undefined) {
        totals[r.player_id] = parseFloat(r.total) || 0;
      }
    });

    // If nobody has played yet, no underdog
    const vals = Object.values(totals);
    if (!vals.length) return [];

    const lowest = Math.min(...vals);

    // Must be a unique lowest — if everyone is tied (all same score) treat
    // them all as underdogs only when there is genuinely one (or more tied) bottom.
    return Object.entries(totals)
      .filter(([, v]) => v === lowest)
      .map(([id]) => id);
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
      // Prefer isWinner flag (always set by the form) — fall back to position
      const hasFlag2v2 = placements.some(p => p.isWinner === true || p.isWinner === false);
      if (hasFlag2v2) {
        placements.forEach(p => {
          if (p.isWinner === true)  winnerGroup.push(p.player_id);
          else                      loserGroup.push(p.player_id);
        });
      } else {
        placements.forEach(p => {
          if (p.position <= 2) winnerGroup.push(p.player_id);
          else                 loserGroup.push(p.player_id);
        });
      }

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
    // King slay: each winner on the team gets the full bonus individually
    const kingBonus  = this.getKingBonus(loserGroup, cfg._kingId, cfg.kingSlay);
    // Upset bonus portion (above base)
    const upsetBonus = round2((perWinner - (base / winnerGroup.length)));

    winnerGroup.forEach(wId => {
      if (!points[wId]) return;
      const ud = this.applyUnderdogMultiplier(wId, perWinner, underdogIds, cfg.underdogMultiplier);
      points[wId].pool      += round2(ud.finalPoints + kingBonus);
      points[wId].bonus     += round2(kingBonus);  // only king slay, upset is in pool
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

      // Derive king for THIS match: whoever scored highest in ANY previous week
      // (uses the most recent week that had matches, handles non-contiguous weeks)
      // Week 1 has no king.
      const cfgNow = { ...cfg, _kingId: null };
      const prevWeek = match.week - 1;
      if (prevWeek >= 1) {
        // Collect all week totals from weeks before this match's week
        const combinedPrev = {};
        Object.entries(weekTotals).forEach(([w, totals]) => {
          if (parseInt(w) <= prevWeek) {
            Object.entries(totals).forEach(([pid, pts]) => {
              combinedPrev[pid] = round2((combinedPrev[pid] || 0) + pts);
            });
          }
        });
        if (Object.keys(combinedPrev).length) {
          let topId = null, topPts = -1;
          Object.entries(combinedPrev).forEach(([pid, pts]) => {
            if (pts > topPts) { topPts = pts; topId = pid; }
          });
          cfgNow._kingId = topId || null;
        }
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

    // 4. Update current_king and current_underdog config to reflect live standings
    //    King = player with highest season total
    //    Underdog = player(s) tied at the lowest season total (among players who have played)
    let liveKingName = '', liveKingPts = -Infinity;
    allPlayerIds.forEach(id => {
      const t = runningTotals[id].total;
      if (t > liveKingPts) { liveKingPts = t; liveKingName = allPlayers.find(p => p.id === id)?.name || ''; }
    });

    const liveStandings = allPlayerIds
      .filter(id => runningTotals[id].total > 0 || runningTotals[id].wins > 0)
      .map(id => ({ player_id: id, total: runningTotals[id].total }));
    const liveUnderdogIds   = this.getUnderdogIds(liveStandings, allPlayers);
    const liveUnderdogNames = liveUnderdogIds.map(id => allPlayers.find(p => p.id === id)?.name || id);

    await Promise.all([
      DB.setConfig('current_king',     liveKingName),
      DB.setConfig('current_underdog', liveUnderdogNames.join(',')),
    ]);

    // 5. Compute tags and advance rotation
    await this.updateTags(seasonId, allMatches, allPlayers, runningTotals);
  },

  // ── TAG SYSTEM ───────────────────────────────────────────
  // Computes which tags each player currently holds, advances
  // each player's rotation index by 1, saves to DB.

  computeTags(allMatches, allPlayers, runningTotals) {
    const active = allMatches.filter(m => !m.deleted);
    const ids    = allPlayers.map(p => p.id);

    // ── Stat accumulators ──────────────────────────────────
    // Pool
    const poolWins        = {};  // total pool wins
    const poolLosses      = {};  // total pool losses
    const poolMatches     = {};  // total pool matches played
    const poolUpsetWins   = {};  // pool wins where winner was ranked lower
    const poolAntiFarm    = {};  // times reduced by anti-farm rule (approx: track from match data)
    const poolLossStreak  = {};  // current AND max loss streak in pool
    const pool2v2TeamWins = {};  // wins as part of 2v2 team
    const pool2v2SoloWins = {};  // wins in singles
    const opponentsBeatenPool = {}; // set of unique opponent IDs beaten in pool
    const lossesToPlayer  = {};  // lossesToPlayer[id][oppId] = count
    const poolWinsFromLast = {}; // wins where winner was ranked last (rank === total players)
    const poolLastPlaceFinishes = {}; // times finished last in pool (lost as loser)

    // Bowling
    const bowlingFirst  = {};
    const bowlingLast   = {};

    // Golf
    const golfWins  = {};
    const golfLoses = {};

    // Cross-sport
    const totalMatches   = {};  // all matches played (any sport)
    const lossesAsHigher = {};  // losses where player was ranked higher than winner

    ids.forEach(id => {
      poolWins[id] = poolLosses[id] = poolMatches[id] = poolUpsetWins[id] = 0;
      poolAntiFarm[id] = poolLossStreak[id] = pool2v2TeamWins[id] = pool2v2SoloWins[id] = 0;
      opponentsBeatenPool[id] = new Set();
      lossesToPlayer[id] = {};
      poolWinsFromLast[id] = 0;
      poolLastPlaceFinishes[id] = 0;
      bowlingFirst[id] = bowlingLast[id] = 0;
      golfWins[id] = golfLoses[id] = 0;
      totalMatches[id] = lossesAsHigher[id] = 0;
    });

    // Build rank map from final standings for ranking-based tag checks
    const standingsArr = ids.map(id => ({ player_id: id, total: runningTotals[id].total }));
    const finalRankMap = this.buildRankMap(standingsArr, allPlayers);
    const totalPlayers = allPlayers.length;

    // Track pool loss streaks per player
    const poolStreakCurrent = {};
    const poolStreakMax     = {};
    ids.forEach(id => { poolStreakCurrent[id] = 0; poolStreakMax[id] = 0; });

    // Need to sort matches chronologically for streak tracking
    const sorted = [...active].sort((a, b) => {
      const da = new Date(a.match_date || a.created_at);
      const db2 = new Date(b.match_date || b.created_at);
      return da - db2;
    });

    // Build a running rank map per match for ranking-based checks
    // (reuse the already-sorted matches and rebuild rank incrementally)
    const runningMatchTotals = {};
    ids.forEach(id => { runningMatchTotals[id] = 0; });

    for (const match of sorted) {
      const sport = match.sport;
      const pl    = (match.match_placements || []).sort((a, b) => a.position - b.position);
      const pIds  = pl.map(p => p.player_id).filter(Boolean);

      // Build rank map at time of this match
      const matchStandings = ids.map(id => ({ player_id: id, total: runningMatchTotals[id] }));
      const matchRankMap   = this.buildRankMap(matchStandings, allPlayers);

      pIds.forEach(id => { if (totalMatches[id] !== undefined) totalMatches[id]++; });

      if (sport === 'Pool') {
        const mode = match.pool_mode;
        const hasFlag = pl.some(p => p.is_winner === true || p.is_winner === false);
        let winners = [], losers = [];

        if (hasFlag) {
          pl.forEach(p => {
            if (p.is_winner === true)  winners.push(p.player_id);
            else                       losers.push(p.player_id);
          });
        } else {
          pl.forEach((p, i) => {
            if (i === 0) winners.push(p.player_id);
            else         losers.push(p.player_id);
          });
        }

        winners = winners.filter(Boolean);
        losers  = losers.filter(Boolean);

        winners.forEach(wId => {
          if (!ids.includes(wId)) return;
          poolWins[wId]++;
          poolMatches[wId]++;
          opponentsBeatenPool[wId] = opponentsBeatenPool[wId] || new Set();
          losers.forEach(lId => opponentsBeatenPool[wId].add(lId));

          // Upset win in pool: winner ranked lower than at least one loser
          const wRank = matchRankMap[wId] || 999;
          const isUpset = losers.some(lId => (matchRankMap[lId] || 999) < wRank);
          if (isUpset) poolUpsetWins[wId]++;

          // Win from last place
          if (matchRankMap[wId] === totalPlayers) poolWinsFromLast[wId]++;

          // Singles win
          if (mode === 'Singles') pool2v2SoloWins[wId]++;

          // 2v2 team win
          if (mode === '2v2') pool2v2TeamWins[wId]++;

          // Reset loss streak
          poolStreakCurrent[wId] = 0;
        });

        losers.forEach(lId => {
          if (!ids.includes(lId)) return;
          poolLosses[lId]++;
          poolMatches[lId]++;
          poolLastPlaceFinishes[lId]++;

          // Loss streak
          poolStreakCurrent[lId]++;
          if (poolStreakCurrent[lId] > poolStreakMax[lId]) {
            poolStreakMax[lId] = poolStreakCurrent[lId];
          }

          // Loss to specific player tracking
          winners.forEach(wId => {
            lossesToPlayer[lId] = lossesToPlayer[lId] || {};
            lossesToPlayer[lId][wId] = (lossesToPlayer[lId][wId] || 0) + 1;
          });

          // Loss as higher ranked (serial bottler — pool)
          const lRank = matchRankMap[lId] || 999;
          const lostToLower = winners.some(wId => (matchRankMap[wId] || 999) > lRank);
          if (lostToLower) lossesAsHigher[lId]++;
        });

        // Update running totals (approximate — just track win/loss for rank purposes)
        winners.forEach(wId => { if (runningMatchTotals[wId] !== undefined) runningMatchTotals[wId] += 3; });

      } else if (sport === 'Bowling') {
        const numPlayers = pIds.length;
        pIds.forEach((id, i) => {
          if (!ids.includes(id)) return;
          if (i === 0) {
            bowlingFirst[id]++;
            // Loss as higher ranked for non-pool
            // (not applicable for 1st place winner)
          }
          if (i === numPlayers - 1 && numPlayers > 1) bowlingLast[id]++;

          // Loss as higher ranked: if you're ranked higher than the winner but didn't win
          if (i > 0) {
            const myRank = matchRankMap[id] || 999;
            const winnerRank = matchRankMap[pIds[0]] || 999;
            if (myRank < winnerRank) lossesAsHigher[id]++;
          }

          if (runningMatchTotals[id] !== undefined) {
            if (i === 0) runningMatchTotals[id] += 5;
            else if (i === 1) runningMatchTotals[id] += 2;
          }
        });

      } else if (sport === 'Golf') {
        const numPlayers = pIds.length;
        pIds.forEach((id, i) => {
          if (!ids.includes(id)) return;
          if (i === 0) golfWins[id]++;
          else         golfLoses[id]++;

          if (i > 0) {
            const myRank = matchRankMap[id] || 999;
            const winnerRank = matchRankMap[pIds[0]] || 999;
            if (myRank < winnerRank) lossesAsHigher[id]++;
          }

          if (runningMatchTotals[id] !== undefined) {
            if (i === 0) runningMatchTotals[id] += 5;
            else if (i === 1) runningMatchTotals[id] += 2;
          }
        });
      }
    }

    // ── Anti-farm: count from season_points bonus-reduced matches ──
    // Approximate: players with more losses than 2× wins vs same opponent
    // We'll use poolMatches - poolWins as proxy for pool losses for anti-farm
    // (actual anti-farm tracking would need match-level flags, use poolLosses as proxy)

    // ── How many unique opponents each player has beaten in pool ──
    const uniquePoolBeaten = {};
    ids.forEach(id => { uniquePoolBeaten[id] = opponentsBeatenPool[id]?.size || 0; });

    // ── Full Penetration: beaten ALL other players in pool at least once ──
    const fullPenetration = {};
    ids.forEach(id => {
      const others = ids.filter(x => x !== id);
      fullPenetration[id] = others.length > 0 && others.every(x => opponentsBeatenPool[id]?.has(x));
    });

    // ── Most played-against in pool (Free Real Estate) ──
    const timesPlayedAgainst = {};
    ids.forEach(id => { timesPlayedAgainst[id] = 0; });
    for (const match of active) {
      if (match.sport !== 'Pool') continue;
      const pl = match.match_placements || [];
      pl.forEach(p => {
        if (p.player_id && timesPlayedAgainst[p.player_id] !== undefined) {
          timesPlayedAgainst[p.player_id]++;
        }
      });
    }

    // ── Fluffer: most 2v2 team wins but zero singles wins ──
    const isFluffer = {};
    ids.forEach(id => {
      isFluffer[id] = pool2v2TeamWins[id] > 0 && pool2v2SoloWins[id] === 0;
    });

    // ── Pool win rate ──
    const poolWinRate = {};
    ids.forEach(id => {
      poolWinRate[id] = poolMatches[id] > 0 ? poolWins[id] / poolMatches[id] : 0;
    });

    // ── Punching Bag: most losses to one specific player (any sport) ──
    const punchingBagScore = {};
    ids.forEach(id => {
      const losses = lossesToPlayer[id] || {};
      punchingBagScore[id] = Object.values(losses).length ? Math.max(...Object.values(losses)) : 0;
    });

    // ── Serial Bottler: most losses when ranked higher (any sport) ──
    // Already tracked in lossesAsHigher

    // ── Now assign tags — one tag per player, exclusive ──
    // Priority order determines which tag "wins" when a player qualifies for multiple
    // Each tag is assigned to exactly ONE player (the one with the highest qualifying stat)

    const TAGS = [
      // Pool tags
      {
        id: 'ball_fondler',
        label: 'Ball Fondler 🎱',
        desc: 'Highest pool win rate',
        score: id => poolMatches[id] >= 3 ? poolWinRate[id] : 0,
      },
      {
        id: 'cushion_humper',
        label: 'Cushion Humper 🎱',
        desc: 'Most upset wins in pool',
        score: id => poolUpsetWins[id],
      },
      {
        id: 'full_penetration',
        label: 'Full Penetration 🎱',
        desc: 'Beaten every other player in pool',
        score: id => fullPenetration[id] ? 1 : 0,
      },
      {
        id: 'rear_entry',
        label: 'Rear Entry 🎱',
        desc: 'Most pool wins from last place',
        score: id => poolWinsFromLast[id],
      },
      {
        id: 'sloppy_seconds',
        label: 'Sloppy Seconds 🎱',
        desc: 'Most 2nd place pool finishes',
        score: id => poolLastPlaceFinishes[id],  // losers in pool = sloppy seconds
      },
      {
        id: 'slow_stroker',
        label: 'Slow Stroker 🎱',
        desc: 'Most anti-farm reductions',
        // Use lossesToPlayer same opponent wins as proxy
        score: id => {
          // Count wins against same opponent in same week (approximation via losses they caused)
          // Use total pool wins minus unique opponents beaten as proxy for repeat farming
          return Math.max(0, (poolWins[id] || 0) - (uniquePoolBeaten[id] || 0));
        },
      },
      {
        id: 'free_real_estate',
        label: 'Free Real Estate 🎱',
        desc: 'Most played-against player in pool',
        score: id => timesPlayedAgainst[id],
      },
      {
        id: 'the_fluffer',
        label: 'The Fluffer 🎱',
        desc: 'Most 2v2 team wins, zero singles wins',
        score: id => isFluffer[id] ? pool2v2TeamWins[id] : 0,
      },
      {
        id: 'cum_dumpster',
        label: 'Cum Dumpster 🎱',
        desc: 'Most pool losses in a row',
        score: id => poolStreakMax[id],
      },
      // Bowling tags
      {
        id: 'lane_daddy',
        label: 'Lane Daddy 🎳',
        desc: 'Most bowling 1st place wins',
        score: id => bowlingFirst[id],
      },
      {
        id: 'gutter_gremlin',
        label: 'Gutter Gremlin 🎳',
        desc: 'Most last-place finishes in bowling',
        score: id => bowlingLast[id],
      },
      // Golf tags
      {
        id: 'caddy_shagger',
        label: 'Caddy Shagger ⛳',
        desc: 'Most golf wins',
        score: id => golfWins[id],
      },
      {
        id: 'grass_stain',
        label: 'Grass Stain ⛳',
        desc: 'Most golf losses',
        score: id => golfLoses[id],
      },
      // Rivalry / cross-sport tags
      {
        id: 'punching_bag',
        label: 'Punching Bag 💀',
        desc: 'Most losses to one specific player',
        score: id => punchingBagScore[id],
      },
      {
        id: 'serial_bottler',
        label: 'Serial Bottler 💀',
        desc: 'Most losses when ranked higher than opponent',
        score: id => lossesAsHigher[id],
      },
    ];

    // Assign each tag to the single highest-scoring player
    // If score is 0 or tied, use totalMatches as tiebreaker
    const tagAssignments = {}; // playerId -> [tagLabel, ...]
    ids.forEach(id => { tagAssignments[id] = []; });

    const assignedTags = new Set();

    for (const tag of TAGS) {
      // Find the player with the highest score for this tag
      let bestId = null, bestScore = 0;
      for (const id of ids) {
        const s = tag.score(id);
        if (s <= 0) continue; // must actually have earned it
        if (s > bestScore || (s === bestScore && totalMatches[id] > (totalMatches[bestId] || 0))) {
          bestScore = s;
          bestId = id;
        }
      }
      if (bestId) {
        tagAssignments[bestId].push({ id: tag.id, label: tag.label, desc: tag.desc });
        assignedTags.add(tag.id);
      }
    }

    return tagAssignments;
  },

  async updateTags(seasonId, allMatches, allPlayers, runningTotals) {
    const ids          = allPlayers.map(p => p.id);
    const tagMap       = this.computeTags(allMatches, allPlayers, runningTotals);
    const rotations    = await DB.getTagRotations(ids);

    const saves = [];
    for (const id of ids) {
      const tags = tagMap[id] || [];
      if (!tags.length) {
        // No tags — reset rotation to 0
        saves.push(DB.setTagRotation(id, 0));
        continue;
      }
      // Advance rotation by 1
      const currentIdx = rotations[id] || 0;
      const nextIdx    = (currentIdx + 1) % tags.length;
      saves.push(DB.setTagRotation(id, nextIdx));
    }
    await Promise.all(saves);

    // Store the full tag map as JSON in config so the dashboard can read it without recomputing
    const tagMapSerializable = {};
    ids.forEach(id => { tagMapSerializable[id] = tagMap[id] || []; });
    await DB.setConfig('player_tags', JSON.stringify(tagMapSerializable));

    return tagMap;
  },
};