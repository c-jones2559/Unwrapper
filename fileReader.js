import { calculateStats, clearStats, announce } from './statsProcessor.js?v=11';

// 1. Helper function to promise-ify the FileReader (makes life way easier)
const readJsonFile = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                // I'm attaching the filename too, so you know which file the data came from
                resolve({ 
                    sourceFile: file.name, 
                    content: json 
                }); 
            } catch (err) {
                reject(`That file (${file.name}) is proper knacked. Invalid JSON.`);
            }
        };
        
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
};

// 2. The Event Listener
document.getElementById('processBtn').addEventListener('click', async () => {
    const inputElement = document.getElementById('input');
    const button = document.getElementById('processBtn');

    if (!inputElement.files.length) {
        alert("Hold on, you haven't selected any files yet!");
        return;
    }

    // Show it's doing something, years of data can take a few seconds.
    // Disabled too so it can't get clicked again halfway through
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>Processing...`;
    announce("Processing your files...");

    try {
        const promises = Array.from(inputElement.files).map(readJsonFile);
        const combinedData = await Promise.all(promises);

        // The rest is one long go with no breaks, and the page can't redraw until it's finished,
        // so wait a frame first to make sure the spinner's actually on screen
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

        let songs = [];
        for (const file of combinedData) {
            if (Array.isArray(file.content)) {
                songs = songs.concat(file.content);
            } else {
                songs.push(file.content);
            }
        }
        
        songs = fromAccountData(songs);
        checkValid(songs);

    } catch (error) {
        console.error("Error: ", error);
        // Say what went wrong on the page as well, otherwise the spinner just stops and nothing happens.
        // Anything from an earlier upload goes too, or a tab click would quietly bring it back
        clearStats();
        const message = typeof error == "string" ? error : "Something went wrong reading those files.";
        document.getElementById("content-viewport").textContent = message;
        announce(message);
    } finally {
        button.disabled = false;
        button.textContent = "Process";
    }
});

// Once there are stats the upload area's just a Change files button, which brings it back
document.getElementById('change-files').addEventListener('click', (e) => {
    document.getElementById('upload').classList.remove('hidden');
    e.target.classList.add('hidden');
    document.getElementById('input').focus();
});

function checkValid (songs) {
    const stats = document.getElementById("content-viewport");

    stats.innerHTML = "Checking file is valid, hold on a second...";

    for (let i = 0; i < songs.length; i++) {
        // Only need ts and ms_played, anything else Spotify adds later can just be ignored
        const song = songs[i];
        if (song == null || typeof song.ts != "string" || isNaN(Date.parse(song.ts)) || typeof song.ms_played != "number") {
            console.error(`Files invalid. Row ${i} is missing ts or ms_played.`);
            // Thrown so it ends up in the same place as every other error, which clears out any old stats
            throw "That doesn't look like a Spotify listening history. You want the Streaming_History_Audio files from Extended streaming history, see the info page for how to get them.";
        }
    }

    const unique = removeDuplicates(songs);
    // An empty file, or nothing but podcasts, would otherwise make a card for "My NaN–NaN"
    if (!unique.some(song => song.master_metadata_track_name)) {
        throw "There aren't any music plays in those files. Podcasts and audiobooks get left out, so pick the Streaming_History_Audio files with your songs in.";
    }
    stats.innerHTML = "(Valid file, processing...)";
    calculateStats(unique);
    return;
}

// The "Account data" download (the one that only goes back a year) has its own names for things:
// endTime, artistName, trackName and msPlayed, and no album. endTime is UTC like ts, but written
// "2023-01-01 12:34", which some browsers won't read, so it's turned into a proper one here
function fromAccountData(songs) {
    const isOld = song => song != null && song.ts == null && typeof song.endTime == "string" && typeof song.msPlayed == "number";
    if (!songs.some(isOld)) return songs;

    // The same plays would be in an extended file too, but without a track URI or seconds
    // to match on they can't be spotted as duplicates, so if there's an extended file just use that
    if (songs.some(song => song != null && song.ts != null)) {
        console.log("Got Account data and Extended streaming history together, using the extended one");
        return songs.filter(song => !isOld(song));
    }

    return songs.map(song => {
        if (!isOld(song)) return song;
        return {
            ts: `${song.endTime.replace(' ', 'T')}:00Z`,
            ms_played: song.msPlayed,
            // Podcasts in this download have episodeName instead of trackName, so they stay out of the music stats
            master_metadata_track_name: song.trackName || null,
            master_metadata_album_artist_name: song.artistName || null,
            master_metadata_album_album_name: null
        };
    });
}

// Spotify's files overlap a bit, so the same play can turn up in two of them
function removeDuplicates (songs) {
    const seen = {};
    let unique = [];
    for (const song of songs) {
        const uri = song.spotify_track_uri || song.spotify_episode_uri || song.audiobook_chapter_uri;
        const key = `${song.ts}|${uri}|${song.ms_played}`;
        if (seen[key]) {
            continue;
        }
        seen[key] = true;
        unique.push(song);
    }
    console.log(`Removed ${songs.length - unique.length} duplicates.`);
    return unique;
}

