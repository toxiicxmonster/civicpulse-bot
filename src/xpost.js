'use strict';
const { TwitterApi } = require('twitter-api-v2');
const axios          = require('axios');

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

async function xPostVoteThread(summaryText, imageBuffer, questionText = null) {
  // Embed image directly in the post — X Basic does not allow media in reply tweets
  let mainId;
  if (imageBuffer) {
    const mediaId = await xClient().v1.uploadMedia(imageBuffer, { mimeType: 'image/png' });
    const res = await xClient().v2.tweet({ text: summaryText, media: { media_ids: [mediaId] } });
    mainId = res.data.id;
  } else {
    const res = await xClient().v2.tweet(summaryText);
    mainId = res.data.id;
  }
  if (questionText && mainId) {
    await xClient().v2.tweet({ text: questionText, reply: { in_reply_to_tweet_id: mainId } });
  }
  console.log('[xpost] posted vote to X');
}

// ─── Bluesky (AT Protocol) ───────────────────────────────────────────────────
// Uses raw HTTP so we avoid the ESM/CJS mismatch in @atproto/api.

const BSKY_BASE   = 'https://bsky.social';
const bskyEnabled = () => !!(process.env.BSKY_HANDLE && process.env.BSKY_APP_PASSWORD);

let _bskySess = null; // { did, accessJwt, refreshJwt }

async function bskyLogin() {
  const res = await axios.post(`${BSKY_BASE}/xrpc/com.atproto.server.createSession`, {
    identifier: process.env.BSKY_HANDLE,
    password:   process.env.BSKY_APP_PASSWORD,
  }, { timeout: 15000 });
  _bskySess = res.data;
  return _bskySess;
}

async function bskyRefresh() {
  try {
    const res = await axios.post(`${BSKY_BASE}/xrpc/com.atproto.server.refreshSession`, {}, {
      headers: { Authorization: `Bearer ${_bskySess.refreshJwt}` },
      timeout: 15000,
    });
    _bskySess = res.data;
    return _bskySess;
  } catch {
    return bskyLogin(); // refresh expired — full re-login
  }
}

async function bskySession() {
  return _bskySess || bskyLogin();
}

async function bskyRequest(fn) {
  // Transparently handle expired access tokens (401) by refreshing and retrying once
  try {
    const sess = await bskySession();
    return await fn(sess);
  } catch (e) {
    if (e.response?.status === 401) {
      const sess = await bskyRefresh();
      return fn(sess);
    }
    throw e;
  }
}

async function bskyUploadBlob(imageBuffer) {
  return bskyRequest(async (sess) => {
    const res = await axios.post(`${BSKY_BASE}/xrpc/com.atproto.repo.uploadBlob`, imageBuffer, {
      headers: { Authorization: `Bearer ${sess.accessJwt}`, 'Content-Type': 'image/png' },
      timeout: 30000,
    });
    return res.data.blob;
  });
}

// Bluesky requires explicit facets for URLs to render as hyperlinks.
// Byte positions (not char positions) are required by the AT Protocol lexicon.
function bskyFacets(text) {
  const facets = [];
  const urlRe  = /https?:\/\/[^\s\])’]+/g;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const start = Buffer.byteLength(text.slice(0, m.index), 'utf8');
    const end   = start + Buffer.byteLength(m[0], 'utf8');
    facets.push({
      index:    { byteStart: start, byteEnd: end },
      features: [{ '$type': 'app.bsky.richtext.facet#link', uri: m[0] }],
    });
  }
  return facets.length ? facets : null;
}

