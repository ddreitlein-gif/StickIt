import React from 'react';
import RankChip from './RankChip';
import BibChip from './BibChip';

const STATUS_TEXT = { DNS: 'DNS', DNF: 'DNF', DSQ: 'DSQ', RNS: 'RNS', SCR: 'SCR' };

function fmt2(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '–';
  return Number(n).toFixed(2);
}
function fmt1(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '–';
  return Number(n).toFixed(1);
}
function fmtTime(t) {
  if (t == null || t === '') return '–';
  if (Number(t) === -1) return 'NT';
  return Number(t).toFixed(2);
}

function statusOf(r) {
  return r?.run_status && STATUS_TEXT[r.run_status] ? STATUS_TEXT[r.run_status] : null;
}

function StatBlock({ label, value }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div className="sk-display" style={{ fontSize: 9, color: 'var(--fg-dim)', letterSpacing: '0.1em', marginBottom: 2 }}>
        {label}
      </div>
      <div className="sk-mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
        {value}
      </div>
    </div>
  );
}

function JudgeBreakdown({ run, judgeScoresMap }) {
  if (!run || !judgeScoresMap) return null;
  const js = judgeScoresMap[run.id] || judgeScoresMap[run.run_id];
  if (!js) return null;
  const tl = Array.isArray(js.tl) ? js.tl : [];
  const a1 = Array.isArray(js.air1) ? js.air1 : [];
  const a2 = Array.isArray(js.air2) ? js.air2 : [];
  if (tl.length === 0 && a1.length === 0 && a2.length === 0) return null;

  return (
    <div style={{ marginTop: 10, padding: 10, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
      {tl.length > 0 && (
        <div style={{ marginBottom: a1.length > 0 || a2.length > 0 ? 8 : 0 }}>
          <div className="sk-display" style={{ fontSize: 9, color: 'var(--fg-dim)', letterSpacing: '0.1em', marginBottom: 4 }}>TURNS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {tl.map((s, i) => (
              <div key={i} className="sk-mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                <span style={{ color: 'var(--fg-dim)' }}>TL{i + 1}</span>{' '}
                <span style={{ color: 'var(--fg)' }}>{fmt1(s)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {a1.length > 0 && (
        <div style={{ marginBottom: a2.length > 0 ? 8 : 0 }}>
          <div className="sk-display" style={{ fontSize: 9, color: 'var(--fg-dim)', letterSpacing: '0.1em', marginBottom: 4 }}>
            AIR 1{run.jump1_code ? ` (${run.jump1_code})` : ''}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {a1.map((s, i) => (
              <div key={i} className="sk-mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                <span style={{ color: 'var(--fg-dim)' }}>A{i + 1}</span>{' '}
                <span style={{ color: 'var(--fg)' }}>{fmt1(s)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {a2.length > 0 && (
        <div>
          <div className="sk-display" style={{ fontSize: 9, color: 'var(--fg-dim)', letterSpacing: '0.1em', marginBottom: 4 }}>
            AIR 2{run.jump2_code ? ` (${run.jump2_code})` : ''}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {a2.map((s, i) => (
              <div key={i} className="sk-mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                <span style={{ color: 'var(--fg-dim)' }}>A{i + 1}</span>{' '}
                <span style={{ color: 'var(--fg)' }}>{fmt1(s)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseSection({ phaseLabel, run, judgeScoresMap, isBest }) {
  if (!run) {
    return (
      <div style={{ padding: 10, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <div className="sk-display" style={{ fontSize: 10, color: 'var(--fg-dim)', letterSpacing: '0.1em', marginBottom: 4 }}>{phaseLabel}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-dim)' }}>—</div>
      </div>
    );
  }
  const status = statusOf(run);
  return (
    <div style={{
      padding: 10,
      background: isBest ? 'var(--bg-elev)' : 'var(--bg)',
      borderRadius: 8,
      border: isBest ? '1px solid var(--gold)' : '1px solid var(--border)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="sk-display" style={{ fontSize: 10, color: 'var(--fg-dim)', letterSpacing: '0.1em' }}>
          {phaseLabel} {isBest && <span style={{ color: 'var(--gold)' }}>★</span>}
        </div>
        <div className="sk-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>
          {status || fmt2(run.total_score)}
        </div>
      </div>
      {!status && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          <StatBlock label="TURNS" value={fmt1(run.turns_score)} />
          <StatBlock label="AIR" value={fmt2(run.air_score)} />
          <StatBlock label="TIME" value={fmtTime(run.run_time)} />
          <StatBlock label="SPEED" value={fmt2(run.speed_score)} />
        </div>
      )}
      <JudgeBreakdown run={run} judgeScoresMap={judgeScoresMap} />
    </div>
  );
}

export default function AthleteCard({
  rank,
  bib,
  firstName,
  lastName,
  club,
  bestRun,
  allRuns,
  format,
  judgeScoresMap,
  expanded,
  onToggle,
  totalScore,
  status
}) {
  const displayName = [lastName, firstName].filter(Boolean).join(', ');
  const totalText = status || fmt2(totalScore != null ? totalScore : bestRun?.total_score);

  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        borderRadius: 14,
        border: '1px solid var(--border)',
        overflow: 'hidden'
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: 16,
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'block'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <RankChip rank={rank} size={36} />
          <BibChip bib={bib} size="md" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="sk-display" style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {displayName || '—'}
            </div>
            {club && (
              <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {club}
              </div>
            )}
          </div>
          <div className="sk-mono" style={{ fontSize: 22, fontWeight: 700, color: status ? 'var(--red)' : 'var(--fg)', flexShrink: 0 }}>
            {totalText}
          </div>
        </div>

        {bestRun && !status && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            padding: 10,
            background: 'var(--bg)',
            borderRadius: 8,
            border: '1px solid var(--border)'
          }}>
            <StatBlock label="TURNS" value={fmt1(bestRun.turns_score)} />
            <StatBlock label="AIR" value={fmt2(bestRun.air_score)} />
            <StatBlock label="TIME" value={fmtTime(bestRun.run_time)} />
            <StatBlock label="SPEED" value={fmt2(bestRun.speed_score)} />
          </div>
        )}
      </button>

      {expanded && allRuns && allRuns.length > 0 && (
        <div style={{ padding: '0 16px 16px', display: 'grid', gap: 8 }}>
          {allRuns.map((r, i) => (
            <PhaseSection
              key={i}
              phaseLabel={r.phaseLabel || `Run ${r.run_number}`}
              run={r}
              judgeScoresMap={judgeScoresMap}
              isBest={bestRun && (r.id === bestRun.id || r.run_id === bestRun.run_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
