// State
let races = [];
let resultsData = null;
let currentView = 'peek';
let currentFilter = 'ALL';

// DOM Elements
const board = document.getElementById('board');
const lastUpdatedEl = document.getElementById('lastUpdated');
const pageSubtitleEl = document.getElementById('pageSubtitle');
const viewBtns = document.querySelectorAll('.view-btn');
const filterBtns = document.querySelectorAll('.filter-btn');

// Race ids, chambers, and filters
//
// Filters are expressed as sets of chambers so a race spanning two chambers
// (e.g. the combined SD9/HD4 race) shows under either. 'FEDERAL' is set by the
// map's Federal toggle and covers both U.S. House and U.S. Senate.
const FILTER_CHAMBERS = {
  'U.S. House': ['us-house'],
  'U.S. Senate': ['us-senate'],
  'FEDERAL': ['us-house', 'us-senate'],
  'State Senate': ['nc-senate'],
  'State House': ['nc-house'],
  'Judicial': ['judicial'],
};

const TYPE_CHAMBER = {
  'U.S. House': 'us-house',
  'U.S. Senate': 'us-senate',
  'State Senate': 'nc-senate',
  'State House': 'nc-house',
  'Judicial': 'judicial',
};

const racesById = {};

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Use race.id from races.json; derive a stable slug when it's missing
function assignRaceIds(list) {
  Object.keys(racesById).forEach(k => delete racesById[k]);
  list.forEach((race, i) => {
    let id = race.id ? slugify(race.id) : '';
    if (!id) {
      const d = Array.isArray(race.districts) && race.districts[0];
      id = d && d.chamber
        ? slugify(d.number != null ? `${d.chamber}-${d.number}` : `${d.chamber}-${race.title}`)
        : slugify(race.title) || `race-${i + 1}`;
    }
    let unique = id;
    for (let n = 2; racesById[unique]; n++) unique = `${id}-${n}`;
    race._id = unique;
    racesById[unique] = race;
  });
}

function getRaceDistricts(race) {
  if (!Array.isArray(race.districts)) return [];
  return race.districts.filter(d => d && d.chamber);
}

function getRaceChambers(race) {
  const chambers = getRaceDistricts(race).map(d => d.chamber);
  if (chambers.length) return chambers;
  return TYPE_CHAMBER[race.type] ? [TYPE_CHAMBER[race.type]] : [];
}

const CHAMBER_NAMES = {
  'us-house': ['CD', 'Congressional District'],
  'us-senate': ['Statewide', 'U.S. Senate (statewide)'],
  'nc-senate': ['SD', 'NC Senate District'],
  'nc-house': ['HD', 'NC House District'],
};

function districtShortName(d) {
  const names = CHAMBER_NAMES[d.chamber];
  if (!names) return d.chamber;
  return d.number != null ? `${names[0]} ${d.number}` : names[0];
}

function districtLongName(d) {
  const names = CHAMBER_NAMES[d.chamber];
  if (!names) return d.chamber;
  return d.number != null ? `${names[1]} ${d.number}` : names[1];
}

// Load data
async function loadData() {
  try {
    const response = await fetch('races.json?v=' + Date.now());
    const data = await response.json();
    races = data.races;
    assignRaceIds(races);
    lastUpdatedEl.textContent = formatDate(data.lastUpdated);
    if (data.subtitle) {
      pageSubtitleEl.textContent = data.subtitle;
    }

    // Try to load election results
    try {
      const resultsResponse = await fetch('results.json?v=' + Date.now());
      if (resultsResponse.ok) {
        resultsData = await resultsResponse.json();
        updateResultsTimestamp();
        console.log(`Loaded results: ${Object.keys(resultsData.races).length} races`);
      }
    } catch (e) {
      console.log('No results data available');
    }

    renderBoard();

    if (window.NCMap) NCMap.setRaces(races);
    openRaceFromHash();
  } catch (error) {
    console.error('Error loading race data:', error);
    board.innerHTML = `
      <div class="empty-state">
        <h3>Error Loading Data</h3>
        <p>Could not load race data. Make sure races.json exists.</p>
      </div>
    `;
  }
}

