'use strict';
const { createCanvas } = require('@napi-rs/canvas');

// ── Layout constants ──────────────────────────────────────────────────────────
const IMG_W  = 2800;
const PAD    = 40;
const LINE   = 28;   // line height for member names
const COLS   = 2;    // name columns per panel
const FONT   = 'sans-serif';

const C = {
  bg:     '#0d1117',
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

function memberName(voter) {
  const p     = voter.person || {};
  const first = p.firstname || '';
  const last  = p.lastname  || '?';
  const loc   = p.district ? `${p.state}-${p.district}` : (p.state || '?');
  return `${first} ${last} (${loc})`.trim();
}

function sectionHeight(count) {
  const labelH = LINE + 6;
  const namesH = count === 0 ? LINE + 8 : Math.ceil(count / COLS) * LINE + 8;
  return labelH + namesH;
}

function panelBodyHeight(voters) {
  const yea    = voters.filter(isYea).length;
  const nay    = voters.filter(isNay).length;
  const absent = voters.length - yea - nay;
  return (LINE + 16)          // party header
       + (LINE + PAD)         // totals row
       + sectionHeight(yea)
       + sectionHeight(nay)
       + sectionHeight(absent)
       + PAD;
}

// ── Draw helpers ──────────────────────────────────────────────────────────────

function drawSection(ctx, label, color, voters, x, y, colW) {
  ctx.fillStyle = color;
  ctx.font      = `bold 22px ${FONT}`;
  ctx.fillText(label, x, y);
  y += LINE + 4;

  if (voters.length === 0) {
    ctx.fillStyle = C.dim;
    ctx.font      = `20px ${FONT}`;
    ctx.fillText('—', x, y);
    return y + LINE + 8;
  }

  const names  = voters.map(memberName);
  const perCol = Math.ceil(names.length / COLS);

  ctx.fillStyle = C.white;
  ctx.font      = `20px ${FONT}`;

  for (let c = 0; c < COLS; c++) {
    const cx    = x + c * colW;
    const slice = names.slice(c * perCol, (c + 1) * perCol);
    slice.forEach((name, row) => ctx.fillText(name, cx, y + row * LINE));
  }

  return y + perCol * LINE + 8;
}

function drawPanel(ctx, label, accentColor, voters, panelX, bodyY, panelW) {
  const contentX = panelX + PAD;
  const colW     = Math.floor((panelW - PAD * 2) / COLS);

  let y = bodyY + PAD;

  ctx.fillStyle = accentColor;
  ctx.font      = `bold 28px ${FONT}`;
  ctx.fillText(label, contentX, y);
  y += LINE + 16;

  const yea    = voters.filter(isYea);
  const nay    = voters.filter(isNay);
  const absent = voters.filter(v => !isYea(v) && !isNay(v));

  ctx.font = `24px ${FONT}`;
  ctx.fillStyle = C.green; ctx.fillText(`YEA ${yea.length}`,    contentX,       y);
  ctx.fillStyle = C.red;   ctx.fillText(`NAY ${nay.length}`,    contentX + 200, y);
  ctx.fillStyle = C.dim;   ctx.fillText(`ABS ${absent.length}`, contentX + 390, y);
  y += LINE + PAD;

  y = drawSection(ctx, `YEA (${yea.length})`,           C.green, yea,    contentX, y, colW);
  y = drawSection(ctx, `NAY (${nay.length})`,           C.red,   nay,    contentX, y, colW);
  y = drawSection(ctx, `NOT VOTING (${absent.length})`, C.dim,   absent, contentX, y, colW);
}

// ── Main export ───────────────────────────────────────────────────────────────

function generateVoteImage(vote) {
  const panelW = Math.floor(IMG_W / 2);
  const rBodyH = panelBodyHeight(vote.republicans || []);
  const dBodyH = panelBodyHeight(vote.democrats   || []);
  const HEADER = 140;
  const IMG_H  = HEADER + Math.max(rBodyH, dBodyH) + PAD;

  const canvas = createCanvas(IMG_W, IMG_H);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, IMG_W, IMG_H);

  ctx.fillStyle = C.header;
  ctx.fillRect(0, 0, IMG_W, HEADER);

  const label = vote.billId || vote.chamber;
  ctx.fillStyle = C.white;
  ctx.font      = `bold 36px ${FONT}`;
  ctx.fillText(`${label}  —  VOTE BREAKDOWN`, PAD, 52);

  const t = vote.totals || {};
  ctx.font      = `26px ${FONT}`;
  ctx.fillStyle = vote.result === 'PASSED' ? C.green : C.red;
  ctx.fillText(vote.result, PAD, 104);

  ctx.fillStyle = C.dim;
  ctx.fillText(
    `YEA: ${t.Yea ?? 0}   NAY: ${t.Nay ?? 0}   ABSENT: ${(t['Not Voting'] ?? 0) + (t.Present ?? 0)}`,
    PAD + 180, 104
  );

  ctx.fillStyle = C.dim;
  ctx.font      = `22px ${FONT}`;
  ctx.fillText('civicpulse.app', IMG_W - 260, 120);

  ctx.fillStyle = C.border;
  ctx.fillRect(0, HEADER, IMG_W, 2);

  ctx.fillStyle = C.border;
  ctx.fillRect(panelW, HEADER, 2, IMG_H - HEADER);

  drawPanel(ctx, 'REPUBLICANS', C.rep, vote.republicans || [], 0,      HEADER, panelW);
  drawPanel(ctx, 'DEMOCRATS',   C.dem, vote.democrats   || [], panelW, HEADER, panelW);

  return canvas.toBuffer('image/png');
}

module.exports = { generateVoteImage };