async function bskyCreatePost(sess, text, reply = null, embed = null) {
  const record = { '$type': 'app.bsky.feed.post', text, createdAt: new Date().toISOString() };
  if (reply)  record.reply  = reply;
  if (embed)  record.embed  = embed;
  const facets = bskyFacets(text);
  if (facets) record.facets = facets;
  const res = await axios.post(`${BSKY_BASE}/xrpc/com.atproto.repo.createRecord`, {
    repo: sess.did, collection: 'app.bsky.feed.post', record,
  }, {
    headers: { Authorization: `Bearer ${sess.accessJwt}` },
    timeout: 15000,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

async function bskyPostThread(posts) {
  await bskyRequest(async (sess) => {
    let root = null, parent = null;
    for (const text of posts) {
      const reply = root ? { root, parent } : null;
      const ref   = await bskyCreatePost(sess, text, reply);
      if (!root) root = ref;
      parent = ref;
    }
  });
  console.log('[xpost] posted thread to Bluesky');
}

async function bskyPostVoteThread(summaryText, imageBuffer, questionText = null) {
  await bskyRequest(async (sess) => {
    let embed = null;
    if (imageBuffer) {
      const blob = await bskyUploadBlob(imageBuffer);
      embed = { '$type': 'app.bsky.embed.images', images: [{ image: blob, alt: 'Full member vote breakdown' }] };
    }
    const mainRef = await bskyCreatePost(sess, summaryText, null, embed);
    if (questionText) {
      const reply = { root: mainRef, parent: mainRef };
      await bskyCreatePost(sess, questionText, reply);
    }
  });
  console.log('[xpost] posted vote to Bluesky');
}

// ─── Public API — fans out to every enabled platform ─────────────────────────
// platform option: 'x' | 'bsky' | 'both' | null (null = all configured)

const DRY = () => process.env.DRY_RUN === 'true';

function resolvePlatforms(platform) {
  const p = (platform || 'both').toLowerCase();
  return {
    useX:    (p === 'x' || p === 'both') && xEnabled(),
    useBsky: (p === 'bsky' || p === 'bluesky' || p === 'both') && bskyEnabled(),
  };
}

async function postThread(posts, { platform = null } = {}) {
  if (!posts?.length) return;

  if (DRY()) {
    const label = platform ? platform.toUpperCase() : 'all platforms';
    console.log(`\n===== DRY RUN — Post Thread [${label}] =====`);
    posts.forEach((t, i) => {
      console.log(`\n[${i + 1}/${posts.length}] (${t.length} chars)\n${t}`);
      console.log('------------------------------------');
    });
    return;
  }

  const { useX, useBsky } = resolvePlatforms(platform);
  const tasks = [];
  if (useX)    tasks.push(xPostThread(posts).catch(e    => console.error('[xpost] X error:',       e.message)));
  if (useBsky) tasks.push(bskyPostThread(posts).catch(e => console.error('[xpost] Bluesky error:', e.message)));
  if (!tasks.length) console.warn('[xpost] no platforms configured — nothing posted');
  await Promise.all(tasks);
}

async function postVoteThread(summaryText, imageBuffer, { platform = null, questionText = null } = {}) {
  if (DRY()) {
    const label = platform ? platform.toUpperCase() : 'all platforms';
    console.log(`\n===== DRY RUN — Vote Thread [${label}] =====`);
    console.log(`\n[1] (${summaryText.length} chars)\n${summaryText}`);
    console.log('------------------------------------');
    if (imageBuffer) console.log(`\n[img] [IMAGE ${(imageBuffer.length / 1024).toFixed(0)} KB]`);
    if (questionText) console.log(`\n[reply] (${questionText.length} chars)\n${questionText}`);
    console.log('------------------------------------');
    return;
  }

  const { useX, useBsky } = resolvePlatforms(platform);
  const tasks = [];
  if (useX)    tasks.push(xPostVoteThread(summaryText, imageBuffer, questionText).catch(e    => console.error('[xpost] X error:',       e.message)));
  if (useBsky) tasks.push(bskyPostVoteThread(summaryText, imageBuffer, questionText).catch(e => console.error('[xpost] Bluesky error:', e.message)));
  if (!tasks.length) console.warn('[xpost] no platforms configured — nothing posted');
  await Promise.all(tasks);
}

module.exports = { postThread, postVoteThread, xEnabled, bskyEnabled };
