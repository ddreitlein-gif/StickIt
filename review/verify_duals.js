/**
 * Dual moguls verification harness (Phase 2).
 *
 * Decoded .fre duals model (validated against SFU0587/SFU0588 official XML):
 *   - Order/D = the athlete's ladder position in each successive round
 *     (index 0 = first knockout round on the full ladder, e.g. 64 positions).
 *   - D<k>=    the athlete's OWN votes from each of the 5 judges in round k
 *     (1-based round number matching Order/D index k-1).
 *   - In round k, positions (2j-1, 2j) are opponents.  Opposing vote lines
 *     are complementary (sum to 5 per judge), except tie/DNF rounds (0/0).
 *   - Winner = simple majority of the 25 votes (JH 6304.3.1/6304.3.3).
 *   - Winners advance to position ceil(p/2) in the next round (main draw).
 *
 * Checks per event/gender:
 *   1. vote complement violations (data integrity)
 *   2. majority-winner advancement violations (bracket integrity)
 *   3. per-judge split validity (0..5 whole votes)
 *   4. optional comparison of final placement vs official XML ranks
 *
 * Usage: node review/verify_duals.js <file.fre> [--xml g=path] [--v]
 */
const fs = require('fs');
const path = require('path');
const { parseFre } = require('./lib/parseFre');

function parseXmlRanks(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const out = [];
  const re = /<FS_ranked[^>]*>([\s\S]*?)<\/FS_ranked>/g; let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const g = t => (b.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1];
    out.push({ rank: Number(g('Rank')), bib: Number(g('Bib')), last: g('Lastname') });
  }
  const notRanked = [];
  const nr = /<FS_notranked[^>]*Status="([^"]*)"[^>]*>([\s\S]*?)<\/FS_notranked>/g;
  while ((m = nr.exec(xml))) notRanked.push({ status: m[1], bib: Number((m[2].match(/<Bib>(\d+)/) || [])[1]) });
  return { ranked: out, notRanked };
}

