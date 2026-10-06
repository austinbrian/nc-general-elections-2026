// District map
//
// D3 v7 + topojson-client, inline SVG. Three layers (Federal / NC House / NC Senate),
// loaded lazily from data/geo/*.topo.json and cached. Districts with a featured race
// are highlighted; clicking one opens its race card in app.js.
//
// Talks to app.js through a few globals defined there (setFilter, openRaceCard,
// setRaceHash, racesById, currentFilter, districtLongName). app.js calls
// NCMap.setRaces() once data has loaded (after the login gate), and
// NCMap.syncToFilter() whenever the filter changes.

const NCMap = (function () {
  const W = 960;
  const PAD = 12;
  const LABEL_PX = 11;       // label size in screen pixels
  const MIN_LABEL_PX = 16;   // hide labels on districts smaller than this on screen
  const GEO_PATH = 'data/geo/';

  const LAYERS = {
    'federal': { file: 'us-house', chamber: 'us-house', filter: 'FEDERAL', name: 'Federal' },
    'nc-house': { file: 'nc-house', chamber: 'nc-house', filter: 'State House', name: 'NC House' },
    'nc-senate': { file: 'nc-senate', chamber: 'nc-senate', filter: 'State Senate', name: 'NC Senate' },
  };

  const FILTER_LAYER = {
    'FEDERAL': 'federal',
    'U.S. House': 'federal',
    'U.S. Senate': 'federal',
    'State House': 'nc-house',
    'State Senate': 'nc-senate',
  };

  const CHAMBER_LAYER = {
    'us-house': 'federal',
    'us-senate': 'federal',
    'nc-house': 'nc-house',
    'nc-senate': 'nc-senate',
  };

  const DISTRICT_NAMES = {
    'us-house': 'Congressional District',
    'nc-house': 'NC House District',
    'nc-senate': 'NC Senate District',
  };

  const section = document.getElementById('mapSection');
  const frame = document.getElementById('mapFrame');
  const svgEl = document.getElementById('mapSvg');
  const tooltip = document.getElementById('mapTooltip');
  const statusEl = document.getElementById('mapStatus');
  const chipsEl = document.getElementById('mapChips');
  const toggleBtns = document.querySelectorAll('.map-toggle-btn');
  const zoomBtns = document.querySelectorAll('.map-zoom-btn');

  const geoCache = {};       // file -> Promise<topology>
  let raceIndex = {};        // chamber -> { number -> [raceId] }, us-senate -> { statewide: [...] }
  let currentLayer = 'federal';
  let renderToken = 0;
  let ready = null;          // Promise for the current layer's render
  let svg, zoomLayer, districtG, outlineG, labelG, zoom, pathGen;
  let H = 400;
  let zoomK = 1;

  const hasD3 = typeof d3 !== 'undefined' && typeof topojson !== 'undefined';

  // ---------- helpers ----------

  function setStatus(msg) {
    if (statusEl) {
      statusEl.textContent = msg || '';
      statusEl.hidden = !msg;
    }
  }

  function loadTopo(file) {
    if (!geoCache[file]) {
      geoCache[file] = fetch(`${GEO_PATH}${file}.topo.json`).then(r => {
        if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
        return r.json();
      });
      // Don't cache failures, so a later toggle can retry
      geoCache[file].catch(() => { delete geoCache[file]; });
    }
    return geoCache[file];
  }

  function topoObject(topo, name) {
    if (topo.objects[name]) return topo.objects[name];
    const keys = Object.keys(topo.objects);
    return keys.length ? topo.objects[keys[0]] : null;
  }

  // d3 expects clockwise exterior rings; reverse any feature that covers the globe
  function fixWinding(feature) {
    if (!feature.geometry || d3.geoArea(feature) <= 2 * Math.PI) return feature;
    const g = feature.geometry;
    if (g.type === 'Polygon') g.coordinates.forEach(r => r.reverse());
    if (g.type === 'MultiPolygon') g.coordinates.forEach(p => p.forEach(r => r.reverse()));
    return feature;
  }

  function districtName(chamber, number) {
    if (typeof districtLongName === 'function' && chamber !== 'us-house') {
      return districtLongName({ chamber, number });
    }
    return `${DISTRICT_NAMES[chamber] || chamber} ${number}`;
  }

  function getRace(id) {
    return typeof racesById !== 'undefined' ? racesById[id] : null;
  }

  function racesFor(chamber, number) {
    return (raceIndex[chamber] && raceIndex[chamber][number]) || [];
  }

  function filterNow() {
    return typeof currentFilter !== 'undefined' ? currentFilter : 'ALL';
  }

  // ---------- race index ----------

  function setRaces(list) {
    raceIndex = {};
    (list || []).forEach(race => {
      const id = race._id || race.id;
      if (!id || !Array.isArray(race.districts)) return;
      race.districts.forEach(d => {
        if (!d || !CHAMBER_LAYER[d.chamber]) return;
        const key = d.number == null ? 'statewide' : Number(d.number);
        raceIndex[d.chamber] = raceIndex[d.chamber] || {};
        (raceIndex[d.chamber][key] = raceIndex[d.chamber][key] || []).push(id);
      });
    });

    const layer = FILTER_LAYER[filterNow()] || currentLayer;
    return switchLayer(layer, true);
  }

  // ---------- rendering ----------

  function initSvg() {
    svg = d3.select(svgEl);
    zoomLayer = svg.append('g').attr('class', 'map-zoom-layer');
    districtG = zoomLayer.append('g').attr('class', 'map-districts');
    outlineG = zoomLayer.append('g').attr('class', 'map-outline');
    labelG = zoomLayer.append('g').attr('class', 'map-labels');

    zoom = d3.zoom()
      .scaleExtent([1, 12])
      .filter(event => {
        // Page scroll stays native: wheel-zoom needs ctrl/cmd (or trackpad pinch),
        // touch pan/zoom needs two fingers
        if (event.type === 'wheel') return event.ctrlKey || event.metaKey;
        if (event.type.startsWith('touch')) return event.touches && event.touches.length > 1;
        return !event.button;
      })
      .on('zoom', event => {
        zoomLayer.attr('transform', event.transform);
        zoomK = event.transform.k;
        updateLabels();
        hideTooltip();
      });

    svg.call(zoom).on('dblclick.zoom', null);
    svg.style('touch-action', 'pan-x pan-y');

    zoomBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.zoom;
        if (action === 'in') svg.transition().duration(250).call(zoom.scaleBy, 1.6);
        else if (action === 'out') svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.6);
        else resetZoom();
      });
    });

    window.addEventListener('resize', () => updateLabels());
    // Touch has no mouseleave; don't leave a tooltip hanging after scrolling
    window.addEventListener('scroll', hideTooltip, { passive: true });
  }

  function resetZoom(animate = true) {
    if (!svg) return;
    (animate ? svg.transition().duration(400) : svg).call(zoom.transform, d3.zoomIdentity);
  }

  // Screen pixels per viewBox unit (before zoom)
  function viewScale() {
    const w = svgEl.getBoundingClientRect().width;
    return w > 0 ? w / W : 1;
  }

  function updateLabels() {
    if (!labelG) return;
    const s = viewScale() * zoomK;
    labelG.selectAll('text')
      .attr('font-size', LABEL_PX / s)
      .attr('stroke-width', 3 / s)
      .attr('display', d => (Math.min(d.w, d.h) * s >= MIN_LABEL_PX ? null : 'none'));
  }

  function switchLayer(layer, force) {
    if (!LAYERS[layer]) return Promise.resolve();
    const changed = layer !== currentLayer;
    currentLayer = layer;

    toggleBtns.forEach(btn => {
      const on = btn.dataset.layer === layer;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (!changed && !force && ready) return ready;
    ready = renderLayer(layer);
    return ready;
  }

  async function renderLayer(layer) {
    const token = ++renderToken;
    const cfg = LAYERS[layer];
    renderChips(layer);

    if (!hasD3) {
      setStatus('The map could not load (D3 unavailable).');
      return;
    }
    if (!svg) initSvg();

    setStatus('Loading map…');
    let topo, stateTopo = null;
    try {
      topo = await loadTopo(cfg.file);
      if (layer === 'federal') {
        stateTopo = await loadTopo('nc-state').catch(() => null);
      }
    } catch (e) {
      if (token !== renderToken) return;
      console.warn('Map layer failed to load:', e);
      districtG.selectAll('*').remove();
      outlineG.selectAll('*').remove();
      labelG.selectAll('*').remove();
      setStatus(`District boundaries for ${cfg.name} aren't available yet.`);
      return;
    }
    if (token !== renderToken) return;

    const obj = topoObject(topo, 'districts');
    const features = topojson.feature(topo, obj).features.map(fixWinding);
    features.forEach(f => { f.properties = f.properties || {}; f.district = Number(f.properties.district); });

    let outline;
    if (stateTopo) {
      outline = topojson.feature(stateTopo, topoObject(stateTopo, 'state'));
      outline = outline.type === 'FeatureCollection' ? outline : { type: 'FeatureCollection', features: [outline] };
      outline.features.forEach(fixWinding);
    } else {
      outline = { type: 'FeatureCollection', features: [fixWinding({ type: 'Feature', properties: {}, geometry: topojson.merge(topo, obj.geometries) })] };
    }

    // Fit to NC: width fixed, height follows the state's shape
    const fc = { type: 'FeatureCollection', features };
    const projection = d3.geoMercator().fitWidth(W - PAD * 2, fc);
    const b = d3.geoPath(projection).bounds(fc);
    H = Math.ceil(b[1][1] - b[0][1]) + PAD * 2;
    projection.fitExtent([[PAD, PAD], [W - PAD, H - PAD]], fc);
    pathGen = d3.geoPath(projection);

    svg.attr('viewBox', `0 0 ${W} ${H}`);
    zoom.extent([[0, 0], [W, H]]).translateExtent([[0, 0], [W, H]]);
    resetZoom(false);

    const chamber = cfg.chamber;
    features.forEach(f => {
      f.raceIds = racesFor(chamber, f.district);
      f.featured = f.raceIds.length > 0;
    });
    // Featured on top so their outlines aren't covered by neighbors
    features.sort((a, b2) => (a.featured - b2.featured) || (a.district - b2.district));

    districtG.selectAll('*').remove();
    const paths = districtG.selectAll('path')
      .data(features)
      .join('path')
      .attr('class', d => `district${d.featured ? ' featured' : ''}`)
      .attr('d', pathGen)
      .attr('data-district', d => d.district);

    paths.filter(d => d.featured)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', d => `${districtName(chamber, d.district)}: ${raceTitles(d.raceIds).join('; ')}. Open race card.`)
      .on('click', (event, d) => activate(d))
      .on('keydown', (event, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate(d);
        }
      })
      .on('focus', (event, d) => showTooltip(d, chamber, null, event.currentTarget))
      .on('blur', hideTooltip);

    paths.filter(d => !d.featured).attr('aria-hidden', 'true');

    paths
      // Hover tooltips for mouse only; a tap opens the card directly
      .on('pointerenter pointermove', (event, d) => {
        if (event.pointerType === 'mouse') showTooltip(d, chamber, event);
      })
      .on('pointerleave', hideTooltip);

    // State outline (highlighted when a U.S. Senate race is featured)
    const senateIds = layer === 'federal' ? racesFor('us-senate', 'statewide') : [];
    outlineG.selectAll('*').remove();
    outlineG.selectAll('path')
      .data(outline.features)
      .join('path')
      .attr('class', `state-outline${senateIds.length ? ' statewide-featured' : ''}`)
      .attr('d', pathGen);

    // Labels on featured districts
    labelG.selectAll('*').remove();
    const labelData = features.filter(f => f.featured).map(f => {
      const [[x0, y0], [x1, y1]] = pathGen.bounds(f);
      const [cx, cy] = pathGen.centroid(f);
      return { district: f.district, x: cx, y: cy, w: x1 - x0, h: y1 - y0 };
    });
    labelG.selectAll('text')
      .data(labelData)
      .join('text')
      .attr('class', 'district-label')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('aria-hidden', 'true')
      .text(d => d.district);
    updateLabels();

    setStatus(features.length ? '' : `No districts found for ${cfg.name}.`);
  }

  function raceTitles(ids) {
    return ids.map(id => (getRace(id) || {}).title).filter(Boolean);
  }

  function renderChips(layer) {
    if (!chipsEl) return;
    chipsEl.innerHTML = '';
    if (layer !== 'federal') return;
    racesFor('us-senate', 'statewide').forEach(id => {
      const race = getRace(id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-chip';
      btn.textContent = 'Statewide: U.S. Senate';
      if (race) btn.setAttribute('aria-label', `Statewide: ${race.title}. Open race card.`);
      btn.addEventListener('click', () => openRace(id));
      chipsEl.appendChild(btn);
    });
  }

  // ---------- interaction ----------

  function openRace(id) {
    hideTooltip();
    if (typeof setRaceHash === 'function') setRaceHash(id);
    if (typeof openRaceCard === 'function') openRaceCard(id);
  }

  function activate(d) {
    if (d.raceIds.length) openRace(d.raceIds[0]);
  }

  function showTooltip(d, chamber, event, target) {
    if (!tooltip) return;
    const titles = raceTitles(d.raceIds);
    const name = districtName(chamber, d.district);
    tooltip.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = name;
    tooltip.appendChild(strong);
    const detail = document.createElement('span');
    detail.textContent = titles.length ? titles.join(' · ') : 'No featured race';
    tooltip.appendChild(detail);
    tooltip.classList.toggle('muted', !titles.length);
    tooltip.hidden = false;

    const fr = frame.getBoundingClientRect();
    let x, y;
    if (event && event.clientX != null) {
      x = event.clientX - fr.left;
      y = event.clientY - fr.top;
    } else {
      const r = (target || event.currentTarget).getBoundingClientRect();
      x = r.left + r.width / 2 - fr.left;
      y = r.top - fr.top;
    }
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const left = Math.max(4, Math.min(fr.width - tw - 4, x - tw / 2));
    const top = y - th - 12 < 0 ? y + 16 : y - th - 12;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
  }

  function pulse(selection) {
    selection.classed('pulse', false);
    selection.each(function () {
      void this.getBoundingClientRect(); // restart animation
    });
    selection.raise().classed('pulse', true)
      .on('animationend.pulse', function () { d3.select(this).classed('pulse', false); });
  }

  function zoomToFeature(f) {
    const [[x0, y0], [x1, y1]] = pathGen.bounds(f);
    const dx = x1 - x0, dy = y1 - y0;
    // Only zoom in for districts too small to see at full-state scale
    if (dx > W / 6 || dy > H / 3) {
      resetZoom();
      return;
    }
    const k = Math.min(8, 0.35 / Math.max(dx / W, dy / H));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    svg.transition().duration(600).call(
      zoom.transform,
      d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy)
    );
  }

  // Show a district on the map (from a card's district chip)
  async function showDistrict(chamber, number, opts = {}) {
    const layer = CHAMBER_LAYER[chamber];
    if (!layer) return;

    // Keep the filter in charge: if it pins a different layer, change the filter;
    // under All/Judicial the layer is free to move on its own.
    const pinned = FILTER_LAYER[filterNow()];
    if (pinned && pinned !== layer && typeof setFilter === 'function') {
      setFilter(LAYERS[layer].filter);
    } else {
      switchLayer(layer);
    }

    if (opts.scroll && section) {
      const top = section.getBoundingClientRect().top + window.scrollY - 8;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }

    await ready;
    if (!svg || currentLayer !== layer) return;

    if (chamber === 'us-senate' || number == null) {
      resetZoom();
      pulse(outlineG.selectAll('path'));
      return;
    }
    const target = districtG.selectAll('path').filter(d => d.district === Number(number));
    if (target.empty()) return;
    zoomToFeature(target.datum());
    pulse(target);
    labelG.raise();
  }

  function showRace(id, opts = {}) {
    const race = getRace(id);
    if (!race || !Array.isArray(race.districts)) return;
    const d = race.districts.find(x => x && CHAMBER_LAYER[x.chamber]);
    if (d) showDistrict(d.chamber, d.number, opts);
  }

  function syncToFilter(filter) {
    const layer = FILTER_LAYER[filter];
    if (layer && layer !== currentLayer) switchLayer(layer);
  }

  // Map toggle sets the filter (which in turn sets the layer)
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      if (typeof setFilter === 'function') setFilter(LAYERS[layer].filter);
      else switchLayer(layer);
    });
  });

  return { setRaces, syncToFilter, showDistrict, showRace };
})();

// app.js checks window.NCMap (top-level const is not a window property)
window.NCMap = NCMap;
