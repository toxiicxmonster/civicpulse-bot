'use strict';
require('dotenv').config();

const { getNewBills, getNewVotes }   = require('./checker');
const { formatBillThread, formatVoteThread } = require('./formatter');
const { postThread }                 = require('./xpost');
const { markBillPosted, markVotePosted }     = require('./tracker');

const POLL_MS = (parseInt(process.env.POLL_INTERVAL_MINUTES, 10) || 15) * 60 * 1000;

// ─── Single run (used by GitHub Actions via --single-run flag) ────────────────

async function runOnce() {
  console.log(`[bot] ${new Date().toISOString()} — checking for new bills and votes…`);

  const [bills, votes] = await Promise.allSettled([getNewBills(), getNewVotes()]);

  const newBills = bills.status === 'fulfilled' ? bills.value : [];
  const newVotes = votes.status === 'fulfilled' ? votes.value : [];

  if (bills.status === 'rejected')  console.error('[bot] bills error:', bills.reason?.message);
  if (votes.status === 'rejected')  console.error('[bot] votes error:', votes.reason?.message);

  console.log(`[bot] found ${newBills.length} new bill(s), ${newVotes.length} new vote(s)`);

  for (const bill of newBills) {
    try {
      const thread = formatBillThread(bill);
      await postThread(thread);
      markBillPosted(bill.trackingId);
      console.log(`[bot] posted bill ${bill.billId}`);
    } catch (err) {
      console.error(`[bot] failed to post bill ${bill.billId}:`, err.message);
    }
  }

  for (const vote of newVotes) {
    try {
      const thread = formatVoteThread(vote);
      await postThread(thread);
      markVotePosted(vote.trackingId);
      console.log(`[bot] posted vote ${vote.voteId}`);
    } catch (err) {
      console.error(`[bot] failed to post vote ${vote.voteId}:`, err.message);
    }
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const singleRun = process.argv.includes('--single-run');

if (singleRun) {
  // GitHub Actions mode — run once and exit
  runOnce()
    .then(() => {
      console.log('[bot] done');
      process.exit(0);
    })
    .catch(err => {
      console.error('[bot] fatal:', err);
      process.exit(1);
    });
} else {
  // Local dev mode — poll on an interval
  console.log(`[bot] starting poll loop every ${POLL_MS / 60000} min…`);
  runOnce();
  setInterval(runOnce, POLL_MS);
}
