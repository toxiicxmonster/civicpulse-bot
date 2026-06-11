'use strict';
const axios = require('axios');
const { hasPostedBill, hasPostedVote } = require('./tracker');

const CONGRESS_BASE = 'https://api.congress.gov/v3';
const GOVTRACK_BASE = 'https://www.govtrack.us/api/v2';

const key = () => process.env.CONGRESS_API_KEY;

// ─── Congress.gov helpers ────────────────────────────────────────────────────

async function cgGet(path, params = {}) {
  const res = await axios.get(`${CONGRESS_BASE}${path}`, {
    params: { api_key: key(), format: 'json', ...params },
    timeout: 12000,
  });
  return res.data;
}

// ─── Member lookup table (bioguideId → name/district) ────────────────────────
// Built once per bot run so we can enrich House XML (which only has last names).

let _memberMap = null;

async function getMemberMap() {
  if (_memberMap) return _memberMap;
  _memberMap = {};
  let offset = 0;

  while (true) {
    const data   = await cgGet('/member', { currentMember: true, limit: 250, offset });
    const batch  = data.members || [];
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
    if (offset >= (data.pagination?.count ?? 0) || batch.length === 0) break;
  }

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
  return [...xml.matchAll(/<member>([\s\S]*?)<\/member>/gi)].map(m => {
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
  return [...xml.matchAll(/<recorded-vote>([\s\S]*?)<\/recorded-vote>/gi)].map(m => {
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
  const res = await axios.get(url, { timeout: 12000 });
  return parseSenateXML(res.data);
}

async function fetchHouseVoters(sessionYear, rollNumber, memberMap) {
  const url = `https://clerk.house.gov/evs/${sessionYear}/roll${rollNumber}.xml`;
  const res = await axios.get(url, { timeout: 12000 });
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

async function fetchRecentBills(limit = 20) { return (await cgGet('/bill', { sort: 'updateDate+desc', limit })).bills || []; }
async function fetchBillDetail(c, t, n)     { return (await cgGet(`/bill/${c}/${t}/${n}`)).bill || null; }
async function fetchBillCosponsors(c, t, n) {
  try { return (await cgGet(`/bill/${c}/${t}/${n}/cosponsors`)).cosponsors || []; } catch { return []; }
}
async function fetchBillSummary(c, t, n) {
  try {
    const list = (await cgGet(`/bill/${c}/${t}/${n}/summaries`)).summaries || [];
    if (!list.length) return null;
    return list[list.length - 1].text?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
  } catch { return null; }
}

// ─── getNewBills ──────────────────────────────────────────────────────────────

function cutoff(days) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]; }

async function getNewBills() {
  const raw    = await fetchRecentBills(20);
  const since  = cutoff(3);
  const result = [];

  for (const bill of raw) {
    const congress = bill.congress;
    const type     = (bill.type || '').toLowerCase();
    const number   = bill.number;
    const tid      = `bill:${congress}:${type}:${number}`;

    if ((bill.introducedDate || '') < since) continue;
    if (hasPostedBill(tid)) continue;

    try {
      const detail     = await fetchBillDetail(congress, type, number);
      if (!detail) continue;
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
    const m = question.match(re);
    if (m) {
      const num = parseInt(m[1], 10);
      return { parsedBillId: billId(type, num), parsedUrl: billUrl(congress, type, num) };
    }
  }
  return { parsedBillId: null, parsedUrl: null };
}

async function fetchRecentVotes(limit = 20) {
  return (await axios.get(`${GOVTRACK_BASE}/vote`, {
    params: { limit, sort: '-created', format: 'json' },
    timeout: 12000,
  })).data.objects || [];
}

async function getNewVotes() {
  const raw      = await fetchRecentVotes(20);
  const memberMap = await getMemberMap();
  const result   = [];

  for (const vote of raw) {
    const { congress, session, chamber, number, passed, result: voteResult,
            total_plus: yea = 0, total_minus: nay = 0, total_other: other = 0 } = vote;

    if (voteResult === null || voteResult === undefined) continue;

    const ch  = chamber === 'senate' ? 'SENATE' : 'HOUSE';
    const tid = `vote:${congress}-${session}-${ch[0]}-${number}`;
    if (hasPostedVote(tid)) continue;

    try {
      let voters;
      if (ch === 'SENATE') {
        voters = await fetchSenateVoters(congress, session, number);
      } else {
        voters = await fetchHouseVoters(session, number, memberMap);
      }

      const republicans = voters.filter(v => v.person?.party === 'Democrat' ? false : v.person?.party === 'Republican');
      const democrats   = voters.filter(v => v.person?.party === 'Democrat');

      const didPass = passed === true || /pass|agree|adopt|approv/i.test(String(voteResult));

      // Try related_bill first, then parse bill ID from the question text
      const rb = vote.related_bill;
      const { parsedBillId, parsedUrl } = parseBillFromQuestion(vote.question || '', congress);
      const url = (rb?.congress != null && rb?.bill_number != null)
        ? billUrl(rb.congress, (rb.bill_type || '').toLowerCase(), rb.bill_number)
        : parsedUrl;
      const voteBillId = parsedBillId;

      result.push({
        trackingId:  tid,
        voteId:      `${congress}-${session}-${ch[0]}-${number}`,
        chamber:     ch,
        billId:      voteBillId,
        question:    vote.question || 'Procedural Vote',
        result:      didPass ? 'PASSED' : 'FAILED',
        resultEmoji: didPass ? '✅' : '❌',
        totals: { Yea: yea, Nay: nay, 'Not Voting': other, Present: 0 },
        republicans,
        democrats,
        url,
      });
    } catch (err) {
      console.error(`[checker] vote ${tid}: ${err.message}`);
    }
  }
  return result;
}

module.exports = { getNewBills, getNewVotes };
