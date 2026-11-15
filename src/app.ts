// The follow-me page: RTT chart, holder on the globe, the pad, and the move. Cell calls live in follow.ts.
import * as fm from './follow';
import type { Device, Sample, Advice } from './follow';
import type { SessionPadClient } from '../sdk/SessionPad';

declare const d3: any;
declare const topojson: any;

const $ = (id: string) => document.getElementById(id)!;
type Point = { t: number; ms: number };
const series = new Map<string, Point[]>();
const events: { t: number; text: string; kind: 'move' | 'find' | 'pad' | 'err' }[] = [];
const state = { devices: [] as Device[], holder: '', best: '', advice: null as Advice | null, follow: false, moving: false, padText: '', moves: [] as { t: number; from: string; to: string }[] };
(window as any).__fm = { state, series, events };

const short = (n: string) => (n ? n.slice(0, 8) : '-');
const label = (n: string) => {
  const d = state.devices.find((x) => x.node === n);
  return d ? `${d.label} ${short(n)}` : short(n);
};
function log(kind: (typeof events)[number]['kind'], text: string) {
  events.unshift({ t: Date.now(), text, kind });
  events.length = Math.min(events.length, 40);
  $('log').innerHTML = events
    .map((e) => `<li class="${e.kind}"><time>${new Date(e.t).toLocaleTimeString([], { hour12: false })}</time>${e.text}</li>`)
    .join('');
}

// ---- RTT chart (SVG, last 90 s) ----
function chart() {
  const W = 560, H = 180, P = 28, now = Date.now(), span = 90_000;
  const all = [...series.values()].flat().filter((p) => now - p.t < span);
  const max = Math.max(5, ...all.map((p) => p.ms)) * 1.15;
  const x = (t: number) => P + ((t - (now - span)) / span) * (W - P - 6);
  const y = (ms: number) => H - 18 - (ms / max) * (H - 30);
  let g = `<line class="ax" x1="${P}" y1="${H - 18}" x2="${W - 6}" y2="${H - 18}"/>`;
  for (const f of [0.25, 0.5, 0.75, 1]) g += `<text class="tk" x="2" y="${y(max * f) + 3}">${(max * f).toFixed(max < 10 ? 1 : 0)}</text><line class="gr" x1="${P}" x2="${W - 6}" y1="${y(max * f)}" y2="${y(max * f)}"/>`;
  for (const m of state.moves.filter((m) => now - m.t < span)) g += `<line class="mv" x1="${x(m.t)}" x2="${x(m.t)}" y1="8" y2="${H - 18}"/><text class="tk mvt" x="${x(m.t) + 3}" y="16">move</text>`;
  for (const [node, pts] of series) {
    const p = pts.filter((q) => now - q.t < span);
    if (!p.length) continue;
    const cls = node === 'pad' ? 'ln pad' : node === state.holder ? 'ln hold' : 'ln';
    g += `<polyline class="${cls}" points="${p.map((q) => `${x(q.t).toFixed(1)},${y(q.ms).toFixed(1)}`).join(' ')}"/>`;
  }
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Round trip from this browser, ms">${g}</svg>`;
}

