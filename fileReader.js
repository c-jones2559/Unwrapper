import { calculateStats } from './statsProcessor.js';

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

    if (!inputElement.files.length) {
        alert("Hold on, you haven't selected any files yet!");
        return;
    }

    try {
        const promises = Array.from(inputElement.files).map(readJsonFile);
        const combinedData = await Promise.all(promises);

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
    }
});

const validFields = [
    "ts",
    "platform",
    "ms_played",
    "conn_country",
    "ip_addr",
    "master_metadata_track_name",
    "master_metadata_album_artist_name",
    "master_metadata_album_album_name",
    "spotify_track_uri",
    "episode_name",
    "episode_show_name",
    "spotify_episode_uri",
    "audiobook_title",
    "audiobook_uri",
    "audiobook_chapter_uri",
    "audiobook_chapter_title",
    "reason_start",
    "reason_end",
    "shuffle",
    "skipped",
    "offline",
    "offline_timestamp",
    "incognito_mode"
]

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
        
        for (const key of Object.keys(songs[i])) {        
            if (validFields.includes(key)) {
                continue;
            } else {
                console.error(`Files invalid. Found unexpected key: ${key}`);
                stats.innerHTML = "Invalid, please enter a different file. See help for more details. (help hasn't been implemented yet)";
                return;
            }
        }
        //console.log(`All keys valid for file ${i}.`);
    }
    console.log("[============] 100%");
    console.log("File valid!");
    stats.innerHTML = "(Valid file, processing...)";
    calculateStats(songs);
    return;
}