// NCSBE contest name mapping
const NCSBE_URL = 'https://er.ncsbe.gov/enr/20261103/data/results_0.txt';
const CORS_PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

// Mirrors build_ncsbe_contests() in update_results.py — keep the two in sync.
// Returns [{ contest, key }]: the NCSBE contest name and the results.json key (race
// title, or a per-district sub-key for multi-district races). Uses race.districts;
// general contests have no party suffix, primary-style races (race.party set) get " - REP"/" - DEM".
const NCSBE_PARTY_NAMES = {
  REP: 'Republican', DEM: 'Democratic', LIB: 'Libertarian', GRE: 'Green',
  CST: 'Constitution', JFA: 'Justice for All', WTP: 'We the People', UNA: 'Unaffiliated',
};

function ncsbeContestBase(d) {
  const pad = (n, w) => String(n).padStart(w, '0');
  if (d.chamber === 'us-senate') return 'US SENATE';
  if (d.chamber === 'us-house' && d.number) return `US HOUSE OF REPRESENTATIVES DISTRICT ${pad(d.number, 2)}`;
  if (d.chamber === 'nc-senate' && d.number) return `NC STATE SENATE DISTRICT ${pad(d.number, 2)}`;
  if (d.chamber === 'nc-house' && d.number) return `NC HOUSE OF REPRESENTATIVES DISTRICT ${pad(d.number, 3)}`;
  if (d.chamber === 'judicial' && d.seat) {
    const court = d.court || 'coa';
    if (court === 'coa') return `NC COURT OF APPEALS JUDGE SEAT ${pad(d.seat, 2)}`;
    if (court === 'supreme') return `NC SUPREME COURT ASSOCIATE JUSTICE SEAT ${pad(d.seat, 2)}`;
  }
  return null;
}

function buildNcsbeContestName(race) {
  const code = { Republican: 'REP', Democratic: 'DEM' }[race.party];
  const suffix = code ? ` - ${code}` : '';
  const districts = race.districts || [];
  const subLabels = { 'nc-senate': 'Senate District', 'nc-house': 'House District', 'us-house': 'Congressional District' };

  const contests = [];
  for (const d of districts) {
    const base = ncsbeContestBase(d);
    if (!base) continue;
    let key = race.title;
    if (districts.length > 1) {
      key = `${subLabels[d.chamber] || d.chamber} ${d.number}`;
      if (code) key += ` ${race.party} Primary`;
    }
    contests.push({ contest: `${base}${suffix} (VOTE FOR 1)`, key });
  }
  return contests;
}

function extractLastName(name) {
  const cleaned = name.replace(/^(Rev\.|Dr\.|Mr\.|Mrs\.|Ms\.)\s+/, '');
  const parts = cleaned.split(/\s+/);
  const suffixes = ['jr.', 'sr.', 'ii', 'iii', 'iv', 'v'];
  if (parts.length > 1 && suffixes.includes(parts[parts.length - 1].toLowerCase().replace('.', ''))) {
    return parts[parts.length - 2].toUpperCase();
  }
  return parts[parts.length - 1].toUpperCase();
}

