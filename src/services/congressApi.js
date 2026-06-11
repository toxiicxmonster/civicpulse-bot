const axios = require('axios');

const BASE = 'https://api.congress.gov/v3';
const KEY = process.env.CONGRESS_API_KEY;

// GovTrack base for vote roll-call data (has full member breakdowns)
const GOVTRACK_BASE = 'https://www.govtrack.us/api/v2';

async function getRecentVotes(limit = 20) {
  // GovTrack returns full roll-call data including per-member votes
  const res = await axios.get(`${GOVTRACK_BASE}/vote`, {
    params: { limit, sort: '-created', format: 'json' },
    timeout: 10000,
  });
  return res.data.objects || [];
}

async function getVoteDetail(voteId) {
  const res = await axios.get(`${GOVTRACK_BASE}/vote/${voteId}`, {
    params: { format: 'json' },
    timeout: 10000,
  });
  return res.data;
}

async function getVoteVoters(voteId) {
  // Returns individual member votes for a roll call
  const res = await axios.get(`${GOVTRACK_BASE}/votevoter`, {
    params: { vote: voteId, limit: 500, format: 'json' },
    timeout: 15000,
  });
  return res.data.objects || [];
}

async function getRecentBills(limit = 20) {
  const res = await axios.get(`${BASE}/bill`, {
    params: {
      api_key: KEY,
      sort: 'updateDate+desc',
      limit,
      format: 'json',
    },
    timeout: 10000,
  });
  return res.data.bills || [];
}

async function getBillDetail(congress, billType, billNumber) {
  const res = await axios.get(`${BASE}/bill/${congress}/${billType}/${billNumber}`, {
    params: { api_key: KEY, format: 'json' },
    timeout: 10000,
  });
  return res.data.bill || null;
}

async function getBillCosponsors(congress, billType, billNumber) {
  const res = await axios.get(`${BASE}/bill/${congress}/${billType}/${billNumber}/cosponsors`, {
    params: { api_key: KEY, format: 'json' },
    timeout: 10000,
  });
  return res.data.cosponsors || [];
}

async function getBillSummary(congress, billType, billNumber) {
  try {
    const res = await axios.get(`${BASE}/bill/${congress}/${billType}/${billNumber}/summaries`, {
      params: { api_key: KEY, format: 'json' },
      timeout: 10000,
    });
    const summaries = res.data.summaries || [];
    // Return the most recent CRS summary text
    return summaries.length > 0 ? summaries[summaries.length - 1].text : null;
  } catch {
    return null;
  }
}

module.exports = {
  getRecentVotes,
  getVoteDetail,
  getVoteVoters,
  getRecentBills,
  getBillDetail,
  getBillCosponsors,
  getBillSummary,
};
