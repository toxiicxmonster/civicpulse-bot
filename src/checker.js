'use strict';
const axios = require('axios');
const { hasPostedBill, hasPostedVote, hasPostedPresidentialAction, hasPostedEO, getLastVoteDate, isInRecess, isHouseInRecess, isSenateInRecess } = require('./tracker');
const { calcPopRepresented } = require('./population');

const CONGRESS_BASE = 'https://api.congress.gov/v3';
const GOVTRACK_BASE = 'https://www.govtrack.us/api/v2';

const key = () => process.env.CONGRESS_API_KEY;

// ─── Resilient HTTP helper ────────────────────────────────────────────────────
// Retries once on 500/503; returns null (never throws) so callers can return []/null.

const RETRY_STATUSES = new Set([500, 503]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function resilientGet(url, options, sourceName) {
  const doGet = () => axios.get(url, options);
  try {
    return await doGet();
  } catch (err) {
    const status = err.response?.status;
    if (RETRY_STATUSES.has(status)) {
      console.warn(`[checker] ${sourceName} returned ${status} — retrying in 30s`);
      await sleep(30000);
      try {
        return await doGet();
      } catch (retryErr) {
        const s2 = retryErr.response?.status;
        console.warn(`[checker] ${sourceName} failed again (${s2 || retryErr.code || retryErr.message}) — skipping`);
        return null;
      }
    }
    // Permanent errors (404, 401, network) or anything else — log and skip
    console.warn(`[checker] ${sourceName} unavailable (${status || err.code || err.message}) — skipping`);
    return null;
  }
}

// ─── Congress.gov helpers ─────────────────────────────────────────────────────

async function cgGet(path, params = {}) {
  const res = await resilientGet(`${CONGRESS_BASE}${path}`, {
    params: { api_key: key(), format: 'json', ...params },
    timeout: 12000,
  }, `Congress.gov ${path}`);
  return res?.data ?? null;
}

// ─── Member lookup table (bioguideId → name/district) ────────────────────────
// Built once per bot run so we can enrich House XML (which only has last names).

let _memberMap     = null;
let _memberMapDate = null;

async function getMemberMap() {
  const today = new Date().toISOString().split('T')[0];
  if (_memberMap && _memberMapDate === today) return _memberMap;
  _memberMap = {};
  let offset = 0;

  while (true) {
    const data   = await cgGet('/member', { currentMember: true, limit: 250, offset });
    const batch  = data?.members || [];
    for (const m of batch) {
      const [lastName = '', firstName = ''] = (m.name || '').split(', ');
      _memberMap[m.bioguideId] = {
        firstName,
        lastName,
        district: m.district ?? null,
        party: m.partyName || '',
      };
    }
    offset += batch.length;
    if (offset >= (data?.pagination?.count ?? 0) || batch.length === 0) break;
  }

  _memberMapDate = today;
  return _memberMap;
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

const PARTY_NAME = { D: 'Democrat', R: 'Republican', I: 'Independent', ID: 'Independent' };

// Parse Senate.gov roll-call XML → voter array compatible with formatter.js
function parseSenateXML(xml) {
  return [...String(xml).matchAll(/<member>([\s\S]*?)<\/member>/gi)].map(m => {
    const inner = m[1];
    return {
      person: {
        firstname: xmlTag(inner, 'first_name'),
        lastname:  xmlTag(inner, 'last_name'),
        party:     PARTY_NAME[xmlTag(inner, 'party')] || xmlTag(inner, 'party'),
        state:     xmlTag(inner, 'state'),
        district:  null,
      },
      option: { value: xmlTag(inner, 'vote_cast') },
    };
  });
}

// Parse House Clerk XML → voter array.  First name + district come from memberMap.
function parseHouseXML(xml, memberMap) {
  return [...String(xml).matchAll(/<recorded-vote>([\s\S]*?)<\/recorded-vote>/gi)].map(m => {
    const inner   = m[1];
    const legEl   = inner.match(/<legislator([^>]*)>/);
    const attrs   = legEl ? legEl[1] : '';
    const attr    = (name) => { const a = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i')); return a ? a[1] : ''; };
    const bioId   = attr('name-id');
    const info    = memberMap[bioId] || {};
    const vote    = xmlTag(inner, 'vote');
    return {
      person: {
        firstname: info.firstName || '',
        lastname:  info.lastName  || attr('sort-field') || attr('unaccented-name'),
        party:     PARTY_NAME[attr('party')] || attr('party'),
        state:     attr('state'),
        district:  info.district ?? null,
      },
      option: { value: vote },
    };
  });
}

// ─── Vote XML fetchers ────────────────────────────────────────────────────────

// Senate: session 1 = odd year (2025), session 2 = even year (2026)
function senateSessionNum(yearStr) {
  return parseInt(yearStr, 10) % 2 === 1 ? 1 : 2;
}

async function fetchSenateVoters(congress, sessionYear, rollNumber) {
  const sn  = senateSessionNum(sessionYear);
  const num = String(rollNumber).padStart(5, '0');
  const url = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${sn}/vote_${congress}_${sn}_${num}.xml`;
  const res = await resilientGet(url, { timeout: 12000 }, 'Senate.gov XML');
  if (!res) return [];
  return parseSenateXML(res.data);
}

async function fetchHouseVoters(sessionYear, rollNumber, memberMap) {
  const url = `https://clerk.house.gov/evs/${sessionYear}/roll${rollNumber}.xml`;
  const res = await resilientGet(url, { timeout: 12000 }, 'House Clerk XML');
  if (!res) return [];
  return parseHouseXML(res.data, memberMap);
}

// ─── Bill type helpers ────────────────────────────────────────────────────────

const DISPLAY = {
  hr: 'H.R.', s: 'S.', hjres: 'H.J.Res.', sjres: 'S.J.Res.',
  hconres: 'H.Con.Res.', sconres: 'S.Con.Res.', hres: 'H.Res.', sres: 'S.Res.',
};
const URL_TYPE = {
  hr: 'house-bill', s: 'senate-bill',
  hjres: 'house-joint-resolution', sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution', sconres: 'senate-concurrent-resolution',
  hres: 'house-resolution', sres: 'senate-resolution',
  // GovTrack uses underscore-separated full names — map them too
  house_bill: 'house-bill', senate_bill: 'senate-bill',
  house_resolution: 'house-resolution', senate_resolution: 'senate-resolution',
  house_joint_resolution: 'house-joint-resolution', senate_joint_resolution: 'senate-joint-resolution',
  house_concurrent_resolution: 'house-concurrent-resolution', senate_concurrent_resolution: 'senate-concurrent-resolution',
};

function ordinal(n) { const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); }
function billUrl(congress, type, number) { return `https://congress.gov/bill/${ordinal(congress)}-congress/${URL_TYPE[type] || type}/${number}`; }
function billId(type, number) { return `${DISPLAY[type] || type.toUpperCase()}${number}`; }

// ─── Bill helpers ─────────────────────────────────────────────────────────────

// Current congress number: 1st Congress was 1789, new one every 2 years on odd years
function currentCongress() { return Math.ceil((new Date().getFullYear() - 1788) / 2); }

async function fetchRecentBills(limit = 20) {
  // sort=updateDate+desc must stay as a literal + in the URL; axios would encode it as %2B which the API rejects
  const url = `${CONGRESS_BASE}/bill/${currentCongress()}?api_key=${key()}&sort=updateDate+desc&limit=${limit}&format=json`;
  const res = await resilientGet(url, { timeout: 12000 }, 'Congress.gov bills');
  return res?.data?.bills || [];
}
async function fetchBillDetail(c, t, n) {
  const data = await cgGet(`/bill/${c}/${t}/${n}`);
  return data?.bill || null;
}
async function fetchBillCosponsors(c, t, n) {
  try {
    const data = await cgGet(`/bill/${c}/${t}/${n}/cosponsors`);
    return data?.cosponsors || [];
  } catch { return []; }
}
async function fetchBillSummary(c, t, n) {
  try {
    const data = await cgGet(`/bill/${c}/${t}/${n}/summaries`);
    const list = data?.summaries || [];
    if (!list.length) return null;
    return list[list.length - 1].text?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
  } catch { return null; }
}

// ─── getNewBills ──────────────────────────────────────────────────────────────

function cutoff(days) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]; }

