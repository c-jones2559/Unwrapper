// Draws the shareable image, kept in here like the graph is in graph.js.
// Laid out like a Wrapped summary card. Always drawn at 1080x1920 (the size of a phone story),
// the preview's just shrunk down with CSS

export const cardWidth = 1080;
export const cardHeight = 1920;

// base is the card, accent is the big year and the box at the top, ink is the text, muted is the
// small labels. Each one's checked so all the text is readable (4.5:1 or better)
export const themes = [
    { name: 'Yellow', base: '#f1eee8', accent: '#f5c518', ink: '#121212', muted: '#5c5a55', pattern: 'checks' },
    { name: 'Purple', base: '#232323', accent: '#a093ff', ink: '#ffffff', muted: '#b8b8b8', pattern: 'stripes' },
    { name: 'Red', base: '#f1eee8', accent: '#ff4b33', ink: '#121212', muted: '#5c5a55', pattern: 'stripes' },
    { name: 'Green', base: '#232323', accent: '#a6e22e', ink: '#ffffff', muted: '#b8b8b8', pattern: 'dots' },
    { name: 'Pink', base: '#f1eee8', accent: '#ff7eb6', ink: '#121212', muted: '#5c5a55', pattern: 'dots' },
    { name: 'Blue', base: '#232323', accent: '#4fa3ff', ink: '#ffffff', muted: '#b8b8b8', pattern: 'checks' }
];

export const patterns = ['checks', 'stripes', 'dots'];

const margin = 70;

