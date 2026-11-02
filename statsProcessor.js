import { sOnEnd } from './timeBits.js?v=8129e47c';
import { buildGraphData, drawGraph } from './graph.js?v=8129e47c';
import { drawCard, themes, findAlbumCover } from './share.js?v=8129e47c';
import { minPlayMs, capNavidromePlays, nameKey, buildNameKeys } from './plays.js?v=8129e47c';

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
    wrappedPeriod: null, // The year the Wrapped card's for ('2026', 'all' or 'custom'). Starts on the latest year
    wrappedFrom: null, // The first and last year for 'custom', like '2021' and '2023'
    wrappedTo: null,
    shareTheme: { ...themes[0] }, // The card's colours
    shareCovers: true, // Whether to look up the top artist's album cover
    coverCache: {}, // Covers looked up so far, by artist and album: { status, cover }
    zoomStack: [], // Where the date filter was before each zoom on the graph, for Zoom out
    excluded: [], // Anything left out of the stats, each { type, key, label }. Remembered between visits
    excludedKeys: { artist: {}, album: {}, song: {} },
    leftKeys: { artist: {}, album: {}, song: {} }, // What has plays left once the exclusions are taken out
    listType: 'song', // What's in the list on screen, and the keys in order, for clicking a row
    listKeys: [],
    searchIndex: {}, // Everything you can search for, built once on load
    names: {}, // How to spell each artist/song/album key, also built once on load
    artistIds: {}, // Artist key to MusicBrainz ID, where the files say
    libraryGenres: {} // Artist key to genre, from the files' own tags
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

    // ts is in UTC, so work out the local year once here rather than on every filter change.
    // The day (as a number, so days next to each other are 1 apart), hour and weekday too, for the Fun tab
    for (const song of songs) {
        const date = new Date(song.ts);
        song.localYear = String(date.getFullYear());
        song.localMonth = date.getMonth();
        song.playedAt = date.getTime();
        song.day = Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / dayMs);
        song.hour = date.getHours();
        song.weekday = date.getDay();
    }
    capNavidromePlays(songs);
    appState.allData = songs;
    const grouped = buildNameKeys(songs);
    appState.names = grouped.names;
    appState.artistIds = grouped.ids; // MusicBrainz IDs, from newer Navidrome exports
    appState.libraryGenres = grouped.genres; // Genre tags from a Navidrome library
    buildSearchIndex(songs);
    loadExclusions();
    applyExclusions();
    loadCoverSetting();
    loadTheme();

    document.getElementById('bento-grid').classList.remove('hidden');
    document.getElementById('controls').classList.remove('hidden');
    // The upload area's done its job, so it shrinks to a button and the stats move up the page
    document.getElementById('upload').classList.add('hidden');
    document.getElementById('change-files').classList.remove('hidden');

    setupYearOptions(songs);
    setupEventListeners();
    render();
    announce('Done, your stats are below.');
}

// After an upload that didn't work. Without this the stats from the last upload stay on screen,
// and clicking a tab draws them all again as if nothing went wrong
export function clearStats() {
    appState.allData = [];
    appState.data = [];
    appState.graphSeries = [];
    appState.zoomStack = [];
    erasCache = null;
    document.getElementById('bento-grid').classList.add('hidden');
    document.getElementById('controls').classList.add('hidden');
    document.getElementById('upload').classList.remove('hidden');
    document.getElementById('change-files').classList.add('hidden');
}

// Says something to screen readers (processing, errors, looking for a cover) without showing it.
// The box is in the page from the start, since ones added with their text already in often don't get read out
export function announce(text) {
    const status = document.getElementById('announcer');
    if (!status) return;
    // Clearing it first means the same message twice still gets read twice
    status.textContent = '';
    setTimeout(() => status.textContent = text, 50);
}

