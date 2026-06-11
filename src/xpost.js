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

const DRY = () => process.env.DRY_RUN === 'true';

// Post an array of plain-text posts as a thread (used for bills)
async function postThread(posts) {
  if (!posts || posts.length === 0) return;

  if (DRY()) {
    console.log('\n===== DRY RUN — X Post Thread =====');
    posts.forEach((t, i) => {
      console.log(`\n[${i + 1}/${posts.length}] (${t.length} chars)\n${t}`);
      console.log('------------------------------------');
    });
    return;
  }

  await client().v2.tweetThread(posts.map(text => ({ text })));
}

// Post vote thread: main summary tweet + image reply
async function postVoteThread(summaryText, imageBuffer) {
  if (DRY()) {
    console.log('\n===== DRY RUN — Vote Thread =====');
    console.log(`\n[1/2] (${summaryText.length} chars)\n${summaryText}`);
    console.log('------------------------------------');
    console.log(`\n[2/2] [IMAGE ${(imageBuffer.length / 1024).toFixed(0)} KB]`);
    console.log('------------------------------------');
    return;
  }

  // Upload image first (media upload uses v1.1 endpoint)
  const mediaId = await client().v1.uploadMedia(imageBuffer, { mimeType: 'image/png' });

  // Post as a 2-tweet thread: summary → image reply
  await client().v2.tweetThread([
    { text: summaryText },
    { text: '📊 Full member breakdown:', media: { media_ids: [mediaId] } },
  ]);
}

module.exports = { postThread, postVoteThread };