// ---- globe (d3 orthographic, land from world-atlas) ----
let land: any = null;
let rot = [-20, -35];
async function globeInit() {
  try {
    const w = await (await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json')).json();
    land = topojson.feature(w, w.objects.land);
  } catch {
    land = null;
  }
}
function globe() {
  const c = $('globe') as HTMLCanvasElement;
  const r = c.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  c.width = r.width * dpr;
  c.height = r.height * dpr;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const s = Math.min(r.width, r.height) / 2 - 8;
  const proj = d3.geoOrthographic().scale(s).translate([r.width / 2, r.height / 2]).rotate(rot).clipAngle(90);
  const path = d3.geoPath(proj, ctx);
  const css = getComputedStyle(document.documentElement);
  const v = (k: string) => css.getPropertyValue(k).trim();
  ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = v('--surface'); ctx.fill(); ctx.strokeStyle = v('--line-2'); ctx.stroke();
  ctx.beginPath(); path(d3.geoGraticule10()); ctx.strokeStyle = v('--line'); ctx.lineWidth = 0.5; ctx.stroke();
  if (land) { ctx.beginPath(); path(land); ctx.fillStyle = v('--raise'); ctx.fill(); }
  const at = (n: string) => { const d = state.devices.find((x) => x.node === n); return d && (d.lat || d.lon) ? [d.lon, d.lat] : null; };
  for (const m of state.moves.slice(-3)) {
    const a = at(m.from), b = at(m.to);
    if (a && b && (a[0] !== b[0] || a[1] !== b[1])) { ctx.beginPath(); path({ type: 'LineString', coordinates: [a, b] }); ctx.strokeStyle = v('--acc'); ctx.lineWidth = 1.6; ctx.stroke(); }
  }
  for (const d of state.devices) {
    const p = d.lat || d.lon ? proj([d.lon, d.lat]) : null;
    if (!p) continue;
    const held = d.node === state.holder;
    ctx.beginPath(); ctx.arc(p[0], p[1], held ? 5 : 3.5, 0, 7); ctx.fillStyle = held ? v('--live') : v('--acc'); ctx.fill();
    if (held) { const k = (Date.now() / 900) % 1; ctx.beginPath(); ctx.arc(p[0], p[1], 6 + k * 14, 0, 7); ctx.strokeStyle = `rgba(155,209,107,${1 - k})`; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.fillStyle = v('--ink'); ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillText(`${d.label}${held ? ' · holds the pad' : ''}`, p[0] + 9, p[1] + 3);
  }
}
function spin() {
  const h = state.devices.find((d) => d.node === state.holder);
  if (h && (h.lat || h.lon)) rot = [rot[0] + (-h.lon - rot[0]) * 0.03, rot[1] + (-h.lat * 0.6 - rot[1]) * 0.03];
  globe();
  requestAnimationFrame(spin);
}

// ---- the pad ----
let padc: SessionPadClient | null = null;
async function padConnect() {
  padc?.close();
  padc = await fm.pad(state.devices);
}
async function padRead() {
  if (!padc) await padConnect();
  const t = performance.now();
  let r;
  try {
    r = await padc!.read('follow-me');
  } catch {
    await padConnect();
    r = await padc!.read('follow-me');
  }
  push('pad', performance.now() - t);
  if ('ok' in r) {
    state.padText = r.ok.text;
    $('pad').textContent = r.ok.text || '(empty: type below)';
    $('padmeta').textContent = `version ${r.ok.version} · answered by ${label(r.ok.node)} · state.store key sessionpad/pads/follow-me`;
  }
}
async function padAppend(text: string) {
  if (!padc) await padConnect();
  let r;
  try { r = await padc!.append({ pad: 'follow-me', text }); } catch { await padConnect(); r = await padc!.append({ pad: 'follow-me', text }); }
  if ('err' in r) return log('err', `append: ${JSON.stringify(r.err)}`);
  state.padText = r.ok.text;
  $('pad').textContent = r.ok.text;
  log('pad', `typed ${JSON.stringify(text.trim())} on ${label(r.ok.node)} (version ${r.ok.version})`);
}

function push(node: string, ms: number) {
  const s = series.get(node) ?? [];
  s.push({ t: Date.now(), ms });
  if (s.length > 200) s.shift();
  series.set(node, s);
}

async function resolve(why: string) {
  const h = await fm.holder();
  if (h !== state.holder) log('find', `net.find Resolve session.pad@1 -> ${h ? label(h) : 'no holder'}${why ? ` (${why})` : ''}`);
  state.holder = h;
  $('holder').textContent = h ? label(h) : 'none';
}

async function move() {
  if (state.moving) return;
  state.moving = true;
  ($('follow') as HTMLButtonElement).disabled = true;
  const from = state.holder, to = state.best || state.holder;
  const before = state.padText;
  log('move', from === to ? `restart session.pad on ${label(to)} (it is already the nearest device)` : `follow me: ${label(from)} -> ${label(to)}`);
  try {
    const t = performance.now();
    const r = await fm.follow(from, to);
    log('move', `orch.up answered in ${((performance.now() - t) / 1000).toFixed(1)} s: ${JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? Number(v) : v)).slice(0, 160)}`);
    state.moves.push({ t: Date.now(), from, to });
    for (let i = 0; i < 30; i++) {
      await resolve('after the move');
      if (state.holder) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await padConnect();
    await padRead();
    log('pad', state.padText.startsWith(before) ? `text typed before the move is still there (${before.length} characters)` : 'text changed during the move');
  } catch (e) {
    log('err', `move: ${e}`);
  }
  state.moving = false;
  ($('follow') as HTMLButtonElement).disabled = false;
}

async function probeLoop() {
  for (;;) {
    try {
      const s: Sample[] = await fm.probe(state.devices);
      for (const x of s) push(x.node, x.rtt_ms);
      const h = s.find((x) => x.node === state.holder);
      $('rtt').textContent = h ? h.rtt_ms.toFixed(1) : '-';
      $('devs').innerHTML = s
        .map((x) => `<li><span>${label(x.node)}${x.node === state.holder ? ' <b>holder</b>' : ''}</span><span class="v">${x.rtt_ms.toFixed(1)} <small>ms</small></span></li>`)
        .join('');
      if (!state.moving) await padRead();
      chart();
    } catch (e) {
      log('err', `probe: ${e}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function watchLoop() {
  for (;;) {
    try {
      for await (const a of await fm.watch()) {
        state.advice = a;
        state.best = a.best.slice(0, 16);
        $('advice').textContent = a.why;
        $('gain').textContent = a.gain_ms.toFixed(1);
        $('streak').textContent = `${a.streak}`;
        if (a.suggest && state.follow && !state.moving && a.best && a.holder) move();
      }
    } catch (e) {
      log('err', `watch: ${e}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  if (!fm.grant) {
    $('nogrant').hidden = false;
    return;
  }
  fetch('follow.ts').then((r) => r.text()).then((t) => ($('code').textContent = t)).catch(() => {});
  await globeInit();
  requestAnimationFrame(spin);
  state.devices = await fm.devices();
  $('ndev').textContent = `${state.devices.length}`;
  log('find', `${state.devices.length} opted-in device(s): ${state.devices.map((d) => d.label).join(', ')}`);
  await resolve('page open');
  probeLoop();
  watchLoop();
  ($('follow') as HTMLButtonElement).onclick = () => {
    state.follow = true;
    $('follow').setAttribute('aria-pressed', 'true');
    if (state.advice && (state.advice.suggest || state.best === state.holder)) move();
  };
  ($('type') as HTMLFormElement).onsubmit = (ev) => {
    ev.preventDefault();
    const i = $('typein') as HTMLInputElement;
    if (i.value.trim()) padAppend(i.value.trim() + ' ');
    i.value = '';
  };
  setInterval(chart, 1000);
}
main().catch((e) => log('err', `${e}`));
