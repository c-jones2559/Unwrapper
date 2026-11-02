import { msToHours, sOnEnd } from './timeBits.js?v=6';
import { buildGraphData, drawGraph } from './graph.js?v=6';
import { drawCard, themes, findAlbumCover } from './share.js?v=6';

// 1. The Global State
let appState = {
    allData: [], // Every play from the files
    data: [], // The same minus anything excluded, which is what all the stats use
    currentView: 'list', // 'list', 'graph' or 'wrapped'
    listView: 'songs', // Which list's showing on the List tab: 'songs', 'artists' or 'albums'
    metric: 'plays', // 'plays' or 'time', what the lists are sorted by and what the graph shows
    timeFilter: 'all', // 'all', a year like '2026', or 'custom'
    monthFilter: 'all', // 'all' or 0-11, only used when a year is picked
    customFrom: '', // "YYYY-MM-DD" from the date inputs
    customTo: '',
    shown: 50, // How many rows of the list to show, goes up by 50 with each Show more
    firstPlay: 0, // ms, so the graph knows where the data starts and ends
    lastPlay: 0,
    // Graph only: the artists/albums/songs picked, each one gets its own line.
    // Each is { type, key, label, colour } with the same keys as topArtists/topAlbums/topSongs
    graphSeries: [],
    suggestions: [], // What's showing under a search box at the moment, which box, and which one the arrow keys are on
    suggestBox: 'graph-search',
    activeSuggestion: -1,
    eras: null, // The eras on screen, kept for making the share image
    wrappedPeriod: null, // The year the Wrapped card's for ('2026', or 'all'). Starts on the latest year
    shareTheme: { ...themes[0] }, // The card's colours
    shareCovers: true, // Whether to look up the top artist's album cover
    coverCache: {}, // Covers looked up so far, by artist and album: { status, cover }
    zoomStack: [], // Where the date filter was before each zoom on the graph, for Zoom out
    excluded: [], // Anything left out of the stats, each { type, key, label }. Remembered between visits
    excludedKeys: { artist: {}, album: {}, song: {} },
    listType: 'song', // What's in the list on screen, and the keys in order, for clicking a row
    listKeys: [],
    searchIndex: {}, // Everything you can search for, built once on load
    names: {} // How to spell each artist/song/album key, also built once on load
};

// 2. The Initializer
export function calculateStats(songs) {
    console.log("Initializing Dashboard...");

    // Start the filters from scratch, in case this is a second upload (the dropdowns get reset too)
    appState.timeFilter = 'all';
    appState.monthFilter = 'all';
    appState.graphSeries = [];
    appState.zoomStack = [];
    appState.shown = 50;
    document.getElementById('month-range').classList.add('hidden');
    document.getElementById('custom-range').classList.add('hidden');

    // ts is in UTC, so work out the local year once here rather than on every filter change
    for (const song of songs) {
        const date = new Date(song.ts);
        song.localYear = String(date.getFullYear());
        song.localMonth = date.getMonth();
        song.playedAt = date.getTime();
    }
    appState.allData = songs;
    buildNameKeys(songs);
    buildSearchIndex(songs);
    loadExclusions();
    applyExclusions();
    loadCoverSetting();

    document.getElementById('bento-grid').classList.remove('hidden');
    document.getElementById('controls').classList.remove('hidden');

    setupYearOptions(songs);
    setupEventListeners();
    render();
}

// 3. The Render Logic
function render() {
    const viewport = document.getElementById('content-viewport');
    
    if (appState.currentView === 'wrapped') {
        appState.eras = buildEras(appState.data);
        const years = appState.eras.eras.map(era => era.label);
        if (appState.wrappedPeriod != 'all' && !years.includes(appState.wrappedPeriod)) {
            appState.wrappedPeriod = years.length > 0 ? years[years.length - 1] : 'all';
        }
        // The stat cards follow the year picked here rather than the (hidden) date filter
        updateBentoStats(wrappedRows());
        holdHeight(viewport, () => {
            viewport.innerHTML = wrappedHTML();
            redrawCards();
        });
        return;
    }

    // Filter data
    const filteredData = filterDataByTime(appState.data);

    // Update Header Stats
    updateBentoStats(filteredData);

    if (appState.currentView === 'graph') {
        holdHeight(viewport, () => {
            viewport.innerHTML = graphControlsHTML();
            showGraph(filteredData);
        });
        return;
    }

    // Generate List. Whatever's on the graph carries over, so it only shows those (like the date filter does)
    let listData = filteredData;
    if (appState.graphSeries.length > 0) {
        listData = filteredData.filter(song => appState.graphSeries.some(pick => matchesPick(song, pick)));
    }
    let sortedData = [];
    if (appState.listView === 'songs') {
        sortedData = topSongs(listData);
    } else if (appState.listView === 'artists') {
        sortedData = topArtists(listData);
    } else {
        sortedData = topAlbums(listData);
    }

    // Remember what's in the list so clicking a row knows what to put on the graph
    appState.listType = { songs: 'song', artists: 'artist', albums: 'album' }[appState.listView];
    appState.listKeys = sortedData.map(entry => entry[0]);

    viewport.innerHTML = listHeaderHTML() + generateListHTML(sortedData);
}

// 4. Helper to Filter Data
function filterDataByTime(data) {
    const bounds = getTimeBounds();
    if (bounds.from == null && bounds.to == null) return data;
    return data.filter(item =>
        (bounds.from == null || item.playedAt >= bounds.from) &&
        (bounds.to == null || item.playedAt < bounds.to)
    );
}

// Start and end of whatever time is picked, in local time. null means no limit that side
function getTimeBounds() {
    const year = appState.timeFilter;
    if (year == 'all') {
        return { from: null, to: null };
    }
    if (year == 'custom') {
        return { from: dateInputToMs(appState.customFrom), to: dateInputToMs(appState.customTo, true) };
    }

    const y = Number(year);
    if (appState.monthFilter == 'all') {
        return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() };
    }
    const m = Number(appState.monthFilter);
    return { from: new Date(y, m, 1).getTime(), to: new Date(y, m + 1, 1).getTime() };
}

// Date inputs give "2026-03-29", but new Date() reads that as UTC, so build it in local time instead
function dateInputToMs(value, endOfDay) {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    if (endOfDay) {
        return new Date(y, m - 1, d + 1).getTime(); // Start of the next day, so the end date counts
    }
    return new Date(y, m - 1, d).getTime();
}

