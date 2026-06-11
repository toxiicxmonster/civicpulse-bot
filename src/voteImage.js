'use strict';
const { createCanvas } = require('@napi-rs/canvas');

// ── Layout constants ──────────────────────────────────────────────────────────
const IMG_W   = 1400;
const PAD     = 20;
const LINE    = 15;      // line height for member names
const FONT    = 'Arial';

const C = {
  bg:     '#0d1117',
  panel:  '#161b22',
  border: '#30363d',
  white:  '#e6edf3',
  dim:    '#8b949e',
  green:  '#3fb950',
  red:    '#f85149',
  rep:    '#ff9a7a',
  dem:    '#79c0ff',
  header: '#21262d',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isYea(v) { return /yea|yes|aye|\+/i.test(String(v?.option?.value ?? v?.option ?? '')); }
function isNay(v) { return /nay|no|^-$/i.test(String(v?.option?.value ?? v?.option ?? '')); }

function shortName(voter) {
  const p    = voter.person || {};
  const last = p.lastname || '?';
  const loc  = p.district ? `${p.state}-${p.district}` : (p.state || '?');
  return `${last} (${loc})`;
}

// Calculate the pixel height that drawSection will consume
function sectionHeight(count) {
  const labelH  = LINE + 4;
  const namesH  = count === 0 ? LINE + 6 : Math.ceil(count / 3) * LINE + 6;
  return labelH + namesH;
}

function panelBodyHeight(voters) {
  const yea    = voters.filter(isYea).length;
  const nay    = voters.filter(isNay).length;
  const absent = voters.length - yea - nay;
  return (LINE + 10)           // party header
       + (LINE + PAD)          // totals row
       + sectionHeight(yea)
       + sectionHeight(nay)
       + sectionHeight(absent)
       + PAD;                  // bottom padding
}

// ── Draw helpers ──────────────────────────────────────────────────────────────

function drawSection(ctx, label, color, voters, x, y, colW) {
  // Section label
  ctx.fillStyle = color;
  ctx.font      = `bold 11px ${FONT}`;
  ctx.fillText(label, x, y);
  y += LINE + 2;

  if (voters.length === 0) {
    ctx.fillStyle = C.dim;
    ctx.font      = `11px ${FONT}`;
    ctx.fillText('—', x, y);
    return y + LINE + 6;
  }

  const names  = voters.map(shortName);
  const cols   = 3;
  const perCol = Math.ceil(names.length / cols);

  ctx.fillStyle = C.white;
  ctx.font      = `11px ${FONT}`;

  for (let c = 0; c < cols; c++) {
    const cx    = x + c * colW;
    const slice = names.slice(c * perCol, (c + 1) * perCol);
    slice.forEach((name, row) => ctx.fillText(name, cx, y + row * LINE));
  }

  return y + perCol * LINE + 6;
}

function drawPanel(ctx, label, accentColor, voters, panelX, bodyY, panelW) {
  const contentX = panelX + PAD;
  const colW     = Math.floor((panelW - PAD * 2) / 3);

  let y = bodyY + PAD;

  // Party header
  ctx.fillStyle = accentColor;
  ctx.font      = `bold 14px ${FONT}`;
  ctx.fillText(label, contentX, y);
  y += LINE + 8;

  // Totals row
  const yea    = voters.filter(isYea);
  const nay    = voters.filter(isNay);
  const absent = voters.filter(v => !isYea(v) && !isNay(v));

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = C.green; ctx.fillText(`YEA ${yea.length}`,    contentX,       y);
  ctx.fillStyle = C.red;   ctx.fillText(`NAY ${nay.length}`,    contentX + 100, y);
  ctx.fillStyle = C.dim;   ctx.fillText(`ABS ${absent.length}`, contentX + 195, y);
  y += LINE + PAD;

  y = drawSection(ctx, `YEA (${yea.length})`,    C.green, yea,    contentX, y, colW);
  y = drawSection(ctx, `NAY (${nay.length})`,    C.red,   nay,    contentX, y, colW);
  y = drawSection(ctx, `NOT VOTING (${absent.length})`, C.dim, absent, contentX, y, colW);
}

// ── Main export ───────────────────────────────────────────────────────────────

function generateVoteImage(vote) {
  const panelW  = Math.floor(IMG_W / 2);
  const rBodyH  = panelBodyHeight(vote.republicans);
  const dBodyH  = panelBodyHeight(vote.democrats);
  const HEADER  = 80;
  const IMG_H   = HEADER + Math.max(rBodyH, dBodyH) + PAD;

  const canvas  = createCanvas(IMG_W, IMG_H);
  const ctx     = canvas.getContext('2d');

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, IMG_W, IMG_H);

  // ── Header bar ──────────────────────────────────────────────────────────────
  ctx.fillStyle = C.header;
  ctx.fillRect(0, 0, IMG_W, HEADER);

  const label = vote.billId || vote.chamber;
  ctx.fillStyle = C.white;
  ctx.font      = `bold 18px ${FONT}`;
  ctx.fillText(`${label}  —  VOTE BREAKDOWN`, PAD, 28);

  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = vote.result === 'PASSED' ? C.green : C.red;
  ctx.fillText(`${vote.result}`, PAD, 54);

  const t = vote.totals || {};
  ctx.fillStyle = C.dim;
  ctx.fillText(
    `YEA: ${t.Yea ?? 0}   NAY: ${t.Nay ?? 0}   ABSENT: ${(t['Not Voting'] ?? 0) + (t.Present ?? 0)}`,
    PAD + 90, 54
  );

  ctx.fillStyle = C.dim;
  ctx.font = `11px ${FONT}`;
  ctx.fillText('civicpulse.app', IMG_W - 120, 68);

  // ── Header / body divider ───────────────────────────────────────────────────
  ctx.fillStyle = C.border;
  ctx.fillRect(0, HEADER, IMG_W, 1);

  // ── Center divider ──────────────────────────────────────────────────────────
  ctx.fillStyle = C.border;
  ctx.fillRect(panelW, HEADER, 1, IMG_H - HEADER);

  // ── Party panels ────────────────────────────────────────────────────────────
  drawPanel(ctx, 'REPUBLICANS',   C.rep, vote.republicans, 0,       HEADER, panelW);
  drawPanel(ctx, 'DEMOCRATS',     C.dem, vote.democrats,   panelW,  HEADER, panelW);

  return canvas.toBuffer('image/png');
}

module.exports = { generateVoteImage };