async function getNewBills() {
  const raw    = await fetchRecentBills(20);
  const since  = cutoff(7);
  const result = [];

  for (const bill of raw) {
    const congress = bill.congress;
    const type     = (bill.type || '').toLowerCase();
    const number   = bill.number;
    const tid      = `bill:${congress}:${type}:${number}`;

    // Quick pre-filter: skip bills with no recent activity
    if ((bill.latestAction?.actionDate || '') < cutoff(14)) continue;
    if (hasPostedBill(tid)) continue;

    try {
      const detail     = await fetchBillDetail(congress, type, number);
      if (!detail) continue;
      if ((detail.introducedDate || '') < since) continue;
      const summary    = await fetchBillSummary(congress, type, number);
      const cosponsors = await fetchBillCosponsors(congress, type, number);

      const sponsors = [];
      for (const sp of (detail.sponsors || []).slice(0, 1))
        sponsors.push({ name: `${sp.firstName} ${sp.lastName}`, party: sp.party, state: sp.state });
      for (const co of cosponsors.slice(0, 5))
        sponsors.push({ name: `${co.firstName} ${co.lastName}`, party: co.party, state: co.state });

      result.push({
        trackingId: tid,
        billId: billId(type, number),
        congress, type, number,
        title:        detail.title || bill.title || 'Untitled',
        synopsis:     summary,
        sponsors,
        url:          billUrl(congress, type, number),
        introducedDate: detail.introducedDate || '',
      });
    } catch (err) {
      console.error(`[checker] bill ${billId(type, number)}: ${err.message}`);
    }
  }
  return result;
}

