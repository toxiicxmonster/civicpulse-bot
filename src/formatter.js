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

// ─── Vote summary tweet (main post) ──────────────────────────────────────────
// Returns a single string. Party totals are inlined; the image reply is handled
// separately in bot.js via voteImage.js.

function formatVoteSummary(vote, { imageReply = true } = {}) {
  const t      = vote.totals || {};
  const yea    = t.Yea   ?? 0;
  const nay    = t.Nay   ?? 0;
  const absent = (t['Not Voting'] ?? 0) + (t.Present ?? 0);
  const label  = vote.billId || vote.chamber;

  // Party breakdown lines
  const rYea = vote.republicans.filter(v => isYea(v)).length;
  const rNay = vote.republicans.filter(v => isNay(v)).length;
  const rAbs = vote.republicans.length - rYea - rNay;
  const dYea = vote.democrats.filter(v => isYea(v)).length;
  const dNay = vote.democrats.filter(v => isNay(v)).length;
  const dAbs = vote.democrats.length - dYea - dNay;

  const partyLines = `🐘 R: ✅ ${rYea}  ❌ ${rNay}  ⬜ ${rAbs}\n🫏 D: ✅ ${dYea}  ❌ ${dNay}  ⬜ ${dAbs}`;
  const popLine    = vote.population
    ? `\n👥 Pop. represented: ✅ ${vote.population.yeaPct}%  ❌ ${vote.population.nayPct}%`
    : '';
  const urlLine    = vote.url ? `\n\n📖 Read the full bill:\n${vote.url}` : '';
  const breakdownRef = imageReply ? '\n\n📊 Breakdown → reply' : '';
  const footer     = `\n\n${partyLines}${popLine}${breakdownRef}\n\n#CivicPulse #Congress`;
  const counts     = `${vote.resultEmoji} ${vote.result}\nYEA: ${yea} | NAY: ${nay} | ABSENT: ${absent}`;
  const prefix     = `🏛️ VOTE ALERT: ${label}\n\n📋 `;
  const overhead   = prefix.length + `\n\n${counts}`.length + urlLine.length + footer.length;

  const qLen   = Math.max(30, MAX - overhead);
  const synopsis = trunc(vote.question, qLen);

  return prefix + synopsis + `\n\n${counts}` + urlLine + footer;
}

// Keep formatVoteThread as an alias that returns [summary] for backward compat
function formatVoteThread(vote) {
  return [formatVoteSummary(vote)];
}

// ─── Presidential action posts ───────────────────────────────────────────────

function formatSignedPost(action) {
  const lawLine = action.lawNumber ? `\n\nNow ${action.lawNumber}.` : '';
  const title   = trunc(action.title, 120);
  const url     = action.url ? `\n\n📖 Read the full bill:\n${action.url}` : '';
  return `✍️ SIGNED INTO LAW: ${action.billId}\n\n${title}${lawLine}${url}\n\n#CivicPulse #Congress`;
}

function formatVetoedPost(action) {
  const title = trunc(action.title, 100);
  const url   = action.url ? `\n\n📖 Read the full bill:\n${action.url}` : '';
  return `🚫 VETOED: ${action.billId}\n\n${title}\n\nThe President has vetoed this bill. Congress may attempt an override with a 2/3 majority.${url}\n\n#CivicPulse #Congress`;
}

function formatExecutiveOrderPost(eo) {
  const title    = trunc(eo.title, 120);
  const abstract = eo.abstract ? '\n\n' + trunc(eo.abstract, 80) : '';
  const url      = eo.url ? `\n\n📖 Full text:\n${eo.url}` : '';
  return `📋 EXECUTIVE ORDER #${eo.number}\n\n${title}${abstract}\n\nSigned: ${eo.signingDate}${url}\n\n#CivicPulse #ExecutiveOrder`;
}

// ─── Adjournment posts ────────────────────────────────────────────────────────

function formatAdjournedPost(returnDate) {
  const line = returnDate ? `🗓️ Scheduled to return: ${returnDate}` : '🗓️ Return date not yet announced.';
  return `🏛️ CONGRESS HAS ADJOURNED\n\nBoth chambers are now in recess. No votes or floor activity expected until they return.\n\n${line}\n\n#CivicPulse #Congress`;
}

function formatReturnedPost() {
  return `🏛️ CONGRESS HAS RETURNED\n\nBoth chambers are back in session. Legislative activity has resumed — stay tuned for upcoming votes.\n\n#CivicPulse #Congress`;
}

module.exports = { formatBillThread, formatVoteThread, formatVoteSummary, formatSignedPost, formatVetoedPost, formatExecutiveOrderPost, formatAdjournedPost, formatReturnedPost };