function main() {
  const args = process.argv.slice(2);
  const frePath = args[0];
  const opt = { xml: {}, verbose: false };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--xml') { const [g, p] = args[++i].split('='); opt.xml[g] = p; }
    else if (args[i] === '--v') opt.verbose = true;
    else if (args[i] === '--standings') opt.standings = true;
  }
  const doc = parseFre(frePath);
  console.log(`# ${path.basename(frePath)}  duals`);

  for (const gender of ['F', 'M']) {
    const entrants = doc.entrants.filter(e => e.gender === gender && e.orders.D && e.orders.D.length);
    if (!entrants.length) continue;
    const maxRounds = Math.max(...entrants.map(e => e.orders.D.length));
    console.log(`\n## Gender ${gender}: ${entrants.length} athletes, rounds=${maxRounds}`);

    let complementErr = 0, advanceErr = 0, splitErr = 0, matches = 0, byes = 0;
    const matchInfo = new Map(); // `${round}:${bib}` -> { oppVotes, oppStatus, walkover }
    for (let k = 0; k < maxRounds; k++) {
      // map position -> athlete for round k
      const byPos = new Map();
      for (const e of entrants) {
        if (e.orders.D.length > k) {
          const p = e.orders.D[k];
          if (byPos.has(p)) console.log(`  POSITION COLLISION round ${k + 1} pos ${p}: ${byPos.get(p).name} vs ${e.name}`);
          byPos.set(p, e);
        }
      }
      const maxPos = Math.max(...byPos.keys());
      for (let j = 1; 2 * j - 1 <= maxPos; j++) {
        const a = byPos.get(2 * j - 1), b = byPos.get(2 * j);
        if (!a && !b) continue;
        if (!a || !b) { byes++; continue; }
        matches++;
        const round = String(k + 1);
        const va = a.dualRounds[round], vb = b.dualRounds[round];
        if (!va || !vb) {
          if (opt.verbose) console.log(`  round ${k + 1} pos ${2 * j - 1}/${2 * j}: missing vote line (${a.name} vs ${b.name})`);
          continue;
        }
        const sa = va.votes.reduce((x, y) => x + y, 0);
        const sb = vb.votes.reduce((x, y) => x + y, 0);
        const walkover = sa === 0 && sb === 0;
        matchInfo.set(`${k + 1}:${a.bib}`, { oppVotes: sb, oppStatus: vb.status, walkover });
        matchInfo.set(`${k + 1}:${b.bib}`, { oppVotes: sa, oppStatus: va.status, walkover });
        // per-judge complement
        for (let ji = 0; ji < 5; ji++) {
          const s = (va.votes[ji] || 0) + (vb.votes[ji] || 0);
          if (s !== 5 && s !== 0 && s !== 4) {
            // 5 = normal; 0 = DNF/unscored; 4 = overall judge with time tie
            complementErr++;
            console.log(`  COMPLEMENT round ${k + 1} J${ji + 1}: ${a.name}(${va.votes[ji]}) + ${b.name}(${vb.votes[ji]}) = ${s}`);
            break;
          }
          if ((va.votes[ji] % 1 !== 0) || va.votes[ji] < 0 || va.votes[ji] > 5) {
            splitErr++;
            console.log(`  SPLIT round ${k + 1} J${ji + 1}: ${a.name} votes ${va.votes[ji]}`);
          }
        }
        // winner determination
        let winner = null, loser = null;
        if (va.status && !vb.status) { winner = b; loser = a; }
        else if (vb.status && !va.status) { winner = a; loser = b; }
        else if (sa > sb) { winner = a; loser = b; }
        else if (sb > sa) { winner = b; loser = a; }
        if (!winner) {
          if (sa === 0 && sb === 0) { if (opt.verbose) console.log(`  round ${k + 1} pos ${2 * j - 1}: both zero (${a.name} vs ${b.name})`); continue; }
          console.log(`  TIE round ${k + 1}: ${a.name} ${sa} vs ${b.name} ${sb}  (no winner determinable)`);
          continue;
        }
        // advancement check (main-draw shape: winner should hold ceil(p/2) next round)
        const nextPos = Math.ceil((2 * j - 1) / 2);
        const wNext = winner.orders.D[k + 1];
        const lNext = loser.orders.D[k + 1];
        if (lNext === nextPos && wNext !== nextPos) {
          advanceErr++;
          console.log(`  ADVANCE round ${k + 1} pos ${2 * j - 1}/${2 * j}: vote winner ${winner.name} (${sa > sb ? sa : sb}) did NOT advance; ` +
            `${loser.name} took slot ${nextPos}.  votes ${a.name}=${sa} ${b.name}=${sb} status ${va.status}/${vb.status}`);
        }
        if (opt.verbose) {
          console.log(`  R${k + 1} [${2 * j - 1} v ${2 * j}] ${a.name} ${sa} - ${sb} ${b.name}  -> ${winner.name}`);
        }
      }
    }
    console.log(`  matches=${matches} byes=${byes} complementErr=${complementErr} advanceErr=${advanceErr} splitErr=${splitErr}`);

    // ---- Derive final standings per USSS 4312 ----
    // Ladder size B from round-1 positions; main-draw positions in round k
    // are 1..B/2^(k-1).  Trail length k = athlete's last round.
    const B = Math.pow(2, Math.ceil(Math.log2(Math.max(...entrants.map(e => e.orders.D[0])))));
    const finalsRound = Math.log2(B) ; // round number whose main positions are 1..2
    const standings = [];
    const finalsAthletes = new Set();
    // Duals-decided places: the last round WITH VOTE LINES holds the finals
    // duals at positions 1/2 (championship), 3/4 (small final), 5/6 and 7/8
    // (runoff duals when used).  A trailing marker round (no vote lines)
    // lists each dual's winner; ignore it for placement.
    let lastRound = 0;
    for (const e of entrants) {
      for (const k of Object.keys(e.dualRounds)) lastRound = Math.max(lastRound, Number(k));
    }
    const lastPos = new Map();
    for (const e of entrants) {
      if (e.orders.D.length >= lastRound) lastPos.set(e.orders.D[lastRound - 1], e);
    }
    for (const basePos of [1, 3, 5, 7]) {
      const a = lastPos.get(basePos), b = lastPos.get(basePos + 1);
      if (!a || !b) continue;
      const va = a.dualRounds[String(lastRound)], vb = b.dualRounds[String(lastRound)];
      const sa = va ? va.votes.reduce((x, y) => x + y, 0) : 0;
      const sb = vb ? vb.votes.reduce((x, y) => x + y, 0) : 0;
      let w = a, l = b;
      if (va && va.status && !(vb && vb.status)) { w = b; l = a; }
      else if (vb && vb.status && !(va && va.status)) { w = a; l = b; }
      else if (sb > sa) { w = b; l = a; }
      standings.push({ place: basePos, e: w });
      standings.push({ place: basePos + 1, e: l });
      finalsAthletes.add(w); finalsAthletes.add(l);
    }
    // Eliminated blocks: athletes not in finals duals, grouped by trail length
    // (= round where eliminated), deeper rounds rank higher.  Within a block:
    // scored by votes desc then seed asc; DNF by seed; then DNS by seed
    // (first-round DNS unclassified).
    const elim = entrants.filter(e => !finalsAthletes.has(e));
    const byRound = new Map();
    const unclassified = [];
    for (const e of elim) {
      const k = e.orders.D.length;
      // USSS 4312.4: DNS in the athlete's FIRST round -> not classified.
      // Walkovers (both sides zero votes, no status) are treated as no-shows:
      // an athlete who never received a vote and exited via DNS or walkover
      // is not classified (matches Winfree practice).
      const firstVoted = Object.keys(e.dualRounds).map(Number).sort((a, b) => a - b)[0];
      const fv = firstVoted ? e.dualRounds[String(firstVoted)] : null;
      const everScored = Object.values(e.dualRounds).some(v => v.votes.some(x => x > 0));
      const exitInfo = matchInfo.get(`${k}:${e.bib}`);
      const exitedByWalkover = exitInfo && exitInfo.walkover && !e.dualRounds[String(k)]?.status;
      if (!everScored && (exitedByWalkover || (fv && fv.status === 'DNS'))) { unclassified.push(e); continue; }
      if (!firstVoted) { unclassified.push(e); continue; }
      if (!byRound.has(k)) byRound.set(k, []);
      byRound.get(k).push(e);
    }
    let nextPlace = standings.length + 1;
    const rounds = [...byRound.keys()].sort((a, b) => b - a);
    for (const k of rounds) {
      const group = byRound.get(k);
      const info = group.map(e => {
        const v = e.dualRounds[String(k)];
        return { e, votes: v ? v.votes.reduce((x, y) => x + y, 0) : 0, status: v ? v.status : null };
      });
      const scored = info.filter(i => !i.status && i.votes > 0);
      const zeroNoStatus = info.filter(i => !i.status && i.votes === 0);
      const dnf = info.filter(i => i.status === 'DNF');
      const dns = info.filter(i => i.status === 'DNS');
      const dsq = info.filter(i => i.status === 'DSQ' || i.status === 'DQ');
      scored.sort((a, b) => b.votes - a.votes || a.e.seeds.D - b.e.seeds.D);
      zeroNoStatus.sort((a, b) => a.e.seeds.D - b.e.seeds.D);
      dnf.sort((a, b) => a.e.seeds.D - b.e.seeds.D);
      dns.sort((a, b) => a.e.seeds.D - b.e.seeds.D);
      for (const i of [...scored, ...zeroNoStatus, ...dnf, ...dns, ...dsq]) {
        standings.push({ place: nextPlace++, e: i.e, votes: i.votes, status: i.status, round: k });
      }
    }
    if (opt.verbose || opt.standings) {
      console.log('  Derived standings (USSS 4312):');
      for (const s of standings) {
        console.log(`    ${String(s.place).padStart(3)}. bib ${String(s.e.bib).padStart(3)} ${s.e.name}  seed=${s.e.seeds.D}${s.round ? ` (out R${s.round}, votes=${s.votes}${s.status ? ' ' + s.status : ''})` : ''}`);
      }
    }

    // Final placement comparison vs XML
    const xmlPath = opt.xml[gender];
    if (xmlPath) {
      const xml = parseXmlRanks(xmlPath);
      let rankMatch = 0, rankMiss = 0;
      for (const x of xml.ranked) {
        const s = standings.find(st => st.e.bib === x.bib);
        if (s && s.place === x.rank) rankMatch++;
        else {
          rankMiss++;
          console.log(`  RANK MISMATCH: official r${x.rank} bib ${x.bib} ${x.last} vs derived ${s ? s.place : 'none'}`);
        }
      }
      console.log(`  standings vs XML: match=${rankMatch} miss=${rankMiss} of ${xml.ranked.length}`);
      if (!opt.verbose) { continue; }
      // Derive Winfree final placements: athletes sorted by official rank; print
      // alongside last Order/D entry and elimination data for audit.
      console.log('  Official ranks vs ladder trail:');
      for (const x of xml.ranked.slice(0, 16)) {
        const e = entrants.find(en => en.bib === x.bib);
        if (!e) { console.log(`    r${x.rank} bib ${x.bib} ${x.last}  (not in duals data)`); continue; }
        const lastRound = e.orders.D.length;
        const votes = e.dualRounds[String(lastRound)];
        console.log(`    r${x.rank} bib ${x.bib} ${x.last}  seed=${e.seeds.D} trail=[${e.orders.D}] lastVotes=${votes ? votes.votes.join(',') : '-'}${votes && votes.status ? '[' + votes.status + ']' : ''}`);
      }
      for (const n of xml.notRanked) console.log(`    NOTRANKED ${n.status} bib ${n.bib}`);
    }
  }
}

main();
