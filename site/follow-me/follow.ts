// The follow-me client. Every cell is reached by its api name; the only door is the one in this page's grant link,
// and each device's own door comes from net.rtt (data, not code). This file is shown on the page as it is.
import { grantFromLink, type Grant } from '../sdk/NetRtt';
import { NetRttClient, type Device, type Sample } from '../sdk/NetRtt';
import { PlaceNearClient, type Advice } from '../sdk/PlaceNear';
import { SessionPadClient, type Pad } from '../sdk/SessionPad';
import { OrchUpClient } from '../sdk/OrchUp';
import { NetFindClient } from '../sdk/NetFind';

export const API = 'session.pad';
export const grant: Grant | null = grantFromLink();

/** Every device that opted in (runs net.rtt next to its own ws-door). */
export async function devices(): Promise<Device[]> {
  const r = await (await NetRttClient.connect(grant)).devices();
  if ('err' in r) throw new Error(JSON.stringify(r.err));
  return r.ok;
}

/** Round trip from THIS browser to each device: 5 pings through that device's door, the median. */
export async function probe(ds: Device[]): Promise<Sample[]> {
  const out: Sample[] = [];
  for (const d of ds) {
    const c = await NetRttClient.connect({ ...grant!, url: d.ws_url || grant!.url });
    const ms: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await c.ping(BigInt(i));
      ms.push(performance.now() - t);
    }
    c.close();
    ms.sort((a, b) => a - b);
    out.push({ node: d.node, rtt_ms: ms[2] });
  }
  await (await NetRttClient.connect(grant)).report({ samples: out }); // place.near reads it for this viewer
  return out;
}

/** Who holds the api now (net.find). */
export async function holder(): Promise<string> {
  const r = await (await NetFindClient.connect(grant)).find({ name: API, major: 1 });
  return 'ok' in r && r.ok.replicas.length ? r.ok.replicas[0].node.slice(0, 16) : '';
}

/** The pad, through the door of the device that holds it. */
export async function pad(ds: Device[]): Promise<SessionPadClient> {
  const h = await holder();
  const d = ds.find((x) => x.node === h);
  return SessionPadClient.connect({ ...grant!, url: d?.ws_url || grant!.url });
}

/** Advice for this viewer; `suggest` only after the gain held for `sustain` probes. */
export async function watch(): Promise<AsyncIterable<Advice>> {
  return (await PlaceNearClient.connect(grant)).watch({ api: API, major: 1, hysteresis_ms: 20, sustain: 3, every_ms: 1000 });
}

/** Follow me: start the pad on `to`, then stop it on `from`. The text is in state.store, not in the cell. */
export async function follow(from: string, to: string) {
  const orch = await OrchUpClient.connect(grant);
  return from === to
    ? { down: await orch.down({ cell: API, on: from }), up: await orch.up({ cell: API, on: to }) } // one device: restart
    : await orch.move({ cell: API, from, to });
}

export type { Pad, Advice, Device, Sample };
