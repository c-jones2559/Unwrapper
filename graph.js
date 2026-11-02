// Everything for the graph tab lives in here so statsProcessor doesn't get massive
import { sOnEnd } from './timeBits.js';

const minPlayMs = 30000; // Same as the lists, so the numbers match up

// 1. Bucketing
// Works out how fine the graph should be from how much time it covers
function pickUnit(span) {
    const day = 1000*60*60*24;
    if (span <= 2*day) return 'hour';
    if (span <= 92*day) return 'day';
    if (span <= 731*day) return 'week';
    return 'month';
}

// Start of the hour/day/week/month that ms falls in, in local time
function startOf(ms, unit) {
    const d = new Date(ms);
    if (unit == 'hour') return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());
    if (unit == 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (unit == 'week') {
        const mondayOffset = (d.getDay() + 6) % 7; // getDay() starts on Sunday, weeks start on Monday
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset);
    }
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Next bucket along. Days and up use the date parts rather than adding ms, since a day isn't
// always 24 hours when the clocks change. Hours are always 60 minutes though, and stepping
// those by date parts would skip the repeated 1am when the clocks go back
function nextStart(date, unit) {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    if (unit == 'hour') return new Date(date.getTime() + 1000*60*60);
    if (unit == 'day') return new Date(y, m, d + 1);
    if (unit == 'week') return new Date(y, m, d + 7);
    return new Date(y, m + 1, 1);
}

// Turns plays into listens per bucket between from and to (ms). Empty buckets stay in as 0
export function buildGraphData(songs, from, to) {
    const unit = pickUnit(to - from);
    let buckets = [];
    for (let start = startOf(from, unit); start.getTime() < to; start = nextStart(start, unit)) {
        // Partial if the range only covers some of it, like the current month, so a dip there isn't taken seriously
        const partial = start.getTime() < from || nextStart(start, unit).getTime() > to;
        buckets.push({ start: start.getTime(), listens: 0, time: 0, partial: partial });
    }

    for (const song of songs) {
        if (!song.master_metadata_track_name) continue; // Music only, same as the lists
        if (song.playedAt < from || song.playedAt >= to) continue;

        // Binary search for the last bucket starting before this play
        let lo = 0, hi = buckets.length - 1;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (buckets[mid].start <= song.playedAt) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        if (song.ms_played >= minPlayMs) buckets[lo].listens++;
        buckets[lo].time += song.ms_played;
    }

    return { unit: unit, buckets: buckets };
}

