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

async function bskyPostVoteThread(summaryText, imageBuffer) {
  // On Bluesky the image embeds directly in the post — strip the "→ reply" hint
  const text = summaryText.replace('\n\n📊 Breakdown → reply', '');
  let embed  = null;
  if (imageBuffer) {
    const blob = await bskyUploadBlob(imageBuffer);
    embed = { '$type': 'app.bsky.embed.images', images: [{ image: blob, alt: 'Full member vote breakdown' }] };
  }
  await bskyRequest(sess => bskyCreatePost(sess, text, null, embed));
  console.log('[xpost] posted vote to Bluesky');
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
  if (xEnabled())    tasks.push(xPostThread(posts).catch(e    => console.error('[xpost] X error:',       e.message)));
  if (bskyEnabled()) tasks.push(bskyPostThread(posts).catch(e => console.error('[xpost] Bluesky error:', e.message)));
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
  if (xEnabled())    tasks.push(xPostVoteThread(summaryText, imageBuffer).catch(e    => console.error('[xpost] X error:',       e.message)));
  if (bskyEnabled()) tasks.push(bskyPostVoteThread(summaryText, imageBuffer).catch(e => console.error('[xpost] Bluesky error:', e.message)));
  if (!tasks.length) console.warn('[xpost] no platforms configured — nothing posted');
  await Promise.all(tasks);
}

module.exports = { postThread, postVoteThread };
