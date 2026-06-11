/**
 * Parser for Winfree "By Score" result sheets extracted with pdftotext -layout.
 * Returns { paceM, paceF, athletes: [{rank, bib, name, group, eventTotal}] }.
 *
 * Athlete blocks start with:  <rank> <bib> NAME,First  <Gp> <Club...>
 * and the event total is the last numeric token of the block's last
 * numeric-bearing line.  Blocks may also end with dns/dnf markers.
 */
function parsePdfResults(text) {
  const lines = text.split('\n');
  const out = { paceM: null, paceF: null, athletes: [] };

  for (const l of lines) {
    const pm = l.match(/Pace:\s*Male\s*=\s*([\d.]+),\s*Female\s*=\s*([\d.]+)/i);
    if (pm) { out.paceM = Number(pm[1]); out.paceF = Number(pm[2]); }
  }

  // Identify athlete header lines: rank, bib, NAME (uppercase last name with comma)
  const headerRe = /^\s{0,4}(\d{1,3})\s+(\d{1,3})\s+([A-Z'\-]+,\S+)\s+([MF][A-Za-z0-9]{1,2})\b/;
  let cur = null;
  const blocks = [];
  for (const l of lines) {
    const m = l.match(headerRe);
    if (m) {
      cur = { rank: Number(m[1]), bib: Number(m[2]), name: m[3], group: m[4], lines: [l] };
      blocks.push(cur);
    } else if (cur) {
      // Page headers and column headers interrupt blocks across page breaks;
      // skip them WITHOUT closing the block so run-2 lines at the top of the
      // next page still attach to the right athlete.
      if (/Filename:|Page\s+\d|\(By (Score|Bib)\)|Date:|Time:|^\s*[=-]{5,}|No\s+Bib|T&L--|^\s*Moguls\b|Female\/Male|Head Judge|Chief of|T\.D\.|Judge \d|Pace:|Break Pt|Course:|Length:|Width:|Pitch:/.test(l)) {
        continue;
      }
      cur.lines.push(l);
    }
  }

  for (const b of blocks) {
    let total = null;
    for (const l of b.lines) {
      const nums = l.match(/\d+\.\d{2}(?!\d)/g);
      if (nums && nums.length) total = Number(nums[nums.length - 1]);
      else if (/\b(dns|dnf|dsq|rns)\b/i.test(l) && total != null) { /* keep */ }
    }
    out.athletes.push({ rank: b.rank, bib: b.bib, name: b.name, group: b.group, eventTotal: total });
  }
  return out;
}

module.exports = { parsePdfResults };
