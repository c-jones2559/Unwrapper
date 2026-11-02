import { msToHours, sOnEnd } from './timeBits.js?v=2';
import { buildGraphData, drawGraph } from './graph.js?v=2';

// 1. The Global State
let appState = {
    allData: [],
    currentView: 'songs',
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
    graphType: 'artist', // What the search box is searching for: 'artist', 'album' or 'song'
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
    appState.graphType = 'artist';
    appState.graphSeries = [];
    appState.shown = 50;
    document.getElementById('month-range').classList.add('hidden');
    document.getElementById('custom-range').classList.add('hidden');

    // ts is in UTC, so work out the local year once here rather than on every filter change
    for (const song of songs) {
        const date = new Date(song.ts);
        song.localYear = String(date.getFullYear());
        song.playedAt = date.getTime();
    }
    appState.allData = songs;
    buildNameKeys(songs);
    buildSearchIndex(songs);

    document.getElementById('bento-grid').classList.remove('hidden');
    document.getElementById('controls').classList.remove('hidden');

    setupYearOptions(songs);
    setupEventListeners();
    render();
}

// 3. The Render Logic
function render() {
    const viewport = document.getElementById('content-viewport');
    
    // Filter data
    const filteredData = filterDataByTime(appState.allData);
    
    // Update Header Stats
    updateBentoStats(filteredData);

    if (appState.currentView === 'graph') {
        viewport.innerHTML = graphControlsHTML();
        showGraph(filteredData);
        return;
    }

    // Generate List
    let listHTML = "";
    let sortedData = [];

    if (appState.currentView === 'songs') {
        sortedData = topSongs(filteredData);
        listHTML = generateListHTML(sortedData);
    } else if (appState.currentView === 'artists') {
        sortedData = topArtists(filteredData);
        listHTML = generateListHTML(sortedData);
    } else if (appState.currentView === 'albums') {
        sortedData = topAlbums(filteredData);
        listHTML = generateListHTML(sortedData);
    }

    // Remember what's in the list so clicking a row knows what to put on the graph
    appState.listType = { songs: 'song', artists: 'artist', albums: 'album' }[appState.currentView];
    appState.listKeys = sortedData.map(entry => entry[0]);

    viewport.innerHTML = listHTML;
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

// Switches tab, same as clicking one of the tab buttons
function setView(view) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab == view));
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
        appState.shown = 50;
        render();
    });

    document.getElementById('custom-from').addEventListener('change', (e) => {
        appState.customFrom = e.target.value;
        appState.shown = 50;
        render();
    });

    document.getElementById('custom-to').addEventListener('change', (e) => {
        appState.customTo = e.target.value;
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
        } else if (e.target.closest('.list-item')) {
            graphFromList(Number(e.target.closest('.list-item').dataset.index));
        }
    });

    // Same idea for the graph's artist/album/song search
    viewport.addEventListener('change', (e) => {
        if (e.target.id == 'graph-type') {
            // Only changes what the search looks for, everything already picked stays on the graph
            appState.graphType = e.target.value;
            render();
        } else if (e.target.id == 'graph-search') {
            addGraphPick(e.target.value);
        }
    });
    viewport.addEventListener('input', (e) => {
        if (e.target.id == 'graph-search') {
            // Clicking a suggestion comes through as an input event, not a change one (in Chrome anyway)
            if (e.inputType == 'insertReplacementText' || !(e instanceof InputEvent)) {
                addGraphPick(e.target.value);
            } else {
                fillSuggestions(e.target.value);
            }
        }
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
        resizeTimer = setTimeout(() => showGraph(filterDataByTime(appState.allData)), 150);
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
    
    let html = `<p class="list-hint">Click anything to see it on the graph.</p>
                <ol class="stats-list">`;

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
    let options = '';
    for (const value in typeNames) {
        options += `<option value="${value}"${appState.graphType == value ? ' selected' : ''}>${typeNames[value]}</option>`;
    }

    const full = appState.graphSeries.length >= maxSeries;
    const an = appState.graphType == 'song' ? 'a' : 'an';
    const placeholder = full ? `That's as many as it can show, remove one to add another`
                             : `Add ${an} ${appState.graphType} to the graph...`;

    return `<div class="graph-controls">
                <select id="graph-type" aria-label="Search for">${options}</select>
                <input id="graph-search" list="graph-suggestions" placeholder="${placeholder}" autocomplete="off"${full ? ' disabled' : ''}>
                <datalist id="graph-suggestions"></datalist>
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
    drawGraph(area, buildGraphData(seriesRows, from, to), seriesInfo, appState.metric);
    fillSuggestions('');
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

// From the search box, which only knows the label that was picked
function addGraphPick(label) {
    for (const item of appState.searchIndex[appState.graphType]) {
        if (item.label == label) {
            if (!addPickByKey(appState.graphType, item.key, item.label)) return;
            render();
            // Straight back into the search box so you can add another
            const search = document.getElementById('graph-search');
            if (search && !search.disabled) search.focus();
            return;
        }
    }
    // Not an exact match yet (still typing), so leave the graph as it is
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

// Everything you can search for, most played first so the suggestions are useful
function buildSearchIndex(songs) {
    appState.searchIndex = { artist: [], album: [], song: [] };
    for (const [key, stats] of topArtists(songs)) {
        appState.searchIndex.artist.push({ key: key, label: stats.name });
    }
    for (const [key, stats] of topAlbums(songs)) {
        appState.searchIndex.album.push({ key: key, label: `${stats.name} - ${stats.artist}` });
    }
    for (const [key, stats] of topSongs(songs)) {
        appState.searchIndex.song.push({ key: key, label: `${stats.name} - ${stats.artist}` });
    }
}

// Only puts the top 30 matches in, a datalist with 14,000 songs in it grinds to a halt.
// Skips anything that's already on the graph
function fillSuggestions(text) {
    const list = document.getElementById('graph-suggestions');
    if (!list) return;
    const search = text.toLowerCase();
    list.innerHTML = '';

    let count = 0;
    for (const item of appState.searchIndex[appState.graphType]) {
        if (isPicked(appState.graphType, item.key)) continue;
        if (item.label.toLowerCase().includes(search)) {
            const option = document.createElement('option');
            option.value = item.label;
            list.appendChild(option);
            count++;
            if (count == 30) break;
        }
    }
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
