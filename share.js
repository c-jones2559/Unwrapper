// The shareable image: drawing it, and finding the cover of the top artist's top album for it.
// Kept in here like the graph is in graph.js. Always drawn at 1080x1920 (the size of a phone story),
// the preview's just shrunk down with CSS

export const cardWidth = 1080;
export const cardHeight = 1920;

// Top and bottom of the background, and the text colour. Each one's checked so the text is
// readable (4.5:1 or better) against both ends, which is why the green's a bit darker than the site's
export const themes = [
    { name: 'Green', top: '#108239', bottom: '#06301a', text: '#ffffff' },
    { name: 'Sunset', top: '#ff5f6d', bottom: '#ffc371', text: '#1a1a1a' },
    { name: 'Ultraviolet', top: '#6a3df0', bottom: '#160b45', text: '#ffffff' },
    { name: 'Ocean', top: '#0b74b8', bottom: '#041d36', text: '#ffffff' },
    { name: 'Bubblegum', top: '#ff8fc6', bottom: '#ffe3f1', text: '#2b0a1e' },
    { name: 'Midnight', top: '#2b2b2b', bottom: '#0b0b0b', text: '#f3f3f3' }
];

const margin = 80;
const textWidth = cardWidth - margin * 2;

// --- Finding the album cover ---
// Looks up the album on Apple's iTunes search, which lets other sites use both the search and the covers.
// Only uses a cover if the artist and the album both match, so it never shows the wrong one.
// Gives back { image, album, year }, or null if there isn't one. Throws if something goes wrong
// (no internet, say), so that can be tried again rather than remembered as "no cover"

async function getJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`${response.status} from ${url}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous'; // Without this the picture couldn't be saved afterwards
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Couldn't load ${url}`));
        image.src = url;
    });
}

// For comparing names: lowercase, without "(Deluxe Edition)", "[Remastered]" or " - EP" on the end,
// and without punctuation, so "Clancy (Deluxe)" matches "Clancy" and "Los Campesinos!" matches "Los Campesinos"
export function simplifyName(text) {
    return text.toLowerCase()
        .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')
        .replace(/\s+-\s+(ep|single)$/, '')
        .replace(/&/g, 'and')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

// Two steps: find the artist, then go through their whole catalogue for the album. Searching for the
// artist and album together misses loads (iTunes's search is fussy), and searching the artist alone
// only lists some of their albums
export async function findAlbumCover(artist, album) {
    const wantArtist = simplifyName(artist);
    const wantAlbum = simplifyName(album);
    if (!wantArtist || !wantAlbum) return null;

    const artists = await getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=musicArtist&limit=10`);
    const match = (artists.results || []).find(result => simplifyName(result.artistName || '') == wantArtist);
    if (!match) return null;

    const catalogue = await getJSON(`https://itunes.apple.com/lookup?id=${match.artistId}&entity=album&limit=200`);
    const found = (catalogue.results || []).find(result =>
        result.wrapperType == 'collection' && simplifyName(result.collectionName || '') == wantAlbum);
    if (!found || !found.artworkUrl100) return null;

    // The catalogue gives a tiny 100px cover, but the same address does bigger ones
    const image = await loadImage(found.artworkUrl100.replace('100x100bb', '1000x1000bb'));
    const year = found.releaseDate ? found.releaseDate.slice(0, 4) : '';
    return { image: image, album: album, year: year };
}

// --- Text ---

// Shrinks the font until the text fits, and if it still doesn't at the smallest size, cuts it off with ...
// Leaves ctx.font set to whatever size it ended up, so it's ready to draw
function fitText(ctx, text, maxWidth, size, minSize, weight, family) {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (ctx.measureText(text).width > maxWidth && s > minSize) {
        s -= 2;
        ctx.font = `${weight} ${s}px ${family}`;
    }
    if (ctx.measureText(text).width <= maxWidth) return text;
    let cut = text;
    while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) {
        cut = cut.slice(0, -1);
    }
    return cut.trimEnd() + '…';
}

