// Moved all the time still into here because it was a bit messy
export function timeFormatter(ms) {
    let y = Math.floor(ms / (1000*60*60*24*365));
    ms -= y * (1000*60*60*24*365);
    let d = Math.floor(ms / (1000*60*60*24));
    ms -= d * (1000*60*60*24);
    let h = Math.floor(ms / (1000*60*60));
    ms -= h * (1000*60*60);
    let m = Math.floor(ms / (1000*60));
    ms -= m * (1000*60);
    let s = Math.floor(ms / 1000);
    ms -= s * 1000;
    let output = ""

    if (y > 0) {output += `${y} year${sOnEnd(y)}, `}
    if (d > 0) {output += `${d} day${sOnEnd(d)}, `}
    if (h > 0) {output += `${h} hour${sOnEnd(h)}, `}
    if (m > 0) {output += `${m} minute${sOnEnd(m)}, `}
    if (s > 0) {output += `${s} second${sOnEnd(s)}, `}
    output += `${ms} millisecond${sOnEnd(ms)}`
    
    return output;
}
export function sOnEnd(num) {
    if (num == 1) {return ""} else {return "s"}
}
export function msToHours(ms) {
    let hours = Math.floor(ms / (1000*60*60));
    let hoursStr = `${hours.toLocaleString()} hour${sOnEnd(hours)}`;

    return hoursStr;
}
export function msToDays(ms) {
    let days = Math.floor(ms / (1000*60*60*24));
    let daysStr = `${days.toLocaleString()} day${sOnEnd(days)}`;

    return daysStr;
}