// ─── getNewVotes ──────────────────────────────────────────────────────────────

// Parse a bill ID and congress.gov URL out of a vote question string.
// Patterns are ordered most-specific → least-specific so "H.J.Res." doesn't
// accidentally match the "H.R." pattern first.
function parseBillFromQuestion(question, congress) {
  const patterns = [
    [/\bH\.?\s*J\.?\s*Res\.?\s*(\d+)/i,   'hjres'],
    [/\bS\.?\s*J\.?\s*Res\.?\s*(\d+)/i,   'sjres'],
    [/\bH\.?\s*Con\.?\s*Res\.?\s*(\d+)/i, 'hconres'],
    [/\bS\.?\s*Con\.?\s*Res\.?\s*(\d+)/i, 'sconres'],
    [/\bH\.?\s*Res\.?\s*(\d+)/i,          'hres'],
    [/\bS\.?\s*Res\.?\s*(\d+)/i,          'sres'],
    [/\bH\.?\s*R\.?\s*(\d+)/i,            'hr'],
    [/\bS\.?\s*(\d+)\b(?!\s*Res)/i,       's'],
  ];
  for (const [re, type] of patterns) {
    const m = (question || '').match(re);
    if (m) {
      const num = parseInt(m[1], 10);
      return { parsedBillId: billId(type, num), parsedUrl: billUrl(congress, type, num) };
    }
  }
  return { parsedBillId: null, parsedUrl: null };
}

async function fetchRecentVotes(limit = 20) {
  const res = await resilientGet(`${GOVTRACK_BASE}/vote`, {
    params: { limit, sort: '-created', format: 'json' },
    timeout: 12000,
  }, 'GovTrack');
  return res?.data?.objects || [];
}