// Splits text into lines that fit, breaking words in the middle with a hyphen to fill each line
// as much as possible. A word's only broken if at least 3 letters go on each side, so there's
// no "Horiz-on" with a lonely couple of letters on the next line
export function hyphenLines(ctx, text, maxWidth) {
    const fits = t => ctx.measureText(t).width <= maxWidth;
    let lines = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
        const attempt = line ? `${line} ${word}` : word;
        if (fits(attempt)) {
            line = attempt;
            continue;
        }

        // Doesn't fit, so put as much of the word as possible on the end of this line
        const start = line ? `${line} ` : '';
        let rest = word;
        let split = 0;
        for (let k = word.length - 3; k >= 3; k--) {
            if (fits(`${start}${word.slice(0, k)}-`)) {
                split = k;
                break;
            }
        }
        if (split > 0) {
            lines.push(`${start}${word.slice(0, split)}-`);
            rest = word.slice(split);
        } else if (line) {
            lines.push(line);
        }

        // Whatever's left starts the next line, broken again if it's still too long on its own
        while (!fits(rest)) {
            let k = rest.length - 3;
            while (k >= 3 && !fits(`${rest.slice(0, k)}-`)) k--;
            if (k < 3) break; // Can't break it sensibly, it'll get cut off later
            lines.push(`${rest.slice(0, k)}-`);
            rest = rest.slice(k);
        }
        line = rest;
    }
    if (line) lines.push(line);
    return lines;
}

// Plain wrapping, a whole word at a time, never breaking one
export function wordLines(ctx, text, maxWidth) {
    let lines = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
        const attempt = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(attempt).width > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = attempt;
        }
    }
    if (line) lines.push(line);
    return lines;
}

// Up to maxLines lines, at the biggest size that fits (going no smaller than minSize).
// Whole words first, at every size. Words only get broken with a hyphen if they can't fit without,
// since there's no point hyphenating something that would've fitted on the next line anyway.
// If it still won't fit at the smallest size, the last line ends with ... instead
export function fitLines(ctx, text, maxWidth, maxLines, size, minSize, weight, family) {
    for (const wrap of [wordLines, hyphenLines]) {
        for (let s = size; s >= minSize; s -= 2) {
            ctx.font = `${weight} ${s}px ${family}`;
            const lines = wrap(ctx, text, maxWidth);
            if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxWidth)) {
                return { lines: lines, size: s };
            }
        }
    }
    ctx.font = `${weight} ${minSize}px ${family}`;
    const all = hyphenLines(ctx, text, maxWidth);
    let lines = all.slice(0, maxLines);
    if (all.length > maxLines) {
        const last = lines.length - 1;
        lines[last] = lines[last].replace(/-$/, '') + '…';
    }
    lines = lines.map(l => fitText(ctx, l, maxWidth, minSize, minSize, weight, family));
    return { lines: lines, size: minSize };
}

// --- Drawing ---

function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

// Draws the image filling the box (cropping whatever doesn't fit), with rounded corners.
// Album covers are square and the box is too, so normally nothing's cropped
function drawCover(ctx, image, x, y, w, h, radius) {
    const scale = Math.max(w / image.width, h / image.height);
    const sw = w / scale, sh = h / scale;
    const sx = (image.width - sw) / 2;
    const sy = (image.height - sh) * 0.3;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.clip();
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();
}

