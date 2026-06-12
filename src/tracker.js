'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, '../data');
const STATE_FILE = path.join(DATA_DIR, 'posted.json');

function load() {
  if (!fs.existsSync(STATE_FILE)) return { bills: [], votes: [], presidentialActions: [], executiveOrders: [], lastVoteDate: null, inRecess: false };
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!s.lastVoteDate)          s.lastVoteDate          = null;
    if (s.inRecess === undefined) s.inRecess               = false;
    if (!s.presidentialActions)   s.presidentialActions    = [];
    if (!s.executiveOrders)       s.executiveOrders        = [];
    return s;
  }
  catch { return { bills: [], votes: [], presidentialActions: [], executiveOrders: [], lastVoteDate: null, inRecess: false }; }
}

function save(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function hasPostedBill(id)                { return load().bills.includes(String(id)); }
function hasPostedVote(id)                { return load().votes.includes(String(id)); }
function hasPostedPresidentialAction(id)  { return load().presidentialActions.includes(String(id)); }
function hasPostedEO(id)                  { return load().executiveOrders.includes(String(id)); }

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

function markPresidentialActionPosted(id) {
  const s = load();
  s.presidentialActions = [...new Set([...s.presidentialActions, String(id)])].slice(-500);
  save(s);
}

function markEOPosted(id) {
  const s = load();
  s.executiveOrders = [...new Set([...s.executiveOrders, String(id)])].slice(-500);
  save(s);
}

function getLastVoteDate() { return load().lastVoteDate; }
function isInRecess()      { return load().inRecess; }

function markLastVoteDate(dateStr) {
  const s = load();
  s.lastVoteDate = dateStr;
  save(s);
}

function setRecessState(flag) {
  const s = load();
  s.inRecess = flag;
  save(s);
}

module.exports = {
  hasPostedBill, markBillPosted,
  hasPostedVote, markVotePosted,
  hasPostedPresidentialAction, markPresidentialActionPosted,
  hasPostedEO, markEOPosted,
  getLastVoteDate, markLastVoteDate,
  isInRecess, setRecessState,
};