// And the other way, for filling the date inputs in
function msToDateInput(ms) {
    const date = new Date(ms);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

// 5. Helper to Update Header
function updateBentoStats(data) {
    const totalMs = totalTime(data);
    document.getElementById('total-time-display').innerText = msToHours(totalMs);

    const songs = topSongs(data);
    const artists = topArtists(data);

    document.getElementById('top-song-display').innerText = songs.length > 0 ? songs[0][1].name : "-";
    document.getElementById('top-artist-display').innerText = artists.length > 0 ? artists[0][1].name : "-";
}

// The graph is empty for a moment while it's rebuilt, and measuring its width makes the browser
// lay the page out right then. The page is shorter for that moment, so the browser scrolls you
// up to fit, and doesn't scroll back once the graph's there. Holding the height stops it shrinking
function holdHeight(el, rebuild) {
    el.style.minHeight = `${el.offsetHeight}px`;
    rebuild();
    el.style.minHeight = '';
}

// Zooming in on the graph sets the date filter to whatever was clicked or dragged across.
// Each zoom remembers where it was before, so Zoom out goes back one step at a time
function zoomGraph(graph, from, to) {
    if (graph.unit == 'hour') return; // Can't go smaller than a day with the date filter
    const fromDate = msToDateInput(graph.buckets[from].start);
    const toDate = msToDateInput(graph.buckets[to].end - 1);
    if (appState.timeFilter == 'custom' && appState.customFrom == fromDate && appState.customTo == toDate) return;

    appState.zoomStack.push({
        timeFilter: appState.timeFilter,
        monthFilter: appState.monthFilter,
        customFrom: appState.customFrom,
        customTo: appState.customTo
    });
    appState.timeFilter = 'custom';
    appState.monthFilter = 'all';
    appState.customFrom = fromDate;
    appState.customTo = toDate;
    applyFilterUI();
    render();
}

function zoomOut() {
    const previous = appState.zoomStack.pop();
    if (!previous) return;
    appState.timeFilter = previous.timeFilter;
    appState.monthFilter = previous.monthFilter;
    appState.customFrom = previous.customFrom;
    appState.customTo = previous.customTo;
    applyFilterUI();
    render();
}

// Makes the date filter at the top show what's in appState, after zooming changes it
function applyFilterUI() {
    const isYear = appState.timeFilter != 'all' && appState.timeFilter != 'custom';
    document.getElementById('time-range').value = appState.timeFilter;
    document.getElementById('month-range').classList.toggle('hidden', !isYear);
    document.getElementById('month-range').value = appState.monthFilter;
    document.getElementById('custom-range').classList.toggle('hidden', appState.timeFilter != 'custom');
    document.getElementById('custom-from').value = appState.customFrom;
    document.getElementById('custom-to').value = appState.customTo;
}

// Back to how the date filter was before any zooming (for phones, which can't right-click to zoom out)
function resetZoom() {
    if (appState.zoomStack.length == 0) return;
    const original = appState.zoomStack[0];
    appState.zoomStack = [];
    appState.timeFilter = original.timeFilter;
    appState.monthFilter = original.monthFilter;
    appState.customFrom = original.customFrom;
    appState.customTo = original.customTo;
    applyFilterUI();
    render();
}

// Right-clicking a row in the lists: View in graph, View on Spotify, or Exclude.
// Opened by right-click, the menu key on a keyboard, or a long press on Android
let menuIndex = -1;
function openRowMenu(index, x, y) {
    menuIndex = index;
    const menu = document.getElementById('row-menu');
    menu.showPopover();
    // Keep it on screen if the click was near the edge
    const left = Math.min(x, window.innerWidth - menu.offsetWidth - 8);
    const top = Math.min(y, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.querySelector('button').focus();
}

function rowMenuAction(action) {
    document.getElementById('row-menu').hidePopover();
    const type = appState.listType;
    const key = appState.listKeys[menuIndex];
    if (key == null) return;
    const name = appState.names[type][key];
    const label = type == 'artist' ? name.name : `${name.name} - ${name.artist}`;

    if (action == 'graph') {
        graphFromList(menuIndex);
    } else if (action == 'spotify') {
        // Spotify's search finds it from the name and artist, e.g. "Animal Badflower"
        const search = type == 'artist' ? name.name : `${name.name} ${name.artist}`;
        window.open(`https://open.spotify.com/search/${encodeURIComponent(search)}`, '_blank', 'noopener');
    } else if (action == 'exclude') {
        addExclusion({ type: type, key: key, label: label });
    }
}


// Switches tab, same as clicking one of the tab buttons
function setView(view) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab == view));
    // Wrapped picks its own year, so the date filter would just be confusing there
    document.getElementById('date-filter').classList.toggle('hidden', view == 'wrapped');
    appState.currentView = view;
    appState.shown = 50;
    render();
}

