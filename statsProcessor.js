import { msToHours, sOnEnd } from './timeBits.js';
import { buildGraphData, drawGraph } from './graph.js';

// 1. The Global State
let appState = {
    allData: [],
    currentView: 'songs',
    timeFilter: 'all', // 'all', a year like '2026', or 'custom'
    monthFilter: 'all', // 'all' or 0-11, only used when a year is picked
    customFrom: '', // "YYYY-MM-DD" from the date inputs
    customTo: '',
    shown: 50, // How many rows of the list to show, goes up by 50 with each Show more
    firstPlay: 0, // ms, so the graph knows where the data starts and ends
    lastPlay: 0,
    // Graph only: narrow it down to one artist/album/song
    graphType: 'all', // 'all', 'artist', 'album' or 'song'
    graphKey: null, // Same keys as topArtists/topAlbums/topSongs
    graphLabel: '',
    searchIndex: {} // Everything you can search for, built once on load
};

// 2. The Initializer
export function calculateStats(songs) {
    console.log("Initializing Dashboard...");

    // ts is in UTC, so work out the local year once here rather than on every filter change
    for (const song of songs) {
        const date = new Date(song.ts);
        song.localYear = String(date.getFullYear());
        song.playedAt = date.getTime();
    }
    appState.allData = songs;
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

// 6. Setup Event Listeners
// Only set them up once, otherwise pressing Process again doubles every click
let listenersSet = false;
function setupEventListeners() {
    if (listenersSet) return;
    listenersSet = true;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            appState.currentView = e.target.dataset.tab;
            appState.shown = 50;
            render();
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
        }
    });

    // Same idea for the graph's artist/album/song filter
    viewport.addEventListener('change', (e) => {
        if (e.target.id == 'graph-type') {
            appState.graphType = e.target.value;
            appState.graphKey = null;
            appState.graphLabel = '';
            render();
        } else if (e.target.id == 'graph-search') {
            pickGraphFilter(e.target.value);
        }
    });
    viewport.addEventListener('input', (e) => {
        if (e.target.id == 'graph-search') {
            // Clicking a suggestion comes through as an input event, not a change one (in Chrome anyway)
            if (e.inputType == 'insertReplacementText' || !(e instanceof InputEvent)) {
                pickGraphFilter(e.target.value);
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
    
    let html = `<ol class="stats-list">`;
    
    for (let i = 0; i < appState.shown && i < sortedData.length; i++) {
        const stats = sortedData[i][1];
        const name = escapeHTML(stats.name);
        const count = stats.count;
        const timeMs = stats.time;
        // This will be undefined for the Artists tab, which is fine
        const artist = stats.artist; 

        const timeString = formatHoursAndMinutes(timeMs);

        // Build the main text: "Song Name" or "Song Name by Artist"
        let headerContent = `<strong>${name}</strong>`;
        if (artist) {
            headerContent += `<span style="color: #888; font-weight: normal;"> - ${escapeHTML(artist)}</span>`;
        }

        html += `<li>
                    ${headerContent}<br>
                    <span style="color: #b3b3b3; font-size: 0.9em;">
                        ${count.toLocaleString()} plays &bull; <em>${timeString}</em>
                    </span>
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

    return `${hours} hour${sOnEnd(hours)}, ${remainingMinutes} minute${sOnEnd(remainingMinutes)}`;
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
function graphControlsHTML() {
    const types = [['all', 'Everything'], ['artist', 'Artist'], ['album', 'Album'], ['song', 'Song']];
    let options = '';
    for (const [value, text] of types) {
        options += `<option value="${value}"${appState.graphType == value ? ' selected' : ''}>${text}</option>`;
    }

    let search = '';
    if (appState.graphType != 'all') {
        search = `<input id="graph-search" list="graph-suggestions" placeholder="Search for a${appState.graphType == 'album' ? 'n' : ''} ${appState.graphType}..."
                    value="${escapeHTML(appState.graphLabel)}" autocomplete="off">
                  <datalist id="graph-suggestions"></datalist>`;
    }

    return `<div class="graph-controls">
                <select id="graph-type" aria-label="Show listens for">${options}</select>
                ${search}
            </div>
            <div id="graph-area" class="graph-card"></div>`;
}

function showGraph(data) {
    // Only bother with the filter if something's actually been picked
    let rows = data;
    if (appState.graphType != 'all' && appState.graphKey != null) {
        rows = data.filter(matchesGraphFilter);
    }

    // Use the picked time range, but don't go past the first or last play
    const bounds = getTimeBounds();
    const from = Math.max(bounds.from == null ? -Infinity : bounds.from, appState.firstPlay);
    const to = Math.min(bounds.to == null ? Infinity : bounds.to, appState.lastPlay + 1);

    const heading = appState.graphKey != null ? appState.graphLabel : 'everything';
    const area = document.getElementById('graph-area');
    if (from >= to) {
        area.textContent = 'No listens in this period.';
        return;
    }
    drawGraph(area, buildGraphData(rows, from, to), heading);

    if (appState.graphType != 'all') {
        fillSuggestions(appState.graphLabel);
    }
}

function matchesGraphFilter(song) {
    const artist = song.master_metadata_album_artist_name;
    if (appState.graphType == 'artist') return artist == appState.graphKey;
    if (appState.graphType == 'album') return `${artist}\n${song.master_metadata_album_album_name}` == appState.graphKey;
    return `${artist}\n${song.master_metadata_track_name}` == appState.graphKey;
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

// Only puts the top 30 matches in, a datalist with 14,000 songs in it grinds to a halt
function fillSuggestions(text) {
    const list = document.getElementById('graph-suggestions');
    if (!list) return;
    const search = text.toLowerCase();
    list.innerHTML = '';

    let count = 0;
    for (const item of appState.searchIndex[appState.graphType]) {
        if (item.label.toLowerCase().includes(search)) {
            const option = document.createElement('option');
            option.value = item.label;
            list.appendChild(option);
            count++;
            if (count == 30) break;
        }
    }
}

function pickGraphFilter(label) {
    if (label == '') {
        appState.graphKey = null;
        appState.graphLabel = '';
        render();
        return;
    }
    for (const item of appState.searchIndex[appState.graphType]) {
        if (item.label == label) {
            appState.graphKey = item.key;
            appState.graphLabel = item.label;
            render();
            return;
        }
    }
    // Not an exact match yet (still typing), so leave the graph as it is
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

function topSongs(songs) {
    const stats = {};
    for (const song of songs) {
        const name = song.master_metadata_track_name;
        const artist = song.master_metadata_album_artist_name;
        if (name) {
            // Key on artist too, otherwise every song called "Intro" gets lumped together
            const key = `${artist}\n${name}`;
            if (!stats[key]) stats[key] = {
                name: name,
                count: 0,
                time: 0,
                artist: artist
            };
            if (song.ms_played >= minPlayMs) stats[key].count++;
            stats[key].time += song.ms_played || 0;
        }
    }
    return Object.entries(stats).sort((a, b) => b[1].count - a[1].count);
}

function topArtists(songs) {
    const stats = {};
    for (const song of songs) {
        const name = song.master_metadata_album_artist_name;
        if (name) {
            if (!stats[name]) stats[name] = { name: name, count: 0, time: 0 }; // No artist line needed, it's the name
            if (song.ms_played >= minPlayMs) stats[name].count++;
            stats[name].time += song.ms_played || 0;
        }
    }
    return Object.entries(stats).sort((a, b) => b[1].count - a[1].count);
}

function topAlbums(songs) {
    const stats = {};
    for (const song of songs) {
        const name = song.master_metadata_album_album_name;
        const artist = song.master_metadata_album_artist_name;
        if (name) {
            // Same as songs, loads of artists have an album called "Greatest Hits"
            const key = `${artist}\n${name}`;
            if (!stats[key]) stats[key] = {
                name: name,
                count: 0,
                time: 0,
                artist: artist
            };
            if (song.ms_played >= minPlayMs) stats[key].count++;
            stats[key].time += song.ms_played || 0;
        }
    }
    return Object.entries(stats).sort((a, b) => b[1].count - a[1].count);
}
