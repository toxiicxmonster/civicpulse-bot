'use strict';
// One-off live test: posts exactly 1 vote and 1 bill to the selected platform(s).
// Does NOT modify posted.json.
//
// Usage:
//   node test-post.js                        # posts to X (default)
//   node test-post.js --platform x           # posts to X only
//   node test-post.js --platform bsky        # posts to Bluesky only
//   node test-post.js --platform both        # posts to both platforms
require('dotenv').config();

const { getLatestVote, getLatestBill }               = require('./src/checker');
const { formatBillThread, formatVoteSummary, formatVoteQuestion } = require('./src/formatter');
const { postThread, postVoteThread, xEnabled, bskyEnabled } = require('./src/xpost');
const { generateVoteImage }                           = require('./src/voteImage');

const VOTE_IMAGE = process.env.VOTE_IMAGE !== 'false';

// ─── Parse args ───────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const pIdx    = args.indexOf('--platform');
const platform = pIdx !== -1 ? args[pIdx + 1] : 'x';

const validPlatforms = ['x', 'bsky', 'bluesky', 'both'];
if (!validPlatforms.includes(platform.toLowerCase())) {
  console.error(`[test-post] unknown platform "${platform}". Valid options: x, bsky, bluesky, both`);
  process.exit(1);
}

// ─── Platform availability checks ─────────────────────────────────────────────

const dry = process.env.DRY_RUN === 'true';
const p   = platform.toLowerCase();

if (!dry) {
  if ((p === 'x' || p === 'both') && !xEnabled()) {
    console.error('[test-post] X credentials not configured — set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET');
    process.exit(1);
  }
  if ((p === 'bsky' || p === 'bluesky' || p === 'both') && !bskyEnabled()) {
    console.error('[test-post] Bluesky credentials not configured — set BSKY_HANDLE and BSKY_APP_PASSWORD');
    process.exit(1);
  }
}

async function main() {
  console.log(`[test-post] mode: ${dry ? 'DRY RUN' : 'LIVE'} | platform: ${platform} | image: ${VOTE_IMAGE}\n`);

  // ── 1. Vote ────────────────────────────────────────────────────────────────
  console.log('[test-post] fetching most recent vote…');
  const vote = await getLatestVote();
  if (!vote) { console.error('[test-post] no vote found'); process.exit(1); }

  console.log(`[test-post] posting vote: ${vote.voteId} — ${vote.question.slice(0, 60)}`);
  const summary  = formatVoteSummary(vote);
  const question = formatVoteQuestion(vote);
  const image    = VOTE_IMAGE ? generateVoteImage(vote) : null;
  await postVoteThread(summary, image, { platform, questionText: question });
  console.log('[test-post] vote posted ✓\n');

  // ── 2. Bill (30-day window) ────────────────────────────────────────────────
  console.log('[test-post] fetching most recently introduced bill (last 30 days)…');
  const bill = await getLatestBill(30);
  if (!bill) { console.error('[test-post] no bill found in last 30 days'); process.exit(1); }

  console.log(`[test-post] posting bill: ${bill.billId} — ${bill.title.slice(0, 60)}`);
  await postThread(formatBillThread(bill), { platform });
  console.log('[test-post] bill posted ✓');
}

main().catch(err => { console.error('[test-post] fatal:', err); process.exit(1); });
