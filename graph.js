// Everything for the graph tab lives in here so statsProcessor doesn't get massive
import { sOnEnd } from './timeBits.js?v=4';

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

// Binary search for the last bucket starting at or before ms
function findBucket(buckets, ms) {
    let lo = 0, hi = buckets.length - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (buckets[mid].start <= ms) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo;
}

// Turns plays into listens per bucket between from and to (ms), once for each series.
// seriesRows is a list of lists of plays, one list per line on the graph.
// Each bucket has a listens and a time list, in the same order as seriesRows. Empty buckets stay in as 0
export function buildGraphData(seriesRows, from, to) {
    const unit = pickUnit(to - from);
    let buckets = [];
    for (let start = startOf(from, unit); start.getTime() < to; start = nextStart(start, unit)) {
        // Partial if the range only covers some of it, like the current month, so a dip there isn't taken seriously
        const partial = start.getTime() < from || nextStart(start, unit).getTime() > to;
        buckets.push({
            start: start.getTime(),
            listens: seriesRows.map(() => 0),
            time: seriesRows.map(() => 0),
            partial: partial
        });
    }

    for (let s = 0; s < seriesRows.length; s++) {
        for (const song of seriesRows[s]) {
            if (!song.master_metadata_track_name) continue; // Music only, same as the lists
            if (song.playedAt < from || song.playedAt >= to) continue;

            const b = buckets[findBucket(buckets, song.playedAt)];
            if (song.ms_played >= minPlayMs) b.listens[s]++;
            b.time[s] += song.ms_played;
        }
    }

    return { unit: unit, buckets: buckets };
}

