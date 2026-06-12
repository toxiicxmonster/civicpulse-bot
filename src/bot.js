'use strict';
require('dotenv').config();

const cron = require('node-cron');

const { getNewBills, getNewVotes, getPresidentialActions, getExecutiveOrders, getAdjournmentUpdate, getCongressStatus } = require('./checker');
const { formatBillThread, formatVoteSummary, formatSignedPost, formatVetoedPost, formatExecutiveOrderPost, formatAdjournedPost, formatReturnedPost, formatSessionStatusPost } = require('./formatter');
const { postThread, postVoteThread }                                                                  = require('./xpost');
const { markBillPosted, markVotePosted, markPresidentialActionPosted, markEOPosted, markLastVoteDate, setRecessState } = require('./tracker');
const { generateVoteImage }                                                             = require('./voteImage');

const VOTE_IMAGE = process.env.VOTE_IMAGE !== 'false';

// ─── Startup validation ───────────────────────────────────────────────────────

function validateEnv() {
  if (!process.env.CONGRESS_API_KEY) {
    console.error('[bot] fatal: CONGRESS_API_KEY is required');
    process.exit(1);
  }
  const hasX    = process.env.X_API_KEY && process.env.X_API_SECRET &&
                   process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET;
  const hasBsky = process.env.BSKY_HANDLE && process.env.BSKY_APP_PASSWORD;
  if (!hasX && !hasBsky) {
    console.error('[bot] fatal: configure at least one posting platform — X keys or BSKY_HANDLE+BSKY_APP_PASSWORD');
    process.exit(1);
  }
  if (hasX)    console.log('[bot] platform: X enabled');
  if (hasBsky) console.log('[bot] platform: Bluesky enabled');
}

// ─── Single run ───────────────────────────────────────────────────────────────

async function runOnce() {
  console.log(`[bot] ${new Date().toISOString()} — checking for new bills and votes…`);

  const [bills, votes, presidentialActions, executiveOrders] = await Promise.allSettled([
    getNewBills(), getNewVotes(), getPresidentialActions(), getExecutiveOrders(),
  ]);

  const newBills              = bills.status              === 'fulfilled' ? bills.value              : [];
  const newVotes              = votes.status              === 'fulfilled' ? votes.value              : [];
  const newPresidentialActions = presidentialActions.status === 'fulfilled' ? presidentialActions.value : [];
  const newExecutiveOrders    = executiveOrders.status    === 'fulfilled' ? executiveOrders.value    : [];

  if (bills.status              === 'rejected') console.error('[bot] bills error:',               bills.reason?.message);
  if (votes.status              === 'rejected') console.error('[bot] votes error:',               votes.reason?.message);
  if (presidentialActions.status === 'rejected') console.error('[bot] presidential actions error:', presidentialActions.reason?.message);
  if (executiveOrders.status    === 'rejected') console.error('[bot] executive orders error:',    executiveOrders.reason?.message);

  console.log(`[bot] found ${newBills.length} new bill(s), ${newVotes.length} new vote(s), ${newPresidentialActions.length} presidential action(s), ${newExecutiveOrders.length} executive order(s)`);

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

  // ── Votes: summary tweet (+ image reply if VOTE_IMAGE=true) ─────────────────
  for (const vote of newVotes) {
    try {
      const summary = formatVoteSummary(vote, { imageReply: VOTE_IMAGE });
      if (VOTE_IMAGE) {
        const image = generateVoteImage(vote);
        await postVoteThread(summary, image);
      } else {
        await postThread([summary]);
      }
      markVotePosted(vote.trackingId);
      console.log(`[bot] posted vote ${vote.voteId}`);
    } catch (err) {
      console.error(`[bot] failed to post vote ${vote.voteId}:`, err.message);
    }
  }

  // ── Presidential actions: signed / vetoed ────────────────────────────────────
  for (const action of newPresidentialActions) {
    try {
      const post = action.action === 'signed' ? formatSignedPost(action) : formatVetoedPost(action);
      await postThread([post]);
      markPresidentialActionPosted(action.trackingId);
      console.log(`[bot] posted presidential action ${action.trackingId}`);
    } catch (err) {
      console.error(`[bot] failed to post presidential action ${action.trackingId}:`, err.message);
    }
  }

  // ── Executive orders ──────────────────────────────────────────────────────────
  for (const eo of newExecutiveOrders) {
    try {
      await postThread([formatExecutiveOrderPost(eo)]);
      markEOPosted(eo.trackingId);
      console.log(`[bot] posted executive order ${eo.number}`);
    } catch (err) {
      console.error(`[bot] failed to post executive order ${eo.number}:`, err.message);
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

process.on('uncaughtException', (err) => {
  console.error('[bot] uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[bot] unhandled rejection:', err);
});

validateEnv();

if (process.argv.includes('--single-run')) {
  runOnce()
    .then(() => { console.log('[bot] done'); process.exit(0); })
    .catch(err => { console.error('[bot] fatal:', err); process.exit(1); });

} else if (process.argv.includes('--post-status')) {
  // Usage:
  //   node src/bot.js --post-status
  //   node src/bot.js --post-status --return-date "July 7, 2026"
  //
  // Status (in session / adjourned) is determined from the Daily Congressional
  // Record API. Return date is not available via API — pass --return-date if known.
  const args       = process.argv.slice(2);
  const rdIdx      = args.indexOf('--return-date');
  const returnDate = rdIdx !== -1 ? args[rdIdx + 1] : null;

  (async () => {
    try {
      console.log('[bot] fetching Congress status from Congressional Record API…');
      const { inSession, lastSessionDate } = await getCongressStatus();
      const inRecess = !inSession;
      console.log(`[bot] status: ${inSession ? 'in session' : 'adjourned'} (last record: ${lastSessionDate})`);
      if (returnDate) console.log(`[bot] return date override: ${returnDate}`);

      await postThread([formatSessionStatusPost(inRecess, returnDate)]);
      setRecessState(inRecess);
      console.log('[bot] status posted');
      process.exit(0);
    } catch (err) {
      console.error('[bot] fatal:', err);
      process.exit(1);
    }
  })();

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
