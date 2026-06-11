const { getRecentVotes } = require('../services/congressApi');
const { hasPostedVote } = require('../utils/stateManager');

async function checkForNewVotes() {
  const votes = await getRecentVotes(20);
  const newVotes = [];
  for (const vote of votes) {
    // Skip votes with no result yet (still in progress)
    if (!vote.result) continue;
    if (!hasPostedVote(String(vote.id))) {
      newVotes.push(vote);
    }
  }
  return newVotes;
}

module.exports = { checkForNewVotes };