// 2. Labels
function bucketLabel(b, unit) {
    const d = new Date(b.start);
    let label;
    if (unit == 'hour') label = d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    else if (unit == 'day') label = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    else if (unit == 'week') label = `Week of ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    else label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return b.partial ? `${label} (partial)` : label;
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

function listensString(n) {
    return `${n.toLocaleString()} listen${sOnEnd(n)}`;
}

// 3. Drawing
const SVG = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG, tag);
    for (const key in attrs) el.setAttribute(key, attrs[key]);
    return el;
}

// The short coloured line used as a key in the legend and tooltip
function keyLine(colour) {
    const key = document.createElement('span');
    key.className = 'graph-key';
    key.style.background = colour;
    return key;
}

// Draws the graph into container (which has to be on the page already, or its width is 0).
// series is one { label, type, colour, removable } per line, in the same order as the data.
// Removable ones get a × button with data-index, the click is handled in statsProcessor.
// metric is 'plays' (listens) or 'time' (hours), from the toggle
export function drawGraph(container, graph, series, metric) {
    container.innerHTML = '';
    const { unit, buckets } = graph;
    const single = series.length == 1;
    const byTime = metric == 'time';

    // What gets plotted for line s at bucket b, and how to write it out
    const value = (b, s) => byTime ? b.time[s] / (1000*60*60) : b.listens[s];
    const longValue = v => byTime ? hoursString(v * 1000*60*60) : listensString(v);
    const shortValue = v => byTime ? `${(Math.round(v * 10) / 10).toLocaleString()}h` : v.toLocaleString();

    let totals = series.map(() => 0);
    let max = 0;
    for (const b of buckets) {
        for (let s = 0; s < series.length; s++) {
            totals[s] += value(b, s);
            if (value(b, s) > max) max = value(b, s);
        }
    }

    const title = document.createElement('h3');
    title.className = 'graph-title';
    title.textContent = `${byTime ? 'Hours' : 'Listens'} per ${unit}`;
    container.appendChild(title);

    // One line with nothing to remove just gets a sentence, otherwise each line gets a chip:
    // its colour, name, total and a ×. These are the legend too
    if (single && !series[0].removable) {
        const subtitle = document.createElement('p');
        subtitle.className = 'graph-subtitle';
        subtitle.textContent = `${longValue(totals[0])} of ${series[0].label}`;
        container.appendChild(subtitle);
    } else {
        const legend = document.createElement('ul');
        legend.className = 'graph-legend';
        for (let s = 0; s < series.length; s++) {
            const chip = document.createElement('li');
            chip.className = 'graph-chip';
            chip.appendChild(keyLine(series[s].colour));

            const name = document.createElement('span');
            name.textContent = series[s].label;
            chip.appendChild(name);

            const detail = document.createElement('span');
            detail.className = 'graph-chip-detail';
            detail.textContent = `${series[s].type} · ${longValue(totals[s])}`;
            chip.appendChild(detail);

            if (series[s].removable) {
                const remove = document.createElement('button');
                remove.className = 'graph-chip-remove';
                remove.dataset.index = s;
                remove.setAttribute('aria-label', `Remove ${series[s].label}`);
                remove.textContent = '×';
                chip.appendChild(remove);
            }
            legend.appendChild(chip);
        }
        container.appendChild(legend);
    }

    if (max == 0) {
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

    const names = series.map(s => s.label).join(', ');
    const svg = svgEl('svg', { width: width, height: height, class: 'graph-svg', tabindex: 0,
        role: 'img', 'aria-label': `${title.textContent} for ${names}. Use the arrow keys to read values.` });

    // Gridlines and y labels. Counts up in whole steps so hours like 0.1 + 0.2 don't come out as 0.30000000000000004
    for (let n = 0; n * step <= yMax * 1.000001; n++) {
        const v = n * step;
        svg.appendChild(svgEl('line', { x1: left, x2: width - right, y1: yAt(v), y2: yAt(v), class: 'graph-grid' }));
        const label = svgEl('text', { x: left - 8, y: yAt(v) + 4, 'text-anchor': 'end', class: 'graph-axis' });
        label.textContent = v >= 10000 ? `${v / 1000}K` : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
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

    // One line per series. Only a single line gets the shaded area, overlapping ones turn to mud
    for (let s = 0; s < series.length; s++) {
        let line = '';
        for (let i = 0; i < buckets.length; i++) {
            line += `${i == 0 ? 'M' : 'L'}${xAt(i)},${yAt(value(buckets[i], s))}`;
        }
        if (single) {
            const area = `${line}L${xAt(buckets.length - 1)},${yAt(0)}L${xAt(0)},${yAt(0)}Z`;
            svg.appendChild(svgEl('path', { d: area, class: 'graph-area', style: `fill: ${series[s].colour}` }));
        }
        svg.appendChild(svgEl('path', { d: line, class: 'graph-line', style: `stroke: ${series[s].colour}` }));
    }

    // Crosshair, a dot per line and the tooltip, hidden until you hover
    const crosshair = svgEl('line', { y1: top, y2: top + plotH, class: 'graph-crosshair', visibility: 'hidden' });
    svg.appendChild(crosshair);
    const dots = [];
    for (let s = 0; s < series.length; s++) {
        const dot = svgEl('circle', { r: 4, class: 'graph-dot', style: `fill: ${series[s].colour}`, visibility: 'hidden' });
        svg.appendChild(dot);
        dots.push(dot);
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip hidden';

    // Hovering anywhere over the plot snaps to the nearest bucket
    const hitArea = svgEl('rect', { x: left, y: top, width: plotW, height: plotH, fill: 'transparent' });
    svg.appendChild(hitArea);

    let current = -1;
    function show(i) {
        current = i;
        const b = buckets[i];
        const x = xAt(i);
        crosshair.setAttribute('x1', x);
        crosshair.setAttribute('x2', x);
        crosshair.setAttribute('visibility', 'visible');
        for (let s = 0; s < series.length; s++) {
            dots[s].setAttribute('cx', x);
            dots[s].setAttribute('cy', yAt(value(b, s)));
            dots[s].setAttribute('visibility', 'visible');
        }

        // Every line at this point, not just the one you're nearest. Value first, name after
        tooltip.innerHTML = '';
        const when = document.createElement('span');
        when.className = 'graph-tooltip-when';
        // With one line, the other measure goes underneath (hours under listens, or the other way round)
        const other = byTime ? listensString(b.listens[0]) : hoursString(b.time[0]);
        when.textContent = single ? `${bucketLabel(b, unit)} · ${other}` : bucketLabel(b, unit);
        if (single) {
            const strong = document.createElement('strong');
            strong.textContent = longValue(value(b, 0));
            tooltip.appendChild(strong);
            tooltip.appendChild(when);
        } else {
            tooltip.appendChild(when);
            for (let s = 0; s < series.length; s++) {
                const row = document.createElement('div');
                row.className = 'graph-tooltip-row';
                row.appendChild(keyLine(series[s].colour));
                const strong = document.createElement('strong');
                strong.textContent = shortValue(value(b, s));
                row.appendChild(strong);
                const name = document.createElement('span');
                name.textContent = series[s].label;
                row.appendChild(name);
                tooltip.appendChild(row);
            }
        }
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
        for (const dot of dots) dot.setAttribute('visibility', 'hidden');
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

    // Same numbers as a table, for anyone who can't (or doesn't want to) use the hover.
    // One line gets listens and time, more than one gets a listens column each
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Show as a table';
    details.appendChild(summary);
    const table = document.createElement('table');
    table.className = 'graph-table';
    const headings = [unit[0].toUpperCase() + unit.slice(1)];
    if (single) {
        headings.push('Listens', 'Time');
    } else {
        for (const s of series) headings.push(s.label);
    }
    const headRow = table.insertRow();
    for (const text of headings) {
        const th = document.createElement('th');
        th.textContent = text;
        headRow.appendChild(th);
    }
    for (const b of buckets) {
        const row = table.insertRow();
        row.insertCell().textContent = bucketLabel(b, unit);
        if (single) {
            row.insertCell().textContent = b.listens[0].toLocaleString();
            row.insertCell().textContent = hoursString(b.time[0]);
        } else {
            for (let s = 0; s < series.length; s++) {
                row.insertCell().textContent = shortValue(value(b, s));
            }
        }
    }
    details.appendChild(table);
    container.appendChild(details);
}
