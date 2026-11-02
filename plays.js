// Turning the files into plays and grouping their names. Nothing in here touches the page, so it can be
// tested on its own (see tests/), and statsProcessor.js and fileReader.js use it

// Spotify only counts it as a play after 30 seconds, anything less is a skip
export const minPlayMs = 30000;

// The "Account data" download (the one that only goes back a year) has its own names for things:
// endTime, artistName, trackName and msPlayed, and no album. endTime is UTC like ts, but written
// "2023-01-01 12:34", which some browsers won't read, so it's turned into a proper one here
export function fromAccountData(songs) {
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
export function removeDuplicates (songs) {
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

// Navidrome doesn't say how long you listened, so the export counts every play as the whole song.
// It counts a play about halfway through though, so skipping later still gets the full length.
// A play can't have lasted longer than it was until the next one, so cut it off there. Never below
// 30 seconds, since Navidrome had already decided it was a play, and the last one's left as it is
export function capNavidromePlays(songs) {
    const plays = songs.filter(song => song.platform == 'navidrome').sort((a, b) => a.playedAt - b.playedAt);
    for (let i = 0; i < plays.length - 1; i++) {
        const gap = plays[i + 1].playedAt - plays[i].playedAt;
        plays[i].ms_played = Math.min(plays[i].ms_played, Math.max(gap, minPlayMs));
    }
}

// The key a name gets grouped (and searched) by. Lowercase, and curly apostrophes and the various
// dashes all made plain, since Spotify and Navidrome write "I Don’t Need Anyone" and "I Don't Need Anyone"
export function nameKey(text) {
    return text.toLowerCase()
        .replace(/[‘’‛ʼ`´]/g, "'")
        .replace(/[“”‟]/g, '"')
        .replace(/[‐‑‒–—―−]/g, '-');
}

// Gives back { names, ids, genres }: how to spell each key ({ artist, song, album }), and each artist key's
// MusicBrainz ID and genre where the files have them. Also sets artistKey, songKey and albumKey on every play.
//
// Spotify and Navidrome don't always agree on capitals ("Bring Me The Horizon" vs "Bring Me the Horizon")
// or punctuation, so everything's grouped by nameKey. They're worked out once on load rather than every render,
// and each key shows whichever spelling turns up most across all the data, so names don't change with the filter
//
// Names also get tidied so the same thing isn't split in two:
//  - Guests come off: "Machine Gun Kelly feat. Halsey" is Machine Gun Kelly, "forget me too (feat. Halsey)" is forget me too
//  - Editions come off albums: "Tickets to My Downfall (SOLD OUT Deluxe)" is Tickets to My Downfall
//  - "Machine Gun Kelly & Travis Barker" on a Machine Gun Kelly album counts as Machine Gun Kelly. Only on
//    one of their albums though, so a band like "Prince Daddy & the Hyena" stays as it is
//  - Two names with the same album and the same songs on it are one artist who's been renamed ("mgk")
export function buildNameKeys(songs) {
    // 1. Each play on its own: guests off the artist and title, edition names off the album
    const parts = songs.map(song => {
        const artist = song.master_metadata_album_artist_name;
        const track = song.master_metadata_track_name;
        const album = song.master_metadata_album_album_name;
        return {
            artist: artist ? tidied('artist', artist, () => nameKey(withoutFeatures(artist))) : null,
            track: track ? tidied('track', track, () => nameKey(withoutFeatures(track))) : null,
            album: album ? tidied('album', album, () => nameKey(albumBase(album, false))) : null,
            exactAlbum: album ? tidied('exactAlbum', album, () => nameKey(album)) : null, // As it was, for spotting renames
            plainAlbum: false // Set if step 4 takes the rest of the brackets off too
        };
    });

    // 2. Collaborations on someone's album count as theirs. Worked out once per artist on each album, not every play
    const onAlbum = artistsOnAlbums(parts, 'album');
    const collabs = {};
    for (const album in onAlbum) {
        for (const artist in onAlbum[album]) {
            for (const other in onAlbum[album]) {
                if (other != artist && collabJoins.some(join => artist.startsWith(other + join))) {
                    collabs[`${album}\n${artist}`] = other;
                    break;
                }
            }
        }
    }
    for (const p of parts) {
        if (!p.artist || !p.album) continue;
        const main = collabs[`${p.album}\n${p.artist}`];
        if (main) p.artist = main;
    }

    // 3. Renamed artists. If two names have the same album with at least 3 of the same songs on it,
    // they're the same artist, and they get grouped under whichever's played most. The album has to be
    // spelled exactly the same, edition and all, so a covers album ("Dude Ranch (Completely Covered)") doesn't count
    const plays = {};
    for (const p of parts) {
        if (p.artist) plays[p.artist] = (plays[p.artist] || 0) + 1;
    }
    const sameAs = {};
    const find = artist => {
        while (sameAs[artist]) artist = sameAs[artist];
        return artist;
    };
    const join = (one, other) => {
        const a = find(one), b = find(other);
        if (a == b) return;
        if (plays[a] >= plays[b]) sameAs[b] = a;
        else sameAs[a] = b;
    };

    // A MusicBrainz artist ID (newer Navidrome exports have them) settles it for certain
    const byId = {};
    for (let i = 0; i < songs.length; i++) {
        const id = artistId(songs[i]);
        if (!id || !parts[i].artist) continue;
        if (byId[id]) join(byId[id], parts[i].artist);
        else byId[id] = parts[i].artist;
    }

    // Otherwise it's the same album with the same songs on it
    const albums = artistsOnAlbums(parts, 'exactAlbum');
    for (const album in albums) {
        const artists = Object.keys(albums[album]);
        if (artists.length > 20) continue; // A compilation, nobody's been renamed in there
        for (let i = 0; i < artists.length; i++) {
            for (let j = i + 1; j < artists.length; j++) {
                let shared = 0;
                for (const track of albums[album][artists[i]]) {
                    if (albums[album][artists[j]].has(track)) shared++;
                }
                if (shared >= 3) join(artists[i], artists[j]);
            }
        }
    }
    for (const p of parts) {
        if (p.artist) p.artist = find(p.artist);
    }

    // 4. Anything else in brackets ("(All Access)") comes off if the artist's got the album without it too.
    // Not before then, since it could be a different album
    const theirAlbums = {};
    for (const p of parts) {
        if (p.album) theirAlbums[`${p.artist}\n${p.album}`] = true;
    }
    for (const p of parts) {
        if (!p.album) continue;
        const plain = albumBase(p.album, true);
        if (plain != p.album && theirAlbums[`${p.artist}\n${plain}`]) {
            p.album = plain;
            p.plainAlbum = true;
        }
    }

    // 5. The keys, and how to spell each one. Each artist's ID and genre too, if their plays have them
    const spellings = { artist: {}, song: {}, album: {} };
    const ids = {}, genres = {};
    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];
        const p = parts[i];
        const artist = song.master_metadata_album_artist_name;
        const track = song.master_metadata_track_name;
        const album = song.master_metadata_album_album_name;
        if (artist) {
            song.artistKey = p.artist;
            const name = tidied('artistName', artist, () => withoutFeatures(artist));
            countSpelling(spellings.artist, song.artistKey, name, { name: name });
            const id = artistId(song);
            if (id) countSpelling(ids, song.artistKey, id, id);
            const genre = firstGenre(song.genre);
            if (genre) countSpelling(genres, song.artistKey, genre, genre);
        }
        if (track) {
            // Key on artist too, otherwise every song called "Intro" gets lumped together
            song.songKey = `${p.artist}\n${p.track}`;
            countSpelling(spellings.song, song.songKey, track, { name: track });
        }
        if (album) {
            // Same as songs, loads of artists have an album called "Greatest Hits"
            song.albumKey = `${p.artist}\n${p.album}`;
            const name = p.plainAlbum ? tidied('plainAlbumName', album, () => albumBase(album, true))
                                      : tidied('albumName', album, () => albumBase(album, false));
            countSpelling(spellings.album, song.albumKey, name, { name: name });
        }
    }

    const names = { artist: {}, song: {}, album: {} };
    for (const type in spellings) {
        for (const key in spellings[type]) {
            names[type][key] = commonest(spellings[type][key]);
        }
    }
    // Songs and albums say whose they are with the artist's own name, not whichever spelling that play had
    for (const type of ['song', 'album']) {
        for (const key in names[type]) {
            const artistKey = key.slice(0, key.indexOf('\n'));
            const artist = names.artist[artistKey];
            names[type][key] = { ...names[type][key], artist: artist ? artist.name : '' };
        }
    }
    const most = counts => Object.fromEntries(Object.keys(counts).map(key => [key, commonest(counts[key])]));
    return { names: names, ids: most(ids), genres: most(genres) };
}

// The play's MusicBrainz artist ID, if it has one. Just the first if there's a few ("id1;id2" for a collaboration)
function artistId(song) {
    if (typeof song.artist_mbid != 'string') return null;
    const id = song.artist_mbid.split(/[;,/\s]+/)[0].toLowerCase();
    return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

// Genre tags from a music library come however they were typed ("Pop Punk", "Rock; Pop"),
// so it's just the first, lowercase to match MusicBrainz's ("pop punk")
export function firstGenre(genre) {
    if (typeof genre != 'string') return null;
    const first = genre.split(/[;,/|]/)[0].trim().toLowerCase();
    return first || null;
}

// What joins two artists in a collaboration, after the main one (keys are lowercase)
const collabJoins = [' & ', ', ', ' x ', ' and ', ' with ', ' + ', ' / '];

// Everyone on each album, and which of its songs they've got: { album: { artist: Set of tracks } }.
// field says which album name to go by, the tidied one or exactly as it was
function artistsOnAlbums(parts, field) {
    const albums = {};
    for (const p of parts) {
        const album = p[field];
        if (!p.artist || !album) continue;
        if (!albums[album]) albums[album] = {};
        if (!albums[album][p.artist]) albums[album][p.artist] = new Set();
        if (p.track) albums[album][p.artist].add(p.track);
    }
    return albums;
}

// The same names turn up thousands of times, so each one's only tidied once
const tidyCache = {};
function tidied(type, text, tidy) {
    if (!tidyCache[type]) tidyCache[type] = new Map();
    let result = tidyCache[type].get(text);
    if (result === undefined) {
        result = tidy();
        tidyCache[type].set(text, result);
    }
    return result;
}

// "Machine Gun Kelly feat. Halsey" to "Machine Gun Kelly", "forget me too (feat. Halsey)" to "forget me too"
export function withoutFeatures(text) {
    return text.replace(/\s*[(\[](?:feat|ft|featuring|with)\.?\s[^)\]]*[)\]]/gi, '')
               .replace(/\s+(?:feat|ft|featuring)\.?\s.*$/i, '')
               .trim() || text;
}

// Takes edition names off the end of an album: "(Deluxe)", "[Remastered 2011]", " - EP".
// Anything that makes it a different record ("(Live)", "(Vol. 2)", "(Taylor's Version)") stays on.
// With anyBrackets, whatever else is in brackets comes off too ("(All Access)")
const differentRecord = /\blive\b|acoustic|remix|instrumental|karaoke|unplugged|\bdemos?\b|taylor'?s version|reimagined|commentary|cover|tribute|\bvol\b|volume|\bpart\b|\bpt\b|chapter|\bact\b|\bdisc\b|\bside\b/i;
const editionName = /deluxe|edition|expanded|remaster|anniversary|bonus|special|\bcomplete\b|version|\bep\b|single|explicit|clean|extended/i;
export function albumBase(title, anyBrackets) {
    let base = title;
    for (;;) {
        const match = base.match(/^(.+?)\s*(\([^()]*\)|\[[^\[\]]*\]|\s-\s[^-]+)$/);
        if (!match || differentRecord.test(match[2])) return base;
        if (!anyBrackets && !editionName.test(match[2])) return base;
        base = match[1];
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