function matchCandidateName(ncsbeName, raceCandidates) {
  const parts = ncsbeName.trim().split(/\s+/);
  const suffixes = ['JR.', 'SR.', 'II', 'III', 'IV', 'V'];
  let ncsbeLastName = parts[parts.length - 1].toUpperCase();
  if (parts.length > 1 && suffixes.includes(ncsbeLastName)) {
    ncsbeLastName = parts[parts.length - 2].toUpperCase();
  }
  const ncsbeFirstName = parts[0].toUpperCase();
  const lastNameMatches = raceCandidates.filter(c => extractLastName(c.name) === ncsbeLastName);
  if (lastNameMatches.length === 1) return lastNameMatches[0].name;
  // Multiple candidates share a last name — match on first name too
  if (lastNameMatches.length > 1) {
    const firstAndLast = lastNameMatches.find(c => c.name.split(/\s+/)[0].toUpperCase() === ncsbeFirstName);
    if (firstAndLast) return firstAndLast.name;
  }
  // Fallback: keep NCSBE's mixed-case ballot name; title-case only if it's ALL CAPS
  if (ncsbeName !== ncsbeName.toUpperCase()) return ncsbeName.trim();
  return ncsbeName.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function parseNcsbeResults(ncsbeData) {
  // Index by contest name
  const byContest = {};
  for (const row of ncsbeData) {
    const cnm = row.cnm;
    if (!byContest[cnm]) byContest[cnm] = [];
    byContest[cnm].push(row);
  }

  const globalPrt = ncsbeData[0]?.prt || '0';
  const globalPtl = ncsbeData[0]?.ptl || '0';

  const output = {
    lastUpdated: new Date().toISOString(),
    precinctsReporting: `${globalPrt} of ${globalPtl}`,
    races: {},
  };

  for (const race of races) {
    for (const { contest, key: raceKey } of buildNcsbeContestName(race)) {
      const rows = byContest[contest];
      if (!rows) continue;

      rows.sort((a, b) => parseInt(b.vct) - parseInt(a.vct));

      const candidates = rows.map(row => {
        const cand = {
          name: matchCandidateName(row.bnm, race.candidates),
          votes: parseInt(row.vct),
          percentage: parseFloat(row.pct),
        };
        const pty = (row.pty || '').trim();
        if (pty) cand.party = NCSBE_PARTY_NAMES[pty] || pty;
        return cand;
      });

      output.races[raceKey] = {
        precinctsReporting: `${rows[0].prt} of ${rows[0].ptl}`,
        candidates,
      };
    }
  }

  return output;
}

// Fetch live from NCSBE (trying CORS proxies) and update cards
async function refreshResults() {
  const btn = document.getElementById('refreshResultsBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Updating...';
  }

  let fetched = false;
  // First try direct fetch (works locally or if CORS allows)
  const urls = [NCSBE_URL, ...CORS_PROXIES.map(p => p(NCSBE_URL))];

  for (const url of urls) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const ncsbeData = await resp.json();
        resultsData = parseNcsbeResults(ncsbeData);
        updateResultsTimestamp();
        renderBoard();
        fetched = true;
        console.log(`Fetched live results via ${url.substring(0, 40)}...`);
        break;
      }
    } catch (e) {
      console.log(`Proxy failed: ${url.substring(0, 40)}...`);
    }
  }

  if (!fetched) {
    // Fall back to local results.json
    try {
      const resp = await fetch('results.json?v=' + Date.now());
      if (resp.ok) {
        resultsData = await resp.json();
        updateResultsTimestamp();
        renderBoard();
        console.log('Fell back to local results.json');
      }
    } catch (e) {
      console.log('Could not load any results');
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Update Results';
  }
}

// Update the results timestamp display
function updateResultsTimestamp() {
  const el = document.getElementById('resultsTimestamp');
  if (el && resultsData && resultsData.lastUpdated) {
    const d = new Date(resultsData.lastUpdated);
    el.textContent = `Results: ${d.toLocaleTimeString()} | ${resultsData.precinctsReporting} precincts`;
    el.style.display = 'inline';
  }
}

// Format date
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Check if race matches filter
function matchesFilter(race, filter) {
  if (filter === 'ALL') return true;
  const chambers = FILTER_CHAMBERS[filter];
  if (!chambers) return race.party === filter || race.type === filter;
  return getRaceChambers(race).some(c => chambers.includes(c));
}

