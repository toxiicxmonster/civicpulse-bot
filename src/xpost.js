'use strict';
const { TwitterApi } = require('twitter-api-v2');
const axios          = require('axios');
const FormData       = require('form-data');

// ─── X ───────────────────────────────────────────────────────────────────────

const xEnabled = () => !!(process.env.X_API_KEY && process.env.X_API_SECRET &&
                           process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET);

let _xClient;
function xClient() {
  if (!_xClient) _xClient = new TwitterApi({
    appKey:       process.env.X_API_KEY,
    appSecret:    process.env.X_API_SECRET,
    accessToken:  process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });
  return _xClient;
}

async function xPostThread(posts) {
  await xClient().v2.tweetThread(posts.map(text => ({ text })));
  console.log('[xpost] posted thread to X');
}

async function xPostVoteThread(summaryText, imageBuffer) {
  if (imageBuffer) {
    const mediaId = await xClient().v1.uploadMedia(imageBuffer, { mimeType: 'image/png' });
    await xClient().v2.tweetThread([
      { text: summaryText },
      { text: '📊 Full member breakdown:', media: { media_ids: [mediaId] } },
    ]);
  } else {
    await xClient().v2.tweet(summaryText);
  }
  console.log('[xpost] posted vote to X');
}

// ─── Truth Social ─────────────────────────────────────────────────────────────

const TS_BASE   = process.env.TS_BASE_URL || 'https://truthsocial.com';
const tsEnabled = () => !!process.env.TS_ACCESS_TOKEN;

async function tsPost(text, replyToId = null, mediaIds = []) {
  const body = { status: text };
  if (replyToId)    body.in_reply_to_id = replyToId;
  if (mediaIds.length) body.media_ids   = mediaIds;
  const res = await axios.post(`${TS_BASE}/api/v1/statuses`, body, {
    headers: { Authorization: `Bearer ${process.env.TS_ACCESS_TOKEN}` },
    timeout: 15000,
  });
  return res.data.id;
}

async function tsUploadMedia(imageBuffer) {
  const form = new FormData();
  form.append('file', imageBuffer, { filename: 'vote.png', contentType: 'image/png' });
  const res = await axios.post(`${TS_BASE}/api/v1/media`, form, {
    headers: { Authorization: `Bearer ${process.env.TS_ACCESS_TOKEN}`, ...form.getHeaders() },
    timeout: 30000,
  });
  return res.data.id;
}

async function tsPostThread(posts) {
  let replyToId = null;
  for (const text of posts) replyToId = await tsPost(text, replyToId);
  console.log('[xpost] posted thread to Truth Social');
}

async function tsPostVoteThread(summaryText, imageBuffer) {
  if (imageBuffer) {
    const mediaId = await tsUploadMedia(imageBuffer);
    const postId  = await tsPost(summaryText);
    await tsPost('📊 Full member breakdown:', postId, [mediaId]);
  } else {
    await tsPost(summaryText);
  }
  console.log('[xpost] posted vote to Truth Social');
}

// ─── Public API — fans out to every enabled platform ─────────────────────────

const DRY = () => process.env.DRY_RUN === 'true';

async function postThread(posts) {
  if (!posts?.length) return;

  if (DRY()) {
    console.log('\n===== DRY RUN — Post Thread =====');
    posts.forEach((t, i) => {
      console.log(`\n[${i + 1}/${posts.length}] (${t.length} chars)\n${t}`);
      console.log('------------------------------------');
    });
    return;
  }

  const tasks = [];
  if (xEnabled())  tasks.push(xPostThread(posts).catch(e  => console.error('[xpost] X error:',            e.message)));
  if (tsEnabled()) tasks.push(tsPostThread(posts).catch(e => console.error('[xpost] Truth Social error:', e.message)));
  if (!tasks.length) console.warn('[xpost] no platforms configured — nothing posted');
  await Promise.all(tasks);
}

async function postVoteThread(summaryText, imageBuffer) {
  if (DRY()) {
    console.log('\n===== DRY RUN — Vote Thread =====');
    console.log(`\n[1/2] (${summaryText.length} chars)\n${summaryText}`);
    console.log('------------------------------------');
    if (imageBuffer) console.log(`\n[2/2] [IMAGE ${(imageBuffer.length / 1024).toFixed(0)} KB]`);
    console.log('------------------------------------');
    return;
  }

  const tasks = [];
  if (xEnabled())  tasks.push(xPostVoteThread(summaryText, imageBuffer).catch(e  => console.error('[xpost] X error:',            e.message)));
  if (tsEnabled()) tasks.push(tsPostVoteThread(summaryText, imageBuffer).catch(e => console.error('[xpost] Truth Social error:', e.message)));
  if (!tasks.length) console.warn('[xpost] no platforms configured — nothing posted');
  await Promise.all(tasks);
}

module.exports = { postThread, postVoteThread };
