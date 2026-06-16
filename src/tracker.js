'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, '../data');
const STATE_FILE = path.join(DATA_DIR, 'posted.json');

const EMPTY_STATE = () => ({ bills: [], votes: [], presidentialActions: [], executiveOrders: [], hillReports: [], lastVoteDate: null, inRecess: false, houseInRecess: false, senateInRecess: false, lastBioUpdate: null, currentSessionStatus: null });

function load() {
  if (!fs.existsSync(STATE_FILE)) return EMPTY_STATE();
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const s   = JSON.parse(raw);
    if (!s || typeof s !== 'object' || Array.isArray(s)) return EMPTY_STATE();
    if (!Array.isArray(s.bills))               s.bills               = [];
    if (!Array.isArray(s.votes))               s.votes               = [];
    if (!Array.isArray(s.presidentialActions)) s.presidentialActions = [];
    if (!Array.isArray(s.executiveOrders))     s.executiveOrders     = [];
    if (!Array.isArray(s.hillReports))         s.hillReports         = [];
    if (!s.lastVoteDate)                s.lastVoteDate          = null;
    if (s.inRecess === undefined)       s.inRecess              = false;
    if (s.houseInRecess === undefined)  s.houseInRecess         = false;
    if (s.senateInRecess === undefined) s.senateInRecess        = false;
    if (!s.lastBioUpdate)               s.lastBioUpdate         = null;
    if (!s.currentSessionStatus)        s.currentSessionStatus  = null;
    return s;
  }
  catch { return EMPTY_STATE(); }
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

function hasPostedHillReport(date) { return (load().hillReports || []).includes(String(date)); }

function markHillReportPosted(date) {
  const s = load();
  s.hillReports = [...new Set([...(s.hillReports || []), String(date)])].slice(-365);
  save(s);
}

function getLastVoteDate()   { return load().lastVoteDate; }
function isInRecess()        { return load().inRecess; }
function isHouseInRecess()   { return load().houseInRecess; }
function isSenateInRecess()  { return load().senateInRecess; }

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

function setHouseRecessState(flag) {
  const s = load();
  s.houseInRecess = Boolean(flag);
  save(s);
}

function setSenateRecessState(flag) {
  const s = load();
  s.senateInRecess = Boolean(flag);
  s.inRecess = Boolean(flag); // keep legacy field in sync
  save(s);
}

function getBioState() {
  const s = load();
  return { lastBioUpdate: s.lastBioUpdate || null, currentSessionStatus: s.currentSessionStatus || null };
}

function setBioState({ lastBioUpdate, currentSessionStatus }) {
  const s = load();
  s.lastBioUpdate        = lastBioUpdate;
  s.currentSessionStatus = currentSessionStatus;
  save(s);
}

module.exports = {
  hasPostedBill, markBillPosted,
  hasPostedVote, markVotePosted,
  hasPostedPresidentialAction, markPresidentialActionPosted,
  hasPostedEO, markEOPosted,
  hasPostedHillReport, markHillReportPosted,
  getLastVoteDate, markLastVoteDate,
  isInRecess, setRecessState,
  isHouseInRecess, setHouseRecessState,
  isSenateInRecess, setSenateRecessState,
  getBioState, setBioState,
};