// Get role class for styling
function getRoleClass(role) {
  const roleLower = role.toLowerCase();
  if (roleLower.includes('incumbent')) return 'incumbent';
  if (roleLower.includes('appointed')) return 'appointed';
  if (roleLower.includes('frontrunner')) return 'frontrunner';
  if (roleLower.includes('challenger')) return 'challenger';
  return 'candidate';
}

// Get results HTML for a race
function getResultsHTML(race) {
  if (!resultsData) return '';

  // Look up results by race title
  let raceResults = resultsData.races[race.title];

  // For multi-district races, look up each sub-race by exact key:
  // "House District 4" (general) or "House District 4 Republican Primary" (primary)
  const subKeys = getResultsSubKeys(race);
  if (!raceResults && subKeys.length > 0) {
    const subResults = [];
    for (const base of subKeys) {
      const candidates = race.party ? [base, `${base} ${race.party} Primary`] : [base];
      const key = candidates.find(k => resultsData.races[k]);
      if (key) subResults.push({ key, data: resultsData.races[key] });
    }
    return subResults.map(({ key, data }) => renderResultsBlock(key, data, race)).join('');
  }

  if (!raceResults) return '';
  return renderResultsBlock(null, raceResults, race);
}

// Base results.json keys for a multi-district race (see buildNcsbeContestName)
function getResultsSubKeys(race) {
  const labels = { 'nc-senate': 'Senate District', 'nc-house': 'House District', 'us-house': 'Congressional District' };
  const districts = getRaceDistricts(race).filter(d => labels[d.chamber] && d.number != null);
  if (districts.length > 1) return districts.map(d => `${labels[d.chamber]} ${d.number}`);
  if (race.title.includes('/')) {
    return race.title.split('/').map(p => p.trim().replace(/ (Republican|Democratic) Primar(y|ies)$/i, '').trim());
  }
  return [];
}