async function getNewVotes() {
  const raw = await fetchRecentVotes(20);
  if (!raw.length) {
    console.log('[checker] no vote data available, skipping');
    return [];
  }

  // Only fetch member map when there are votes to process — avoids Congress.gov
  // call during recess when that API may also be slow or rate-limited.
  let memberMap = {};
  try {
    memberMap = await getMemberMap();
  } catch (err) {
    console.error(`[checker] member map unavailable — ${err.message} — proceeding without district info`);
  }

  const result = [];

  for (const vote of raw) {
    // Guard against null/malformed entries in the GovTrack response array
    if (!vote || typeof vote !== 'object') continue;

    const { congress, session, chamber, number, passed, result: voteResult,
            total_plus: yea = 0, total_minus: nay = 0, total_other: other = 0 } = vote;

    if (voteResult == null) continue;

    const ch  = (chamber === 'senate') ? 'SENATE' : 'HOUSE';
    const tid = `vote:${congress}-${session}-${ch[0]}-${number}`;

    try {
      // hasPostedVote is inside the try so a corrupt state file can't crash the whole loop
      if (hasPostedVote(tid)) continue;

      let voters;
      if (ch === 'SENATE') {
        voters = await fetchSenateVoters(congress, session, number);
      } else {
        voters = await fetchHouseVoters(session, number, memberMap);
      }
      voters = voters || [];

      const republicans = voters.filter(v => v.person?.party === 'Republican');
      const democrats   = voters.filter(v => v.person?.party === 'Democrat');

      const didPass = passed === true || /pass|agree|adopt|approv/i.test(String(voteResult));

      // Try related_bill first, then parse bill ID from the question text
      const rb = vote.related_bill;
      const { parsedBillId, parsedUrl } = parseBillFromQuestion(vote.question || '', congress);
      const url = (rb?.congress != null && rb?.bill_number != null)
        ? billUrl(rb.congress, (rb.bill_type || '').toLowerCase(), rb.bill_number)
        : parsedUrl;

      const voteObj = {
        trackingId:  tid,
        voteId:      `${congress}-${session}-${ch[0]}-${number}`,
        chamber:     ch,
        billId:      parsedBillId,
        question:    vote.question || 'Procedural Vote',
        result:      didPass ? 'PASSED' : 'FAILED',
        resultEmoji: didPass ? '✅' : '❌',
        totals: { Yea: yea, Nay: nay, 'Not Voting': other, Present: 0 },
        republicans,
        democrats,
        url,
        population:  null,
        date:        (vote.created || '').slice(0, 10),
      };
      voteObj.population = calcPopRepresented(voteObj);
      result.push(voteObj);
    } catch (err) {
      console.error(`[checker] vote ${tid}: ${err.message}`);
    }
  }
  return result;
}

// ─── Adjournment detection ────────────────────────────────────────────────────
// Returns an array of { chamber, status, returnDate } objects — one entry per
// chamber that changed state this run (adjourned or returned).
// Chambers are checked independently:
//   HOUSE   — scraped from clerk.house.gov homepage (live status widget)
//   SENATE  — Senate schedule XML (State Work Period blocks) + vote-gap fallback
//
// RECESS_THRESHOLD_DAYS: days without a Senate vote before falling back to the
// schedule check. House status is authoritative and doesn't use this fallback.
const RECESS_THRESHOLD_DAYS = 5;

async function fetchHouseScheduleStatus() {
  const res = await resilientGet('https://clerk.house.gov/', {
    timeout: 12000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' },
  }, 'House Clerk homepage');
  if (!res) {
    console.warn('[checker] House Clerk homepage unavailable — assuming House in session');
    return { inSession: true, returnDate: null };
  }
  const html = String(res.data);

  const statusMatch = html.match(/id="menu-session-status"[^>]*>([^<]+)</);
  const dateMatch   = html.match(/id="menu-session-status-date"[^>]*>([^<]+)</);

  const statusText = statusMatch?.[1]?.trim() ?? '';
  const inSession  = !statusText.toLowerCase().includes('not in session');

  let returnDate = null;
  if (!inSession && dateMatch) {
    const raw = dateMatch[1].trim();
    // "Next Session: June 18th, 2026 at 10:00 AM" → "June 18, 2026"
    const m = raw.match(/Next Session:\s*([A-Za-z]+ \d+(?:st|nd|rd|th)?,?\s*\d{4})/i);
    if (m) returnDate = m[1].replace(/(\d+)(?:st|nd|rd|th)/, '$1').replace(',', '');
  }

  console.log(`[checker] House status: "${statusText}"${returnDate ? ` — return: ${returnDate}` : ''}`);
  return { inSession, returnDate };
}

async function getHouseSessionUpdate() {
  const alreadyIn = isHouseInRecess();
  const { inSession, returnDate } = await fetchHouseScheduleStatus();
  if (!inSession && !alreadyIn) return { chamber: 'HOUSE', status: 'adjourned', returnDate };
  if (inSession  &&  alreadyIn) return { chamber: 'HOUSE', status: 'returned',  returnDate: null };
  return null;
}

