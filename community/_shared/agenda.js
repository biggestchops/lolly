// SPDX-License-Identifier: MPL-2.0
// === lolly:shared agenda-clock - canonical source; edit here and run pnpm run sync:shared ===
// Event time is absolute; presentation time is elapsed. Neither depends on frame order.
function agWallParts(ms, zone) {
  var f = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(function (p) { f[p.type] = p.value; });
  return { date: f.year + '-' + f.month + '-' + f.day, minutes: Number(f.hour) * 60 + Number(f.minute) };
}
function agInstant(day, minute, zone) {
  var wall = Date.parse(day + 'T00:00:00Z') + minute * 60000;
  if (!Number.isFinite(wall)) return { error: 'Invalid date' };
  if (!zone) return { ms: wall, floating: true };
  var offsets = [], candidates = [];
  try {
    [-36, -12, 0, 12, 36].forEach(function (h) {
      var probe = wall + h * 3600000, p = agWallParts(probe, zone);
      var offset = Date.parse(p.date + 'T00:00:00Z') + p.minutes * 60000 - probe;
      if (offsets.indexOf(offset) < 0) offsets.push(offset);
    });
    offsets.forEach(function (offset) {
      var utc = wall - offset, p = agWallParts(utc, zone);
      if (Date.parse(p.date + 'T00:00:00Z') + p.minutes * 60000 === wall) candidates.push(utc);
    });
  } catch (_) { return { error: 'Unknown time zone' }; }
  if (candidates.length !== 1) return { error: candidates.length ? 'Ambiguous time at daylight saving change' : 'Time does not exist at daylight saving change' };
  return { ms: candidates[0] };
}
function agNow(sessions, instant, groupKey) {
  var groups = [];
  sessions.forEach(function (s) {
    if (s.status === 'cancelled') return;
    var name = s[groupKey] || 'All tracks', g = groups.find(function (v) { return v.name === name; });
    if (!g) { g = { name: name, now: [], next: [] }; groups.push(g); }
    if (s.startMs <= instant && instant < s.endMs) g.now.push(s);
    else if (s.startMs > instant) g.next.push(s);
  });
  groups.forEach(function (g) {
    g.next.sort(function (a,b) { return a.startMs - b.startMs; });
    g.next = g.next.filter(function (s) { return s.startMs === g.next[0].startMs; });
  });
  return groups;
}
function agPan(elapsed, overflow, speed, hold) {
  if (overflow <= 0 || elapsed <= hold) return 0;
  var travel = overflow / Math.max(1, speed), t = Math.max(0, elapsed - hold);
  return -overflow * Math.min(1, t / travel);
}
function agSceneAt(scenes, elapsed) {
  var total = scenes.reduce(function (n, s) { return n + s.duration; }, 0);
  if (!scenes.length || total <= 0) return null;
  var t = ((elapsed % total) + total) % total;
  for (var i = 0; i < scenes.length; i++) {
    if (t < scenes[i].duration) return { index: i, local: t, scene: scenes[i], total: total };
    t -= scenes[i].duration;
  }
  return { index: 0, local: 0, scene: scenes[0], total: total };
}
function agCalendar(sessions, title, createdAt) {
  function text(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/[\x00-\x1f\x7f]/g, ''); }
  function stamp(ms, floating) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, floating ? '' : 'Z'); }
  var generated = stamp(Number.isFinite(createdAt) ? createdAt : Date.now(), false);
  var lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Lolly//Agenda//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:' + text(title)];
  sessions.forEach(function (s) {
    if (!s.valid || !s.title) return;
    var uid = s.eventId ? encodeURIComponent(s.eventId) + '/' + encodeURIComponent(s.id) : text(s.id);
    lines.push('BEGIN:VEVENT','UID:' + uid + '@lolly.tools','DTSTAMP:' + generated,'DTSTART:' + stamp(s.startMs,s.floating),'DTEND:' + stamp(s.endMs,s.floating),'SUMMARY:' + text(s.title),'LOCATION:' + text(s.room),'DESCRIPTION:' + text([s.speaker,s.note].filter(Boolean).join('\n')));
    if (s.link) lines.push('URL:' + text(s.link));
    lines.push('STATUS:' + (s.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'),'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(function (line) {
    var out = '', n = 0;
    Array.from(line).forEach(function (ch) { var cp = ch.codePointAt(0), len = cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4; if (n + len > 75) { out += '\r\n '; n = 1; } out += ch; n += len; });
    return out;
  }).join('\r\n') + '\r\n';
}
// === /lolly:shared agenda-clock ===