function renderResultsBlock(subLabel, raceResults, race) {
  const totalVotes = raceResults.candidates.reduce((sum, c) => sum + c.votes, 0);
  const barsHTML = raceResults.candidates.map(c => {
    // Colour by the candidate's party (general), falling back to the race's (primary)
    const partyClass = slugify(c.party || race.party || 'other');
    const pctDisplay = (c.percentage * 100).toFixed(1);
    const votesDisplay = c.votes.toLocaleString();
    const isLeading = c === raceResults.candidates[0] && raceResults.candidates.length > 1;
    return `
      <div class="result-row ${isLeading ? 'leading' : ''}">
        <div class="result-info">
          <span class="result-name">${c.name}</span>
          <span class="result-votes">${votesDisplay} votes (${pctDisplay}%)</span>
        </div>
        <div class="result-bar-track">
          <div class="result-bar-fill ${partyClass}" style="width: ${pctDisplay}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const labelHTML = subLabel ? `<div class="result-sublabel">${subLabel}</div>` : '';

  return `
    <div class="results-section">
      ${labelHTML}
      <div class="results-header">
        <span class="results-label">Election Results</span>
        <span class="results-precincts">${raceResults.precinctsReporting} precincts</span>
      </div>
      ${barsHTML}
    </div>
  `;
}

// Get expanded view type based on current view
function getExpandedView() {
  if (currentView === 'skim' || currentView === 'peek') return 'expanded-peruse';
  return 'expanded-deep-dive';
}

// Create race card HTML
function createRaceCard(race) {
  const isHidden = !matchesFilter(race, currentFilter);
  const partyClass = (race.party || '').toLowerCase();
  const partyHTML = race.party ? `<span class="card-party ${partyClass}">${race.party}</span>` : '';
  const chipsHTML = getRaceDistricts(race)
    .filter(d => d.chamber !== 'judicial')
    .map(d => `<button type="button" class="district-chip" data-chamber="${d.chamber}" data-number="${d.number ?? ''}" aria-label="Show ${districtLongName(d)} on the map">${districtShortName(d)}</button>`)
    .join('');

  const candidatesHTML = race.candidates
    .map(c => `
      <div class="candidate">
        <div class="candidate-header">
          <span class="candidate-name">${c.name}</span>
          <span class="candidate-role ${getRoleClass(c.role)}">${c.role}</span>
        </div>
        <p class="candidate-desc">${c.description}</p>
      </div>
    `)
    .join('');

  const issuesHTML = race.keyIssues
    .map(issue => `<span class="issue-tag">${issue}</span>`)
    .join('');

  // Convert fullText newlines to paragraphs
  const fullTextHTML = race.fullText
    ? race.fullText.split('\n\n').map(p => `<p>${p}</p>`).join('')
    : '';

  const resultsHTML = getResultsHTML(race);

  return `
    <article class="race-card ${partyClass ? `party-${partyClass}` : ''} ${isHidden ? 'hidden' : ''}"
             id="race-${race._id}"
             data-id="${race._id}"
             data-party="${race.party || ''}"
             data-type="${race.type}"
             data-rank="${race.rank}">
      <div class="card-header">
        <span class="card-rank">${race.rank}</span>
        <div class="card-info">
          <h3 class="card-title">${race.title}</h3>
          <div class="card-meta">
            ${partyHTML}
            <span class="card-type">${race.type}</span>
            ${chipsHTML}
          </div>
          <div class="card-location">${race.location}</div>
        </div>
      </div>

      <div class="card-candidates">
        ${candidatesHTML}
      </div>

      ${resultsHTML}

      <p class="card-summary">${race.summary}</p>

      <div class="card-fulltext">
        ${fullTextHTML}
      </div>

      <div class="card-stakes">
        <div class="card-stakes-label">Why It Matters</div>
        ${race.stakes}
      </div>

      <div class="card-issues">
        ${issuesHTML}
      </div>

      <div class="card-keyfact">
        <div class="card-keyfact-label">Key Fact</div>
        ${race.keyFact}
      </div>

      <button class="dive-deep-btn">Dive Deeper</button>
    </article>
  `;
}

// Render the board
function renderBoard() {
  board.className = `board view-${currentView}`;

  const filteredRaces = races.filter(r => matchesFilter(r, currentFilter));

  if (filteredRaces.length === 0) {
    board.innerHTML = `
      <div class="empty-state">
        <h3>No Races Found</h3>
        <p>No races match the selected filter.</p>
      </div>
    `;
    return;
  }

  board.innerHTML = races.map(createRaceCard).join('');
}

// Handle view mode change
function setView(view) {
  currentView = view;
  viewBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  renderBoard();
}

// Handle filter change
// currentFilter is the single source of truth for both the filter buttons and
// the map layer: the map toggle calls setFilter, and setFilter tells the map.
function setFilter(filter) {
  currentFilter = filter;
  const active = FILTER_CHAMBERS[filter] || [];
  filterBtns.forEach(btn => {
    const btnChambers = FILTER_CHAMBERS[btn.dataset.type] || [];
    const isActive = btn.dataset.type === filter ||
      (filter === 'FEDERAL' && btnChambers.length > 0 && btnChambers.every(c => active.includes(c)));
    btn.classList.toggle('active', isActive);
  });

  // Board may be showing an empty state from a previous render
  if (!board.querySelector('.race-card') && races.length) {
    renderBoard();
  }

  let visibleCount = 0;
  document.querySelectorAll('.race-card').forEach(card => {
    const race = racesById[card.dataset.id] || { party: card.dataset.party, type: card.dataset.type };
    const isVisible = matchesFilter(race, filter);
    if (isVisible) visibleCount++;
    card.classList.toggle('hidden', !isVisible);
  });

  let emptyEl = board.querySelector('.filter-empty');
  if (visibleCount === 0 && board.querySelector('.race-card')) {
    if (!emptyEl) {
      board.insertAdjacentHTML('beforeend', `
        <div class="empty-state filter-empty">
          <h3>No Races Found</h3>
          <p>No featured races match the selected filter.</p>
        </div>
      `);
    }
  } else if (emptyEl) {
    emptyEl.remove();
  }

  if (window.NCMap) NCMap.syncToFilter(filter);
}

// Height of the sticky controls bar, so scrolled-to cards aren't hidden under it
function getStickyOffset() {
  const controls = document.querySelector('.controls');
  return controls ? controls.getBoundingClientRect().height + 12 : 12;
}

function scrollToCard(card) {
  const top = card.getBoundingClientRect().top + window.scrollY - getStickyOffset();
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

// Expand a race card, scroll to it, and flash it (used by the map and #race= hash)
function openRaceCard(id) {
  const race = racesById[id];
  if (!race) return false;

  // Make sure the card is visible under the current filter
  if (!matchesFilter(race, currentFilter)) {
    setFilter('ALL');
  }

  const card = document.getElementById(`race-${id}`);
  if (!card) return false;

  const previouslyExpanded = board.querySelector('.race-card.expanded');
  if (previouslyExpanded && previouslyExpanded !== card) {
    previouslyExpanded.classList.remove('expanded', 'expanded-peruse', 'expanded-deep-dive');
  }
  if (!card.classList.contains('expanded')) {
    card.classList.add('expanded', getExpandedView());
  }

  setTimeout(() => {
    scrollToCard(card);
    card.classList.remove('flash');
    void card.offsetWidth; // restart the animation
    card.classList.add('flash');
  }, 50);
  return true;
}

function setRaceHash(id) {
  try {
    history.replaceState(null, '', `#race=${encodeURIComponent(id)}`);
  } catch (e) {
    // replaceState can throw in sandboxed iframes; the hash is a convenience
  }
}

function openRaceFromHash() {
  const match = window.location.hash.match(/^#race=([^&]+)/);
  if (!match) return;
  const id = decodeURIComponent(match[1]);
  if (!racesById[id]) return;
  if (window.NCMap) NCMap.showRace(id, { scroll: false });
  openRaceCard(id);
}

window.addEventListener('hashchange', openRaceFromHash);

// Event Listeners
viewBtns.forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => setFilter(btn.dataset.type));
});

