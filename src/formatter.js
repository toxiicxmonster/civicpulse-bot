'use strict';

const MAX = 278; // leave a 2-char buffer under X's 280-character post limit

// ─── Hashtag generation ─────────────────────────────────────────────────────

// Matched against bill title only — for appropriations bills that need department-specific tags.
const APPROPRIATIONS_MAP = [
  [/defense appropriations/i,         ['#DefenseBudget']],
  [/labor[,\s]+hhs[,\s]+education/i,  ['#EducationFunding', '#Healthcare']],
  [/financial services/i,             ['#FinancialServices']],
  [/homeland security/i,              ['#HomelandSecurity']],
  [/agriculture appropriations/i,     ['#AgricultureBudget']],
];

const HASHTAG_MAP = [
  [/\b(health\s?care|medicare|medicaid|aca|affordable care|health insurance|prescription|drug\s?price)/i, ['#Healthcare', '#Medicare']],
  [/\b(public health|health awareness|health disparit|health equity|disease prevention|epidemic|pandemic)/i, ['#PublicHealth']],
  [/\b(heat wave|extreme heat|heat|temperature|weather emergency|wildfire|drought|flood|disaster prep)/i, ['#ClimateChange', '#ExtremeHeat']],
  [/\b(tax(es|ation)?|irs|revenue|deduction|fiscal|tariff)/i,                                         ['#TaxReform', '#Taxes']],
  [/\b(climate change|environment|emission|clean energy|renewable|fossil fuel|epa)/i,                 ['#Climate', '#CleanEnergy']],
  [/\b(immigra|border|asylum|visa|deporta|daca|undocumented)/i,                                        ['#Immigration', '#BorderSecurity']],
  [/\b(defense|military|armed forces|pentagon|nato|national security)/i,                              ['#Defense', '#NationalSecurity']],
  [/\b(veteran|va benefit|gi bill|service member)/i,                                                  ['#Veterans']],
  [/\b(education|school|student loan|college|university|teacher)/i,                                   ['#Education']],
  [/\b(infrastructure|highway|bridge|transit|broadband|water infrastructure|water treatment)/i,       ['#Infrastructure']],
  [/\b(housing|rent|mortgage|homeless|affordable housing)/i,                                          ['#Housing']],
  [/\b(social security|disability|retirement|pension|elder|aging)/i,                                 ['#SocialSecurity']],
  [/\b(child(ren)?|family|daycare|childcare|maternity|paternity)/i,                                  ['#FamilyPolicy']],
  // Gun: split by framing so opposing tags don't land on the same post
  [/\b(gun control|gun violence|background check|assault weapon|red flag law)/i,                     ['#GunControl']],
  [/\b(second amendment|right to bear arms|gun rights)/i,                                            ['#2A', '#GunRights']],
  [/\b(gun|firearm|rifle)/i,                                                                         ['#GunControl']],
  [/\b(police|law enforcement|criminal justice|prison|sentencing|parole)/i,                          ['#CriminalJustice']],
  [/\b(election|voting right|ballot|campaign finance|gerrymandering)/i,                              ['#VotingRights']],
  [/\b(agriculture|farming|crop|livestock|usda|farm bill)/i,                                         ['#Agriculture']],
  [/\b(trade|export|import|wto|nafta|usmca|sanction)/i,                                              ['#Trade']],
  [/\b(tech(nology)?|artificial intelligence|ai|data privacy|cybersecurity|internet)/i,              ['#Technology', '#AI']],
  [/\b(small business|entrepreneur|startup|sba)/i,                                                   ['#SmallBusiness']],
  [/\b(opioid|fentanyl|addiction|substance abuse)/i,                                                 ['#DrugPolicy', '#OpioidCrisis']],
  [/\b(foreign policy|ukraine|israel|china|nato\s+allies)/i,                                         ['#ForeignPolicy']],
  [/\b(budget|deficit|debt ceiling|spending cuts)/i,                                                 ['#FederalBudget', '#NationalDebt']],
  [/\b(abortion|reproductive rights|planned parenthood)/i,                                           ['#ReproductiveRights']],
  [/\b(minimum wage|labor union|union|workers?\s+right)/i,                                           ['#LaborRights', '#MinimumWage']],
  [/\b(energy|oil|natural gas|nuclear|pipeline)/i,                                                   ['#EnergyPolicy']],
  [/\b(food stamps|snap|welfare|poverty)/i,                                                          ['#FoodSecurity']],
  [/\b(lgbtq|transgender|gender identity|discrimination)/i,                                          ['#LGBTQRights']],
  [/\b(mental health|suicide|counseling|behavioral health)/i,                                        ['#MentalHealth']],
  [/\b(space|nasa|satellite)/i,                                                                       ['#SpacePolicy']],
  [/\b(cryptocurrency|blockchain|digital assets?|crypto)/i,                                          ['#Crypto', '#DigitalAssets']],
  [/\b(native american|tribal|indigenous)/i,                                                         ['#IndigenousRights']],
  // Conservative-leaning framing
  [/\b(parental rights?|parents?\s+rights?|school curriculum)/i,                                     ['#ParentalRights']],
  [/\b(religious freedom|religious liberty|faith.based)/i,                                           ['#ReligiousFreedom']],
  [/\b(free speech|censorship|first amendment)/i,                                                    ['#FreeSpeech', '#FirstAmendment']],
  [/\b(deregulation|regulation reform|red tape)/i,                                                   ['#Deregulation']],
  [/\b(school choice|charter school|school voucher)/i,                                               ['#SchoolChoice']],
  [/\b(illegal immigra|illegal alien|border wall)/i,                                                 ['#BorderSecurity', '#IllegalImmigration']],
  [/\b(america\s+first|domestic production|reshoring)/i,                                             ['#AmericaFirst']],
  [/\b(back the blue|police funding)/i,                                                              ['#BackTheBlue', '#LawEnforcement']],
  [/\b(election integrity|voter\s+id|ballot security)/i,                                             ['#ElectionIntegrity']],
  [/\b(free market|capitalism|private sector)/i,                                                     ['#FreeMarket']],
  [/\b(pro.?life|unborn|sanctity of life)/i,                                                         ['#ProLife']],
  [/\b(fiscal responsib|wasteful spending)/i,                                                        ['#FiscalResponsibility']],
  [/\b(ccp|chinese communist|national security threat)/i,                                            ['#ChinaThreat']],
  [/\b(energy independence|domestic energy production)\b|(?:drill|drilling)\s+(?:for|more|baby)/i,  ['#EnergyIndependence']],
  // Bipartisan / neutral governance
  [/\b(bipartisan|across.the.aisle)/i,                                                               ['#Bipartisan']],
  [/\b(term limits?|congressional reform)/i,                                                         ['#TermLimits']],
  [/\b(government accountability|transparency|oversight)/i,                                          ['#Accountability']],
  [/\b(balanced budget|deficit spending)/i,                                                          ['#NationalDebt', '#BalancedBudget']],
  [/\b(free trade|trade war)/i,                                                                      ['#FreeTrade']],
  [/\b(constitution|constitutional)/i,                                                               ['#Constitution']],
];

