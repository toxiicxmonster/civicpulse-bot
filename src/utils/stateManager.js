const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../../data/state.json');

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { postedVotes: [], postedBills: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { postedVotes: [], postedBills: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function hasPostedVote(voteId) {
  return loadState().postedVotes.includes(voteId);
}

function markVotePosted(voteId) {
  const state = loadState();
  state.postedVotes = [...new Set([...state.postedVotes, voteId])].slice(-500);
  saveState(state);
}

function hasPostedBill(billId) {
  return loadState().postedBills.includes(billId);
}

function markBillPosted(billId) {
  const state = loadState();
  state.postedBills = [...new Set([...state.postedBills, billId])].slice(-500);
  saveState(state);
}

module.exports = { hasPostedVote, markVotePosted, hasPostedBill, markBillPosted };
