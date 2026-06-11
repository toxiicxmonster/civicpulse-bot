'use strict';
require('dotenv').config();

const { getNewBills, getNewVotes, getAdjournmentUpdate }                         = require('./checker');
const { formatBillThread, formatVoteSummary, formatAdjournedPost, formatReturnedPost } = require('./formatter');
const { postThread, postVoteThread }                                              = require('./xpost');
const { markBillPosted, markVotePosted, markLastVoteDate, setRecessState }       = require('./tracker');
const { generateVoteImage }                                                       = require('./voteImage');

const POLL_MS = (parseInt(process.env.POLL_INTERVAL_MINUTES, 10) || 15) * 60 * 1000;

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

const singleRun = process.argv.includes('--single-run');

if (singleRun) {
  runOnce()
    .then(() => { console.log('[bot] done'); process.exit(0); })
    .catch(err => { console.error('[bot] fatal:', err); process.exit(1); });
} else {
  console.log(`[bot] starting poll loop every ${POLL_MS / 60000} min…`);
  runOnce();
  setInterval(runOnce, POLL_MS);
}
