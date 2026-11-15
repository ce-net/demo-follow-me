// Headless proof: open the page from a grant link, probe, type, press Follow me, type again; print what happened
// and save a screenshot. Usage: node proof/run.mjs '<link with #g=...>' [out-dir]   (needs puppeteer-core + chromium)
import puppeteer from 'puppeteer-core';
const [link, out = 'proof'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', args: ['--no-sandbox'], headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const consoleErr = [];
p.on('console', (m) => m.type() === 'error' && consoleErr.push(m.text()));
p.on('pageerror', (e) => consoleErr.push(String(e)));
await p.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => p.evaluate(() => {
  const f = window.__fm;
  const s = {}; for (const [k, v] of f.series) s[k] = v.map((x) => +x.ms.toFixed(2));
  return { holder: f.state.holder, best: f.state.best, pad: f.state.padText, moves: f.state.moves, advice: f.state.advice && { why: f.state.advice.why, gain_ms: f.state.advice.gain_ms, suggest: f.state.advice.suggest }, series: s, events: f.events.map((e) => `${new Date(e.t).toISOString().slice(11, 19)} ${e.kind} ${e.text}`) };
});
await sleep(12000);
const text1 = `typed before the move at ${new Date().toISOString().slice(11, 19)}.`;
await p.type('#typein', text1); await p.keyboard.press('Enter');
await sleep(5000);
const before = await st();
await p.click('#follow');
for (let i = 0; i < 240; i++) { await sleep(1000); const s = await st(); if (s.moves.length && !(await p.evaluate(() => window.__fm.state.moving))) break; }
await p.type('#typein', 'typed after the move.'); await p.keyboard.press('Enter');
await sleep(12000);
const after = await st();
await p.screenshot({ path: `${out}/follow-me-1440.png` });
await p.setViewport({ width: 390, height: 844 }); await sleep(2500);
await p.screenshot({ path: `${out}/follow-me-390.png`, fullPage: true });
const t = after.moves[0]?.t ?? Date.now();
console.log(JSON.stringify({ text1, before: { holder: before.holder, pad: before.pad, advice: before.advice }, after: { holder: after.holder, pad: after.pad, moves: after.moves }, rtt_ms: after.series, events: after.events.reverse(), consoleErr }, null, 1));
await b.close();
