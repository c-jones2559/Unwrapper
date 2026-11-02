// Tests for plays.js, run with: node --test
// Small made-up plays, each one for something that's caught the grouping out before
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromAccountData, removeDuplicates, capNavidromePlays, nameKey, withoutFeatures, albumBase,
         buildNameKeys, firstGenre, minPlayMs } from '../plays.js';

// One play. Times are minutes from the start, so gaps are easy to read
function play(artist, track, album, extra = {}) {
    return {
        ts: '2026-01-01T00:00:00Z',
        ms_played: 200000,
        master_metadata_album_artist_name: artist,
        master_metadata_track_name: track,
        master_metadata_album_album_name: album,
        ...extra
    };
}

// The artist names after grouping, sorted so the order doesn't matter
function artistNames(songs) {
    const { names } = buildNameKeys(songs);
    return Object.values(names.artist).map(a => a.name).sort();
}

function albumNames(songs) {
    const { names } = buildNameKeys(songs);
    return Object.values(names.album).map(a => `${a.name} - ${a.artist}`).sort();
}

// --- Reading the files ---

test('Account data rows become normal plays, with the time read as UTC', () => {
    const [song] = fromAccountData([{ endTime: '2023-01-01 12:34', artistName: 'Hot Mulligan', trackName: 'Feelings of Neglect', msPlayed: 200000 }]);
    assert.equal(song.ts, '2023-01-01T12:34:00Z');
    assert.equal(song.ms_played, 200000);
    assert.equal(song.master_metadata_album_artist_name, 'Hot Mulligan');
    assert.equal(song.master_metadata_track_name, 'Feelings of Neglect');
    assert.equal(song.master_metadata_album_album_name, null);
});

test('Account data podcasts have no track name, so they stay out of the music', () => {
    const [song] = fromAccountData([{ endTime: '2023-01-01 12:34', podcastName: 'Pod', episodeName: 'Ep', msPlayed: 1000 }]);
    assert.equal(song.master_metadata_track_name, null);
});

test('Account data is dropped when there is an extended file too, so plays are not counted twice', () => {
    const songs = fromAccountData([
        { endTime: '2023-01-01 12:34', artistName: 'A', trackName: 'B', msPlayed: 1000 },
        play('A', 'B', 'C')
    ]);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].ts, '2026-01-01T00:00:00Z');
});

test('Extended files on their own are left as they are', () => {
    const songs = [play('A', 'B', 'C')];
    assert.equal(fromAccountData(songs), songs);
});

test('The same play in two files is only kept once', () => {
    const one = play('A', 'B', 'C', { spotify_track_uri: 'spotify:track:1' });
    const again = { ...one };
    const other = play('A', 'B', 'C', { spotify_track_uri: 'spotify:track:1', ms_played: 1234 });
    assert.equal(removeDuplicates([one, again, other]).length, 2);
});

// --- Navidrome listening time ---

function navidrome(minutes, length) {
    return { platform: 'navidrome', playedAt: minutes * 60000, ms_played: length };
}

test('Navidrome plays are cut off at the next play, but never below 30 seconds, and the last is left alone', () => {
    const plays = [navidrome(0, 300000), navidrome(2, 300000), navidrome(2.2, 300000), navidrome(10, 300000)];
    capNavidromePlays(plays);
    assert.deepEqual(plays.map(p => p.ms_played), [120000, minPlayMs, 300000, 300000]);
});

test('Spotify plays are never cut off, since they say how long you listened', () => {
    const spotify = { platform: 'android', playedAt: 0, ms_played: 300000 };
    capNavidromePlays([spotify, navidrome(1, 300000)]);
    assert.equal(spotify.ms_played, 300000);
});

// --- Tidying names ---

test('Curly apostrophes, dashes and capitals all make the same key', () => {
    assert.equal(nameKey('I Don’t Need Anyone'), nameKey("i don't need anyone"));
    assert.equal(nameKey('e‐girl'), nameKey('e-girl'));
});

test('Guests come off artists and songs', () => {
    assert.equal(withoutFeatures('Machine Gun Kelly feat. Halsey'), 'Machine Gun Kelly');
    assert.equal(withoutFeatures('forget me too (feat. Halsey)'), 'forget me too');
    assert.equal(withoutFeatures('iSpy (feat. Lil Yachty)'), 'iSpy');
    assert.equal(withoutFeatures('Song [with Someone]'), 'Song');
    assert.equal(withoutFeatures('Daft Punk'), 'Daft Punk');
    assert.equal(withoutFeatures('Left Behind'), 'Left Behind');
});

test('Edition names come off albums', () => {
    assert.equal(albumBase('Tickets to My Downfall (SOLD OUT Deluxe)', false), 'Tickets to My Downfall');
    assert.equal(albumBase('Hybrid Theory [Remastered 2020]', false), 'Hybrid Theory');
    assert.equal(albumBase('Panic Vertigo - EP', false), 'Panic Vertigo');
});

test('Anything that makes it a different record stays on', () => {
    assert.equal(albumBase('Dude Ranch (Completely Covered)', false), 'Dude Ranch (Completely Covered)');
    assert.equal(albumBase('Dude Ranch (Completely Covered)', true), 'Dude Ranch (Completely Covered)');
    assert.equal(albumBase('Live at Wembley (Live)', true), 'Live at Wembley (Live)');
    assert.equal(albumBase('Greatest Hits (Vol. 2)', true), 'Greatest Hits (Vol. 2)');
    assert.equal(albumBase("1989 (Taylor's Version)", false), "1989 (Taylor's Version)");
});

test('Other bracketed bits only come off when asked', () => {
    assert.equal(albumBase('Tickets to My Downfall (All Access)', false), 'Tickets to My Downfall (All Access)');
    assert.equal(albumBase('Tickets to My Downfall (All Access)', true), 'Tickets to My Downfall');
});

