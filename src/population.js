'use strict';

// 2020 US Census state populations (apportionment count).
// Valid until the 2030 Census apportionment — no action needed when a new Congress starts.
const STATE_POP = {
  AL: 5024279,  AK: 733391,   AZ: 7151502,  AR: 3011524,  CA: 39538223,
  CO: 5773714,  CT: 3605944,  DE: 989948,   FL: 21538187, GA: 10711908,
  HI: 1455271,  ID: 1839106,  IL: 12812508, IN: 6785528,  IA: 3190369,
  KS: 2937880,  KY: 4505836,  LA: 4657757,  ME: 1362359,  MD: 6177224,
  MA: 7029917,  MI: 10077331, MN: 5706494,  MS: 2961279,  MO: 6154913,
  MT: 1084225,  NE: 1961504,  NV: 3104614,  NH: 1377529,  NJ: 9288994,
  NM: 2117522,  NY: 20201249, NC: 10439388, ND: 779094,   OH: 11799448,
  OK: 3959353,  OR: 4237256,  PA: 13002700, RI: 1097379,  SC: 5118425,
  SD: 886667,   TN: 6910840,  TX: 29145505, UT: 3271616,  VT: 643077,
  VA: 8631393,  WA: 7705281,  WV: 1793716,  WI: 5893718,  WY: 576851,
  DC: 689545,
};

const US_TOTAL = Object.values(STATE_POP).reduce((a, b) => a + b, 0);
const AVG_DISTRICT_POP = Math.round(US_TOTAL / 435);

function isYea(v) {
  const val = String(v?.option?.value ?? v?.option ?? '').toLowerCase();
  return ['yea', 'yes', '+', 'aye'].includes(val);
}
function isNay(v) {
  const val = String(v?.option?.value ?? v?.option ?? '').toLowerCase();
  return ['nay', 'no', '-'].includes(val);
}

// Returns { yeaPct, nayPct } or null on error.
// Senate: each state is counted once for whichever side its senators favor.
//   When senators from a state split 1-1, the state's population is split 50/50.
//   This prevents any side from exceeding 100%.
// House: districts are apportioned equal population, so count × avgDistrictPop.
function calcPopRepresented(vote) {
  try {
    const all = [...(vote.republicans || []), ...(vote.democrats || [])];

    let yeaPop = 0, nayPop = 0;

    if (vote.chamber === 'SENATE') {
      // Tally each state's yea/nay senator count, then assign population proportionally
      const stateVotes = {};
      for (const v of all) {
        const st = v.person?.state;
        if (!st) continue;
        if (!stateVotes[st]) stateVotes[st] = { yea: 0, nay: 0 };
        if (isYea(v)) stateVotes[st].yea++;
        else if (isNay(v)) stateVotes[st].nay++;
      }
      for (const [st, { yea, nay }] of Object.entries(stateVotes)) {
        const pop   = STATE_POP[st] || 0;
        const total = yea + nay;
        if (total === 0) continue;
        yeaPop += pop * yea / total;
        nayPop += pop * nay / total;
      }
    } else {
      const t = vote.totals || {};
      yeaPop = (t.Yea || 0) * AVG_DISTRICT_POP;
      nayPop = (t.Nay || 0) * AVG_DISTRICT_POP;
    }

    return {
      yeaPct: Math.round(yeaPop / US_TOTAL * 100),
      nayPct: Math.round(nayPop / US_TOTAL * 100),
    };
  } catch {
    return null;
  }
}

module.exports = { calcPopRepresented };
