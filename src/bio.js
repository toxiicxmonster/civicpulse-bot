'use strict';
const { TwitterApi } = require('twitter-api-v2');
const { getBioState, setBioState } = require('./tracker');

// ─── Bio text building ────────────────────────────────────────────────────────

const STATIC = '🏛️ Real-time congressional tracking | Bills, votes, presidential actions & EOs | Nonpartisan civic data';
const FOOTER = '🤖 Automated bot | Powered by @USCivicPulse';
const BIO_MAX = 160;

function buildBio(houseRecess, senateRecess, returnDate = null) {
  let statusLine;
  if (houseRecess && senateRecess) {
    statusLine = `📍 CONGRESS IN RECESS${returnDate ? ` | Returns: ${returnDate}` : ''}`;
  } else if (houseRecess) {
    statusLine = `📍 HOUSE IN RECESS | SENATE IN SESSION`;
  } else if (senateRecess) {
    statusLine = `📍 SENATE IN RECESS | HOUSE IN SESSION${returnDate ? ` | Returns: ${returnDate}` : ''}`;
  } else {
    statusLine = '📍 CONGRESS IN SESSION';
  }
  const full = `${STATIC}\n${statusLine}\n${FOOTER}`;
  return truncateBio(full);
}

// Trim to BIO_MAX Unicode code points (Twitter counts emoji as 2, but code-point
// counting is a safe approximation for most bios — the API rejects if truly over).
function truncateBio(text) {
  const chars = [...text]; // split by code point, not UTF-16 unit
  if (chars.length <= BIO_MAX) return text;

  let trimmed = chars.slice(0, BIO_MAX).join('');
  // Prefer breaking at a line or word boundary
  const lastBreak = Math.max(trimmed.lastIndexOf('\n'), trimmed.lastIndexOf(' '));
  if (lastBreak > BIO_MAX * 0.6) trimmed = trimmed.slice(0, lastBreak);
  return trimmed.trimEnd();
}

// ─── Update throttling ────────────────────────────────────────────────────────

const IN_SESSION_MS = 30 * 60 * 1000;        // 30 minutes
const IN_RECESS_MS  = 24 * 60 * 60 * 1000;   // 24 hours

function shouldUpdateBio(houseRecess, senateRecess) {
  const state      = getBioState();
  const now        = Date.now();
  const last       = state.lastBioUpdate ? new Date(state.lastBioUpdate).getTime() : 0;
  const prevStatus = state.currentSessionStatus;
  const nextStatus = `house:${houseRecess}|senate:${senateRecess}`;

  if (prevStatus !== nextStatus) return true;

  const inAnyRecess = houseRecess || senateRecess;
  const interval    = inAnyRecess ? IN_RECESS_MS : IN_SESSION_MS;
  return (now - last) >= interval;
}

// ─── X API client (reuses env creds, isolated from xpost.js) ─────────────────

let _xClient;
function xClient() {
  if (!_xClient) _xClient = new TwitterApi({
    appKey:       process.env.X_API_KEY,
    appSecret:    process.env.X_API_SECRET,
    accessToken:  process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });
  return _xClient;
}

async function updateXBio(bioText) {
  // POST /1.1/account/update_profile — works with OAuth 1.0a keys
  await xClient().v1.updateAccountProfile({ description: bioText });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function maybeUpdateBio(houseRecess, senateRecess, returnDate = null) {
  if (process.env.X_UPDATE_BIO !== 'true') return;
  if (!shouldUpdateBio(houseRecess, senateRecess)) return;
  await forceUpdateBio(houseRecess, senateRecess, returnDate);
}

async function forceUpdateBio(houseRecess, senateRecess, returnDate = null) {
  const bioText   = buildBio(houseRecess, senateRecess, returnDate);
  const newStatus = `house:${houseRecess}|senate:${senateRecess}`;

  if (process.env.DRY_RUN === 'true') {
    console.log(`[bio] DRY RUN — bio would be (${[...bioText].length} chars):\n${bioText}`);
    setBioState({ lastBioUpdate: new Date().toISOString(), currentSessionStatus: String(newStatus) });
    return;
  }

  try {
    await updateXBio(bioText);
    setBioState({ lastBioUpdate: new Date().toISOString(), currentSessionStatus: String(newStatus) });
    console.log(`[bio] X bio updated — ${newStatus} (${[...bioText].length} chars)`);
  } catch (err) {
    console.warn('[bio] failed to update X bio:', err.message);
  }
}

module.exports = { buildBio, truncateBio, shouldUpdateBio, maybeUpdateBio, forceUpdateBio };
