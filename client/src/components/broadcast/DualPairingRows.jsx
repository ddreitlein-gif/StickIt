import React from 'react';
import { outstandingFeeders, pad2, winnerSide } from './broadcastDual';

// StickIt v2.6.00 -- Broadcast Board dual pairing rows (round board + finals
// block) and the "Coming Up" strip. Blue skier left, red skier right (the
// tablets' and the overlay's convention), each with a course-color bar.
// Completed rows show the five-judge split as two chips: winner solid course
// color, loser grey (a DNF / DNS / DSQ loser shows the status instead of
// points). The next pairing gets the navy outline + NEXT tab; later
// pairings read TO RUN. Sides the server has not filled read "Winner of 11"
// on no course (broadcastDual.js).

const fullName = (first, last) => [first, last].filter(Boolean).join(' ');

function Side({ color, name, bib, win, placeholder, right, showBib }) {
  return (
    <div className={`bb-side-cell${right ? ' r' : ''}`}>
      <span className={`bb-course-bar ${placeholder ? 'none' : color}`} />
      <div className="bb-side-text">
        {placeholder
          ? <div className="bb-side-name tbd">{placeholder}</div>
          : <>
              <div className={`bb-side-name${win ? ' win' : ''}`}>{name}</div>
              {showBib && bib != null && bib !== '' ? <div className="bb-side-bib bb-num">Bib {bib}</div> : null}
            </>}
      </div>
    </div>
  );
}

function Middle({ m, isNext, chip }) {
  let row;
  if (m.status === 'complete') {
    const w = winnerSide(m);
    const blueLoser = w === 'red', redLoser = w === 'blue';
    const blueVal = blueLoser && m.loser_status ? m.loser_status : (m.blue_total ?? '');
    const redVal = redLoser && m.loser_status ? m.loser_status : (m.red_total ?? '');
    row = (
      <div className="bb-pair-mid-row" data-testid="bb-split">
        <span className={`bb-chip ${w === 'blue' ? 'blue' : 'lose'}${blueLoser && m.loser_status ? ' status' : ''}`} data-testid="bb-chip-blue">{blueVal}</span>
        <span className={`bb-chip ${w === 'red' ? 'red' : 'lose'}${redLoser && m.loser_status ? ' status' : ''}`} data-testid="bb-chip-red">{redVal}</span>
      </div>
    );
  } else if (isNext) {
    row = <div className="bb-pair-mid-row"><span className="bb-vs">VS</span></div>;
  } else {
    row = <div className="bb-pair-mid-row"><span className="bb-torun">To run</span></div>;
  }
  return <div className="bb-pair-mid">{row}{chip}</div>;
}

// compact: qualifying-round pages with more than four pairings (Round of 16 /
// 32) — 80px rows, names only, so eight rows and the Coming Up strip fit.
export function PairingRow({ m, matches, isNext = false, champ = false, showRoundChip = false, compact = false }) {
  const placeholders = outstandingFeeders(m, matches);
  const blueKnown = !!m.registration_id_blue;
  const redKnown = !!m.registration_id_red;
  const w = winnerSide(m);
  const cls = `bb-pair${isNext ? ' next' : ''}${champ ? ' champ' : ''}${compact ? ' compact' : ''}`;
  const no = <span className="bb-pair-no bb-num" data-testid="bb-pair-no">{pad2(m.pairing_number)}</span>;
  const chip = showRoundChip && m.round_name ? <span className="bb-round-chip" data-testid="bb-round-chip">{m.round_name}</span> : null;

  if (!blueKnown && !redKnown) {
    return (
      <div className={cls} data-testid="bb-pair-row" data-next={isNext ? '1' : undefined}>
        {isNext ? <span className="bb-next-tab">Next</span> : null}
        {no}
        <div className="bb-pair-tbd">
          <span>{placeholders[0] || 'TBD'}</span>
          <span className="bb-vs">VS</span>
          <span>{placeholders[1] || 'TBD'}</span>
          {chip}
        </div>
      </div>
    );
  }
  return (
    <div className={cls} data-testid="bb-pair-row" data-next={isNext ? '1' : undefined}>
      {isNext ? <span className="bb-next-tab">Next</span> : null}
      {no}
      <Side color="blue" name={fullName(m.blue_first, m.blue_last)} bib={m.blue_bib} win={w === 'blue'} showBib={!compact}
            placeholder={blueKnown ? null : (placeholders[0] || 'TBD')} />
      <Middle m={m} isNext={isNext} chip={chip} />
      <Side color="red" name={fullName(m.red_first, m.red_last)} bib={m.red_bib} win={w === 'red'} showBib={!compact}
            placeholder={redKnown ? null : (placeholders[0] || 'TBD')} right />
    </div>
  );
}

/** Frame 3 rows: the current round's pairings (one page). */
export function DualRoundRows({ rows, matches, nextMatchId, heading, showRoundChip = false }) {
  const compact = rows.length > 4;
  return (
    <div className="bb-panel" data-testid="bb-round-board">
      {heading ? <div className="bb-panel-head"><span>{heading}</span></div> : null}
      {rows.length === 0 ? <div className="bb-empty">Waiting for the bracket</div> : null}
      {rows.map(m => (
        <PairingRow key={m.id} m={m} matches={matches} isNext={m.id === nextMatchId} showRoundChip={showRoundChip} compact={compact} />
      ))}
    </div>
  );
}

/** Frame 4 rows: Championship first, 7th/8th last (display order only). */
export function DualFinalsRows({ rows, matches, nextMatchId }) {
  return (
    <div className="bb-panel" data-testid="bb-finals-block">
      {rows.map(m => (
        <PairingRow key={m.id} m={m} matches={matches} isNext={m.id === nextMatchId}
                    champ={!m.is_small_final} showRoundChip />
      ))}
    </div>
  );
}

/** The navy "Coming Up · Semifinals" strip: the next block's pairings. */
export function DualComingUp({ block, matches }) {
  if (!block || !block.matches.length) return null;
  const items = block.matches.filter(m => !m.is_bye);
  if (!items.length) return null;
  return (
    <div className="bb-coming" data-testid="bb-coming-up">
      <div className="bb-coming-head">Coming up · {block.name}</div>
      <div className="bb-coming-list">
        {items.map(m => {
          const ph = outstandingFeeders(m, matches);
          let k = 0;
          const side = (known, color, first, last) => known
            ? <><span className={`bb-coming-dot ${color}`} /><span>{fullName(first, last)}</span></>
            : <span style={{ opacity: 0.8 }}>{ph[k++] || 'TBD'}</span>;
          return (
            <div className="bb-coming-item" key={m.id} data-testid="bb-coming-item">
              <span className="bb-coming-no bb-num">{pad2(m.pairing_number)}</span>
              {side(!!m.registration_id_blue, 'blue', m.blue_first, m.blue_last)}
              <span style={{ opacity: 0.6 }}>vs</span>
              {side(!!m.registration_id_red, 'red', m.red_first, m.red_last)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
