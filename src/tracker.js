'use strict';
const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../data/posted.json');

function load() {
  if (!fs.existsSync(STATE_FILE)) return { bills: [], votes: [] };
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { bills: [], votes: [] }; }
}

function save(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function hasPostedBill(id) { return load().bills.includes(String(id)); }
function hasPostedVote(id) { return load().votes.includes(String(id)); }

function markBillPosted(id) {
  const s = load();
  s.bills = [...new Set([...s.bills, String(id)])].slice(-1000);
  save(s);
}

function markVotePosted(id) {
  const s = load();
  s.votes = [...new Set([...s.votes, String(id)])].slice(-1000);
  save(s);
}

module.exports = { hasPostedBill, markBillPosted, hasPostedVote, markVotePosted };
