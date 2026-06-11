'use strict';
const axios = require('axios');
const { hasPostedBill, hasPostedVote } = require('./tracker');

const CONGRESS_BASE = 'https://api.congress.gov/v3';
const GOVTRACK_BASE = 'https://www.govtrack.us/api/v2';

// Congress.gov API key is read lazily so dotenv has time to load
const key = () => process.env.CONGRESS_API_KEY;

// ─── Congress.gov helpers ────────────────────────────────────────────────────

async function cgGet(path, params = {}) {
  const res = await axios.get(`${CONGRESS_BASE}${path}`, {
    params: { api_key: key(), format: 'json', ...params },
    timeout: 12000,
  });
  return res.data;
}

async function fetchRecentBills(limit = 20) {
  const data = await cgGet('/bill', { sort: 'updateDate+desc', limit });
  return data.bills || [];
}

async function fetchBillDetail(congress, type, number) {
  const data = await cgGet(`/bill/${congress}/${type}/${number}`);
  return data.bill || null;
}

async function fetchBillSummary(congress, type, number) {
  try {
    const data = await cgGet(`/bill/${congress}/${type}/${number}/summaries`);
    const list = data.summaries || [];
    if (!list.length) return null;
    const raw = list[list.length - 1].text || '';
    return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch { return null; }
}

async function fetchBillCosponsors(congress, type, number) {
  try {
    const data = await cgGet(`/bill/${congress}/${type}/${number}/cosponsors`);
    return data.cosponsors || [];
  } catch { return []; }
}

// ─── GovTrack helpers (roll-call per-member vote data) ───────────────────────
// Congress.gov v3 does not expose per-member roll-call breakdowns;
// GovTrack's free API provides exactly this.

async function gtGet(path, params = {}) {
  const res = await axios.get(`${GOVTRACK_BASE}${path}`, {
    params: { format: 'json', ...params },
    timeout: 15000,
  });
  return res.data;
}

async function fetchRecentVotes(limit = 20) {
  const data = await gtGet('/vote', { limit, sort: '-created' });
  return data.objects || [];
}

async function fetchVoteVoters(voteId) {
  const data = await gtGet('/votevoter', { vote: voteId, limit: 600 });
  return data.objects || [];
}

// ─── Bill type mappings ───────────────────────────────────────────────────────

const DISPLAY = {
  hr: 'H.R.', s: 'S.', hjres: 'H.J.Res.', sjres: 'S.J.Res.',
  hconres: 'H.Con.Res.', sconres: 'S.Con.Res.', hres: 'H.Res.', sres: 'S.Res.',
};

const URL_TYPE = {
  hr: 'house-bill', s: 'senate-bill',
  hjres: 'house-joint-resolution', sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution', sconres: 'senate-concurrent-resolution',
  hres: 'house-resolution', sres: 'senate-resolution',
};

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function billUrl(congress, type, number) {
  return `https://congress.gov/bill/${ordinal(congress)}-congress/${URL_TYPE[type] || type}/${number}`;
}

function billId(type, number) {
  return `${DISPLAY[type] || type.toUpperCase()}${number}`;
}

// ─── getNewBills ──────────────────────────────────────────────────────────────

// Only post bills introduced within the last 3 days to avoid flooding on first run.
function cutoffDate(days = 3) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

async function getNewBills() {
  const raw    = await fetchRecentBills(20);
  const cutoff = cutoffDate(3);
  const result = [];

  for (const bill of raw) {
    const congress = bill.congress;
    const type     = (bill.type || '').toLowerCase();
    const number   = bill.number;
    const tid      = `bill:${congress}:${type}:${number}`;

    if ((bill.introducedDate || '') < cutoff) continue;
    if (hasPostedBill(tid)) continue;

    try {
      const detail     = await fetchBillDetail(congress, type, number);
      if (!detail) continue;

      const summary    = await fetchBillSummary(congress, type, number);
      const cosponsors = await fetchBillCosponsors(congress, type, number);

      const sponsors = [];
      for (const sp of (detail.sponsors || []).slice(0, 1)) {
        sponsors.push({ name: `${sp.firstName} ${sp.lastName}`, party: sp.party, state: sp.state, isLead: true });
      }
      for (const co of cosponsors.slice(0, 5)) {
        sponsors.push({ name: `${co.firstName} ${co.lastName}`, party: co.party, state: co.state, isLead: false });
      }

      result.push({
        trackingId: tid,
        billId:     billId(type, number),
        congress, type, number,
        title:   detail.title || bill.title || 'Untitled',
        synopsis: summary,
        sponsors,
        url: billUrl(congress, type, number),
      });
    } catch (err) {
      console.error(`[checker] bill ${billId(type, number)}: ${err.message}`);
    }
  }

  return result;
}

// ─── getNewVotes ──────────────────────────────────────────────────────────────

async function getNewVotes() {
  const raw    = await fetchRecentVotes(20);
  const result = [];

  for (const vote of raw) {
    if (!vote.result) continue; // vote not yet concluded
    const tid = `vote:${vote.id}`;
    if (hasPostedVote(tid)) continue;

    try {
      const voters = await fetchVoteVoters(vote.id);

      const republicans = voters.filter(v => v.person?.party === 'Republican');
      const democrats   = voters.filter(v => v.person?.party === 'Democrat');

      const chamber = vote.chamber === 's' ? 'SENATE' : 'HOUSE';
      const passed  = /pass|agree|adopt|approv/i.test(vote.result);

      const t = vote.totals || {};
      const totals = {
        Yea: t.Yea ?? t['+'] ?? 0,
        Nay: t.Nay ?? t['-'] ?? 0,
        'Not Voting': t['Not Voting'] ?? 0,
        Present: t.Present ?? 0,
      };

      // Try to find an associated bill ID from the vote question
      const qMatch  = (vote.question || '').match(/([HS]\.?\s*(?:J\.\s*)?(?:Con\.\s*)?(?:Res\.\s*)?\d+)/i);
      const voteBillId = qMatch ? qMatch[0].replace(/\s+/g, '') : null;

      // Build congress.gov link if GovTrack has related bill info
      const rb  = vote.related_bill;
      const url = rb?.congress
        ? billUrl(rb.congress, (rb.bill_type || '').toLowerCase(), rb.bill_number)
        : null;

      result.push({
        trackingId:  tid,
        voteId:      vote.id,
        chamber,
        billId:      voteBillId,
        question:    vote.question || 'Procedural Vote',
        result:      passed ? 'PASSED' : 'FAILED',
        resultEmoji: passed ? '✅' : '❌',
        totals,
        republicans,
        democrats,
        url,
      });
    } catch (err) {
      console.error(`[checker] vote ${vote.id}: ${err.message}`);
    }
  }

  return result;
}

module.exports = { getNewBills, getNewVotes };