// 6. Setup Event Listeners
// Only set them up once, otherwise pressing Process again doubles every click
let listenersSet = false;
function setupEventListeners() {
    if (listenersSet) return;
    listenersSet = true;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            setView(e.target.dataset.tab);
        });
    });

    document.getElementById('time-range').addEventListener('change', (e) => {
        appState.timeFilter = e.target.value;
        appState.zoomStack = [];
        const isYear = appState.timeFilter != 'all' && appState.timeFilter != 'custom';

        // Months only make sense with a year, and go back to all months when the year changes
        document.getElementById('month-range').classList.toggle('hidden', !isYear);
        document.getElementById('month-range').value = 'all';
        appState.monthFilter = 'all';

        document.getElementById('custom-range').classList.toggle('hidden', appState.timeFilter != 'custom');

        appState.shown = 50;
        render();
    });

    document.querySelectorAll('.metric-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            appState.metric = e.target.dataset.metric;
            document.querySelectorAll('.metric-btn').forEach(b => {
                b.classList.toggle('active', b == e.target);
                b.setAttribute('aria-pressed', b == e.target);
            });
            appState.shown = 50;
            render();
        });
    });

    document.getElementById('month-range').addEventListener('change', (e) => {
        appState.monthFilter = e.target.value;
        appState.zoomStack = [];
        appState.shown = 50;
        render();
    });

    document.getElementById('custom-from').addEventListener('change', (e) => {
        appState.customFrom = e.target.value;
        appState.zoomStack = [];
        appState.shown = 50;
        render();
    });

    document.getElementById('custom-to').addEventListener('change', (e) => {
        appState.customTo = e.target.value;
        appState.zoomStack = [];
        appState.shown = 50;
        render();
    });

    // The button gets rebuilt every render, so listen on the viewport instead of the button itself
    const viewport = document.getElementById('content-viewport');
    viewport.addEventListener('click', (e) => {
        if (e.target.id == 'show-more-btn') {
            appState.shown += 50;
            render();
        } else if (e.target.classList.contains('graph-chip-remove')) {
            removeGraphPick(Number(e.target.dataset.index));
        } else if (e.target.closest('.sub-tab')) {
            appState.listView = e.target.closest('.sub-tab').dataset.list;
            appState.shown = 50;
            render();
        } else if (e.target.closest('.list-item')) {
            graphFromList(Number(e.target.closest('.list-item').dataset.index));
        } else if (e.target.closest('.year-chip')) {
            setWrappedPeriod(e.target.closest('.year-chip').dataset.year);
        } else if (e.target.closest('.era-year')) {
            setWrappedPeriod(e.target.closest('.era-year').dataset.year);
            document.getElementById('controls').scrollIntoView({ behavior: 'smooth' }); // Back up to the card
        } else if (e.target.id == 'wrapped-customise') {
            openShareWindow();
        } else if (e.target.id == 'wrapped-download') {
            downloadShareImage();
        } else if (e.target.id == 'wrapped-share') {
            shareShareImage();
        } else if (e.target.id == 'graph-reset-zoom') {
            resetZoom();
        } else if (e.target.id == 'list-filter-clear') {
            appState.graphSeries = []; // Clears the graph too, it's the same filter
            render();
        } else if (e.target.id == 'graph-clear') {
            appState.graphSeries = [];
            render();
        }
    });

    // Right-click (or the menu key, or a long press on Android) on a list row opens its menu
    viewport.addEventListener('contextmenu', (e) => {
        const row = e.target.closest('.list-item');
        if (!row) return;
        e.preventDefault();
        // From the keyboard there's no mouse position, so put it by the row instead
        const box = row.getBoundingClientRect();
        const x = e.clientX || box.left + 40;
        const y = e.clientY || box.bottom;
        openRowMenu(Number(row.dataset.index), x, y);
    });
    document.getElementById('row-menu').addEventListener('click', (e) => {
        const item = e.target.closest('[data-action]');
        if (item) rowMenuAction(item.dataset.action);
    });

    // The search boxes (on the graph and in the exclude window) and their suggestions.
    // The exclude window isn't inside the viewport, so these listen on the whole page
    document.addEventListener('input', (e) => {
        if (searchBoxes[e.target.id]) showSuggestions(e.target.id, e.target.value);
    });
    document.addEventListener('keydown', (e) => {
        if (searchBoxes[e.target.id]) suggestionKeys(e);
    });
    // Clicking a suggestion would take focus off the search box (and close the list) before the click lands
    document.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.suggestion')) e.preventDefault();
    });
    document.addEventListener('focusout', (e) => {
        if (searchBoxes[e.target.id]) hideSuggestions(e.target.id);
    });
    document.addEventListener('click', (e) => {
        if (e.target.closest('.suggestion')) {
            pickSuggestion(Number(e.target.closest('.suggestion').dataset.index));
        } else if (e.target.classList.contains('exclude-remove')) {
            removeExclusion(Number(e.target.dataset.index));
        }
    });

    // The share window
    document.getElementById('theme-swatches').addEventListener('click', (e) => {
        const swatch = e.target.closest('.theme-swatch');
        if (!swatch) return;
        appState.shareTheme = { ...themes[Number(swatch.dataset.index)] };
        buildSwatches();
        setColourInputs();
        redrawCards();
    });
    for (const [id, part] of [['colour-top', 'top'], ['colour-bottom', 'bottom'], ['colour-text', 'text']]) {
        document.getElementById(id).addEventListener('input', (e) => {
            appState.shareTheme = { ...appState.shareTheme, name: 'Custom', [part]: e.target.value };
            buildSwatches(); // None of the presets will be lit up any more
            redrawCards();
        });
    }
    document.getElementById('share-photo').addEventListener('change', (e) => {
        appState.shareCovers = e.target.checked;
        saveCoverSetting();
        redrawCards();
    });
    document.getElementById('share-download').addEventListener('click', downloadShareImage);
    document.getElementById('share-native').addEventListener('click', shareShareImage);
    document.getElementById('share-close').addEventListener('click', () => {
        document.getElementById('share-dialog').close();
    });
    document.getElementById('share-dialog').addEventListener('close', redrawCards);

    // Both windows close with the x in the corner, or by clicking outside them. A click outside lands on the
    // dialog itself but outside its box. Only counts if the press started outside too, so dragging out of the
    // window (selecting text, say) doesn't close it
    document.querySelectorAll('dialog').forEach(dialog => {
        let pressedOutside = false;
        const outside = (e) => {
            const box = dialog.getBoundingClientRect();
            return e.target == dialog && (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom);
        };
        dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e); });
        dialog.addEventListener('click', (e) => {
            if (pressedOutside && outside(e)) dialog.close();
            pressedOutside = false;
        });
        dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    });

    // The exclude window
    document.getElementById('exclude-btn').addEventListener('click', () => {
        document.getElementById('settings-menu').hidePopover();
        openExcludeWindow();
    });

    // The settings menu opens in the middle of the screen by default, so put it under the gear instead
    const settingsMenu = document.getElementById('settings-menu');
    settingsMenu.addEventListener('toggle', (e) => {
        if (e.newState != 'open') return;
        const gear = document.getElementById('settings-btn').getBoundingClientRect();
        settingsMenu.style.top = `${gear.bottom + 8}px`;
        settingsMenu.style.left = `${Math.max(8, gear.right - settingsMenu.offsetWidth)}px`;
    });
    document.getElementById('exclude-clear').addEventListener('click', () => {
        // Asks first, since it's a saved list that might've taken a while to put together
        if (appState.excluded.length > 0 && confirm(`Stop excluding all ${appState.excluded.length}?`)) {
            appState.excluded = [];
            exclusionsChanged();
        }
    });
    document.getElementById('exclude-done').addEventListener('click', () => {
        document.getElementById('exclude-dialog').close();
    });

    // The graph is sized to fit, so redraw it when the window gets wider or narrower.
    // Only the width matters, and only the graph gets redrawn, not the search box: a phone
    // keyboard opening changes the height, and rebuilding the box would close the keyboard
    let resizeTimer = null;
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        if (appState.currentView != 'graph' || window.innerWidth == lastWidth) return;
        lastWidth = window.innerWidth;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            holdHeight(viewport, () => showGraph(filterDataByTime(appState.data)));
        }, 150);
    });
}

function setupYearOptions(data) {
    const years = new Set();
    data.forEach(item => {
        years.add(item.localYear);
    });
    
    const select = document.getElementById('time-range');
    select.innerHTML = '<option value="all">All Time</option>';
    
    Array.from(years).sort().reverse().forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.innerText = year;
        select.appendChild(option);
    });

    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.innerText = 'Custom range';
    select.appendChild(custom);

    // Start the custom range off as first play to last play
    let first = Infinity, last = -Infinity;
    for (const item of data) {
        if (item.playedAt < first) first = item.playedAt;
        if (item.playedAt > last) last = item.playedAt;
    }
    appState.firstPlay = first;
    appState.lastPlay = last;
    if (data.length > 0) {
        appState.customFrom = msToDateInput(first);
        appState.customTo = msToDateInput(last);
        for (const id of ['custom-from', 'custom-to']) {
            const input = document.getElementById(id);
            input.min = appState.customFrom;
            input.max = appState.customTo;
        }
        document.getElementById('custom-from').value = appState.customFrom;
        document.getElementById('custom-to').value = appState.customTo;
    }
}

