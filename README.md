# Unwrapper

You're probably wondering *"why's Chris sent me this?"*, or *"can't I just wait for Wrapped?"*

You could, but Wrapped only covers one year, only shows you what Spotify picks out, and it's gone a month later. Spotify will actually send you every song you've ever played if you ask for it. Unwrapper turns that into proper lists and graphs, for any stretch of time you like, from your whole history down to a single day.

Try it at **[unwrapper.cjones.cymru](https://unwrapper.cjones.cymru)**.

## Getting your data

1. Go to Spotify's [privacy settings](https://www.spotify.com/us/account/privacy/), tick **Extended streaming history** and request it. Not "Account data", that only goes back a year.
2. Confirm the email they send you, then wait. They say it can take up to 30 days, but it's usually a few.
3. When it turns up, unzip it, open the site and pick all the `Streaming_History_Audio` files at once, then press Process.

The video and podcast files are fine to include too, they just get left out of the music stats.

## What you can do with it

- See your top songs, artists and albums for all time, a year, a month, or any dates you pick.
- Sort by how many times you played something, or by how long you actually spent listening to it (in the settings, behind the gear).
- Graph your listening over time. Click anything in the lists, or search for it, to put it on the graph, and compare up to eight artists, albums or songs at once.
- Make your own Wrapped for any year, or all time: your top artists, songs and album and how many minutes you listened, on a card to share, in whatever colours you like. Your eras are underneath, your top artists year by year.
- Exclude anything you don't want counted, like sleep sounds or someone else using your account (also in the settings). It's remembered for next time.

## How it counts

A play only counts if you listened for at least 30 seconds, which is the same rule Spotify uses. Anything shorter still adds to your listening time. Podcasts and audiobooks are left out, Spotify's files overlap a bit so duplicates get removed, and names are grouped ignoring capitals, so "Bring Me The Horizon" and "Bring Me the Horizon" count as the same band.

## Privacy

I'm a computer scientist, not a data harvester. Everything happens in your browser: your files never get uploaded anywhere, I never see them and neither does the server.

The one exception is album covers on the Wrapped card. For each year you look at on the Wrapped tab, it looks for the cover of that year's top artist's top album, so the artist and album names get looked up on Apple's iTunes search. Nothing else gets sent, and you can turn it off under Customise, which it remembers.

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
FROM scrobbles s JOIN media_file m ON m.id = s.media_file_id;" > navidrome_history.json
```

Then upload `navidrome_history.json`, on its own or along with your Spotify files. You'll need `sqlite3` installed on the server. Navidrome doesn't record how long you actually listened for, so every play counts as the whole song, and it exports everyone's plays if other people use your server.

## Running it yourself

It's plain HTML, CSS and JavaScript with no build step and no dependencies. The JavaScript uses modules, which browsers won't load straight from a file, so serve the folder instead:

```bash
python3 -m http.server 8000
```

and open `http://localhost:8000`.

If you change any CSS or JS, bump the `?v=` number everywhere it appears (`grep -rn "?v=" --include='*.html' --include='*.js' .`). Otherwise browsers that already have the old files cached can end up mixing old and new ones.