// 3. The Render Logic
function render() {
    const viewport = document.getElementById('content-viewport');
    
    if (appState.currentView === 'wrapped') {
        appState.eras = cachedEras();
        const years = appState.eras.eras.map(era => era.label);
        if (appState.wrappedPeriod != 'all' && appState.wrappedPeriod != 'custom' && !years.includes(appState.wrappedPeriod)) {
            appState.wrappedPeriod = years.length > 0 ? years[years.length - 1] : 'all';
        }
        // The custom range starts as every year, and any year that's gone (a new upload, say) goes back to the ends
        if (!years.includes(appState.wrappedFrom)) appState.wrappedFrom = years[0] || null;
        if (!years.includes(appState.wrappedTo)) appState.wrappedTo = years[years.length - 1] || null;
        if (appState.wrappedPeriod == 'custom' && years.length == 0) appState.wrappedPeriod = 'all';
        // The stat cards follow the year picked here rather than the (hidden) date filter
        updateBentoStats(wrappedRows());
        holdHeight(viewport, () => {
            viewport.innerHTML = wrappedHTML();
            redrawCards();
        });
        return;
    }

    // A custom range that ends before it starts has nothing in it, which looks like a bug unless it says why
    if (appState.timeFilter == 'custom' && appState.customFrom && appState.customTo && appState.customFrom > appState.customTo) {
        updateBentoStats([]);
        viewport.innerHTML = `<p>The start date's after the end date, so there's nothing in between. Swap them round.</p>`;
        return;
    }

    // Filter data
    const filteredData = filterDataByTime(appState.data);

    // Update Header Stats. These are the same top songs and artists the list needs, so keep them
    const top = updateBentoStats(filteredData);

    if (appState.currentView === 'graph') {
        holdHeight(viewport, () => {
            viewport.innerHTML = graphControlsHTML();
            showGraph(filteredData);
        });
        return;
    }

    if (appState.currentView === 'fun') {
        showFun(filteredData);
        return;
    }

    // Generate List. Whatever's on the graph carries over, so it only shows those (like the date filter does)
    let listData = filteredData;
    if (appState.graphSeries.length > 0) {
        listData = filteredData.filter(song => appState.graphSeries.some(pick => matchesPick(song, pick)));
    }
    let sortedData = [];
    if (appState.listView === 'songs') {
        sortedData = listData === filteredData ? top.songs : topSongs(listData);
    } else if (appState.listView === 'artists') {
        sortedData = listData === filteredData ? top.artists : topArtists(listData);
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
    document.getElementById('total-time-display').innerText = formatHoursAndMinutes(totalMs);

    const songs = topSongs(data);
    const artists = topArtists(data);

    document.getElementById('top-song-display').innerText = songs.length > 0 ? songs[0][1].name : "-";
    document.getElementById('top-artist-display').innerText = artists.length > 0 ? artists[0][1].name : "-";
    return { songs: songs, artists: artists };
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

// Right-clicking a row in the lists (or a name on the Fun tab): View in graph, View on Spotify, or Exclude.
// Opened by right-click, the menu key on a keyboard, or a long press on a phone
let menuTarget = null;
function openRowMenu(target, x, y) {
    menuTarget = target;
    const menu = document.getElementById('row-menu');
    // Android can fire its own long press as well as ours, and showing it twice throws
    if (!menu.matches(':popover-open')) menu.showPopover();
    // Keep it on screen if the click was near the edge
    const left = Math.min(x, window.innerWidth - menu.offsetWidth - 8);
    const top = Math.min(y, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.querySelector('button').focus();
}

// What a right-click or long press landed on, as { type, key }: a row in the lists, or a name on the Fun tab
function menuTargetAt(el) {
    const row = el.closest('.list-item');
    if (row) return { type: appState.listType, key: appState.listKeys[Number(row.dataset.index)], el: row };
    const name = el.closest('.fun-pick');
    if (name) return { type: name.dataset.type, key: name.dataset.key, el: name };
    return null;
}

function rowMenuAction(action) {
    document.getElementById('row-menu').hidePopover();
    if (!menuTarget || menuTarget.key == null) return;
    const { type, key } = menuTarget;
    const name = appState.names[type][key];
    const label = type == 'artist' ? name.name : `${name.name} - ${name.artist}`;

    if (action == 'graph') {
        graphPick(type, key);
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
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab == view);
        b.setAttribute('aria-pressed', b.dataset.tab == view); // So screen readers can tell which one's on
    });
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
        } else if (e.target.id == 'genre-start') {
            startGenreLookup();
        } else if (e.target.id == 'genre-stop') {
            stopGenreLookup();
        } else if (e.target.closest('.fun-pick')) {
            // A name on the Fun tab, onto the graph like clicking it in the lists
            const pick = e.target.closest('.fun-pick').dataset;
            graphPick(pick.type, pick.key);
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
            appState.graphSeries = []; // Clears the graph too, they're the same filters
            render();
        } else if (e.target.id == 'graph-clear') {
            appState.graphSeries = [];
            render();
        }
    });

    // The custom year range on the Wrapped tab. Picking a start after the end (or the other way round)
    // moves the other one with it, so it's never back to front
    viewport.addEventListener('change', (e) => {
        if (e.target.id == 'wrapped-from') {
            appState.wrappedFrom = e.target.value;
            if (appState.wrappedTo < appState.wrappedFrom) appState.wrappedTo = appState.wrappedFrom;
        } else if (e.target.id == 'wrapped-to') {
            appState.wrappedTo = e.target.value;
            if (appState.wrappedFrom > appState.wrappedTo) appState.wrappedFrom = appState.wrappedTo;
        } else {
            return;
        }
        render();
        document.getElementById(e.target.id).focus(); // The tab's rebuilt, so put focus back where it was
    });

    // Right-click (or the menu key, or a long press on Android) on a list row or Fun tab name opens its menu
    viewport.addEventListener('contextmenu', (e) => {
        const target = menuTargetAt(e.target);
        if (!target) return;
        e.preventDefault();
        // From the keyboard there's no mouse position, so put it by the row instead
        const box = target.el.getBoundingClientRect();
        const x = e.clientX || box.left + 40;
        const y = e.clientY || box.bottom;
        press = null; // Android's long press got there first
        // On Linux and Macs this comes when the button goes down, and letting go of it then counts as
        // a click outside the menu, which closes it straight away. So open it once the button's let go
        if (e.buttons & 2) {
            window.addEventListener('pointerup', () => setTimeout(() => openRowMenu(target, x, y), 0), { once: true });
        } else {
            openRowMenu(target, x, y);
        }
    });

    // iPhones don't fire contextmenu on a long press, so time it here. The menu opens when you let go:
    // opening it while your finger's still down means lifting it counts as a tap outside, which closes it again.
    // The tap that follows letting go would put the row on the graph, so that gets swallowed
    let press = null;
    let swallowClick = false;
    viewport.addEventListener('pointerdown', (e) => {
        swallowClick = false;
        const target = menuTargetAt(e.target);
        if (e.pointerType != 'touch' || !target) return;
        press = { target: target, x: e.clientX, y: e.clientY, held: false };
        const thisPress = press;
        setTimeout(() => thisPress.held = true, 500);
    });
    viewport.addEventListener('pointermove', (e) => {
        // Moved too far for a hold, probably scrolling
        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) press = null;
    });
    viewport.addEventListener('pointercancel', () => press = null);
    viewport.addEventListener('pointerup', () => {
        if (press && press.held) {
            const { target, x, y } = press;
            swallowClick = true;
            setTimeout(() => openRowMenu(target, x, y), 0);
        }
        press = null;
    });
    viewport.addEventListener('click', (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.stopPropagation();
        e.preventDefault();
    }, true);

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
        saveTheme();
        buildSwatches();
        setColourInputs();
        redrawCards();
    });
    for (const [id, part] of [['colour-top', 'top'], ['colour-bottom', 'bottom'], ['colour-text', 'text']]) {
        document.getElementById(id).addEventListener('input', (e) => {
            appState.shareTheme = { ...appState.shareTheme, name: 'Custom', [part]: e.target.value };
            saveTheme();
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
    custom.innerText = 'Custom';
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
            headerContent += `<span style="color: #999; font-weight: normal;"> - ${escapeHTML(artist)}</span>`;
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
    // Filters: the same ones as the graph (adding one here puts it on the graph too, and the other way round),
    // shown as chips in the graph's colours so it's clear which is which
    const full = appState.graphSeries.length >= maxSeries;
    let chips = '';
    for (let i = 0; i < appState.graphSeries.length; i++) {
        const pick = appState.graphSeries[i];
        chips += `<li class="graph-chip">
                    <span class="graph-key" style="background: var(--series-${pick.colour})"></span>
                    <span>${escapeHTML(pick.label)}</span>
                    <span class="graph-chip-detail">${typeNames[pick.type]}</span>
                    <button type="button" class="graph-chip-remove" data-index="${i}" aria-label="Remove ${escapeHTML(pick.label)}">×</button>
                  </li>`;
    }
    return `<div class="list-header">
                <div class="sub-tabs" role="group" aria-label="Show">${buttons}</div>
                <p class="list-hint">${touchScreen ? 'Tap anything to see it on the graph, or tap and hold for more.'
                                                   : 'Click anything to see it on the graph, or right-click for more.'}</p>
            </div>
            <div class="graph-controls">
                <div class="graph-search-wrap">
                    <input id="list-search" placeholder="${full ? "That's as many filters as there can be, remove one to add another" : 'Filter by an artist, album or song...'}"
                           autocomplete="off"${full ? ' disabled' : ''} role="combobox" aria-label="Filter" aria-autocomplete="list"
                           aria-expanded="false" aria-controls="list-suggestions">
                    <ul id="list-suggestions" class="suggestions hidden" role="listbox"></ul>
                </div>
                ${appState.graphSeries.length > 0 ? '<button id="list-filter-clear" type="button" class="secondary-btn">Clear all</button>' : ''}
            </div>
            ${chips ? `<ul class="graph-legend list-chips">${chips}</ul>` : ''}`;
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

// Phones and tablets get "tap" in the hints rather than "click" and "right-click", which they haven't got
const touchScreen = window.matchMedia('(pointer: coarse)').matches;

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
                <p class="list-hint">${touchScreen ? 'Tap the graph to see a point and tap it again to zoom in, or drag across a stretch.'
                                                   : 'Click or drag across the graph to zoom in, right-click to zoom out.'}</p>
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
    'list-search': {
        list: 'list-suggestions',
        skip: item => isPicked(item.type, item.key) || isExcluded(item.type, item.key),
        pick: item => {
            addPickByKey(item.type, item.key, item.label);
            render();
            const search = document.getElementById('list-search');
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

// From clicking a row in one of the lists
function graphFromList(index) {
    graphPick(appState.listType, appState.listKeys[index]);
}

// Adds an artist, album or song to whatever's already on the graph and switches to it
function graphPick(type, key) {
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
                                           search: nameKey(stats.name) });
    }
    for (const [key, stats] of topAlbums(songs)) {
        const label = `${stats.name} - ${stats.artist}`;
        appState.searchIndex.album.push({ type: 'album', key: key, label: label, name: stats.name, artist: stats.artist,
                                          search: nameKey(label) });
    }
    for (const [key, stats] of topSongs(songs)) {
        const label = `${stats.name} - ${stats.artist}`;
        appState.searchIndex.song.push({ type: 'song', key: key, label: label, name: stats.name, artist: stats.artist,
                                         search: nameKey(label) });
    }
}

// Searches artists, albums and songs all at once, so there's no picking which you're after first.
// Every word you type has to be in there somewhere ("overcompensate twenty" finds it), and
// the order is: names that start with what you typed, then artists, albums, songs, then most played.
// skip says what to leave out (already on the graph, already excluded, etc)
function findSuggestions(text, skip = searchBoxes['graph-search'].skip) {
    const search = nameKey(text.trim());
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
            const startsWith = nameKey(item.name).startsWith(search);
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

// The eras only change with the data (a new upload or exclusion makes a new appState.data)
// or with Plays/Time, which changes the order. So keep them rather than redo every year on each click
let erasCache = null;
function cachedEras() {
    if (!erasCache || erasCache.data !== appState.data || erasCache.metric != appState.metric) {
        erasCache = { data: appState.data, metric: appState.metric, eras: buildEras(appState.data) };
    }
    return erasCache.eras;
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

    // With a custom range, just the years in it
    let eras = result.eras;
    if (appState.wrappedPeriod == 'custom') eras = eras.filter(era => inWrappedRange(era.label));

    let html = `<h3 class="eras-title">Your eras</h3>
                <p class="list-hint eras-hint">Your top artists year by year. Click a year to see its card.</p>
                <div class="eras-grid">`;
    // Most recent first
    for (const era of eras.slice().reverse()) {
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
    if (appState.wrappedPeriod == 'custom') return appState.data.filter(song => inWrappedRange(song.localYear));
    return appState.data.filter(song => song.localYear == appState.wrappedPeriod);
}

// Years are always four digits, so comparing them as text puts them in the right order
function inWrappedRange(year) {
    return year >= appState.wrappedFrom && year <= appState.wrappedTo;
}

// What goes at the top of the card: "2026", "2020–2026" for all time, or the custom years
function wrappedLabel() {
    if (appState.wrappedPeriod == 'all') return rangeLabel();
    if (appState.wrappedPeriod == 'custom') {
        return appState.wrappedFrom == appState.wrappedTo ? appState.wrappedFrom : `${appState.wrappedFrom}–${appState.wrappedTo}`;
    }
    return appState.wrappedPeriod;
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
        label: wrappedLabel(),
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
    for (const year of years.concat('all', 'custom')) {
        const text = { all: 'All time', custom: 'Custom' }[year] || year;
        chips += `<button type="button" class="year-chip" data-year="${year}" aria-pressed="${appState.wrappedPeriod == year}">${text}</button>`;
    }
    // From and to years, only once Custom is picked
    let range = '';
    if (appState.wrappedPeriod == 'custom') {
        const options = picked => years.slice().reverse().map(year =>
            `<option value="${year}"${year == picked ? ' selected' : ''}>${year}</option>`).join('');
        range = `<div class="wrapped-range">
                    <select id="wrapped-from" aria-label="From year">${options(appState.wrappedFrom)}</select>
                    to
                    <select id="wrapped-to" aria-label="To year">${options(appState.wrappedTo)}</select>
                 </div>`;
    }
    return `<div class="wrapped-top">
                <canvas id="wrapped-canvas" class="card-preview" role="img" aria-label="Your Wrapped card"></canvas>
                <div class="wrapped-side">
                    <h3>Your Wrapped</h3>
                    <div class="year-chips" role="group" aria-label="Year">${chips}</div>
                    ${range}
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
    // The status line gets rebuilt with the tab, so screen readers are told separately, and only when it changes
    if (text && text != lastCoverStatus) announce(text);
    lastCoverStatus = text;
}
let lastCoverStatus = '';

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

// The card's colours are remembered too, same as the cover setting. Only proper #rrggbb colours
// get used, the colour pickers quietly ignore anything else
const themeStorageKey = 'unwrapper-theme';
function loadTheme() {
    try {
        const saved = JSON.parse(localStorage.getItem(themeStorageKey));
        const colour = /^#[0-9a-f]{6}$/i;
        if (saved && colour.test(saved.top) && colour.test(saved.bottom) && colour.test(saved.text)) {
            appState.shareTheme = { name: String(saved.name || 'Custom'), top: saved.top, bottom: saved.bottom, text: saved.text };
        }
    } catch (err) {
        // Nothing saved, or storage is blocked, so it stays green
    }
}

function saveTheme() {
    try {
        localStorage.setItem(themeStorageKey, JSON.stringify(appState.shareTheme));
    } catch (err) {
        // Can't save, it'll be green again next time
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

// 13. The Fun tab: odd little things about your listening, each on its own card.
// Follows the date filter like the lists do. New and forgotten artists need a before and an after,
// which is the period picked, or with All Time, your last year compared with everything before it
const dayMs = 1000*60*60*24;

// Working it all out takes a second or so with years of data, so the tab switches straight away with grey
// placeholder cards, then fills in. What it worked out is kept, so coming back with the same data and dates is instant
let funCache = null;
let funToken = 0;
function showFun(rows) {
    const viewport = document.getElementById('content-viewport');
    const filter = [appState.timeFilter, appState.monthFilter, appState.customFrom, appState.customTo, appState.metric].join('|');
    // Not while genres are being looked up though, or the count would be out of date
    if (funCache && funCache.data === appState.data && funCache.filter == filter && !genreLookup.running) {
        viewport.innerHTML = funCache.html;
        return;
    }
    viewport.innerHTML = funSkeletonHTML();
    // If something else gets drawn before this is done (another tab, a new date), the token's moved on and this is dropped
    const token = ++funToken;
    // Wait for the placeholders to be on screen before starting, or they'd never get drawn
    requestAnimationFrame(() => setTimeout(() => {
        if (token != funToken || appState.currentView != 'fun') return;
        const html = funHTML(rows);
        funCache = { data: appState.data, filter: filter, html: html };
        viewport.innerHTML = html;
    }, 0));
}

function funSkeletonHTML() {
    let cards = '';
    for (let i = 0; i < 8; i++) {
        cards += `<section class="fun-card fun-skeleton">
                    <span class="skeleton-line short"></span>
                    <span class="skeleton-line big"></span>
                    <span class="skeleton-line"></span>
                    <span class="skeleton-line"></span>
                    <span class="skeleton-line"></span>
                  </section>`;
    }
    return `<p class="list-hint">Working it out...</p>
            <div class="fun-grid" aria-busy="true">${cards}</div>`;
}

function funHTML(periodRows) {
    const rows = periodRows.filter(song => song.master_metadata_track_name);
    if (rows.length == 0) return `<p>No data found for this period.</p>`;

    const all = appState.data.filter(song => song.master_metadata_track_name);
    const bounds = getTimeBounds();
    const picked = bounds.from != null;
    const start = picked ? bounds.from : appState.lastPlay - 365 * dayMs;
    const end = bounds.to != null ? bounds.to : Infinity;
    const when = picked ? 'in this period' : 'in your last year';

    const ends = dayEnds(rows); // Both the day starters and the last thing at night need these
    const cards = [
        newArtistsCard(all, start, end, when),
        forgottenArtistsCard(all, start, end, when),
        genresCard(rows),
        genreErasCard(rows),
        everPresentCard(rows),
        overlookedCard(rows),
        deepCutsCard(rows),
        obsessionCard(rows),
        busiestDayCard(rows),
        streakCard(rows),
        comebackCard(rows),
        flingsCard(rows, all),
        clockCard(rows),
        dayStartersCard(ends),
        lastThingCard(ends),
        songOfTheMonthCard(rows),
        varietyCard(rows),
        firstSongCard(rows)
    ].filter(card => card);

    const more = touchScreen ? 'tap and hold for more' : 'right-click for more';
    return `<p class="list-hint">Odd little things about your listening${picked ? ' in this period' : ''}. ${touchScreen ? 'Tap' : 'Click'} a name to see it on the graph, or ${more}.</p>
            <div class="fun-grid">${cards.join('')}</div>`;
}

// One card: a title, a big headline, a line under it, and optionally a short list.
// Each list item is { type, key, value } for an artist or song (clickable, onto the graph) or { text, value }
// chart is extra HTML underneath (funBars), and makes the card the full width of the grid
function funCard(title, big, detail, items = [], chart = '', wide = chart != '') {
    let list = '';
    for (const item of items) {
        let name;
        if (item.key != null) {
            const names = appState.names[item.type][item.key];
            const label = item.type == 'artist' ? names.name : `${names.name} - ${names.artist}`;
            const artist = item.type == 'artist' ? '' : `<span class="fun-artist">${escapeHTML(names.artist)}</span>`;
            name = `<button type="button" class="fun-pick" data-type="${item.type}" data-key="${escapeHTML(item.key)}" title="Show ${escapeHTML(label)} on the graph">${escapeHTML(names.name)}</button>${artist}`;
        } else {
            name = `<span>${escapeHTML(item.text)}</span>`;
        }
        list += `<li><span class="fun-name">${name}</span><span class="fun-value">${escapeHTML(item.value)}</span></li>`;
    }
    return `<section class="fun-card${wide ? ' fun-wide' : ''}">
                <h3>${title}</h3>
                <p class="fun-big">${escapeHTML(big)}</p>
                <p class="fun-detail">${detail}</p>
                ${list ? `<ol class="fun-list">${list}</ol>` : ''}
                ${chart}
            </section>`;
}

// A small bar chart: share of listening time for each hour, day, etc. Hovering a bar says its numbers,
// and the same numbers are in a table for screen readers. axisLabels has one per bar, '' for no label
function funBars(title, values, axisLabels, names) {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const max = Math.max(...values) || 1;
    let bars = '', axis = '', rows = '';
    for (let i = 0; i < values.length; i++) {
        const share = `${Math.round(values[i] / total * 100)}%`;
        const tip = `${names[i]}: ${share}, ${formatHoursAndMinutes(values[i])}`;
        // Tooltips near the ends line up with that end, so they don't hang off the card
        const edge = i < values.length / 4 ? ' start' : i >= values.length * 3 / 4 ? ' end' : '';
        bars += `<div class="fun-bar${edge}" data-tip="${escapeHTML(tip)}"><span style="height: ${values[i] / max * 100}%"></span></div>`;
        axis += `<span>${escapeHTML(axisLabels[i])}</span>`;
        rows += `<tr><th scope="row">${escapeHTML(names[i])}</th><td>${share}</td><td>${formatHoursAndMinutes(values[i])}</td></tr>`;
    }
    return `<figure class="fun-chart">
                <figcaption>${title}</figcaption>
                <div class="fun-bars" style="--bars: ${values.length}" aria-hidden="true">${bars}</div>
                <div class="fun-axis" style="--bars: ${values.length}" aria-hidden="true">${axis}</div>
                <div class="visually-hidden"><table><caption>${title}</caption>${rows}</table></div>
            </figure>`;
}

function funDate(ms) {
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function plays(n) {
    return `${n.toLocaleString()} play${sOnEnd(n)}`;
}

// Counted plays (30 seconds or more) for each key, from a key function
function countBy(rows, keyOf) {
    const counts = {};
    for (const song of rows) {
        const key = keyOf(song);
        if (key == null || song.ms_played < minPlayMs) continue;
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

// Artists whose first ever play was in the period, most played first
function newArtistsCard(all, start, end, when) {
    const first = {};
    for (const song of all) {
        if (song.artistKey && !(song.playedAt >= first[song.artistKey])) first[song.artistKey] = song.playedAt;
    }
    const counts = countBy(all.filter(song => song.playedAt >= start && song.playedAt < end), song => song.artistKey);
    const found = Object.keys(counts).filter(key => first[key] >= start && first[key] < end);
    if (found.length == 0) return null;
    found.sort((a, b) => counts[b] - counts[a]);
    return funCard('New artists', found.length.toLocaleString(), `artists you heard for the first time ${when}`,
        found.slice(0, 5).map(key => ({ type: 'artist', key: key, value: `${plays(counts[key])}, since ${funDate(first[key])}` })));
}

// Artists you played loads before the period and not once in it
function forgottenArtistsCard(all, start, end, when) {
    const before = countBy(all.filter(song => song.playedAt < start), song => song.artistKey);
    const since = {};
    const last = {};
    for (const song of all) {
        if (!song.artistKey) continue;
        if (song.playedAt >= start && song.playedAt < end) since[song.artistKey] = true;
        if (song.playedAt < start && !(song.playedAt <= last[song.artistKey])) last[song.artistKey] = song.playedAt;
    }
    const found = Object.keys(before).filter(key => before[key] >= 30 && !since[key]);
    if (found.length == 0) return null;
    found.sort((a, b) => before[b] - before[a]);
    return funCard('Forgotten artists', found.length.toLocaleString(), `artists you'd played 30+ times before, and not at all ${when}`,
        found.slice(0, 5).map(key => ({ type: 'artist', key: key, value: `${plays(before[key])}, last ${funDate(last[key])}` })));
}

// Artists where nearly every play's the same song, so the rest of their stuff's been overlooked
function overlookedCard(rows) {
    const byArtist = countBy(rows, song => song.artistKey);
    const bySong = countBy(rows, song => song.songKey);
    const topSong = {};
    for (const key in bySong) {
        const artist = key.slice(0, key.indexOf('\n'));
        if (!topSong[artist] || bySong[key] > bySong[topSong[artist]]) topSong[artist] = key;
    }
    const found = Object.keys(byArtist).filter(key => byArtist[key] >= 25 && bySong[topSong[key]] / byArtist[key] >= 0.8);
    if (found.length == 0) return null;
    found.sort((a, b) => byArtist[b] - byArtist[a]);
    return funCard('Overlooked artists', found.length.toLocaleString(), 'artists where 80% or more of your plays are one song. The rest of their stuff might be worth a go',
        found.slice(0, 5).map(key => ({ type: 'song', key: topSong[key], value: `${Math.round(bySong[topSong[key]] / byArtist[key] * 100)}% of ${plays(byArtist[key])}` })));
}

// The artists you've gone deepest into: the most different songs of theirs played
function deepCutsCard(rows) {
    const songs = {};
    for (const song of rows) {
        if (!song.artistKey || song.ms_played < minPlayMs) continue;
        if (!songs[song.artistKey]) songs[song.artistKey] = new Set();
        songs[song.artistKey].add(song.songKey);
    }
    const ranked = Object.keys(songs).sort((a, b) => songs[b].size - songs[a].size);
    if (ranked.length == 0) return null;
    return funCard('Deep dives', songs[ranked[0]].size.toLocaleString(), `different songs by ${escapeHTML(appState.names.artist[ranked[0]].name)}, more than anyone else`,
        ranked.slice(0, 5).map(key => ({ type: 'artist', key: key, value: `${songs[key].size.toLocaleString()} songs` })));
}

// The most times you've played one song in a single day
function obsessionCard(rows) {
    // Counts for each day, then each song on it. The best so far is kept as it goes rather than searched for after
    const days = new Map();
    let best = { count: 0 };
    for (const song of rows) {
        if (!song.songKey || song.ms_played < minPlayMs) continue;
        let counts = days.get(song.day);
        if (!counts) days.set(song.day, counts = new Map());
        const count = (counts.get(song.songKey) || 0) + 1;
        counts.set(song.songKey, count);
        if (count > best.count) best = { count: count, day: song.day, songKey: song.songKey };
    }
    if (best.count < 3) return null;
    return funCard('On repeat', `${best.count} times`, `in one day, on ${funDate(best.day * dayMs)}`,
        [{ type: 'song', key: best.songKey, value: '' }]);
}

// The day with the most listening, and how long
function busiestDayCard(rows) {
    const time = {};
    for (const song of rows) {
        const day = song.day;
        time[day] = (time[day] || 0) + song.ms_played;
    }
    let best = null;
    for (const day in time) {
        if (best == null || time[day] > time[best]) best = day;
    }
    const days = Object.keys(time).length;
    const average = Object.values(time).reduce((a, b) => a + b, 0) / days;
    return funCard('Biggest day', formatHoursAndMinutes(time[best]), `on ${funDate(Number(best) * dayMs)}. On a day you listen at all, it's usually ${formatHoursAndMinutes(average)}`);
}

// The most days in a row with something played
function streakCard(rows) {
    const days = [...new Set(rows.map(song => song.day))].sort((a, b) => a - b);
    let best = 1, bestEnd = days[0], run = 1;
    for (let i = 1; i < days.length; i++) {
        run = days[i] == days[i - 1] + 1 ? run + 1 : 1;
        if (run > best) {
            best = run;
            bestEnd = days[i];
        }
    }
    return funCard('Longest streak', `${best.toLocaleString()} day${sOnEnd(best)}`,
        `in a row with music, from ${funDate((bestEnd - best + 1) * dayMs)} to ${funDate(bestEnd * dayMs)}. You listened on ${days.length.toLocaleString()} days in all`);
}

// Artists you went off for ages and came back to: the longest gap with at least 10 plays either side
function comebackCard(rows) {
    const times = {};
    for (const song of rows) {
        if (!song.artistKey || song.ms_played < minPlayMs) continue;
        if (!times[song.artistKey]) times[song.artistKey] = [];
        times[song.artistKey].push(song.playedAt);
    }
    const found = [];
    for (const key in times) {
        const t = times[key].sort((a, b) => a - b);
        if (t.length < 20) continue;
        let gap = 0, back = 0;
        for (let i = 9; i < t.length - 10; i++) {
            if (t[i + 1] - t[i] > gap) {
                gap = t[i + 1] - t[i];
                back = t[i + 1];
            }
        }
        if (gap >= 180 * dayMs) found.push({ key: key, gap: gap, back: back });
    }
    if (found.length == 0) return null;
    found.sort((a, b) => b.gap - a.gap);
    const months = gap => Math.round(gap / (30.44 * dayMs));
    return funCard('Comebacks', `${months(found[0].gap)} months`, `away from ${escapeHTML(appState.names.artist[found[0].key].name)} before going back to them`,
        found.slice(0, 5).map(c => ({ type: 'artist', key: c.key, value: `${months(c.gap)} months, back ${funDate(c.back)}` })));
}

// What time of day and day of the week you listen most
function clockCard(rows) {
    const hours = new Array(24).fill(0);
    const weekdays = new Array(7).fill(0);
    for (const song of rows) {
        hours[song.hour] += song.ms_played;
        weekdays[song.weekday] += song.ms_played;
    }
    const total = hours.reduce((a, b) => a + b, 0);
    const peak = hours.indexOf(Math.max(...hours));
    const day = weekdays.indexOf(Math.max(...weekdays));
    const hour = h => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const share = (from, to) => `${Math.round(hours.slice(from, to).reduce((a, b) => a + b, 0) / total * 100)}%`;
    const dayName = (d, style) => new Date(2000, 0, 2 + d).toLocaleDateString(undefined, { weekday: style }); // 2 Jan 2000 was a Sunday

    // Hours, labelled every 6. Days start on Monday
    const hourNames = hours.map((_, h) => `${hour(h)}–${hour((h + 1) % 24)}`);
    const hourLabels = hours.map((_, h) => h % 6 == 0 ? hour(h) : '');
    const order = [1, 2, 3, 4, 5, 6, 0];
    const charts = `<div class="fun-charts">
                        ${funBars('Time of day', hours, hourLabels, hourNames)}
                        ${funBars('Day of the week', order.map(d => weekdays[d]), order.map(d => dayName(d, 'short')), order.map(d => dayName(d, 'long')))}
                    </div>`;
    return funCard('When you listen', `${hour(peak)}–${hour((peak + 1) % 24)}`,
        `is your busiest hour, and ${dayName(day, 'long')} your busiest day. ${share(0, 5)} of your listening is after midnight and before 5am`,
        [], charts);
}

// How many different artists, songs and albums
function varietyCard(rows) {
    const artistKeys = new Set(), songKeys = new Set(), albumKeys = new Set();
    for (const song of rows) {
        if (song.artistKey) artistKeys.add(song.artistKey);
        if (song.songKey) songKeys.add(song.songKey);
        if (song.albumKey) albumKeys.add(song.albumKey);
    }
    const artists = artistKeys.size;
    const songs = songKeys.size;
    return funCard('Variety', `${artists.toLocaleString()} artists`, `${songs.toLocaleString()} different songs and ${albumKeys.size.toLocaleString()} albums`, [
        { text: 'Songs per artist', value: (songs / artists).toFixed(1) }
    ]);
}

// The first thing played in the period (or ever, with All Time)
function firstSongCard(rows) {
    let first = null;
    for (const song of rows) {
        if (song.ms_played >= minPlayMs && (!first || song.playedAt < first.playedAt)) first = song;
    }
    if (!first) return null;
    return funCard('Where it started', funDate(first.playedAt), 'the first song you played', [{ type: 'song', key: first.songKey, value: '' }]);
}

// Artists in your top 10 for every year in the period (needs at least two years to mean anything)
function everPresentCard(rows) {
    const byYear = {};
    for (const song of rows) {
        if (!byYear[song.localYear]) byYear[song.localYear] = [];
        byYear[song.localYear].push(song);
    }
    const years = Object.keys(byYear).sort();
    if (years.length < 2) return null;
    const timesInTop = {};
    for (const year of years) {
        for (const [key] of topArtists(byYear[year]).slice(0, 10)) timesInTop[key] = (timesInTop[key] || 0) + 1;
    }
    const ranked = Object.keys(timesInTop).sort((a, b) => timesInTop[b] - timesInTop[a]);
    const every = ranked.filter(key => timesInTop[key] == years.length);
    // Nobody in it every year is common (a first or last year that's only partly there), so then it's whoever's closest
    const big = every.length > 0 ? `${every.length} artist${sOnEnd(every.length)}` : `${timesInTop[ranked[0]]} of ${years.length} years`;
    const detail = every.length > 0 ? `in your top 10 every year from ${years[0]} to ${years[years.length - 1]}`
                                    : `in your top 10 is the best anyone's managed, from ${years[0]} to ${years[years.length - 1]}`;
    return funCard('Ever-presents', big, detail,
        ranked.slice(0, 5).map(key => ({ type: 'artist', key: key, value: `top 10 in ${timesInTop[key]} of ${years.length} years` })));
}

// Songs you couldn't stop playing for a week, then barely touched: the busiest 7 days are most of their plays ever
function flingsCard(rows, all) {
    const ever = countBy(all, song => song.songKey);
    const times = {};
    for (const song of rows) {
        if (!song.songKey || song.ms_played < minPlayMs) continue;
        if (!times[song.songKey]) times[song.songKey] = [];
        times[song.songKey].push(song.playedAt);
    }
    const found = [];
    for (const key in times) {
        if (times[key].length < 15) continue;
        const t = times[key].sort((a, b) => a - b);
        let best = 0, bestStart = 0;
        for (let i = 0, j = 0; j < t.length; j++) {
            while (t[j] - t[i] >= 7 * dayMs) i++;
            if (j - i + 1 > best) {
                best = j - i + 1;
                bestStart = t[i];
            }
        }
        if (best >= 15 && best / ever[key] >= 0.7) found.push({ key: key, week: best, rest: ever[key] - best, start: bestStart });
    }
    if (found.length == 0) return null;
    found.sort((a, b) => b.week - a.week);
    return funCard('Flings', found.length.toLocaleString(), 'songs you played 15+ times in a week, and hardly ever again',
        found.slice(0, 5).map(f => ({ type: 'song', key: f.key, value: `${f.week} that week, ${f.rest} since` })));
}

// What you start and end your day with. A day runs from 5am, so a late night counts as the day before
function dayEnds(rows) {
    const first = {}, last = {};
    for (const song of rows) {
        if (!song.songKey || song.ms_played < minPlayMs) continue;
        const day = song.hour < 5 ? song.day - 1 : song.day;
        if (!first[day] || song.playedAt < first[day].playedAt) first[day] = song;
        if (!last[day] || song.playedAt > last[day].playedAt) last[day] = song;
    }
    return { first: Object.values(first), last: Object.values(last) };
}

function dayStartersCard(ends) {
    const firsts = ends.first;
    const counts = countBy(firsts, song => song.songKey);
    const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (ranked.length == 0 || counts[ranked[0]] < 2) return null;
    return funCard('Day starters', `${counts[ranked[0]]} mornings`, 'started with the same song, more than any other',
        ranked.slice(0, 5).map(key => ({ type: 'song', key: key, value: `${counts[key]} days` })));
}

function lastThingCard(ends) {
    const lasts = ends.last;
    const counts = countBy(lasts, song => song.songKey);
    const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (ranked.length == 0 || counts[ranked[0]] < 2) return null;
    return funCard('Last thing at night', `${counts[ranked[0]]} nights`, 'ended on the same song, more than any other',
        ranked.slice(0, 5).map(key => ({ type: 'song', key: key, value: `${counts[key]} nights` })));
}

// Your top song for each month, newest first (up to the last 12 in the period)
function songOfTheMonthCard(rows) {
    // Months as numbers (2026 * 12 + month), each with its own song counts and the best so far
    const months = new Map();
    for (const song of rows) {
        if (!song.songKey || song.ms_played < minPlayMs) continue;
        const month = Number(song.localYear) * 12 + song.localMonth;
        let m = months.get(month);
        if (!m) months.set(month, m = { counts: new Map(), best: null, bestCount: 0 });
        const count = (m.counts.get(song.songKey) || 0) + 1;
        m.counts.set(song.songKey, count);
        if (count > m.bestCount) {
            m.best = song.songKey;
            m.bestCount = count;
        }
    }
    const latest = [...months.keys()].sort((a, b) => b - a).slice(0, 12);
    if (latest.length < 2) return null;
    const monthName = month => new Date(Math.floor(month / 12), month % 12).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    return funCard('Song of the month', `${latest.length} months`, latest.length == 12 ? 'your top song for each of the last 12' : 'your top song for each one',
        latest.map(month => ({ type: 'song', key: months.get(month).best, value: monthName(month) })), '', true);
}

// --- Genres, from MusicBrainz ---
// None of the files say what genre anything is, so it's looked up on MusicBrainz, starting as soon as the files
// are processed, unless it's been stopped (which is remembered, until you press Carry on).
// Your top 100 artists, a bit slower than one a second (their limit), remembered in the browser so it's only done once.
// Each artist gets the genre most people have tagged them with, out of MusicBrainz's list of real genres
// (people tag things "seen live" and "american" too)
const genreSettingKey = 'unwrapper-genres-on';
const genreCacheKey = 'unwrapper-genres';
const genreListKey = 'unwrapper-genre-list';
const genreArtists = 100;
let genreLookup = { running: false, done: 0, total: 0, failed: 0 };

// On unless it's been stopped
function genresOn() {
    try {
        return localStorage.getItem(genreSettingKey) != 'off';
    } catch (err) {
        return true;
    }
}

function saveGenreSetting(on) {
    try {
        localStorage.setItem(genreSettingKey, on ? 'on' : 'off');
    } catch (err) {
        // Won't be remembered, but still works for now
    }
}

// Kicked off when the files are processed, so it's usually done by the time you look at the Fun tab
export function autoStartGenres() {
    if (genresOn()) startGenreLookup();
}

// The Stop button. Whatever's been looked up so far is kept
function stopGenreLookup() {
    genreLookup.stopped = true;
    saveGenreSetting(false);
    rerenderFun();
}

function genreCache() {
    try {
        return JSON.parse(localStorage.getItem(genreCacheKey) || '{}') || {};
    } catch (err) {
        return {};
    }
}

function saveGenreCache(cache) {
    try {
        localStorage.setItem(genreCacheKey, JSON.stringify(cache));
    } catch (err) {
        // Can't save, it'll look them up again next time
    }
}

// The artists worth looking up: most played across everything, so changing the date filter doesn't need more.
// Not ones whose genre's in the files already
function genreArtistKeys() {
    return topArtists(appState.data).slice(0, genreArtists).map(entry => entry[0]).filter(key => !appState.libraryGenres[key]);
}

// Genre for each artist key that has one: from the files' own tags first, then whatever's been looked up
function artistGenres() {
    const cache = genreCache();
    const genres = {};
    for (const key in appState.names.artist) {
        const found = appState.libraryGenres[key] || cache[key];
        if (found) genres[key] = found;
    }
    return genres;
}

// They answer 503 when it's too fast for them, or just busy (it happens a lot), so wait longer each time:
// 2, 4, 8, then 16 seconds until it's been about 2 minutes, then give up for now
async function getMusicBrainz(url) {
    let wait = 2000;
    for (let waited = 0; ; waited += wait, wait = Math.min(wait * 2, 16000)) {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (response.ok) return response;
        if (response.status != 503 || waited >= 120000) throw new Error(`${response.status} from MusicBrainz`);
        await new Promise(resolve => setTimeout(resolve, wait));
    }
}

async function genreList() {
    try {
        const saved = JSON.parse(localStorage.getItem(genreListKey) || 'null');
        if (Array.isArray(saved) && saved.length > 0) return new Set(saved);
    } catch (err) {
        // Look it up instead
    }
    const text = await (await getMusicBrainz('https://musicbrainz.org/ws/2/genre/all?fmt=txt')).text();
    const list = text.split('\n').map(line => line.trim()).filter(line => line);
    try {
        localStorage.setItem(genreListKey, JSON.stringify(list));
    } catch (err) {
        // Fine, it'll be fetched again next time
    }
    return new Set(list);
}

// One artist: by their MusicBrainz ID if the files have it, which is certain and quicker (it's not their busy search).
// Otherwise by name, where only a confident match (score 100) with the same name counts. Then their most tagged genre.
// Gives back the genre, or '' if there isn't one (remembered, so it's not looked up again)
async function lookUpGenre(key, genres) {
    const id = appState.artistIds[key];
    if (id) {
        const found = await (await getMusicBrainz(`https://musicbrainz.org/ws/2/artist/${id}?inc=genres&fmt=json`)).json();
        const ranked = (found.genres || []).sort((a, b) => b.count - a.count);
        return ranked.length > 0 ? ranked[0].name : '';
    }
    const artist = appState.names.artist[key].name;
    const query = encodeURIComponent(`artist:"${artist.replace(/"/g, '')}"`);
    const result = await (await getMusicBrainz(`https://musicbrainz.org/ws/2/artist/?query=${query}&fmt=json&limit=5`)).json();
    const match = (result.artists || []).find(a => a.score == 100 && nameKey(a.name) == nameKey(artist));
    if (!match) return '';
    const tags = (match.tags || []).filter(tag => genres.has(tag.name)).sort((a, b) => b.count - a.count);
    return tags.length > 0 ? tags[0].name : '';
}

async function startGenreLookup() {
    saveGenreSetting(true);
    // Carry on pressed straight after Stop, while the last one's still being fetched: just don't stop
    if (genreLookup.running) {
        genreLookup.stopped = false;
        rerenderFun();
        return;
    }
    const cache = genreCache();
    const todo = genreArtistKeys().filter(key => !(key in cache));
    if (todo.length == 0) return; // All done already
    genreLookup = { running: true, done: 0, total: todo.length, failed: 0, stopped: false };
    rerenderFun();
    try {
        const genres = await genreList();
        for (const key of todo) {
            if (genreLookup.stopped) break;
            // Counted from the start of each, so a slow answer doesn't make it slower still
            const started = Date.now();
            // If MusicBrainz is too busy, this throws and the rest wait for Try again (or the next visit)
            cache[key] = await lookUpGenre(key, genres);
            saveGenreCache(cache);
            genreLookup.done++;
            // The count goes up every time, but the cards only get redrawn every 20, since that's slow with years of data
            const status = document.getElementById('genre-status');
            if (status) status.textContent = genreStatusText();
            if (genreLookup.done % 20 == 0) rerenderFun();
            await new Promise(resolve => setTimeout(resolve, Math.max(0, 1500 - (Date.now() - started))));
        }
    } catch (err) {
        console.error("Couldn't look up genres:", err);
        genreLookup.failed = genreLookup.total - genreLookup.done;
    }
    genreLookup.running = false;
    rerenderFun();
    if (genreLookup.stopped) announce('Stopped looking up genres.');
    else announce(genreLookup.failed ? `MusicBrainz is busy, ${genreLookup.failed} artists are still to do.` : 'Genres looked up.');
}

function genreStatusText() {
    return ` Looking up artists, ${genreLookup.done} of ${genreLookup.total} so far...`;
}

function rerenderFun() {
    funCache = null; // There's more genres now, so it all needs working out again
    if (appState.currentView == 'fun') render();
}

// Shares of your listening by genre, out of the artists that have one
function genresCard(rows) {
    const left = genreArtistKeys().filter(key => !(key in genreCache())).length;

    const genres = artistGenres();
    const time = {};
    let covered = 0, total = 0;
    for (const song of rows) {
        total += song.ms_played;
        const genre = genres[song.artistKey];
        if (!genre) continue;
        time[genre] = (time[genre] || 0) + song.ms_played;
        covered += song.ms_played;
    }
    const ranked = Object.keys(time).sort((a, b) => time[b] - time[a]);
    // What it's up to, with Stop while it's going, and Carry on or Try again if there's more to do
    const button = (id, text) => `<button id="${id}" type="button" class="secondary-btn fun-action">${text}</button>`;
    let status = '';
    if (genreLookup.running && !genreLookup.stopped) {
        status = `<span id="genre-status">${genreStatusText()}</span>${button('genre-stop', 'Stop')}`;
    } else if (left > 0 && !genresOn()) {
        status = ` Stopped, with ${left} of your top ${genreArtists} artists still to look up on MusicBrainz. Only their names get sent.${button('genre-start', 'Carry on')}`;
    } else if (left > 0 && genreLookup.failed) {
        status = ` MusicBrainz is too busy at the moment, so ${left} artists are still to do.${button('genre-start', 'Try again')}`;
    }
    if (ranked.length == 0) {
        return funCard('Genres', '...', `None of your files say what genre anything is, so your top ${genreArtists} artists' names get looked up on MusicBrainz.${status}`);
    }

    return funCard('Top genres', ranked[0], `is your top genre, out of the ${Math.round(covered / total * 100)}% of your listening whose artists have one on MusicBrainz.${status}`,
        ranked.slice(0, 8).map(genre => ({ text: genre, value: `${Math.round(time[genre] / covered * 100)}%` })));
}

// Your top genre each year, like the eras on the Wrapped tab
function genreErasCard(rows) {
    const genres = artistGenres();
    const byYear = {};
    for (const song of rows) {
        const genre = genres[song.artistKey];
        if (!genre) continue;
        if (!byYear[song.localYear]) byYear[song.localYear] = {};
        byYear[song.localYear][genre] = (byYear[song.localYear][genre] || 0) + song.ms_played;
    }
    const years = Object.keys(byYear).sort().reverse();
    if (years.length < 2) return null;
    const top = year => Object.keys(byYear[year]).sort((a, b) => byYear[year][b] - byYear[year][a]);
    const changes = years.filter((year, i) => i < years.length - 1 && top(year)[0] != top(years[i + 1])[0]).length;
    return funCard('Genre eras', `${changes} change${sOnEnd(changes)}`, 'of top genre over the years. Your top two each year:',
        years.map(year => ({ text: year, value: top(year).slice(0, 2).join(', ') })));
}

// 14. Excluding things from the stats
// Anything excluded gets taken out of the data everything else works from, so all the numbers agree
const excludedStorageKey = 'unwrapper-excluded';

function applyExclusions() {
    const keys = { artist: {}, album: {}, song: {} };
    for (const ex of appState.excluded) keys[ex.type][ex.key] = true;
    appState.excludedKeys = keys;
    appState.data = appState.allData.filter(song => !isExcludedSong(song));

    // What's still left after excluding. Excluding an artist takes their songs and albums with them,
    // so checking the exclusions alone would still offer "Hot Mulligan Lofi" with Hot Mulligan excluded
    const left = { artist: {}, album: {}, song: {} };
    for (const song of appState.data) {
        if (song.artistKey) left.artist[song.artistKey] = true;
        if (song.albumKey) left.album[song.albumKey] = true;
        if (song.songKey) left.song[song.songKey] = true;
    }
    appState.leftKeys = left;

    // A line on the graph for something that's now excluded would just be flat, so take it off
    appState.graphSeries = appState.graphSeries.filter(pick => !isExcluded(pick.type, pick.key));
    updateExcludeButton();
}

// Excluded itself, or nothing of it left because its artist or album is
function isExcluded(type, key) {
    return appState.excludedKeys[type][key] == true || !appState.leftKeys[type][key];
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
            appState.excluded = saved.filter(ex => ex && typeNames[ex.type] && typeof ex.key == 'string' && typeof ex.label == 'string')
                                     // Saved before keys ignored curly apostrophes, guests and editions,
                                     // so turn them into today's keys or they'd stop matching
                                     .map(ex => ({ ...ex, key: upgradeKey(ex.type, nameKey(ex.key)) }));
        }
    } catch (err) {
        appState.excluded = [];
    }
}

// An exclusion saved before names were tidied has the key the old way ("artist\nalbum (deluxe)").
// If it doesn't match anything now, find a play that had that old key and use its key today
function upgradeKey(type, key) {
    if (appState.names[type][key]) return key;
    const field = { artist: 'artistKey', album: 'albumKey', song: 'songKey' }[type];
    for (const song of appState.allData) {
        const artist = song.master_metadata_album_artist_name;
        const second = type == 'album' ? song.master_metadata_album_album_name : song.master_metadata_track_name;
        if (!artist || (type != 'artist' && !second)) continue;
        const old = nameKey(type == 'artist' ? artist : `${artist}\n${second}`);
        if (old == key) return song[field];
    }
    return key;
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