// Returns up to maxTags unique bill-specific hashtags based on title and synopsis.
function generateHashtags(title = '', synopsis = '', subjects = [], maxTags = 5) {
  const text = [title, synopsis, ...subjects].join(' ');
  const seen = new Set();
  const tags = [];
  for (const [re, candidates] of APPROPRIATIONS_MAP) {
    if (re.test(title)) {
      for (const tag of candidates) {
        if (!seen.has(tag)) { seen.add(tag); tags.push(tag); }
        if (tags.length >= maxTags) return tags;
      }
    }
  }
  for (const [re, candidates] of HASHTAG_MAP) {
    if (re.test(text)) {
      for (const tag of candidates) {
        if (!seen.has(tag)) { seen.add(tag); tags.push(tag); }
        if (tags.length >= maxTags) return tags;
      }
    }
  }
  return tags;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

// Returns a "we missed it" notice when the event date is not today (ET).
// Returns empty string for same-day events.
function missedItLine(dateStr) {
  if (!dateStr) return '';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (dateStr >= today) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const formatted = new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  return `\n⏰ We missed it — occurred ${formatted}`;
}

function trunc(str, maxLen) {
  if (!str) return '';
  const s = str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const raw = s.slice(0, maxLen - 1);
  // Prefer ending at a complete sentence
  const sentenceEnd = raw.match(/^[\s\S]*[.!?](?=\s|$)/);
  if (sentenceEnd && sentenceEnd[0].trimEnd().length > maxLen * 0.6) {
    return sentenceEnd[0].trimEnd();
  }
  // Fall back to word boundary
  const lastSpace = raw.lastIndexOf(' ');
  if (lastSpace > maxLen / 2) return raw.slice(0, lastSpace) + '…';
  return raw + '…';
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

  // Tweet 1 — bill name as the headline with link
  const dynamicTags = generateHashtags(bill.title, bill.synopsis, bill.subjects || []);
  const hashtags  = ['#CivicPulse', '#Congress', '#NewBill', ...dynamicTags].join(' ');
  const header    = `📜 NEW BILL INTRODUCED\n\n${bill.billId}`;
  const linkLine  = bill.url ? `\n\n📖 ${bill.url}` : '';
  const missed    = missedItLine(bill.introducedDate);
  const suffix    = `${linkLine}${missed}\n\n${hashtags}`;
  const available = MAX - header.length - suffix.length - 2; // \n\n before title
  const title     = trunc(bill.title, Math.max(60, available));
  tweets.push(`${header}\n\n${title}${suffix}`);

  // Tweet 2 — synopsis (if available)
  if (bill.synopsis) {
    const synopsisHeader = `📋 SYNOPSIS — ${bill.billId}\n\n`;
    const synopsis = trunc(bill.synopsis, Math.max(60, MAX - synopsisHeader.length));
    tweets.push(`${synopsisHeader}${synopsis}`);
  }

  // Tweet 3 — sponsors + link
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
// Bill name is the headline; question/synopsis goes to a reply via formatVoteQuestion.

function formatVoteSummary(vote) {
  const t      = vote.totals || {};
  const yea    = t.Yea   ?? 0;
  const nay    = t.Nay   ?? 0;
  const absent = (t['Not Voting'] ?? 0) + (t.Present ?? 0);
  const label  = vote.billId || vote.chamber;

  const reps = vote.republicans || [];
  const dems = vote.democrats   || [];
  const rYea = reps.filter(v => isYea(v)).length;
  const rNay = reps.filter(v => isNay(v)).length;
  const rAbs = reps.length - rYea - rNay;
  const dYea = dems.filter(v => isYea(v)).length;
  const dNay = dems.filter(v => isNay(v)).length;
  const dAbs = dems.length - dYea - dNay;

  const partyLines  = `🐘 R: ✅ ${rYea}  ❌ ${rNay}  ⬜ ${rAbs}\n🫏 D: ✅ ${dYea}  ❌ ${dNay}  ⬜ ${dAbs}`;
  const popLine     = vote.population
    ? `\n👥 Pop. represented: ✅ ${vote.population.yeaPct}%  ❌ ${vote.population.nayPct}%`
    : '';
  const urlLine     = vote.url ? `\n\n📖 Read the full bill:\n${vote.url}` : '';
  const counts      = `${vote.resultEmoji} ${vote.result}\nYEA: ${yea} | NAY: ${nay} | ABSENT: ${absent}`;
  const dynamicTags = generateHashtags(vote.question || '', vote.billTitle || '');
  const hashtags    = ['#CivicPulse', '#Congress', ...dynamicTags].join(' ');
  const missed      = missedItLine(vote.date);

  return `🏛️ VOTE ALERT: ${label}\n\n${counts}\n\n${partyLines}${popLine}${urlLine}${missed}\n\n${hashtags}`;
}

// Returns the question text for the reply tweet following a vote post.
function formatVoteQuestion(vote) {
  const q = trunc(vote.question || 'Procedural Vote', MAX - 5);
  return `📋 ${q}`;
}

// Keep formatVoteThread as an alias that returns [summary] for backward compat
function formatVoteThread(vote) {
  return [formatVoteSummary(vote)];
}

// ─── Presidential action posts ───────────────────────────────────────────────

function formatSignedPost(action) {
  const lawLine     = action.lawNumber ? `\n\nNow ${action.lawNumber}.` : '';
  const url         = action.url ? `\n\n📖 Read the full bill:\n${action.url}` : '';
  const missed      = missedItLine(action.actionDate);
  const dynamicTags = generateHashtags(action.title, '', action.subjects || []);
  const hashtags    = ['#CivicPulse', '#Congress', ...dynamicTags].join(' ');
  const overhead    = `✍️ SIGNED INTO LAW: ${action.billId}\n\n`.length + lawLine.length + url.length + missed.length + `\n\n${hashtags}`.length;
  const title       = trunc(action.title, Math.max(20, MAX - overhead));
  return `✍️ SIGNED INTO LAW: ${action.billId}\n\n${title}${lawLine}${url}${missed}\n\n${hashtags}`;
}

function formatVetoedPost(action) {
  const url         = action.url ? `\n\n📖 Read the full bill:\n${action.url}` : '';
  const override    = '\n\nThe President has vetoed this bill. Congress may attempt an override with a 2/3 majority.';
  const missed      = missedItLine(action.actionDate);
  const dynamicTags = generateHashtags(action.title, '', action.subjects || []);
  const hashtags    = ['#CivicPulse', '#Congress', ...dynamicTags].join(' ');
  const overhead    = `🚫 VETOED: ${action.billId}\n\n`.length + override.length + url.length + missed.length + `\n\n${hashtags}`.length;
  const title       = trunc(action.title, Math.max(20, MAX - overhead));
  return `🚫 VETOED: ${action.billId}\n\n${title}${override}${url}${missed}\n\n${hashtags}`;
}

function formatExecutiveOrderPost(eo) {
  const dynamicTags = generateHashtags(eo.title, eo.abstract || '');
  const hashtags    = ['#CivicPulse', '#ExecutiveOrder', ...dynamicTags].join(' ');
  const url         = eo.url ? `\n\n📖 Full text:\n${eo.url}` : '';
  const abstract    = eo.abstract ? '\n\n' + trunc(eo.abstract, 80) : '';
  const missed      = missedItLine(eo.signingDate);
  const title       = trunc(eo.title, 120);
  return `📋 EXECUTIVE ORDER #${eo.number}\n\n${title}${abstract}\n\nSigned: ${eo.signingDate}${missed}${url}\n\n${hashtags}`;
}

// ─── Session status post (manual / forced) ───────────────────────────────────

function formatSessionStatusPost(inRecess, returnDate) {
  if (inRecess) {
    const line = returnDate
      ? `🗓️ Scheduled to return: ${returnDate}`
      : '🗓️ Return date not yet announced.';
    return `🏛️ CONGRESS STATUS: ADJOURNED\n\nBoth chambers are currently in recess. No votes or floor activity expected until they return.\n\n${line}\n\n#CivicPulse #Congress`;
  }
  return `🏛️ CONGRESS STATUS: IN SESSION\n\nCongress is currently in session. Legislative activity is ongoing — stay tuned for vote alerts and bill updates.\n\n#CivicPulse #Congress`;
}

// ─── Adjournment posts ────────────────────────────────────────────────────────

function formatAdjournedPost(returnDate) {
  const line = returnDate ? `🗓️ Scheduled to return: ${returnDate}` : '🗓️ Return date not yet announced.';
  return `🏛️ CONGRESS HAS ADJOURNED\n\nBoth chambers are now in recess. No votes or floor activity expected until they return.\n\n${line}\n\n#CivicPulse #Congress`;
}

function formatReturnedPost() {
  return `🏛️ CONGRESS HAS RETURNED\n\nBoth chambers are back in session. Legislative activity has resumed — stay tuned for upcoming votes.\n\n#CivicPulse #Congress`;
}

// ─── Hill Report thread ───────────────────────────────────────────────────────

function formatHillReport({ date, votes, bills }) {
  // Build a human-readable date string from a YYYY-MM-DD without timezone shift
  const [y, m, d] = date.split('-').map(Number);
  const dateStr = new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const tweets   = [];
  const passed   = votes.filter(v => v.passed).length;
  const failed   = votes.length - passed;
  const voteLine = votes.length > 0
    ? `🗳️ ${votes.length} vote${votes.length !== 1 ? 's' : ''}: ${passed} passed, ${failed} failed`
    : '🗳️ No floor votes today';
  const billLine = bills.length > 0
    ? `📜 ${bills.length} new bill${bills.length !== 1 ? 's' : ''} introduced`
    : '📜 No new bills introduced';

  tweets.push(`🗞️ THE HILL REPORT — ${dateStr}\n\n${voteLine}\n${billLine}\n\n#CivicPulse #Congress`);

  // Pack votes into as many tweets as needed
  if (votes.length > 0) {
    let current = '🗳️ VOTES TODAY';
    for (const v of votes) {
      const emoji  = v.passed ? '✅' : '❌';
      const label  = v.billId ? `${v.billId} — ` : `${v.chamber}: `;
      const q      = trunc(v.question, Math.max(20, Math.min(60, MAX - label.length - 5)));
      const line   = `\n${emoji} ${label}${q}`;
      if (current.length + line.length > MAX) {
        tweets.push(current);
        current = '🗳️ VOTES (cont.)';
      }
      current += line;
    }
    tweets.push(current);
  }

  // Pack bills into as many tweets as needed
  if (bills.length > 0) {
    let current = '📜 NEW BILLS INTRODUCED';
    for (const b of bills) {
      const line = `\n• ${b.billId} — ${trunc(b.title, 55)}`;
      if (current.length + line.length > MAX) {
        tweets.push(current);
        current = '📜 NEW BILLS (cont.)';
      }
      current += line;
    }
    tweets.push(current);
  }

  return tweets;
}

module.exports = { formatBillThread, formatVoteThread, formatVoteSummary, formatVoteQuestion, formatSignedPost, formatVetoedPost, formatExecutiveOrderPost, formatAdjournedPost, formatReturnedPost, formatSessionStatusPost, formatHillReport };