async function getSenateSessionUpdate(newVoteIds) {
  const today     = new Date().toISOString().split('T')[0];
  const lastKnown = getLastVoteDate();
  const alreadyIn = isSenateInRecess();

  // New votes always mean "returned" if we thought Senate was in recess
  if (newVoteIds.length > 0) {
    if (alreadyIn) return { chamber: 'SENATE', status: 'returned', returnDate: null };
    return null;
  }

  if (!lastKnown) return null;

  const daysSinceVote = Math.floor((new Date(today) - new Date(lastKnown)) / 86400000);
  if (!alreadyIn && daysSinceVote >= RECESS_THRESHOLD_DAYS) {
    // Confirm with the official schedule before posting — prevents false
    // positives on days Congress is sitting but hasn't voted yet.
    const { inSession, returnDate } = await fetchSenateScheduleStatus();
    if (inSession) {
      console.log(`[checker] ${daysSinceVote}d since last Senate vote but schedule says in session — skipping`);
      return null;
    }
    return { chamber: 'SENATE', status: 'adjourned', returnDate };
  }
  return null;
}

// Returns array (may be empty) of { chamber, status, returnDate } updates.
async function getAdjournmentUpdate(newVoteIds) {
  const [houseUpdate, senateUpdate] = await Promise.allSettled([
    getHouseSessionUpdate(),
    getSenateSessionUpdate(newVoteIds),
  ]);
  const updates = [];
  if (houseUpdate.status  === 'fulfilled' && houseUpdate.value)  updates.push(houseUpdate.value);
  if (senateUpdate.status === 'fulfilled' && senateUpdate.value) updates.push(senateUpdate.value);
  if (houseUpdate.status  === 'rejected') console.error('[checker] house session check failed:', houseUpdate.reason?.message);
  if (senateUpdate.status === 'rejected') console.error('[checker] senate session check failed:', senateUpdate.reason?.message);
  return updates;
}

// ─── getCongressStatus ────────────────────────────────────────────────────────
// Combines two signals:
//   1. Senate schedule XML  — planned session vs. State Work Period (recess)
//   2. Recent vote activity — detects emergency sessions (votes during a planned
//      recess) and early adjournments (no votes despite a scheduled session)
//
// Override matrix:
//   schedule=session  + recent votes    → in session
//   schedule=session  + no recent votes → trust schedule (committee work, etc.)
//   schedule=recess   + recent votes    → emergency session → override to in session
//   schedule=recess   + no recent votes → adjourned, return date from XML

function addOneDay(isoDate) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

async function fetchSenateScheduleStatus() {
  const year = new Date().getFullYear();
  const url  = `https://www.senate.gov/legislative/${year}_schedule.xml`;
  const res  = await resilientGet(url, { timeout: 12000 }, 'Senate schedule');
  if (!res) {
    console.warn('[checker] Senate schedule unavailable — assuming in session');
    return { inSession: true, returnDate: null };
  }
  const xml   = String(res.data);
  const today = new Date().toISOString().split('T')[0];

  for (const block of xml.matchAll(/<date>([\s\S]*?)<\/date>/gi)) {
    const inner  = block[1];
    const begin  = xmlTag(inner, 'beginDate');
    const end    = xmlTag(inner, 'endDate');
    const action = xmlTag(inner, 'action');
    if (action !== 'State Work Period') continue;
    if (today >= begin && today <= end) {
      const returnIso  = addOneDay(end);
      const returnDate = new Date(returnIso + 'T12:00:00Z')
        .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      return { inSession: false, returnDate };
    }
  }

  return { inSession: true, returnDate: null };
}

async function getCongressStatus() {
  const [schedule, recentVotes] = await Promise.all([
    fetchSenateScheduleStatus(),
    fetchRecentVotes(5),
  ]);

  const cutoffStr = cutoff(RECESS_THRESHOLD_DAYS);
  const hasRecentActivity = recentVotes.some(v => (v.created || '').slice(0, 10) >= cutoffStr);

  // Emergency session: schedule says recess but votes are happening
  if (!schedule.inSession && hasRecentActivity) {
    console.log('[checker] emergency session detected — overriding schedule');
    return { inSession: true, returnDate: null };
  }

  return schedule;
}

// ─── Test helpers (bypass tracker, return exactly one result) ────────────────

