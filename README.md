# Unwrapper

You're probably wondering *"why's Chris sent me this?"*, or *"can't I just wait for Wrapped?"*

You could, but Wrapped only covers one year, only shows you what Spotify picks out, and it's gone a month later. Spotify will actually send you every song you've ever played if you ask for it. Unwrapper turns that into proper lists and graphs, for any stretch of time you like, from your whole history down to a single day.

Try it at **[unwrapper.cjones.cymru](https://unwrapper.cjones.cymru)**.

## Getting your data

1. Go to Spotify's [privacy settings](https://www.spotify.com/us/account/privacy/), tick **Extended streaming history** and request it. "Account data" works too, but only goes back a year.
2. Confirm the email they send you, then wait. They say it can take up to 30 days, but it's usually a few.
3. When it turns up, unzip it, open the site and pick all the `Streaming_History_Audio` files at once, then press Process.

The video and podcast files are fine to include too, they just get left out of the music stats.

## What you can do with it

- See your top songs, artists and albums for all time, a year, a month, or any dates you pick.
- Sort by how many times you played something, or by how long you actually spent listening to it (in the settings, behind the gear).
- Graph your listening over time. Click anything in the lists, or search for it, to put it on the graph, and compare up to eight artists, albums or songs at once. Click a month or drag across a stretch to zoom in (right-click to zoom back out). The lists follow the same dates, and you can filter both by artist, album or song from either one, so you can see exactly what you were playing.
- Right-click (or tap and hold on a phone) anything in the lists or on the Fun tab to see it on the graph, find it on Spotify, or exclude it.
- Make your own Wrapped for any year, or all time: your top artists, songs and album and how many minutes you listened, on a card to share, in whatever colours you like. Your eras are underneath, your top artists year by year.
- Dig through the Fun tab: new and forgotten artists, your genres, ever-presents, ones where you only ever play one song, your skip rate, flings, guilty pleasures, what you start and end the day with, your song of each month, your biggest day, longest streak, comebacks, what time you listen and more. It follows the date filter too.
- Exclude anything you don't want counted, like sleep sounds or someone else using your account (also in the settings). It's remembered for next time.

## How it counts

A play only counts if you listened for at least 30 seconds, which is the same rule Spotify uses. Anything shorter still adds to your listening time. Podcasts and audiobooks are left out, Spotify's files overlap a bit so duplicates get removed, and names are grouped ignoring capitals and apostrophes, so "Bring Me The Horizon" and "Bring Me the Horizon" count as the same band. Guest credits ("feat. Halsey") and edition names ("(Deluxe)", "[Remastered]") are left off too, collaborations on an artist's own album count as theirs, and an artist who's been renamed (Machine Gun Kelly to mgk) is spotted from having the same album with the same songs on it.

## Privacy

I'm a computer scientist, not a data harvester. Everything happens in your browser: your files never get uploaded anywhere, I never see them and neither does the server.

The one exception is album covers on the Wrapped card. For each year you look at on the Wrapped tab, it looks for the cover of that year's top artist's top album, so the artist and album names get looked up on Apple's iTunes search. Nothing else gets sent, and you can turn it off under Customise, which it remembers.

Genres on the Fun tab are the other one. Your files don't say what genre anything is, so if you press Look up genres, the names of your top 100 artists get looked up on [MusicBrainz](https://musicbrainz.org/). That only happens if you ask, and the answers are kept in your browser so it's only done once.

## Moved off Spotify?

If you've gone self-hosted with [Navidrome](https://www.navidrome.org/) (0.59 or newer), it keeps its own record of every play, and you can export that in the same format. On your server, in Navidrome's data folder (the one with `navidrome.db` in it), run:

```bash
sqlite3 -readonly navidrome.db "
SELECT json_group_array(json_object(
  'ts', strftime('%Y-%m-%dT%H:%M:%SZ', s.submission_time, 'unixepoch'),
  'ms_played', CAST(m.duration * 1000 AS INTEGER),
  'platform', 'navidrome',
  'master_metadata_track_name', m.title,
  'master_metadata_album_artist_name', m.artist,
  'master_metadata_album_album_name', m.album))
FROM scrobbles s JOIN media_file m ON m.id = s.media_file_id
WHERE s.user_id = (SELECT id FROM user WHERE user_name = 'YOUR_USERNAME');" > navidrome_history.json
```

Then upload `navidrome_history.json`, on its own or along with your Spotify files. Change `YOUR_USERNAME` to the name you log in to Navidrome with, so you only get your own plays. You'll need `sqlite3` installed on the server. Navidrome doesn't record how long you actually listened for, only that you got at least halfway, so each play counts as the whole song or the time until the next play, whichever's shorter.

## Running it yourself

It's plain HTML, CSS and JavaScript with no build step and no dependencies. The JavaScript uses modules, which browsers won't load straight from a file, so serve the folder instead:

```bash
python3 -m http.server 8000
```

and open `http://localhost:8000`.

If you change any CSS or JS, bump the `?v=` number everywhere it appears (`grep -rn "?v=" --include='*.html' --include='*.js' .`). Otherwise browsers that already have the old files cached can end up mixing old and new ones.
