import { calculateStats } from './statsProcessor.js?v=6';

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
        
        console.log("All songs:", songs);
        checkValid(songs);

    } catch (error) {
        console.error("Error: ", error);
        // Say what went wrong on the page as well, otherwise the spinner just stops and nothing happens
        document.getElementById("content-viewport").textContent =
            typeof error == "string" ? error : "Something went wrong reading those files.";
    } finally {
        button.disabled = false;
        button.textContent = "Process";
    }
});

function checkValid (songs) {
    console.log("Checking valid...");
    const stats = document.getElementById("content-viewport");

    stats.innerHTML = "Checking file is valid, hold on a second...";

    const quarter = Math.floor(songs.length/4);
    for (let i = 0; i < songs.length; i++) {
        if (i == 0) {
            console.log("[>-----------] 0%")
        } else if (i == quarter) {
            console.log("[===>--------] 25%")
        } else if (i == quarter*2) {
            console.log("[======>-----] 50%")
        } else if (i == quarter*3) {
            console.log("[=========>--] 75%")
        } else if (i == songs.length-1) {
            console.log("[===========>] 99%")
        }

        // Only need ts and ms_played, anything else Spotify adds later can just be ignored
        const song = songs[i];
        if (song == null || typeof song.ts != "string" || isNaN(Date.parse(song.ts)) || typeof song.ms_played != "number") {
            console.error(`Files invalid. Row ${i} is missing ts or ms_played.`);
            stats.innerHTML = "Invalid, please enter a different file. See help for more details. (help hasn't been implemented yet)";
            return;
        }
    }
    console.log("[============] 100%");
    console.log("File valid!");
    stats.innerHTML = "(Valid file, processing...)";
    calculateStats(removeDuplicates(songs));
    return;
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

