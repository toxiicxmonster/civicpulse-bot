'use strict';
require('dotenv').config();

const cron = require('node-cron');

const { getNewBills, getNewVotes, getAdjournmentUpdate }                               = require('./checker');
const { formatBillThread, formatVoteSummary, formatAdjournedPost, formatReturnedPost } = require('./formatter');
const { postThread, postVoteThread }                                                    = require('./xpost');
const { markBillPosted, markVotePosted, markLastVoteDate, setRecessState }             = require('./tracker');
const { generateVoteImage }                                                             = require('./voteImage');

// ─── Startup validation ───────────────────────────────────────────────────────

function validateEnv() {
  const required = ['CONGRESS_API_KEY', 'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('[bot] fatal: missing required env vars:', missing.join(', '));
    process.exit(1);
  }
}

// ─── Single run ───────────────────────────────────────────────────────────────

async function runOnce() {
  console.log(`[bot] ${new Date().toISOString()} — checking for new bills and votes…`);

  const [bills, votes] = await Promise.allSettled([getNewBills(), getNewVotes()]);

  const newBills = bills.status === 'fulfilled' ? bills.value : [];
  const newVotes = votes.status === 'fulfilled' ? votes.value : [];

  if (bills.status === 'rejected') console.error('[bot] bills error:', bills.reason?.message);
  if (votes.status === 'rejected') console.error('[bot] votes error:', votes.reason?.message);

  console.log(`[bot] found ${newBills.length} new bill(s), ${newVotes.length} new vote(s)`);

  // ── Bills: text thread ───────────────────────────────────────────────────────
  for (const bill of newBills) {
    try {
      await postThread(formatBillThread(bill));
      markBillPosted(bill.trackingId);
      console.log(`[bot] posted bill ${bill.billId}`);
    } catch (err) {
      console.error(`[bot] failed to post bill ${bill.billId}:`, err.message);
    }
  }

  // ── Votes: summary tweet + image reply ───────────────────────────────────────
  for (const vote of newVotes) {
    try {
      const summary = formatVoteSummary(vote);
      const image   = generateVoteImage(vote);
      await postVoteThread(summary, image);
      markVotePosted(vote.trackingId);
      console.log(`[bot] posted vote ${vote.voteId}`);
    } catch (err) {
      console.error(`[bot] failed to post vote ${vote.voteId}:`, err.message);
    }
  }

  // ── Track last vote date + adjournment detection ──────────────────────────────
  if (newVotes.length > 0) {
    markLastVoteDate(new Date().toISOString().split('T')[0]);
  }
  const adjStatus = await getAdjournmentUpdate(newVotes.map(v => v.voteId));
  if (adjStatus === 'adjourned') {
    try {
      await postThread([formatAdjournedPost(null)]);
      setRecessState(true);
      console.log('[bot] posted adjournment notice');
    } catch (err) {
      console.error('[bot] failed to post adjournment notice:', err.message);
    }
  } else if (adjStatus === 'returned') {
    try {
      await postThread([formatReturnedPost()]);
      setRecessState(false);
      console.log('[bot] posted return-from-recess notice');
    } catch (err) {
      console.error('[bot] failed to post return notice:', err.message);
    }
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

validateEnv();

if (process.argv.includes('--single-run')) {
  runOnce()
    .then(() => { console.log('[bot] done'); process.exit(0); })
    .catch(err => { console.error('[bot] fatal:', err); process.exit(1); });
} else {
  // Build cron expression from POLL_INTERVAL_MINUTES (default 15, clamped 1–59)
  const pollMins = Math.min(59, Math.max(1, parseInt(process.env.POLL_INTERVAL_MINUTES, 10) || 15));
  const cronExpr = `*/${pollMins} * * * *`;

  console.log(`[bot] starting — polling every ${pollMins} min (cron: "${cronExpr}")`);

  // Fire immediately on startup, then on schedule
  runOnce().catch(err => console.error('[bot] run error:', err));
  cron.schedule(cronExpr, () => runOnce().catch(err => console.error('[bot] run error:', err)));

  process.on('SIGTERM', () => {
    console.log('[bot] SIGTERM received — shutting down');
    process.exit(0);
  });
}