// 7. Updated HTML Generator (Now includes Artist logic)
function generateListHTML(sortedData) {
    if (!sortedData.length) return `<p>No data found for this period.</p>`;
    
    let html = `<ol class="stats-list">`;

    for (let i = 0; i < appState.shown && i < sortedData.length; i++) {
        const stats = sortedData[i][1];
        const name = escapeHTML(stats.name);
        const count = stats.count;
        const timeMs = stats.time;
        // This will be undefined for the Artists tab, which is fine
        const artist = stats.artist; 

        const timeString = formatHoursAndMinutes(timeMs);

        // Whichever it's sorted by goes first
        const playsText = `${count.toLocaleString()} play${sOnEnd(count)}`;
        const timeText = `<em>${timeString}</em>`;
        const detail = appState.metric == 'time' ? `${timeText} &bull; ${playsText}` : `${playsText} &bull; ${timeText}`;

        // Build the main text: "Song Name" or "Song Name by Artist"
        let headerContent = `<strong>${name}</strong>`;
        if (artist) {
            headerContent += `<span style="color: #888; font-weight: normal;"> - ${escapeHTML(artist)}</span>`;
        }

        // The whole row's a button so it can be clicked (or tabbed to) to put it on the graph
        html += `<li>
                    <button class="list-item" data-index="${i}" title="Show on the graph">
                        ${headerContent}<br>
                        <span style="color: #b3b3b3; font-size: 0.9em;">
                            ${detail}
                        </span>
                    </button>
                 </li>`;
    }
    html += `</ol>`;

    if (sortedData.length > appState.shown) {
        html += `<button id="show-more-btn">Show more</button>`;
    }
    return html;
}

// The Songs / Artists / Albums switch above the list
function listHeaderHTML() {
    let buttons = '';
    for (const [value, text] of [['songs', 'Songs'], ['artists', 'Artists'], ['albums', 'Albums']]) {
        buttons += `<button type="button" class="sub-tab" data-list="${value}" aria-pressed="${appState.listView == value}">${text}</button>`;
    }
    // Says when the list's only showing what's on the graph, with a way back to everything
    let filter = '';
    if (appState.graphSeries.length > 0) {
        const names = appState.graphSeries.map(pick => `<strong>${escapeHTML(pick.label)}</strong>`).join(', ');
        filter = `<div class="list-filter">
                    <span>Only showing what's on the graph: ${names}</span>
                    <button id="list-filter-clear" type="button" class="secondary-btn">Clear</button>
                  </div>`;
    }
    return `<div class="list-header">
                <div class="sub-tabs" role="group" aria-label="Show">${buttons}</div>
                <p class="list-hint">Click anything to see it on the graph, or right-click for more.</p>
            </div>
            ${filter}`;
}

// 8. Custom Time Formatter
function formatHoursAndMinutes(ms) {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    // No point saying "0 hours" for a song you've played twice
    if (hours == 0) return `${remainingMinutes} minute${sOnEnd(remainingMinutes)}`;
    return `${hours.toLocaleString()} hour${sOnEnd(hours)}, ${remainingMinutes} minute${sOnEnd(remainingMinutes)}`;
}