async function getLatestVote() {
  const raw       = await fetchRecentVotes(5);
  const memberMap = await getMemberMap();

  for (const vote of raw) {
    if (!vote || typeof vote !== 'object') continue;
    const { congress, session, chamber, number, passed, result: voteResult,
            total_plus: yea = 0, total_minus: nay = 0, total_other: other = 0 } = vote;
    if (voteResult == null) continue;
    const ch = chamber === 'senate' ? 'SENATE' : 'HOUSE';
    try {
      const voters = ch === 'SENATE'
        ? await fetchSenateVoters(congress, session, number)
        : await fetchHouseVoters(session, number, memberMap);

      const republicans = (voters || []).filter(v => v.person?.party === 'Republican');
      const democrats   = (voters || []).filter(v => v.person?.party === 'Democrat');
      const didPass     = passed === true || /pass|agree|adopt|approv/i.test(String(voteResult));
      const rb = vote.related_bill;
      const { parsedBillId, parsedUrl } = parseBillFromQuestion(vote.question || '', congress);
      const url = (rb?.congress != null && rb?.bill_number != null)
        ? billUrl(rb.congress, (rb.bill_type || '').toLowerCase(), rb.bill_number)
        : parsedUrl;

      const voteObj = {
        trackingId: `vote:${congress}-${session}-${ch[0]}-${number}`,
        voteId:      `${congress}-${session}-${ch[0]}-${number}`,
        chamber: ch, billId: parsedBillId,
        question: vote.question || 'Procedural Vote',
        result: didPass ? 'PASSED' : 'FAILED', resultEmoji: didPass ? '✅' : '❌',
        totals: { Yea: yea, Nay: nay, 'Not Voting': other, Present: 0 },
        republicans, democrats, url, population: null,
        date: (vote.created || '').slice(0, 10),
      };
      voteObj.population = calcPopRepresented(voteObj);
      return voteObj;
    } catch { continue; }
  }
  return null;
}

async function getLatestBill(days = 30) {
  const raw   = await fetchRecentBills(50);
  const since = cutoff(days);

  for (const bill of raw) {
    if ((bill.latestAction?.actionDate || '') < cutoff(days * 2)) continue;
    const congress = bill.congress;
    const type     = (bill.type || '').toLowerCase();
    const number   = bill.number;
    try {
      const detail = await fetchBillDetail(congress, type, number);
      if (!detail || (detail.introducedDate || '') < since) continue;
      const summary    = await fetchBillSummary(congress, type, number);
      const cosponsors = await fetchBillCosponsors(congress, type, number);
      const sponsors   = [];
      for (const sp of (detail.sponsors || []).slice(0, 1))
        sponsors.push({ name: `${sp.firstName} ${sp.lastName}`, party: sp.party, state: sp.state });
      for (const co of cosponsors.slice(0, 5))
        sponsors.push({ name: `${co.firstName} ${co.lastName}`, party: co.party, state: co.state });
      return {
        trackingId: `bill:${congress}:${type}:${number}`,
        billId: billId(type, number), congress, type, number,
        title: detail.title || bill.title || 'Untitled',
        synopsis: summary, sponsors, url: billUrl(congress, type, number),
      };
    } catch { continue; }
  }
  return null;
}

// ─── getPresidentialActions ───────────────────────────────────────────────────

async function getPresidentialActions() {
  const raw    = await fetchRecentBills(50);
  const since  = cutoff(7);
  const result = [];

  for (const bill of raw) {
    const actionText = bill.latestAction?.text || '';
    const actionDate = bill.latestAction?.actionDate || '';
    if (actionDate < since) continue;

    const isSigned = /signed by president|became public law/i.test(actionText);
    const isVetoed = /vetoed by president/i.test(actionText);
    if (!isSigned && !isVetoed) continue;

    const congress = bill.congress;
    const type     = (bill.type || '').toLowerCase();
    const number   = bill.number;
    const action   = isSigned ? 'signed' : 'vetoed';
    const tid      = `${action}:${congress}:${type}:${number}`;
    if (hasPostedPresidentialAction(tid)) continue;

    try {
      const detail = await fetchBillDetail(congress, type, number);
      if (!detail) continue;

      const law = isSigned && detail.laws?.length > 0
        ? `Public Law ${detail.laws[0].number}`
        : null;

      result.push({
        trackingId: tid,
        action,
        billId:     billId(type, number),
        title:      detail.title || bill.title || 'Untitled',
        lawNumber:  law,
        url:        billUrl(congress, type, number),
        actionDate,
      });
    } catch (err) {
      console.error(`[checker] presidential action ${tid}: ${err.message}`);
    }
  }

  return result;
}

