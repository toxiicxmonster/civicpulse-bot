'use strict';
// twitter-api-v2 is the npm package name; the platform is X.
const { TwitterApi } = require('twitter-api-v2');

let _client;
function client() {
  if (!_client) {
    _client = new TwitterApi({
      appKey:       process.env.X_API_KEY,
      appSecret:    process.env.X_API_SECRET,
      accessToken:  process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });
  }
  return _client;
}

async function postThread(posts) {
  if (!posts || posts.length === 0) return;

  if (process.env.DRY_RUN === 'true') {
    console.log('\n===== DRY RUN — X Post Thread =====');
    posts.forEach((t, i) => {
      console.log(`\n[${i + 1}/${posts.length}] (${t.length} chars)\n${t}`);
      console.log('------------------------------------');
    });
    return;
  }

  await client().v2.tweetThread(posts.map(text => ({ text })));
}

module.exports = { postThread };