test('Library genres are the first one, lowercase', () => {
    assert.equal(firstGenre('Pop Punk; Emo'), 'pop punk');
    assert.equal(firstGenre('Rock/Pop'), 'rock');
    assert.equal(firstGenre(''), null);
    assert.equal(firstGenre(null), null);
});

// --- Grouping ---

test('Names that only differ in capitals or apostrophes are one artist, shown the way most plays spell it', () => {
    assert.deepEqual(artistNames([
        play('Bring Me The Horizon', 'a', 'x'), play('Bring Me The Horizon', 'b', 'x'), play('Bring Me the Horizon', 'c', 'x')
    ]), ['Bring Me The Horizon']);
    assert.deepEqual(artistNames([play('Guns N’ Roses', 'a', 'x'), play("Guns N' Roses", 'a', 'x')]).length, 1);
});

test('A guest on the artist still counts as the main artist', () => {
    assert.deepEqual(artistNames([
        play('Machine Gun Kelly', 'a', 'Tickets'), play('Machine Gun Kelly feat. Halsey', 'forget me too', 'Tickets')
    ]), ['Machine Gun Kelly']);
});

test('A collaboration on the main artist\'s album counts as theirs', () => {
    assert.deepEqual(artistNames([
        play('Machine Gun Kelly', 'a', 'Tickets'), play('Machine Gun Kelly & Travis Barker', 'b', 'Tickets')
    ]), ['Machine Gun Kelly']);
});

test('A band with & in the name is left alone when there is no album to tie it to', () => {
    assert.deepEqual(artistNames([
        play('Prince Daddy & the Hyena', 'a', 'Cosmic Thrill Seekers'), play('Prince', 'Purple Rain', 'Purple Rain')
    ]), ['Prince', 'Prince Daddy & the Hyena']);
});

test('A renamed artist (same album, 3+ same songs) is one artist under the most played name', () => {
    const songs = [];
    for (const track of ['a', 'b', 'c']) songs.push(play('Machine Gun Kelly', track, 'Tickets to My Downfall (SOLD OUT Deluxe)'));
    for (const track of ['a', 'b', 'c', 'd']) songs.push(play('mgk', track, 'Tickets to My Downfall (SOLD OUT Deluxe)'));
    assert.deepEqual(artistNames(songs), ['mgk']);
});

test('Two songs in common is not enough to call it a rename', () => {
    const songs = [play('One', 'a', 'Album'), play('One', 'b', 'Album'), play('Two', 'a', 'Album'), play('Two', 'b', 'Album')];
    assert.equal(artistNames(songs).length, 2);
});

test('A covers album with the same songs is not the original band renamed', () => {
    const songs = [];
    for (const track of ['Dammit', 'Apple Shampoo', 'Boring']) {
        songs.push(play('blink-182', track, 'Dude Ranch'));
        songs.push(play('new.wav', track, 'Dude Ranch (Completely Covered)'));
    }
    assert.deepEqual(artistNames(songs), ['blink-182', 'new.wav']);
});

test('The same MusicBrainz artist ID is one artist, whatever the names', () => {
    const id = '12a9e259-f7cb-4fca-87b1-a6c5fd38c300';
    const songs = [play('Machine Gun Kelly', 'a', 'One', { artist_mbid: id }), play('mgk', 'b', 'Two', { artist_mbid: id }),
                   play('mgk', 'c', 'Two', { artist_mbid: id })];
    const { names, ids } = buildNameKeys(songs);
    assert.deepEqual(Object.values(names.artist).map(a => a.name), ['mgk']);
    assert.deepEqual(Object.values(ids), [id]);
});

test('Junk in the ID field is ignored', () => {
    const { ids } = buildNameKeys([play('A', 'a', 'x', { artist_mbid: 'not an id' })]);
    assert.deepEqual(ids, {});
});

test('Library genres are kept for each artist, most common first', () => {
    const { genres } = buildNameKeys([
        play('Hot Mulligan', 'a', 'x', { genre: 'Emo' }), play('Hot Mulligan', 'b', 'x', { genre: 'Emo' }),
        play('Hot Mulligan', 'c', 'x', { genre: 'Pop Punk' }), play('Nobody', 'd', 'y')
    ]);
    assert.deepEqual(genres, { 'hot mulligan': 'emo' });
});

test('Editions of an album are one album, shown without the edition', () => {
    assert.deepEqual(albumNames([
        play('mgk', 'a', 'Tickets To My Downfall'), play('mgk', 'b', 'Tickets To My Downfall'),
        play('mgk', 'c', 'Tickets to My Downfall (SOLD OUT Deluxe)'), play('mgk', 'd', 'Tickets to My Downfall (All Access)')
    ]), ['Tickets To My Downfall - mgk']);
});

test('Bracketed bits that are not editions stay when there is no plain album to merge into', () => {
    assert.deepEqual(albumNames([play('A', 'a', 'Songs (All Access)')]), ['Songs (All Access) - A']);
});

test('Every play gets its keys, and songs and albums say the artist\'s own name', () => {
    const songs = [play('Machine Gun Kelly feat. Halsey', 'forget me too (feat. Halsey)', 'Tickets'), play('Machine Gun Kelly', 'x', 'Tickets')];
    const { names } = buildNameKeys(songs);
    assert.equal(songs[0].artistKey, 'machine gun kelly');
    assert.equal(songs[0].songKey, 'machine gun kelly\nforget me too');
    assert.equal(songs[0].albumKey, 'machine gun kelly\ntickets');
    assert.equal(names.song[songs[0].songKey].artist, 'Machine Gun Kelly');
});