// 9. Stops a song called "<b>hi</b>" turning into actual HTML
function escapeHTML(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

// 10. Graph view
const maxSeries = 8; // One per colour in the palette, a 9th line would need a made-up colour
const typeNames = { artist: 'Artist', album: 'Album', song: 'Song' };

function graphControlsHTML() {
    const full = appState.graphSeries.length >= maxSeries;
    const placeholder = full ? `That's as many as it can show, remove one to add another`
                             : `Add an artist, album or song to the graph...`;
    // Only worth having once there's something to clear
    const clear = appState.graphSeries.length > 0 ? `<button id="graph-clear" type="button">Clear all</button>` : '';

    return `<div class="graph-controls">
                <div class="graph-search-wrap">
                    <input id="graph-search" placeholder="${placeholder}" autocomplete="off"${full ? ' disabled' : ''}
                           role="combobox" aria-label="Add to the graph" aria-autocomplete="list"
                           aria-expanded="false" aria-controls="graph-suggestions">
                    <ul id="graph-suggestions" class="suggestions hidden" role="listbox"></ul>
                </div>
                ${clear}
            </div>
            <div class="graph-tools">
                <p class="list-hint">Click or drag across the graph to zoom in, right-click to zoom out.</p>
                ${appState.zoomStack.length > 0 ? '<button id="graph-reset-zoom" type="button" class="secondary-btn">Reset zoom</button>' : ''}
            </div>
            <div id="graph-area" class="graph-card"></div>`;
}

function showGraph(data) {
    // Use the picked time range, but don't go past the first or last play
    const bounds = getTimeBounds();
    const from = Math.max(bounds.from == null ? -Infinity : bounds.from, appState.firstPlay);
    const to = Math.min(bounds.to == null ? Infinity : bounds.to, appState.lastPlay + 1);

    const area = document.getElementById('graph-area');
    if (from >= to) {
        area.textContent = 'No listens in this period.';
        return;
    }

    // Nothing picked means one line for everything, otherwise a line for each pick
    let seriesRows = [];
    let seriesInfo = [];
    if (appState.graphSeries.length == 0) {
        seriesRows.push(data);
        seriesInfo.push({ label: 'everything', type: '', colour: 'var(--series-everything)', removable: false });
    } else {
        for (const pick of appState.graphSeries) {
            seriesRows.push(data.filter(song => matchesPick(song, pick)));
            seriesInfo.push({ label: pick.label, type: typeNames[pick.type], colour: `var(--series-${pick.colour})`, removable: true });
        }
    }
    const graph = buildGraphData(seriesRows, from, to);
    drawGraph(area, graph, seriesInfo, appState.metric, (start, end) => zoomGraph(graph, start, end), zoomOut);
}

// Uses the same lowercase keys as the lists, so this ignores capitals too
function matchesPick(song, pick) {
    if (pick.type == 'artist') return song.artistKey == pick.key;
    if (pick.type == 'album') return song.albumKey == pick.key;
    return song.songKey == pick.key;
}

function isPicked(type, key) {
    for (const pick of appState.graphSeries) {
        if (pick.type == type && pick.key == key) return true;
    }
    return false;
}

// The first colour nobody's using, so lines keep their colour when another one gets removed
function freeColour() {
    for (let c = 1; c <= maxSeries; c++) {
        let used = false;
        for (const pick of appState.graphSeries) {
            if (pick.colour == c) used = true;
        }
        if (!used) return c;
    }
    return maxSeries;
}

// Adds a line to the graph, unless it's already on there or the graph's full. Says whether it did
function addPickByKey(type, key, label) {
    if (appState.graphSeries.length >= maxSeries || isPicked(type, key)) return false;
    appState.graphSeries.push({ type: type, key: key, label: label, colour: freeColour() });
    return true;
}

// The search boxes that suggest artists/albums/songs: where their list is, what to leave out, and what picking one does
const searchBoxes = {
    'graph-search': {
        list: 'graph-suggestions',
        skip: item => isPicked(item.type, item.key) || isExcluded(item.type, item.key),
        pick: item => {
            addPickByKey(item.type, item.key, item.label);
            render();
            // Straight back into the search box so you can add another
            const search = document.getElementById('graph-search');
            if (search && !search.disabled) search.focus();
        }
    },
    'exclude-search': {
        list: 'exclude-suggestions',
        skip: item => isExcluded(item.type, item.key),
        pick: item => {
            addExclusion(item);
            const search = document.getElementById('exclude-search');
            search.value = '';
            hideSuggestions('exclude-search');
            search.focus();
        }
    }
};

// Picking one of the suggestions under whichever search box is open
function pickSuggestion(index) {
    const item = appState.suggestions[index];
    if (!item) return;
    searchBoxes[appState.suggestBox].pick(item);
}

// From clicking a row in one of the lists. Adds it to whatever's already on the graph and switches to it
function graphFromList(index) {
    const type = appState.listType;
    const key = appState.listKeys[index];
    const name = appState.names[type][key];
    const label = type == 'artist' ? name.name : `${name.name} - ${name.artist}`;
    addPickByKey(type, key, label);

    // If you'd scrolled down the list, jump back up to where the graph starts
    const graphTop = document.getElementById('bento-grid').getBoundingClientRect().bottom + window.scrollY;
    setView('graph');
    if (window.scrollY > graphTop) window.scrollTo({ top: graphTop });
}

function removeGraphPick(index) {
    appState.graphSeries.splice(index, 1);
    render();
}

// Everything you can search for. Each list is most played first, so the suggestions are useful
function buildSearchIndex(songs) {
    appState.searchIndex = { artist: [], album: [], song: [] };
    for (const [key, stats] of topArtists(songs)) {
        appState.searchIndex.artist.push({ type: 'artist', key: key, label: stats.name, name: stats.name, artist: '',
                                           search: stats.name.toLowerCase() });
    }
    for (const [key, stats] of topAlbums(songs)) {
        const label = `${stats.name} - ${stats.artist}`;
        appState.searchIndex.album.push({ type: 'album', key: key, label: label, name: stats.name, artist: stats.artist,
                                          search: label.toLowerCase() });
    }
    for (const [key, stats] of topSongs(songs)) {
        const label = `${stats.name} - ${stats.artist}`;
        appState.searchIndex.song.push({ type: 'song', key: key, label: label, name: stats.name, artist: stats.artist,
                                         search: label.toLowerCase() });
    }
}

// Searches artists, albums and songs all at once, so there's no picking which you're after first.
// Every word you type has to be in there somewhere ("overcompensate twenty" finds it), and
// the order is: names that start with what you typed, then artists, albums, songs, then most played.
// skip says what to leave out (already on the graph, already excluded, etc)
function findSuggestions(text, skip = searchBoxes['graph-search'].skip) {
    const search = text.trim().toLowerCase();
    const types = ['artist', 'album', 'song'];

    // Nothing typed yet, so just show a few of the most played of each
    if (search == '') {
        let found = [];
        const howMany = { artist: 4, album: 3, song: 3 };
        for (const type of types) {
            let count = 0;
            for (const item of appState.searchIndex[type]) {
                if (count == howMany[type]) break;
                if (skip(item)) continue;
                found.push(item);
                count++;
            }
        }
        return found;
    }

    const words = search.split(/\s+/);
    let candidates = [];
    for (let t = 0; t < types.length; t++) {
        // The best 10 that start with it and the best 10 that just contain it, from each type
        let starts = 0, contains = 0;
        const index = appState.searchIndex[types[t]];
        for (let i = 0; i < index.length && (starts < 10 || contains < 10); i++) {
            const item = index[i];
            if (!words.every(word => item.search.includes(word))) continue;
            if (skip(item)) continue;
            const startsWith = item.name.toLowerCase().startsWith(search);
            if (startsWith && starts < 10) {
                candidates.push({ item: item, score: t, rank: i });
                starts++;
            } else if (!startsWith && contains < 10) {
                candidates.push({ item: item, score: 3 + t, rank: i });
                contains++;
            }
        }
    }
    candidates.sort((a, b) => a.score - b.score || a.rank - b.rank);
    return candidates.slice(0, 10).map(c => c.item);
}

function showSuggestions(boxId, text) {
    const box = searchBoxes[boxId];
    const list = document.getElementById(box.list);
    const input = document.getElementById(boxId);
    if (!list || !input) return;
    appState.suggestBox = boxId;
    appState.suggestions = findSuggestions(text, box.skip);
    appState.activeSuggestion = -1;
    input.removeAttribute('aria-activedescendant');
    list.innerHTML = '';

    if (appState.suggestions.length == 0) {
        if (text.trim() == '') {
            hideSuggestions(boxId);
            return;
        }
        const none = document.createElement('li');
        none.className = 'suggestion-none';
        none.textContent = 'Nothing matches that';
        list.appendChild(none);
    }

    // Built with textContent rather than HTML strings, so names can't turn into markup
    for (let i = 0; i < appState.suggestions.length; i++) {
        const item = appState.suggestions[i];
        const li = document.createElement('li');
        li.className = 'suggestion';
        li.id = `${box.list}-${i}`; // Named after the list, so two lists on the page don't clash
        li.dataset.index = i;
        li.setAttribute('role', 'option');

        const name = document.createElement('span');
        name.className = 'suggestion-name';
        name.textContent = item.name;
        li.appendChild(name);
        if (item.artist) {
            const artist = document.createElement('span');
            artist.className = 'suggestion-artist';
            artist.textContent = item.artist;
            li.appendChild(artist);
        }
        // Says what it is, so a title track and its album can be told apart
        const type = document.createElement('span');
        type.className = 'suggestion-type';
        type.textContent = typeNames[item.type];
        li.appendChild(type);

        list.appendChild(li);
    }
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
}

function hideSuggestions(boxId) {
    const list = document.getElementById(searchBoxes[boxId].list);
    const input = document.getElementById(boxId);
    if (list) list.classList.add('hidden');
    if (input) {
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    }
    appState.activeSuggestion = -1;
}

function setActiveSuggestion(boxId, i) {
    const listId = searchBoxes[boxId].list;
    appState.activeSuggestion = i;
    document.getElementById(listId).querySelectorAll('.suggestion').forEach(li => li.classList.toggle('active', Number(li.dataset.index) == i));
    document.getElementById(boxId).setAttribute('aria-activedescendant', `${listId}-${i}`);
    document.getElementById(`${listId}-${i}`).scrollIntoView({ block: 'nearest' });
}

// Up/down to move through the suggestions (down also opens them), Enter to pick
// (the top one if you haven't moved), Escape to close
function suggestionKeys(e) {
    const boxId = e.target.id;
    const list = document.getElementById(searchBoxes[boxId].list);
    const open = list && !list.classList.contains('hidden') && appState.suggestBox == boxId;
    const count = appState.suggestions.length;

    if (e.key == 'ArrowDown' || e.key == 'ArrowUp') {
        e.preventDefault();
        if (!open) {
            showSuggestions(boxId, e.target.value);
            return;
        }
        if (count == 0) return;
        let i = appState.activeSuggestion + (e.key == 'ArrowDown' ? 1 : -1);
        if (i < 0) i = count - 1;
        if (i >= count) i = 0;
        setActiveSuggestion(boxId, i);
    } else if (e.key == 'Enter') {
        if (open && count > 0) {
            e.preventDefault();
            pickSuggestion(appState.activeSuggestion == -1 ? 0 : appState.activeSuggestion);
        }
    } else if (e.key == 'Escape') {
        // In the exclude window Escape would also close the window, so the first one just closes the list
        if (open) {
            e.preventDefault();
            hideSuggestions(boxId);
        }
    }
}

// 11. Eras
// Your top artists for each year, from all your data (the Wrapped tab has its own year picker,
// so this doesn't follow the date filter)
function buildEras(data) {
    const from = appState.firstPlay;
    const to = appState.lastPlay + 1;

    const groups = {};
    for (const song of data) {
        if (!song.master_metadata_track_name) continue;
        if (!groups[song.localYear]) groups[song.localYear] = [];
        groups[song.localYear].push(song);
    }

    let eras = [];
    for (const year of Object.keys(groups).sort()) {
        const top = topArtists(groups[year]).slice(0, 5);
        if (top.length == 0) continue; // Nothing but podcasts that year, so skip it
        const start = new Date(Number(year), 0, 1);
        const end = new Date(Number(year) + 1, 0, 1);
        eras.push({
            label: year,
            start: start.getTime(),
            end: end.getTime(),
            top: top,
            partial: start.getTime() < from || end.getTime() > to // Only some of it's in your data, like this year so far
        });
    }
    return { unit: 'year', eras: eras, from: from, to: to };
}

function eraValue(stats) {
    if (appState.metric == 'time') {
        const hours = Math.round(stats.time / (1000*60*60));
        return `${hours.toLocaleString()} hr${sOnEnd(hours)}`;
    }
    return `${stats.count.toLocaleString()} play${sOnEnd(stats.count)}`;
}

function erasHTML(result) {
    if (result.eras.length == 0) return `<p>No data found.</p>`;

    let html = `<h3 class="eras-title">Your eras</h3>
                <p class="list-hint eras-hint">Your top artists year by year. Click a year to see its card.</p>
                <div class="eras-grid">`;
    // Most recent first
    for (const era of result.eras.slice().reverse()) {
        const selected = appState.wrappedPeriod == era.label;
        html += `<section class="era-card${selected ? ' selected' : ''}">
                    <h3><button type="button" class="era-year" data-year="${era.label}">${escapeHTML(era.label)}</button>${era.partial ? ' <span class="era-partial">(partial)</span>' : ''}</h3>
                    <ol>`;
        for (let i = 0; i < era.top.length; i++) {
            const stats = era.top[i][1];
            html += `<li${i == 0 ? ' class="era-top"' : ''}>
                        <span class="era-name">${escapeHTML(stats.name)}</span>
                        <span class="era-value">${eraValue(stats)}</span>
                     </li>`;
        }
        html += `</ol></section>`;
    }
    return html + `</div>`;
}

// 12. The Wrapped tab: a card for a year (or all time) to share. The drawing's in share.js
// The plays for the year that's picked, or everything
function wrappedRows() {
    if (appState.wrappedPeriod == 'all') return appState.data;
    return appState.data.filter(song => song.localYear == appState.wrappedPeriod);
}

// All your years in a few characters, for the card: "2020–2026"
function rangeLabel() {
    const first = new Date(appState.firstPlay).getFullYear();
    const last = new Date(appState.lastPlay).getFullYear();
    return first == last ? String(first) : `${first}–${last}`;
}

// What goes on the card: the same things as Wrapped (bar genre, which Spotify's data doesn't have,
// so it's top album instead), plus the cover of the top artist's own top album if it's been found
function currentCard() {
    const rows = wrappedRows();
    const topArtistList = topArtists(rows);
    const artists = topArtistList.slice(0, 5).map(entry => entry[1].name);
    const topAlbum = topAlbums(rows)[0];

    // The top artist's most played album, which is what the cover's of
    let artistAlbum = null;
    if (topArtistList.length > 0) {
        const artistKey = topArtistList[0][0];
        const theirs = topAlbums(rows.filter(song => song.artistKey == artistKey))[0];
        if (theirs) artistAlbum = theirs[1].name;
    }
    const lookup = appState.shareCovers && artistAlbum ? appState.coverCache[coverKey(artists[0], artistAlbum)] : null;

    return {
        label: appState.wrappedPeriod == 'all' ? rangeLabel() : appState.wrappedPeriod,
        artists: artists,
        songs: topSongs(rows).slice(0, 5).map(entry => entry[1].name),
        minutes: Math.round(totalTime(rows) / 60000),
        topAlbum: topAlbum ? topAlbum[1].name : '-',
        artistAlbum: artistAlbum,
        cover: lookup && lookup.status == 'found' ? lookup.cover : null
    };
}

function coverKey(artist, album) {
    return `${artist}\n${album}`;
}

function wrappedHTML() {
    const years = appState.eras.eras.map(era => era.label).reverse();
    let chips = '';
    for (const year of years.concat('all')) {
        chips += `<button type="button" class="year-chip" data-year="${year}" aria-pressed="${appState.wrappedPeriod == year}">${year == 'all' ? 'All time' : year}</button>`;
    }
    return `<div class="wrapped-top">
                <canvas id="wrapped-canvas" class="card-preview" role="img" aria-label="Your Wrapped card"></canvas>
                <div class="wrapped-side">
                    <h3>Your Wrapped</h3>
                    <div class="year-chips" role="group" aria-label="Year">${chips}</div>
                    <p id="photo-status" class="photo-status"></p>
                    <div class="wrapped-actions">
                        <button id="wrapped-share" type="button" class="hidden">Share</button>
                        <button id="wrapped-download" type="button">Download</button>
                        <button id="wrapped-customise" type="button" class="secondary-btn">Customise</button>
                    </div>
                </div>
            </div>
            ${erasHTML(appState.eras)}`;
}

// Draws the card on the Wrapped tab, and in the Customise window if it's open,
// then looks for a photo if it hasn't yet
function redrawCards() {
    const card = currentCard();
    for (const id of ['wrapped-canvas', 'share-canvas']) {
        const canvas = document.getElementById(id);
        if (!canvas) continue;
        if (id == 'share-canvas' && !document.getElementById('share-dialog').open) continue;
        drawCard(canvas, card, appState.shareTheme);
    }
    // Start looking first, so the status line can say it's looking
    if (card.artistAlbum) lookForCover(card.artists[0], card.artistAlbum);
    updateCoverStatus(card);
    makeShareFile();
}

// Looks up the cover of the top artist's top album, one at a time.
// Found or not, the answer's remembered. If it fails, it's forgotten after a bit so it can be tried again
let coverQueue = Promise.resolve();
function lookForCover(artist, album) {
    const key = coverKey(artist, album);
    if (!appState.shareCovers || appState.coverCache[key]) return;
    appState.coverCache[key] = { status: 'looking' };
    coverQueue = coverQueue.then(async () => {
        try {
            const cover = await findAlbumCover(artist, album);
            appState.coverCache[key] = cover ? { status: 'found', cover: cover } : { status: 'none' };
        } catch (err) {
            console.error(`Couldn't look up the cover of ${album} by ${artist}:`, err);
            appState.coverCache[key] = { status: 'failed' };
            setTimeout(() => {
                if (appState.coverCache[key] && appState.coverCache[key].status == 'failed') delete appState.coverCache[key];
            }, 30000);
        }
        // Only redraw if it's still the same card on screen
        const now = currentCard();
        if (now.artists[0] == artist && now.artistAlbum == album) redrawCards();
    });
}

function updateCoverStatus(card) {
    const status = document.getElementById('photo-status');
    if (!status) return;
    const lookup = appState.shareCovers && card.artistAlbum ? appState.coverCache[coverKey(card.artists[0], card.artistAlbum)] : null;
    let text = '';
    if (lookup) {
        if (lookup.status == 'looking') text = `Looking for the cover of ${card.artistAlbum}...`;
        else if (lookup.status == 'none') text = `Couldn't find the cover of ${card.artistAlbum}, so it's ${card.artists[0]}'s name instead.`;
        else if (lookup.status == 'failed') text = `Couldn't look for the cover just now, so it's ${card.artists[0]}'s name instead.`;
        else if (lookup.status == 'unusable') text = `The cover of ${card.artistAlbum} couldn't be used, so it's ${card.artists[0]}'s name instead.`;
    }
    status.textContent = text;
}

// Whether to look for covers is remembered, like exclusions, so turning it off sticks.
// In try for the same reason: private browsing can make localStorage throw
function loadCoverSetting() {
    try {
        appState.shareCovers = localStorage.getItem('unwrapper-covers') != 'off';
    } catch (err) {
        appState.shareCovers = true;
    }
}

function saveCoverSetting() {
    try {
        localStorage.setItem('unwrapper-covers', appState.shareCovers ? 'on' : 'off');
    } catch (err) {
        // Can't save, it'll just be on again next time
    }
}

function setWrappedPeriod(period) {
    appState.wrappedPeriod = period;
    render();
}

// The Customise window: colours, and whether to look for a photo
function openShareWindow() {
    buildSwatches();
    setColourInputs();
    document.getElementById('share-photo').checked = appState.shareCovers;
    document.getElementById('share-dialog').showModal();
    redrawCards();
}

// The preset colour buttons
function buildSwatches() {
    const holder = document.getElementById('theme-swatches');
    holder.innerHTML = '';
    for (let i = 0; i < themes.length; i++) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'theme-swatch';
        swatch.dataset.index = i;
        swatch.style.background = `linear-gradient(135deg, ${themes[i].top}, ${themes[i].bottom})`;
        swatch.setAttribute('aria-label', themes[i].name);
        swatch.title = themes[i].name;
        swatch.setAttribute('aria-pressed', sameColours(themes[i], appState.shareTheme));
        holder.appendChild(swatch);
    }
}

