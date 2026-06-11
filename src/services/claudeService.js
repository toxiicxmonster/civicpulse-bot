require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

async function generateVoteSynopsis(voteQuestion) {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      messages: [
        {
          role: 'user',
          content: `Summarize in one plain-English sentence (max 140 characters) what this congressional vote was about: "${voteQuestion}". Be specific. No emojis. No preamble.`,
        },
      ],
    });
    const text = message.content[0]?.text?.trim() || voteQuestion;
    return text.length > 200 ? text.slice(0, 197) + '...' : text;
  } catch {
    // Fall back to raw question if Claude is unavailable
    return voteQuestion.length > 200 ? voteQuestion.slice(0, 197) + '...' : voteQuestion;
  }
}

module.exports = { generateVoteSynopsis };
