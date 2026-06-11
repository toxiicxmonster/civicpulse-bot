'use strict';

const MAX = 278; // leave a 2-char buffer under X's 280-character post limit

// ─── Utilities ──────────────────────────────────────────────────────────────

function trunc(str, maxLen) {
  if (!str) return '';
  const s = str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + '…';
}

function isYea(voter) {
  const v = String(voter?.option?.value ?? voter?.option ?? '').toLowerCase();
  return ['yea', 'yes', '+', 'aye'].includes(v);
}

function isNay(voter) {
  const v = String(voter?.option?.value ?? voter?.option ?? '').toLowerCase();
  return ['nay', 'no', '-'].includes(v);
}

function memberLabel(voter, chamber) {
  const p = voter.person || {};
  const name = `${p.firstname || ''} ${p.lastname || ''}`.trim() || '?';
  const loc  = chamber === 'HOUSE' && p.district
    ? `${p.state}-${p.district}`
    : (p.state || '?');
  return `${name} (${loc})`;
}

// ─── Party vote tweet builder ────────────────────────────────────────────────
// Splits one party's voter list across as many tweets as needed.

function buildPartyTweets(emoji, partyLabel, voteLabel, voters, chamber, lastSuffix) {
  const header     = `${emoji} ${partyLabel} VOTES — ${voteLabel}`;
  const contHeader = `${emoji} ${partyLabel} VOTES (cont.) — ${voteLabel}`;

  const yea    = voters.filter(v =>  isYea(v));
  const nay    = voters.filter(v =>  isNay(v));
  const absent = voters.filter(v => !isYea(v) && !isNay(v));

  // Flat ordered list of lines to pack into tweets
  const lines = [];
  if (yea.length)    { lines.push(`\n✅ YEA (${yea.length}):`);                  yea.forEach(v    => lines.push(`- ${memberLabel(v, chamber)}`)); }
  if (nay.length)    { lines.push(`\n❌ NAY (${nay.length}):`);                  nay.forEach(v    => lines.push(`- ${memberLabel(v, chamber)}`)); }
  if (absent.length) { lines.push(`\n⬜ ABSENT/NOT VOTING (${absent.length}):`); absent.forEach(v => lines.push(`- ${memberLabel(v, chamber)}`)); }

  const tweets  = [];
  let   current = header;

  for (const line of lines) {
    const proposed = current + '\n' + line;
    if (proposed.length <= MAX) {
      current = proposed;
    } else {
      tweets.push(current);
      current = contHeader + '\n' + line;
    }
  }

  if (lastSuffix) {
    const withSuffix = current + '\n\n' + lastSuffix;
    if (withSuffix.length <= MAX) {
      current = withSuffix;
    } else {
      tweets.push(current);
      current = lastSuffix;
    }
  }

  if (current) tweets.push(current);
  return tweets;
}

// ─── Bill thread ─────────────────────────────────────────────────────────────

function formatBillThread(bill) {
  const tweets = [];

  // Tweet 1 — NEW BILL INTRODUCED
  const hashtags  = '#CivicPulse #Congress #NewBill';
  const billLine  = `${bill.billId} — ${trunc(bill.title, 55)}`;
  const prefix    = `📜 NEW BILL INTRODUCED\n\n${billLine}\n\n📋 Synopsis:\n`;
  const suffix    = `\n\n${hashtags}`;
  const available = MAX - prefix.length - suffix.length;
  const synopsis  = trunc(bill.synopsis || bill.title, Math.max(30, available));

  tweets.push(prefix + synopsis + suffix);

  // Tweet 2 — Sponsors + link
  const sponsorHeader  = `👥 SPONSORS — ${bill.billId}\n\n`;
  const linkBlock      = `\n\n📖 Read the full bill:\n${bill.url}\n\n#CivicPulse`;
  const availableForNames = MAX - sponsorHeader.length - linkBlock.length;

  let nameBlock = '';
  for (let i = 0; i < bill.sponsors.length; i++) {
    const s    = bill.sponsors[i];
    const line = `- ${s.name} (${s.party}-${s.state})${i === 0 ? ' — Lead Sponsor' : ''}\n`;
    if (nameBlock.length + line.length > availableForNames) break;
    nameBlock += line;
  }

  tweets.push(sponsorHeader + nameBlock.trimEnd() + linkBlock);
  return tweets;
}

// ─── Vote thread ──────────────────────────────────────────────────────────────

function formatVoteThread(vote) {
  const tweets  = [];
  const t       = vote.totals || {};
  const yea     = t.Yea   ?? t['+'] ?? 0;
  const nay     = t.Nay   ?? t['-'] ?? 0;
  const absent  = (t['Not Voting'] ?? 0) + (t.Present ?? 0);
  const label   = vote.billId || vote.chamber;

  // Tweet 1 — Vote summary
  const urlLine  = vote.url ? `\n\n📖 Read the full bill:\n${vote.url}` : '';
  const hashTags = '\n\n#CivicPulse #Congress';
  const seeBelow = '\n\n🐘 Republican votes ↓\n🫏 Democrat votes ↓';
  const counts   = `${vote.resultEmoji} ${vote.result}\nYEA: ${yea} | NAY: ${nay} | ABSENT: ${absent}`;
  const overhead = `🏛️ VOTE ALERT: ${label}\n\n📋 `.length
    + `\n\n${counts}`.length + seeBelow.length + urlLine.length + hashTags.length;

  const qLen    = Math.max(30, MAX - overhead);
  const summary = trunc(vote.question, qLen);

  tweets.push(
    `🏛️ VOTE ALERT: ${label}\n\n` +
    `📋 ${summary}\n\n` +
    `${counts}` +
    seeBelow + urlLine + hashTags
  );

  // Republican vote tweets
  if (vote.republicans.length > 0) {
    tweets.push(...buildPartyTweets('🐘', 'REPUBLICAN', label, vote.republicans, vote.chamber, null));
  }

  // Democrat vote tweets (last tweet includes the footer)
  const demSuffix = '⬇️ Track your reps: CivicPulse app\n#CivicPulse';
  if (vote.democrats.length > 0) {
    tweets.push(...buildPartyTweets('🫏', 'DEMOCRAT', label, vote.democrats, vote.chamber, demSuffix));
  } else {
    tweets.push(demSuffix);
  }

  return tweets;
}

module.exports = { formatBillThread, formatVoteThread };