// How light a colour is, for working out whether black or white text goes on it
function luminance(hex) {
    const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Black or white, whichever's easier to read on this colour. Used for the name in the coloured box,
// so it works with any colour someone picks
export function readableOn(colour) {
    return contrast(colour, '#121212') >= contrast(colour, '#ffffff') ? '#121212' : '#ffffff';
}

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

// Splits text into lines that fit, a word at a time
function breakLines(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    let lines = [];
    let line = '';
    for (const word of words) {
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

// Big text over a few lines: goes as big as it can while fitting in maxLines.
// If it won't fit even at the smallest size, the last line gets cut off with ...
function wrapText(ctx, text, maxWidth, maxLines, size, minSize, weight, family) {
    for (let s = size; s >= minSize; s -= 4) {
        ctx.font = `${weight} ${s}px ${family}`;
        const lines = breakLines(ctx, text, maxWidth);
        if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxWidth)) {
            return { lines: lines, size: s };
        }
    }
    ctx.font = `${weight} ${minSize}px ${family}`;
    let lines = breakLines(ctx, text, maxWidth).slice(0, maxLines);
    lines = lines.map(l => fitText(ctx, l, maxWidth, minSize, minSize, weight, family));
    const last = lines.length - 1;
    if (!lines[last].endsWith('…')) lines[last] = fitText(ctx, lines[last] + '…', maxWidth, minSize, minSize, weight, family);
    return { lines: lines, size: minSize };
}

// The black and white pattern round the coloured box
function drawPattern(ctx, kind, x, y, w, h, light, dark) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = light;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = dark;
    const size = 70;
    if (kind == 'checks') {
        for (let row = 0; row * size < h; row++) {
            for (let col = 0; col * size < w; col++) {
                if ((row + col) % 2 == 0) ctx.fillRect(x + col * size, y + row * size, size, size);
            }
        }
    } else if (kind == 'stripes') {
        // Diagonal stripes: draw wide bars, then turn the whole lot 45 degrees
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(Math.PI / 4);
        const reach = w + h;
        for (let i = -reach; i < reach; i += size) {
            ctx.fillRect(i, -reach, size / 2, reach * 2);
        }
    } else {
        for (let row = 0; row * size < h + size; row++) {
            for (let col = 0; col * size < w + size; col++) {
                // Every other row's shifted half a gap, like Wrapped's dots
                const offset = row % 2 == 0 ? 0 : size / 2;
                ctx.beginPath();
                ctx.arc(x + col * size + offset, y + row * size, size * 0.3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    ctx.restore();
}

// card is { label, artists: [5 names], songs: [5 names], minutes, topAlbum }
// theme is one of the themes above (or someone's own colours in the same shape)
export function drawWrappedCard(canvas, card, theme) {
    canvas.width = cardWidth;
    canvas.height = cardHeight;
    const ctx = canvas.getContext('2d');
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    ctx.fillStyle = theme.base;
    ctx.fillRect(0, 0, cardWidth, cardHeight);

    // The top: a pattern with a coloured box in it, and the year running down the left
    const frame = { x: margin, y: margin, w: cardWidth - margin * 2, h: 940 };
    drawPattern(ctx, theme.pattern, frame.x, frame.y, frame.w, frame.h, theme.base, theme.ink);

    const box = { x: frame.x + 170, y: frame.y + 60, w: frame.w - 230, h: frame.h - 120 };
    ctx.fillStyle = theme.accent;
    ctx.fillRect(box.x, box.y, box.w, box.h);

    // Inside the box: the number one artist, as big as it'll go
    const boxText = readableOn(theme.accent);
    const padding = 50;
    ctx.fillStyle = boxText;
    ctx.font = `bold 34px ${family}`;
    ctx.fillText('MY TOP ARTIST', box.x + padding, box.y + padding + 30);
    const name = wrapText(ctx, card.artists[0] || '-', box.w - padding * 2, 4, 170, 64, 'bold', family);
    const lineHeight = name.size * 1.02;
    let nameY = box.y + box.h - padding - lineHeight * (name.lines.length - 1);
    for (const line of name.lines) {
        ctx.fillText(line, box.x + padding, nameY);
        nameY += lineHeight;
    }

    // The year (or whatever the period is) sideways down the left, outlined so it stands off the pattern
    ctx.save();
    ctx.translate(frame.x + 140, frame.y + frame.h - 40);
    ctx.rotate(-Math.PI / 2);
    const label = fitText(ctx, card.label.toUpperCase(), frame.h - 80, 190, 80, 'bold', family);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = theme.base;
    ctx.strokeText(label, 0, 0);
    ctx.fillStyle = theme.accent;
    ctx.fillText(label, 0, 0);
    ctx.restore();

    // Top artists and top songs, side by side
    const columnWidth = (cardWidth - margin * 2 - 40) / 2;
    const columns = [
        { title: 'Top Artists', items: card.artists, x: margin },
        { title: 'Top Songs', items: card.songs, x: margin + columnWidth + 40 }
    ];
    for (const column of columns) {
        let y = 1110;
        ctx.fillStyle = theme.muted;
        ctx.font = `normal 36px ${family}`;
        ctx.fillText(column.title, column.x, y);
        y += 70;
        for (let i = 0; i < 5; i++) {
            if (!column.items[i]) break;
            ctx.fillStyle = theme.ink;
            ctx.font = `bold 42px ${family}`;
            ctx.fillText(String(i + 1), column.x, y);
            // Every row the same size, long ones cut off with ... (like Wrapped) rather than shrunk
            ctx.fillText(fitText(ctx, column.items[i], columnWidth - 44, 42, 42, 'bold', family), column.x + 44, y);
            y += 66;
        }
    }

    // Minutes listened and top album
    const statsY = 1560;
    ctx.fillStyle = theme.muted;
    ctx.font = `normal 36px ${family}`;
    ctx.fillText('Minutes Listened', columns[0].x, statsY);
    ctx.fillText('Top Album', columns[1].x, statsY);
    ctx.fillStyle = theme.ink;
    ctx.fillText(fitText(ctx, card.minutes.toLocaleString(), columnWidth, 110, 60, 'bold', family), columns[0].x, statsY + 120);
    ctx.fillText(fitText(ctx, card.topAlbum || '-', columnWidth, 72, 36, 'bold', family), columns[1].x, statsY + 110);

    // Footer: a little mark on the left, the site on the right
    const footerY = 1830;
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.arc(margin + 34, footerY - 14, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.base;
    ctx.textAlign = 'center';
    ctx.font = `bold 40px ${family}`;
    ctx.fillText('U', margin + 34, footerY);
    ctx.fillStyle = theme.ink;
    ctx.textAlign = 'right';
    ctx.font = `bold 40px ${family}`;
    ctx.fillText('UNWRAPPER.CJONES.CYMRU', cardWidth - margin, footerY);
    ctx.textAlign = 'left';
}
