import { msToHours, sOnEnd } from './timeBits.js';

// 1. The Global State
let appState = {
    allData: [],
    currentView: 'songs', 
    timeFilter: 'all' 
};

// 2. The Initializer
export function calculateStats(songs) {
    console.log("Initializing Dashboard...");

    // ts is in UTC, so work out the local year once here rather than on every filter change
    for (const song of songs) {
        song.localYear = String(new Date(song.ts).getFullYear());
    }
    appState.allData = songs;

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
    const filteredData = filterDataByTime(appState.allData, appState.timeFilter);
    
    // Update Header Stats
    updateBentoStats(filteredData);

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
function filterDataByTime(data, year) {
    if (year === 'all') return data;
    return data.filter(item => item.localYear == year);
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
function setupEventListeners() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            appState.currentView = e.target.dataset.tab;
            render();
        });
    });

    document.getElementById('time-range').addEventListener('change', (e) => {
        appState.timeFilter = e.target.value;
        render();
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
}

// 7. Updated HTML Generator (Now includes Artist logic)
function generateListHTML(sortedData) {
    if (!sortedData.length) return `<p>No data found for this period.</p>`;
    
    let html = `<ol class="stats-list">`;
    
    for (let i = 0; i < 50 && i < sortedData.length; i++) {
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
