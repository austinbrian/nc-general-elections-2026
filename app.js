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

// Load data
async function loadData() {
  try {
    const response = await fetch('races.json?v=' + Date.now());
    const data = await response.json();
    races = data.races;
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
const NCSBE_URL = 'https://er.ncsbe.gov/enr/20260303/data/results_0.txt';
const CORS_PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

function buildNcsbeContestName(title, party) {
  const code = party === 'Republican' ? 'REP' : 'DEM';

  if (title.includes('U.S. Senate')) return [`US SENATE - ${code} (VOTE FOR 1)`];

  const congMatch = title.match(/(\d+)\w* Congressional District/);
  if (congMatch) {
    const dist = congMatch[1].padStart(2, '0');
    return [`US HOUSE OF REPRESENTATIVES DISTRICT ${dist} - ${code} (VOTE FOR 1)`];
  }

  // Combined race like "Senate District 9 / House District 4"
  if (title.includes('/')) {
    const names = [];
    const senMatch = title.match(/Senate District (\d+)/);
    const houseMatch = title.match(/House District (\d+)/);
    if (senMatch) names.push(`NC STATE SENATE DISTRICT ${senMatch[1].padStart(2, '0')} - ${code} (VOTE FOR 1)`);
    if (houseMatch) names.push(`NC HOUSE OF REPRESENTATIVES DISTRICT ${houseMatch[1].padStart(3, '0')} - ${code} (VOTE FOR 1)`);
    return names;
  }

  const senMatch = title.match(/Senate District (\d+)/);
  if (senMatch) return [`NC STATE SENATE DISTRICT ${senMatch[1].padStart(2, '0')} - ${code} (VOTE FOR 1)`];

  const houseMatch = title.match(/House District (\d+)/);
  if (houseMatch) return [`NC HOUSE OF REPRESENTATIVES DISTRICT ${houseMatch[1].padStart(3, '0')} - ${code} (VOTE FOR 1)`];

  const coaMatch = title.match(/Court of Appeals Judge Seat (\d+)/);
  if (coaMatch) return [`NC COURT OF APPEALS JUDGE SEAT ${coaMatch[1].padStart(2, '0')} - ${code} (VOTE FOR 1)`];

  return null;
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
  // Title-case the NCSBE name as fallback
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
    const contestNames = buildNcsbeContestName(race.title, race.party);
    if (!contestNames) continue;

    for (const contestName of contestNames) {
      const rows = byContest[contestName];
      if (!rows) continue;

      rows.sort((a, b) => parseInt(b.vct) - parseInt(a.vct));

      const candidates = rows.map(row => ({
        name: matchCandidateName(row.bnm, race.candidates),
        votes: parseInt(row.vct),
        percentage: parseFloat(row.pct),
      }));

      // For combined races, use sub-race key
      let raceKey = race.title;
      if (contestNames.length > 1) {
        if (contestName.includes('STATE SENATE')) {
          const m = contestName.match(/DISTRICT (\d+)/);
          raceKey = `Senate District ${parseInt(m[1])} Republican Primary`;
        } else if (contestName.includes('HOUSE OF REPRESENTATIVES')) {
          const m = contestName.match(/DISTRICT (\d+)/);
          raceKey = `House District ${parseInt(m[1])} Republican Primary`;
        }
      }

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
  if (el && resultsData) {
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
  return race.party === filter || race.type === filter;
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

  // For combined races, check sub-race keys
  if (!raceResults && race.title.includes('/')) {
    const parts = race.title.split('/').map(p => p.trim());
    const subResults = [];
    for (const part of parts) {
      // Try matching partial title
      for (const key of Object.keys(resultsData.races)) {
        if (key.includes(part.replace(/ Republican Primaries?| Democratic Primaries?/i, '').trim())) {
          subResults.push({ key, data: resultsData.races[key] });
        }
      }
    }
    if (subResults.length > 0) {
      return subResults.map(({ key, data }) => renderResultsBlock(key, data, race)).join('');
    }
    return '';
  }

  if (!raceResults) return '';
  return renderResultsBlock(null, raceResults, race);
}

function renderResultsBlock(subLabel, raceResults, race) {
  const totalVotes = raceResults.candidates.reduce((sum, c) => sum + c.votes, 0);
  const partyClass = race.party.toLowerCase();

  const barsHTML = raceResults.candidates.map(c => {
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
  const partyClass = race.party.toLowerCase();

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
    <article class="race-card party-${partyClass} ${isHidden ? 'hidden' : ''}"
             data-party="${race.party}"
             data-type="${race.type}"
             data-rank="${race.rank}">
      <div class="card-header">
        <span class="card-rank">${race.rank}</span>
        <div class="card-info">
          <h3 class="card-title">${race.title}</h3>
          <div class="card-meta">
            <span class="card-party ${partyClass}">${race.party}</span>
            <span class="card-type">${race.type}</span>
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
function setFilter(filter) {
  currentFilter = filter;
  filterBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === filter);
  });

  document.querySelectorAll('.race-card').forEach(card => {
    const cardParty = card.dataset.party;
    const cardType = card.dataset.type;
    const isVisible = matchesFilter({ party: cardParty, type: cardType }, filter);
    card.classList.toggle('hidden', !isVisible);
  });
}

// Event Listeners
viewBtns.forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => setFilter(btn.dataset.type));
});

// Card click handler using event delegation
board.addEventListener('click', function(e) {
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
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
});

// Initialize
loadData();