// card is { label, artists: [up to 5], songs: [up to 5], minutes, topAlbum, cover: { image, album, year } or null }
// theme is one of the themes above (or someone's own colours in the same shape)
export function drawCard(canvas, card, theme) {
    canvas.width = cardWidth;
    canvas.height = cardHeight;
    const ctx = canvas.getContext('2d');
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // Background: a diagonal gradient with a few big see-through circles
    const bg = ctx.createLinearGradient(0, 0, cardWidth * 0.4, cardHeight);
    bg.addColorStop(0, theme.top);
    bg.addColorStop(1, theme.bottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cardWidth, cardHeight);
    ctx.fillStyle = theme.text;
    ctx.globalAlpha = 0.08;
    circle(ctx, cardWidth * 0.95, cardHeight * 0.07, 340);
    circle(ctx, cardWidth * 0.02, cardHeight * 0.88, 420);
    ctx.globalAlpha = 0.05;
    circle(ctx, cardWidth * 0.8, cardHeight * 0.6, 230);
    ctx.globalAlpha = 1;

    // Header: the year big on the left, UNWRAPPER small on the right, lined up with the top of the year
    const headerY = 200;
    ctx.font = `bold 34px ${family}`;
    const brand = ctx.measureText('UNWRAPPER');
    const label = fitText(ctx, card.label, textWidth - brand.width - 40, 130, 64, 'bold', family);
    const labelTop = headerY - ctx.measureText(label).actualBoundingBoxAscent;
    ctx.fillText(label, margin, headerY);
    ctx.globalAlpha = 0.75;
    ctx.font = `bold 34px ${family}`;
    ctx.textAlign = 'right';
    ctx.fillText('UNWRAPPER', cardWidth - margin, labelTop + brand.actualBoundingBoxAscent);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;

    // Work out the layout before drawing the rest: two-line songs take more room, so if it's all
    // too tall, try a shorter picture box, then smaller list text, until it fits above the footer
    const columnGap = 40;
    const columnWidth = (textWidth - columnGap) / 2;
    const numberWidth = 44;
    const rowGap = 16;
    let layout = null;
    for (const option of [{ box: 620, size: 40 }, { box: 560, size: 40 }, { box: 480, size: 40 }, { box: 480, size: 34 }, { box: 400, size: 32 }]) {
        const lineHeight = Math.round(option.size * 1.2);
        const rows = items => items.map(item => fitLines(ctx, item, columnWidth - numberWidth, 2, option.size, option.size, 'bold', family).lines);
        const artistRows = rows(card.artists);
        const songRows = rows(card.songs);
        const height = list => list.reduce((total, r) => total + r.length * lineHeight, 0) + Math.max(0, list.length - 1) * rowGap;
        const album = fitLines(ctx, card.topAlbum, columnWidth, 2, 64, 40, 'bold', family);

        const boxTop = headerY + 70;
        const listTop = boxTop + option.box + 80;
        const listsBottom = listTop + 60 + Math.max(height(artistRows), height(songRows));
        const statsTop = listsBottom + 50;
        const statsBottom = statsTop + 100 + (album.lines.length - 1) * Math.round(album.size * 1.1);
        layout = { ...option, lineHeight, artistRows, songRows, album, boxTop, listTop, statsTop };
        if (statsBottom <= 1690) break;
    }

    // The top artist: their top album's cover with their name beside it, or failing that their name, big
    const box = { x: margin, y: layout.boxTop, w: textWidth, h: layout.box };
    if (card.cover) {
        const size = box.h;
        drawCover(ctx, card.cover.image, box.x, box.y, size, size, 24);
        const sideX = box.x + size + 40;
        const sideWidth = box.x + box.w - sideX;

        ctx.globalAlpha = 0.75;
        ctx.font = `bold 30px ${family}`;
        ctx.fillText('TOP ARTIST', sideX, box.y + 34);
        ctx.globalAlpha = 1;
        const name = fitLines(ctx, card.artists[0], sideWidth, 2, 64, 34, 'bold', family);
        let nameY = box.y + 34 + Math.round(name.size * 1.25);
        for (const line of name.lines) {
            ctx.fillText(line, sideX, nameY);
            nameY += Math.round(name.size * 1.1);
        }

        // What the cover is, at the bottom of the column: the title, with the year underneath
        const caption = card.cover.year;
        const album = fitLines(ctx, card.cover.album, sideWidth, 2, 40, 26, 'bold', family);
        const albumLine = Math.round(album.size * 1.15);
        let albumY = box.y + size - 6 - 44 - albumLine * (album.lines.length - 1);
        ctx.font = `bold ${album.size}px ${family}`;
        for (const line of album.lines) {
            ctx.fillText(line, sideX, albumY);
            albumY += albumLine;
        }
        ctx.globalAlpha = 0.75;
        ctx.fillText(fitText(ctx, caption, sideWidth, 30, 22, 'normal', family), sideX, box.y + size - 6);
        ctx.globalAlpha = 1;
    } else {
        ctx.globalAlpha = 0.12;
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, 32);
        ctx.fill();
        ctx.globalAlpha = 0.75;
        ctx.font = `bold 34px ${family}`;
        ctx.fillText('TOP ARTIST', box.x + 50, box.y + 80);
        ctx.globalAlpha = 1;
        const name = fitLines(ctx, card.artists[0] || '-', box.w - 100, 2, 170, 64, 'bold', family);
        const nameHeight = Math.round(name.size * 1.05);
        let nameY = box.y + box.h - 60 - nameHeight * (name.lines.length - 1);
        for (const line of name.lines) {
            ctx.fillText(line, box.x + 50, nameY);
            nameY += nameHeight;
        }
    }

    // Top artists and top songs, side by side, each row up to two lines
    const columns = [
        { title: 'Top Artists', rows: layout.artistRows, x: margin },
        { title: 'Top Songs', rows: layout.songRows, x: margin + columnWidth + columnGap }
    ];
    for (const column of columns) {
        ctx.globalAlpha = 0.75;
        ctx.font = `normal 34px ${family}`;
        ctx.fillText(column.title, column.x, layout.listTop);
        ctx.globalAlpha = 1;
        ctx.font = `bold ${layout.size}px ${family}`;
        let y = layout.listTop + 60;
        for (let i = 0; i < column.rows.length; i++) {
            ctx.fillText(String(i + 1), column.x, y);
            for (const line of column.rows[i]) {
                ctx.fillText(line, column.x + numberWidth, y);
                y += layout.lineHeight;
            }
            y += rowGap;
        }
    }

    // Minutes listened and top album
    const albumX = margin + columnWidth + columnGap;
    ctx.globalAlpha = 0.75;
    ctx.font = `normal 34px ${family}`;
    ctx.fillText('Minutes Listened', margin, layout.statsTop);
    ctx.fillText('Top Album', albumX, layout.statsTop);
    ctx.globalAlpha = 1;
    ctx.fillText(fitText(ctx, card.minutes.toLocaleString(), columnWidth, 100, 56, 'bold', family), margin, layout.statsTop + 100);
    ctx.font = `bold ${layout.album.size}px ${family}`;
    let albumY = layout.statsTop + 100 - (layout.album.lines.length > 1 ? Math.round(layout.album.size * 0.55) : 0);
    for (const line of layout.album.lines) {
        ctx.fillText(line, albumX, albumY);
        albumY += Math.round(layout.album.size * 1.1);
    }

    // Footer: where to make your own, in a pill so it stands out
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.8;
    ctx.font = `normal 34px ${family}`;
    ctx.fillText('Make your own at', cardWidth / 2, 1745);
    ctx.globalAlpha = 1;
    const site = 'unwrapper.cjones.cymru';
    ctx.font = `bold 46px ${family}`;
    const pillWidth = ctx.measureText(site).width + 80;
    const pillHeight = 90;
    const pillX = (cardWidth - pillWidth) / 2;
    const pillY = 1775;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
    ctx.fill();
    ctx.fillStyle = theme.bottom; // The site name's cut out of the pill in the background colour
    ctx.fillText(site, cardWidth / 2, pillY + pillHeight / 2 + 16);
    ctx.textAlign = 'left';
}