// 2. Labels
function bucketLabel(ms, unit) {
    const d = new Date(ms);
    if (unit == 'hour') return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    if (unit == 'day') return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (unit == 'week') return `Week of ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function tickLabel(ms, unit, manyMonths) {
    const d = new Date(ms);
    if (unit == 'hour') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (unit == 'month' && manyMonths) return String(d.getFullYear());
    if (unit == 'month') return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// Rounds the top of the y axis up to a clean number (1, 2 or 5 times a power of 10)
function niceStep(rough) {
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    for (const mult of [1, 2, 5, 10]) {
        if (mult * power >= rough) return mult * power;
    }
    return 10 * power;
}

function hoursString(ms) {
    const hours = ms / (1000*60*60);
    if (hours < 1) {
        const minutes = Math.round(ms / 60000);
        return `${minutes} minute${sOnEnd(minutes)}`;
    }
    const rounded = Math.round(hours * 10) / 10;
    return `${rounded.toLocaleString()} hour${sOnEnd(rounded)}`;
}

// 3. Drawing
const SVG = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG, tag);
    for (const key in attrs) el.setAttribute(key, attrs[key]);
    return el;
}

// Draws the graph into container (which has to be on the page already, or its width is 0)
export function drawGraph(container, graph, heading) {
    container.innerHTML = '';
    const { unit, buckets } = graph;

    let total = 0, max = 0;
    for (const b of buckets) {
        total += b.listens;
        if (b.listens > max) max = b.listens;
    }

    const title = document.createElement('h3');
    title.className = 'graph-title';
    title.textContent = `Listens per ${unit}`;
    const subtitle = document.createElement('p');
    subtitle.className = 'graph-subtitle';
    subtitle.textContent = `${total.toLocaleString()} listen${sOnEnd(total)} of ${heading}`;
    container.appendChild(title);
    container.appendChild(subtitle);

    if (total == 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No listens in this period.';
        container.appendChild(empty);
        return;
    }

    // Put the plot on the page first so it can be measured (the card's clientWidth includes its padding)
    const plot = document.createElement('div');
    plot.className = 'graph-plot';
    container.appendChild(plot);

    // Sizes
    const width = plot.clientWidth;
    const height = 280;
    const left = 48, right = 12, top = 12, bottom = 28;
    const plotW = width - left - right;
    const plotH = height - top - bottom;

    const step = niceStep(max / 4);
    const yMax = step * Math.ceil(max / step);
    const xAt = i => left + (buckets.length == 1 ? plotW / 2 : i * plotW / (buckets.length - 1));
    const yAt = v => top + plotH - (v / yMax) * plotH;

    const svg = svgEl('svg', { width: width, height: height, class: 'graph-svg', tabindex: 0,
        role: 'img', 'aria-label': `${title.textContent}, ${subtitle.textContent}. Use the arrow keys to read values.` });

    // Gridlines and y labels
    for (let v = 0; v <= yMax; v += step) {
        svg.appendChild(svgEl('line', { x1: left, x2: width - right, y1: yAt(v), y2: yAt(v), class: 'graph-grid' }));
        const label = svgEl('text', { x: left - 8, y: yAt(v) + 4, 'text-anchor': 'end', class: 'graph-axis' });
        label.textContent = v >= 10000 ? `${v / 1000}K` : v.toLocaleString();
        svg.appendChild(label);
    }

    // X labels. Years at each January if it's loads of months, otherwise spread out with
    // about 80px each so they don't crash into each other on a phone
    const manyMonths = unit == 'month' && buckets.length > 24;
    const maxTicks = Math.max(2, Math.floor(plotW / 80));
    let tickIndexes = [];
    if (manyMonths) {
        const januaries = [];
        for (let i = 0; i < buckets.length; i++) {
            if (new Date(buckets[i].start).getMonth() == 0) januaries.push(i);
        }
        const every = Math.ceil(januaries.length / maxTicks);
        for (let i = 0; i < januaries.length; i += every) tickIndexes.push(januaries[i]);
    } else {
        const every = Math.max(1, Math.ceil(buckets.length / maxTicks));
        for (let i = 0; i < buckets.length; i += every) tickIndexes.push(i);
    }
    for (const i of tickIndexes) {
        const label = svgEl('text', { x: xAt(i), y: height - 8, 'text-anchor': 'middle', class: 'graph-axis' });
        label.textContent = tickLabel(buckets[i].start, unit, manyMonths);
        svg.appendChild(label);
    }

    // The area and the line on top of it
    let line = '';
    for (let i = 0; i < buckets.length; i++) {
        line += `${i == 0 ? 'M' : 'L'}${xAt(i)},${yAt(buckets[i].listens)}`;
    }
    const area = `${line}L${xAt(buckets.length - 1)},${yAt(0)}L${xAt(0)},${yAt(0)}Z`;
    svg.appendChild(svgEl('path', { d: area, class: 'graph-area' }));
    svg.appendChild(svgEl('path', { d: line, class: 'graph-line' }));

    // Crosshair, dot and tooltip, hidden until you hover
    const crosshair = svgEl('line', { y1: top, y2: top + plotH, class: 'graph-crosshair', visibility: 'hidden' });
    const dot = svgEl('circle', { r: 4, class: 'graph-dot', visibility: 'hidden' });
    svg.appendChild(crosshair);
    svg.appendChild(dot);

    const tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip hidden';
    const tipValue = document.createElement('strong');
    const tipDetail = document.createElement('span');
    tooltip.appendChild(tipValue);
    tooltip.appendChild(tipDetail);

    // Hovering anywhere over the plot snaps to the nearest bucket
    const hitArea = svgEl('rect', { x: left, y: top, width: plotW, height: plotH, fill: 'transparent' });
    svg.appendChild(hitArea);

    let current = -1;
    function show(i) {
        current = i;
        const b = buckets[i];
        const x = xAt(i), y = yAt(b.listens);
        crosshair.setAttribute('x1', x);
        crosshair.setAttribute('x2', x);
        crosshair.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', x);
        dot.setAttribute('cy', y);
        dot.setAttribute('visibility', 'visible');

        tipValue.textContent = `${b.listens.toLocaleString()} listen${sOnEnd(b.listens)}`;
        tipDetail.textContent = `${bucketLabel(b.start, unit)}${b.partial ? ' (partial)' : ''} · ${hoursString(b.time)}`;
        tooltip.classList.remove('hidden');
        // Flip to the left of the line past halfway, and keep it inside the graph on narrow screens
        let tipLeft = x > width / 2 ? x - tooltip.offsetWidth - 12 : x + 12;
        tipLeft = Math.max(0, Math.min(width - tooltip.offsetWidth, tipLeft));
        tooltip.style.left = `${tipLeft}px`;
        tooltip.style.top = `${top}px`;
    }
    function hide() {
        current = -1;
        crosshair.setAttribute('visibility', 'hidden');
        dot.setAttribute('visibility', 'hidden');
        tooltip.classList.add('hidden');
    }

    function showAtPointer(e) {
        const x = e.clientX - svg.getBoundingClientRect().left;
        const i = buckets.length == 1 ? 0 : Math.round((x - left) / plotW * (buckets.length - 1));
        show(Math.min(buckets.length - 1, Math.max(0, i)));
    }
    svg.addEventListener('pointermove', showAtPointer);
    svg.addEventListener('pointerdown', showAtPointer); // Tapping on a phone
    svg.addEventListener('pointerleave', (e) => {
        // A tap "leaves" straight after, which would hide the tooltip before you can read it
        if (e.pointerType != 'touch') hide();
    });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
        if (e.key != 'ArrowLeft' && e.key != 'ArrowRight') return;
        e.preventDefault();
        if (current == -1) {
            show(e.key == 'ArrowRight' ? 0 : buckets.length - 1);
        } else {
            show(Math.min(buckets.length - 1, Math.max(0, current + (e.key == 'ArrowRight' ? 1 : -1))));
        }
    });

    plot.appendChild(svg);
    plot.appendChild(tooltip);

    // Same numbers as a table, for anyone who can't (or doesn't want to) use the hover
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Show as a table';
    details.appendChild(summary);
    const table = document.createElement('table');
    table.className = 'graph-table';
    const headRow = table.insertRow();
    for (const text of [unit[0].toUpperCase() + unit.slice(1), 'Listens', 'Time']) {
        const th = document.createElement('th');
        th.textContent = text;
        headRow.appendChild(th);
    }
    for (const b of buckets) {
        const row = table.insertRow();
        row.insertCell().textContent = `${bucketLabel(b.start, unit)}${b.partial ? ' (partial)' : ''}`;
        row.insertCell().textContent = b.listens.toLocaleString();
        row.insertCell().textContent = hoursString(b.time);
    }
    details.appendChild(table);
    container.appendChild(details);
}