// Card click handler using event delegation
board.addEventListener('click', function(e) {
  // District chip: show the district on the map instead of toggling the card
  const chip = e.target.closest('.district-chip');
  if (chip) {
    e.stopPropagation();
    if (window.NCMap) {
      const num = chip.dataset.number === '' ? null : parseInt(chip.dataset.number, 10);
      NCMap.showDistrict(chip.dataset.chamber, num, { scroll: true });
    }
    return;
  }

  // Handle "Dive Deeper" button click
  if (e.target.classList.contains('dive-deep-btn')) {
    e.stopPropagation();
    const card = e.target.closest('.race-card');
    if (card && card.classList.contains('expanded-peruse')) {
      card.classList.remove('expanded-peruse');
      card.classList.add('expanded-deep-dive');
    }
    return;
  }

  const card = e.target.closest('.race-card');
  if (!card) return;

  const expandedClass = getExpandedView();

  // If clicking an already expanded card, collapse it
  if (card.classList.contains('expanded')) {
    card.classList.remove('expanded', 'expanded-peruse', 'expanded-deep-dive');
    return;
  }

  // Collapse any other expanded card
  const previouslyExpanded = board.querySelector('.race-card.expanded');
  if (previouslyExpanded) {
    previouslyExpanded.classList.remove('expanded', 'expanded-peruse', 'expanded-deep-dive');
  }

  // Expand this card
  card.classList.add('expanded', expandedClass);

  // Scroll into view
  setTimeout(() => {
    scrollToCard(card);
  }, 50);
});

board.addEventListener('animationend', e => {
  if (e.target.classList.contains('race-card')) e.target.classList.remove('flash');
});

// Initialize (wait for the login gate in auth.js)
(window.authReady || Promise.resolve()).then(loadData);
