// Draws the shareable eras image, kept in here like the graph is in graph.js.
// Always drawn at 1080x1920 (the size of a phone story), the preview's just shrunk down with CSS

export const cardWidth = 1080;
export const cardHeight = 1920;

// Top and bottom of the background, and the text colour. Each one's checked so the
// text is readable (4.5:1 or better) against both ends, which is why the green's a bit darker than the site's
export const themes = [
    { name: 'Green', top: '#108239', bottom: '#06301a', text: '#ffffff' },
    { name: 'Sunset', top: '#ff5f6d', bottom: '#ffc371', text: '#1a1a1a' },
    { name: 'Ultraviolet', top: '#6a3df0', bottom: '#160b45', text: '#ffffff' },
    { name: 'Ocean', top: '#0b74b8', bottom: '#041d36', text: '#ffffff' },
    { name: 'Bubblegum', top: '#ff8fc6', bottom: '#ffe3f1', text: '#2b0a1e' },
    { name: 'Midnight', top: '#2b2b2b', bottom: '#0b0b0b', text: '#f3f3f3' }
];

const margin = 80;

function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
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

// card is { title, range, summary, rows: [{ label, top: [names...] }], compact, note }
// compact means lots of short rows (months): label and top artist side by side, no runners-up
export function drawEraCard(canvas, card, theme) {
    canvas.width = cardWidth;
    canvas.height = cardHeight;
    const ctx = canvas.getContext('2d');
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    const textWidth = cardWidth - margin * 2;

    // Background: a diagonal gradient with a few big see-through circles, a bit Wrapped
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

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // Header
    let y = 170;
    ctx.globalAlpha = 0.75;
    ctx.font = `bold 34px ${family}`;
    ctx.fillText('UNWRAPPER', margin, y);
    ctx.globalAlpha = 1;

    y += 120;
    ctx.fillText(fitText(ctx, card.title, textWidth, 104, 64, 'bold', family), margin, y);

    y += 80;
    ctx.globalAlpha = 0.9;
    ctx.fillText(fitText(ctx, card.range, textWidth, 52, 36, 'bold', family), margin, y);
    y += 64;
    ctx.globalAlpha = 0.8;
    ctx.fillText(fitText(ctx, card.summary, textWidth, 42, 30, 'normal', family), margin, y);
    ctx.globalAlpha = 1;

    // The eras. Row height comes from how many there are, capped so a couple don't look silly and huge
    const top = 560;
    const bottom = card.note ? 1610 : 1660;
    const rowH = Math.min(card.compact ? 120 : 230, (bottom - top) / card.rows.length);
    let rowY = top;

    for (let i = 0; i < card.rows.length; i++) {
        const row = card.rows[i];

        // Thin line between rows
        if (i > 0) {
            ctx.globalAlpha = 0.2;
            ctx.fillRect(margin, rowY, textWidth, 2);
            ctx.globalAlpha = 1;
        }

        if (card.compact) {
            // "Jan   Hot Mulligan" on one line
            const labelWidth = 190;
            const size = Math.min(56, rowH * 0.42);
            const baseline = rowY + rowH / 2 + size * 0.35;
            ctx.globalAlpha = 0.7;
            ctx.fillText(fitText(ctx, row.label, labelWidth - 20, size * 0.8, 20, 'bold', family), margin, baseline);
            ctx.globalAlpha = 1;
            ctx.fillText(fitText(ctx, row.top[0], textWidth - labelWidth, size, 22, 'bold', family), margin + labelWidth, baseline);
        } else {
            // Year, then the number one big, then the next two smaller underneath.
            // With lots of years the rows get too short for that third line to be readable
            // on a phone, so it's left off and the number one gets bigger instead
            const showRest = rowH >= 140 && row.top.length > 1;
            const labelSize = Math.min(44, rowH * (showRest ? 0.2 : 0.24));
            const topSize = Math.min(78, rowH * (showRest ? 0.36 : 0.46));
            const restSize = showRest ? Math.min(40, rowH * 0.19) : 0;
            const gap = (rowH - labelSize - topSize - restSize) / (showRest ? 4 : 3);

            let lineY = rowY + gap + labelSize;
            ctx.globalAlpha = 0.7;
            ctx.fillText(fitText(ctx, row.label, textWidth, labelSize, 20, 'bold', family), margin, lineY);
            ctx.globalAlpha = 1;

            lineY += gap + topSize;
            ctx.fillText(fitText(ctx, row.top[0], textWidth, topSize, 28, 'bold', family), margin, lineY);

            const rest = row.top.slice(1, 3);
            if (showRest) {
                lineY += gap + restSize;
                ctx.globalAlpha = 0.85;
                ctx.fillText(fitText(ctx, `then ${rest.join(' and ')}`, textWidth, restSize, 20, 'normal', family), margin, lineY);
                ctx.globalAlpha = 1;
            }
        }
        rowY += rowH;
    }

    // Says if some got left off, like someone with 15 years of data
    if (card.note) {
        ctx.globalAlpha = 0.7;
        ctx.fillText(fitText(ctx, card.note, textWidth, 30, 22, 'normal', family), margin, 1650);
        ctx.globalAlpha = 1;
    }

    // Footer: where to make your own, in a pill so it stands out
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.8;
    ctx.font = `normal 34px ${family}`;
    ctx.fillText('Make your own at', cardWidth / 2, 1740);
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