// ─── getExecutiveOrders ───────────────────────────────────────────────────────

async function getExecutiveOrders() {
  const res = await resilientGet('https://www.federalregister.gov/api/v1/documents.json', {
    params: {
      'conditions[type][]':                        'PRESDOCU',
      'conditions[presidential_document_type][]':  'executive_order',
      order:    'newest',
      per_page: 5,
    },
    timeout: 12000,
  }, 'Federal Register');

  if (!res) return [];

  const docs   = res.data?.results || [];
  const since  = cutoff(7);
  const result = [];

  for (const doc of docs) {
    if ((doc.signing_date || '') < since) continue;
    const tid = `eo:${doc.document_number}`;
    if (hasPostedEO(tid)) continue;

    result.push({
      trackingId:  tid,
      number:      doc.document_number,
      title:       doc.title,
      signingDate: doc.signing_date,
      abstract:    doc.abstract || null,
      url:         doc.html_url,
    });
  }

  return result;
}

// ─── getHillReportData ────────────────────────────────────────────────────────
// Returns all votes cast and bills introduced on a given date (YYYY-MM-DD).
// Does NOT consult the dedup tracker — the caller decides whether to post.

async function getHillReportData(date = new Date().toISOString().split('T')[0]) {
  // Use allSettled so a single API failure doesn't abort the entire Hill Report —
  // during recess one endpoint may be slow/down while the other still responds.
  const [votesRes, billsRes] = await Promise.allSettled([
    fetchRecentVotes(50),
    fetchRecentBills(50),
  ]);

  if (votesRes.status === 'rejected') console.error(`[checker] hill report: votes fetch failed — ${votesRes.reason?.message}`);
  if (billsRes.status  === 'rejected') console.error(`[checker] hill report: bills fetch failed — ${billsRes.reason?.message}`);

  const rawVotes = votesRes.status === 'fulfilled' ? (votesRes.value || []) : [];
  const rawBills = billsRes.status  === 'fulfilled' ? (billsRes.value  || []) : [];

  // GovTrack vote objects include a `created` ISO timestamp; filter to today
  const votes = rawVotes
    .filter(v => v && v.result != null && (v.created || '').startsWith(date))
    .map(v => {
      const ch      = v.chamber === 'senate' ? 'SENATE' : 'HOUSE';
      const didPass = v.passed === true || /pass|agree|adopt|approv/i.test(String(v.result || ''));
      const rb      = v.related_bill;
      const { parsedBillId, parsedUrl } = parseBillFromQuestion(v.question || '', v.congress);
      const url = (rb?.congress != null && rb?.bill_number != null)
        ? billUrl(rb.congress, (rb.bill_type || '').toLowerCase(), rb.bill_number)
        : parsedUrl;
      return { chamber: ch, billId: parsedBillId, question: v.question || 'Procedural Vote', passed: didPass, url };
    });

  console.log(`[checker] hill report: ${votes.length} vote(s) found for ${date} (${rawVotes.length} total fetched)`);

  // Bills whose first action matches today — verify introducedDate via detail
  const candidates = rawBills.filter(b => b && (b.latestAction?.actionDate || '') >= date);
  const bills = [];
  for (const bill of candidates) {
    const congress = bill.congress;
    const type     = (bill.type || '').toLowerCase();
    const number   = bill.number;
    try {
      const detail = await fetchBillDetail(congress, type, number);
      if (!detail || detail.introducedDate !== date) continue;
      bills.push({
        billId: billId(type, number),
        title:  detail.title || bill.title || 'Untitled',
        url:    billUrl(congress, type, number),
      });
    } catch { continue; }
  }

  return { date, votes, bills };
}

module.exports = { getNewBills, getNewVotes, getPresidentialActions, getExecutiveOrders, getAdjournmentUpdate, getCongressStatus, getLatestVote, getLatestBill, getHillReportData };
