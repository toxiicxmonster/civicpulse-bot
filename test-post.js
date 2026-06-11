'use strict';
// One-off live test: posts exactly 1 vote and 1 bill to X.
// Does NOT modify posted.json.
// Run: node test-post.js
require('dotenv').config();

const { getLatestVote, getLatestBill }               = require('./src/checker');
const { formatBillThread, formatVoteSummary }         = require('./src/formatter');
const { postThread, postVoteThread }                  = require('./src/xpost');
const { generateVoteImage }                           = require('./src/voteImage');

async function main() {
  const dry = process.env.DRY_RUN === 'true';
  console.log(`[test-post] mode: ${dry ? 'DRY RUN' : 'LIVE'}\n`);

  // ── 1. Vote ────────────────────────────────────────────────────────────────
  console.log('[test-post] fetching most recent vote…');
  const vote = await getLatestVote();
  if (!vote) { console.error('[test-post] no vote found'); process.exit(1); }

  console.log(`[test-post] posting vote: ${vote.voteId} — ${vote.question.slice(0, 60)}`);
  const summary = formatVoteSummary(vote);
  const image   = generateVoteImage(vote);
  await postVoteThread(summary, image);
  console.log('[test-post] vote posted ✓\n');

  // ── 2. Bill (30-day window) ────────────────────────────────────────────────
  console.log('[test-post] fetching most recently introduced bill (last 30 days)…');
  const bill = await getLatestBill(30);
  if (!bill) { console.error('[test-post] no bill found in last 30 days'); process.exit(1); }

  console.log(`[test-post] posting bill: ${bill.billId} — ${bill.title.slice(0, 60)}`);
  await postThread(formatBillThread(bill));
  console.log('[test-post] bill posted ✓');
}

main().catch(err => { console.error('[test-post] fatal:', err); process.exit(1); });