function sameColours(a, b) {
    return a.top == b.top && a.bottom == b.bottom && a.text == b.text;
}

function setColourInputs() {
    document.getElementById('colour-top').value = appState.shareTheme.top;
    document.getElementById('colour-bottom').value = appState.shareTheme.bottom;
    document.getElementById('colour-text').value = appState.shareTheme.text;
}

// Makes the PNG a moment after drawing. It's made ahead of time because phones only let
// a page share if it does it straight away when the button's pressed
let shareFile = null;
let blobTimer = null;
function makeShareFile() {
    shareFile = null;
    updateShareButtons();
    clearTimeout(blobTimer);
    blobTimer = setTimeout(() => {
        const canvas = document.getElementById('wrapped-canvas') || document.getElementById('share-canvas');
        if (!canvas) return;
        try {
            canvas.toBlob(blob => {
                if (!blob) return;
                const name = `unwrapper-${currentCard().label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
                shareFile = new File([blob], name, { type: 'image/png' });
                updateShareButtons();
            }, 'image/png');
        } catch (err) {
            // A browser won't let a picture be saved if an image on it came from somewhere that didn't allow it.
            // Shouldn't happen with iTunes, but if it does, drop the cover rather than leave Download dead
            console.error("Couldn't save the card with that cover on:", err);
            const card = currentCard();
            const key = card.artistAlbum ? coverKey(card.artists[0], card.artistAlbum) : null;
            if (key && appState.coverCache[key]) {
                appState.coverCache[key] = { status: 'unusable' };
                redrawCards();
            }
        }
    }, 150);
}

// Share only shows if the browser can actually share files (most phones, hardly any computers)
function updateShareButtons() {
    const canShare = shareFile != null && navigator.canShare && navigator.canShare({ files: [shareFile] });
    for (const id of ['wrapped-download', 'share-download']) {
        const button = document.getElementById(id);
        if (button) button.disabled = shareFile == null;
    }
    for (const id of ['wrapped-share', 'share-native']) {
        const button = document.getElementById(id);
        if (button) button.classList.toggle('hidden', !canShare);
    }
}

function downloadShareImage() {
    if (!shareFile) return;
    const url = URL.createObjectURL(shareFile);
    const link = document.createElement('a');
    link.href = url;
    link.download = shareFile.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function shareShareImage() {
    if (!shareFile) return;
    navigator.share({ files: [shareFile], title: 'My Unwrapped', text: 'Made with unwrapper.cjones.cymru' })
        .catch(() => {}); // Closing the share menu counts as an error, which isn't worth mentioning
}

// 13. Excluding things from the stats
// Anything excluded gets taken out of the data everything else works from, so all the numbers agree
const excludedStorageKey = 'unwrapper-excluded';

function applyExclusions() {
    const keys = { artist: {}, album: {}, song: {} };
    for (const ex of appState.excluded) keys[ex.type][ex.key] = true;
    appState.excludedKeys = keys;
    appState.data = appState.allData.filter(song => !isExcludedSong(song));
    // A line on the graph for something that's now excluded would just be flat, so take it off
    appState.graphSeries = appState.graphSeries.filter(pick => !keys[pick.type][pick.key]);
    updateExcludeButton();
}

function isExcluded(type, key) {
    return appState.excludedKeys[type][key] == true;
}

// Excluding an artist takes out all their songs and albums, an album takes out its songs
function isExcludedSong(song) {
    const keys = appState.excludedKeys;
    return keys.artist[song.artistKey] == true || keys.album[song.albumKey] == true || keys.song[song.songKey] == true;
}

function addExclusion(item) {
    if (isExcluded(item.type, item.key)) return;
    appState.excluded.push({ type: item.type, key: item.key, label: item.label });
    exclusionsChanged();
}

function removeExclusion(index) {
    appState.excluded.splice(index, 1);
    exclusionsChanged();
}

function exclusionsChanged() {
    saveExclusions();
    applyExclusions();
    renderExcludeList();
    render();
}

// Kept in the browser so they're still there next time. Wrapped in try because private
// browsing (or blocked storage) can make localStorage throw, in which case they're just forgotten
function loadExclusions() {
    try {
        const saved = JSON.parse(localStorage.getItem(excludedStorageKey) || '[]');
        if (Array.isArray(saved)) {
            appState.excluded = saved.filter(ex => ex && typeNames[ex.type] && typeof ex.key == 'string' && typeof ex.label == 'string');
        }
    } catch (err) {
        appState.excluded = [];
    }
}

function saveExclusions() {
    try {
        localStorage.setItem(excludedStorageKey, JSON.stringify(appState.excluded));
    } catch (err) {
        // Can't save, never mind, it'll still work until the tab's closed
    }
}

function updateExcludeButton() {
    const button = document.getElementById('exclude-btn');
    if (!button) return;
    const count = appState.excluded.length;
    button.textContent = count > 0 ? `Excluded (${count})` : 'Exclude';
    button.classList.toggle('has-exclusions', count > 0);
    const dot = document.getElementById('settings-dot');
    if (dot) dot.classList.toggle('hidden', count == 0);
}

function renderExcludeList() {
    const list = document.getElementById('exclude-list');
    if (!list) return;
    list.innerHTML = '';
    const clear = document.getElementById('exclude-clear');
    if (clear) clear.classList.toggle('hidden', appState.excluded.length == 0);
    if (appState.excluded.length == 0) {
        const none = document.createElement('li');
        none.className = 'exclude-none';
        none.textContent = 'Nothing excluded yet.';
        list.appendChild(none);
        return;
    }
    for (let i = 0; i < appState.excluded.length; i++) {
        const ex = appState.excluded[i];
        const chip = document.createElement('li');
        chip.className = 'graph-chip';
        const name = document.createElement('span');
        name.textContent = ex.label;
        chip.appendChild(name);
        const type = document.createElement('span');
        type.className = 'graph-chip-detail';
        type.textContent = typeNames[ex.type];
        chip.appendChild(type);
        const remove = document.createElement('button');
        remove.className = 'graph-chip-remove exclude-remove';
        remove.type = 'button';
        remove.dataset.index = i;
        remove.setAttribute('aria-label', `Stop excluding ${ex.label}`);
        remove.textContent = '×';
        chip.appendChild(remove);
        list.appendChild(chip);
    }
}

function openExcludeWindow() {
    renderExcludeList();
    const search = document.getElementById('exclude-search');
    search.value = '';
    hideSuggestions('exclude-search');
    document.getElementById('exclude-dialog').showModal();
    search.focus();
}

// --- DATA PROCESSORS (Updated to capture Artist name) ---

// Spotify only counts it as a play after 30 seconds, anything less is a skip
const minPlayMs = 30000;

function totalTime(songs) {
    // Podcasts and audiobooks don't have a track name, so they don't count
    return songs.reduce((acc, song) => {
        if (!song.master_metadata_track_name) return acc;
        return acc + (song.ms_played || 0);
    }, 0);
}

// Spotify and Navidrome don't always agree on capitals ("Bring Me The Horizon" vs "Bring Me the Horizon"),
// so everything's grouped by a lowercase key. They're worked out once on load rather than every render,
// and each key shows whichever spelling turns up most across all the data, so names don't change with the filter
function buildNameKeys(songs) {
    const spellings = { artist: {}, song: {}, album: {} };
    for (const song of songs) {
        const artist = song.master_metadata_album_artist_name;
        const track = song.master_metadata_track_name;
        const album = song.master_metadata_album_album_name;
        if (artist) {
            song.artistKey = artist.toLowerCase();
            countSpelling(spellings.artist, song.artistKey, artist, { name: artist });
        }
        if (track) {
            // Key on artist too, otherwise every song called "Intro" gets lumped together
            song.songKey = `${artist}\n${track}`.toLowerCase();
            countSpelling(spellings.song, song.songKey, `${artist}\n${track}`, { name: track, artist: artist });
        }
        if (album) {
            // Same as songs, loads of artists have an album called "Greatest Hits"
            song.albumKey = `${artist}\n${album}`.toLowerCase();
            countSpelling(spellings.album, song.albumKey, `${artist}\n${album}`, { name: album, artist: artist });
        }
    }

    appState.names = { artist: {}, song: {}, album: {} };
    for (const type in spellings) {
        for (const key in spellings[type]) {
            appState.names[type][key] = commonest(spellings[type][key]);
        }
    }
}

function countSpelling(counts, key, spelling, parts) {
    if (!counts[key]) counts[key] = {};
    if (!counts[key][spelling]) counts[key][spelling] = { n: 0, parts: parts };
    counts[key][spelling].n++;
}

function commonest(spellings) {
    let best = null;
    for (const spelling in spellings) {
        if (best == null || spellings[spelling].n > best.n) best = spellings[spelling];
    }
    return best.parts;
}

function topSongs(songs) {
    const stats = {};
    for (const song of songs) {
        const key = song.songKey;
        if (key) {
            if (!stats[key]) stats[key] = { 
                name: appState.names.song[key].name,
                count: 0, 
                time: 0, 
                artist: appState.names.song[key].artist 
            };
            if (song.ms_played >= minPlayMs) stats[key].count++;
            stats[key].time += song.ms_played || 0;
        }
    }
    return sortByMetric(stats);
}

function topArtists(songs) {
    const stats = {};
    for (const song of songs) {
        const key = song.artistKey;
        if (key) {
            if (!stats[key]) stats[key] = { name: appState.names.artist[key].name, count: 0, time: 0 }; // No artist line needed, it's the name
            if (song.ms_played >= minPlayMs) stats[key].count++;
            stats[key].time += song.ms_played || 0;
        }
    }
    return sortByMetric(stats);
}

function topAlbums(songs) {
    const stats = {};
    for (const song of songs) {
        const key = song.albumKey;
        if (key) {
            if (!stats[key]) stats[key] = { 
                name: appState.names.album[key].name,
                count: 0, 
                time: 0, 
                artist: appState.names.album[key].artist 
            };
            if (song.ms_played >= minPlayMs) stats[key].count++;
            stats[key].time += song.ms_played || 0;
        }
    }
    return sortByMetric(stats);
}

// Most plays first, or most time first, depending on the Plays/Time toggle
function sortByMetric(stats) {
    const field = appState.metric == 'time' ? 'time' : 'count';
    return Object.entries(stats).sort((a, b) => b[1][field] - a[1][field]);
}
