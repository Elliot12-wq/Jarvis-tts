// JARVIS TTS backend (Cloudflare Worker): Microsoft Edge neural voices, free, NO API key and NO billing.
// Deploy:  npx wrangler deploy        (same wrangler.toml as before; the GOOGLE_TTS_KEY secret is no longer needed)
// Optional vars (wrangler.toml [vars] or dashboard):
//   VOICE     default "en-GB-RyanNeural" (deep, warm British male). Other British males: en-GB-ThomasNeural (mature), en-GB-OllieMultilingualNeural, en-GB-AlfieNeural
//   RATE      default "-8%"   (slower = more butler)      e.g. "-12%" .. "+0%"
//   PITCH     default "-4Hz"  (lower = more gravitas)     e.g. "-8Hz" .. "+0Hz"
//   EDGE_VER  default "2-143.0.3650.75" (Sec-MS-GEC-Version; must start with "2-" since Microsoft's Oct 2026 token change)
// In the script: Main page > "Jarvis voice server" box, or say: "Jarvis, set voice server https://jarvis-tts.<you>.workers.dev"
const MAX_CHARS = 450;
const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const BASE = "speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const VERSIONS = ["2-143.0.3650.75", "2-155.0.4283.45"];
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const rnd = (n) => hex(crypto.getRandomValues(new Uint8Array(n))).toUpperCase();

// Sec-MS-GEC v2 token (mandatory since Oct 2026): "<16 hex CS64>-<64 hex SHA-256>". Port of generate_sec_ms_gec_v2 from rany2/edge-tts (LGPL-3.0).
const K = [0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,0xE49B69C1,0xEFBE4786,0x0FC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x06CA6351,0x14292967,0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2];
const KB = K.slice(); KB[14] = 0xC9DC06A7;
const IV = [0x6A09E667,0xBB67AE85,0x3C6EF372,0xA54FF53A,0x510E527F,0x9B05688C,0x1F83D9AB,0x5BE0CD19];
const MID = [0xFD9FBEA2,0x91243CE7,0xBE499094,0xCD2E1E0A,0x6C006F49,0x04BD35AB,0xFEB0A7E4,0x03EFFBD2];
const SCH = [0xEB24BF9E,0x1558691F,0xA0C09EE2,0x0CFA32BA,0xA622EE8C,0xD1DD9491,0xC0DD25A0,0xF9E70AB6,0xF0C31573,0x7058CE4E,0x7188E606,0x00E5AB33,0xD258B060,0x72766564];
const CSC = [[0xE82E91B1,0xB32700D0],[0x44DE24C6,0x88DFF51D],[0x3BEB65BC,0x29514038],[0xC89C5933,0xB328CBDF],[0x8D1EC211,0xD405B4D5],[0x314EF5D5,0x26E55F3C],[0xE92491B1,0x607801C6],[0xF0A5B9D5,0x82B2C1FB],[0x06064CF3,0xFA51A3DA],[0xDA79FA60,0x207CC464],[0xBED20560,0x3C3C74F3],[0x89F9C9F8,0xD2D14B61],[0x35FA38C6,0xBB04A2C1],[0xCB49E3C6,0xC5626167]];
const mul = (a, b) => Math.imul(a, b) >>> 0;
const rol16 = (v) => ((v << 16) | (v >>> 16)) >>> 0;
const rotr = (v, n) => ((v >>> n) | (v << (32 - n))) >>> 0;
const sg0 = (v) => ((v >>> 7) ^ (v << 25) ^ (v >>> 18) ^ (v << 14) ^ (v >>> 3)) >>> 0;
const sg1 = (v) => ((v >>> 17) ^ (v << 15) ^ (v >>> 19) ^ (v << 13) ^ (v >>> 10)) >>> 0;
const bg0 = (v) => (rotr(v, 2) ^ rotr(v, 13) ^ rotr(v, 22)) >>> 0;
const bg1 = (v) => (rotr(v, 6) ^ rotr(v, 11) ^ rotr(v, 25)) >>> 0;
const expand = (w, from) => { for (let i = from; i < 64; i++) w.push((sg1(w[i - 2]) + w[i - 7] + sg0(w[i - 15]) + w[i - 16]) >>> 0); return w; };
function rounds(st, w, first) {
  let [a, b, c, d, e, f, g, h] = st;
  const k = first === 14 ? KB : K;
  for (let i = first; i < 64; i++) {
    const t1 = (h + bg1(e) + ((g ^ (e & (f ^ g))) >>> 0) + k[i] + w[i]) >>> 0;
    const t2 = (bg0(a) + (((a & b) | (c & (a | b))) >>> 0)) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}
function midstate(salt) {
  const w = new Array(16).fill(0);
  w[14] = (salt[0] << 16 | salt[1] << 8 | salt[2]) >>> 0;
  w[15] = ((salt[3] << 24) | (salt[4] << 16) | (salt[5] << 8) | salt[6]) >>> 0;
  for (let i = 16; i < 30; i++) {
    let v = SCH[i - 16];
    if (i - 2 >= 14) { let s = sg1(w[i - 2]); if (i === 16) s = (s ^ 0x000B92C0) >>> 0; v = (v + s) >>> 0; }
    if (i - 7 >= 14) v = (v + w[i - 7]) >>> 0;
    if (i - 15 >= 14) { let s = sg0(w[i - 15]); if (i === 29) s = (s ^ 0x059C0B80) >>> 0; v = (v + s) >>> 0; }
    w.push(v);
  }
  w.push((sg1(w[28]) + w[23] + sg0(w[15]) + w[14] + 0xC9DC06A7 - K[14]) >>> 0);
  const r = rounds(MID, expand(w, 31), 14);
  return r.map((x, i) => (IV[i] + x) >>> 0);
}
function v2(ticks) {
  const data = new TextEncoder().encode(ticks + TOKEN);
  // salted SHA-256
  const len = 57 + data.length, rest = data.subarray(7);
  const padN = (((55 - len) % 64) + 64) % 64;
  const padded = new Uint8Array(rest.length + 1 + padN + 8);
  padded.set(rest); padded[rest.length] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, (len * 8) >>> 0);
  let st = midstate(data.subarray(0, 7));
  for (let o = 0; o < padded.length; o += 64) {
    const dv = new DataView(padded.buffer, o, 64), w = [];
    for (let i = 0; i < 16; i++) w.push(dv.getUint32(i * 4));
    const r = rounds(st, expand(w, 16), 0);
    st = st.map((x, i) => (x + r[i]) >>> 0);
  }
  const dig = new Uint8Array(32), ddv = new DataView(dig.buffer);
  st.forEach((x, i) => ddv.setUint32(i * 4, x));
  // CS64 keyed by the digest
  const kA = (ddv.getUint32(0, true) | 1) >>> 0, kB = (ddv.getUint32(4, true) | 1) >>> 0;
  const fac = [mul(kA, 0x82893933), mul(kB, 0x82893933)];
  const inp = new Uint8Array(1 + data.length); inp.set(data, 1);
  let n = Math.ceil(inp.length / 4); if (n % 2) n++;
  const buf = new Uint8Array(n * 4); buf.set(inp);
  const bdv = new DataView(buf.buffer), words = [];
  for (let i = 0; i < n; i++) words.push(bdv.getUint32(i * 4, true));
  const terms = [], offs = [];
  CSC.forEach((c, i) => { terms.push(mul(c[0], fac[i % 2])); offs.push(c[1]); });
  words.forEach((wd, i) => {
    let key = kA, off = mul(rol16(wd), 0xEF0569FB);
    if (i % 2 === 1) { key = kB; off = mul(rol16(wd), 0xC31713DB); }
    let term = mul(wd, key);
    if (i === 0) { term = (term + mul(0xF2F90B1A, fac[0])) >>> 0; off = (off + 0x0B1A0000) >>> 0; }
    terms.push(term); offs.push(off);
  });
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let t = rol16((offs[i] + x) >>> 0), q = mul(t, 0x76F50F34);
    swapAcc = (swapAcc + mul(rol16(q), 0xC3EFEA97) + q) >>> 0;
    t = rol16((offs[i + 1] + y) >>> 0); q = mul(t, 0x1881CE3C);
    swapLast = (mul(rol16(q), 0x35BD1EC9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;
    state = (mul(state, kA) + x) >>> 0;
    state = mul(rol16(state), 0xCF98B111); state = mul(rol16(state), 0x87085B9F);
    state = mul(rol16(state), 0x12CEB96D); state = mul(rol16(state), 0x257E1D83);
    acc = (acc + state) >>> 0;
    t = (mul(state, kB) + y) >>> 0;
    t = mul(rol16(t), 0xA27416F5); t = mul(rol16(t), 0xD38396FF);
    state = mul(rol16(mul(rol16(t), 0x7C932B89)), 0xBFA49F69);
    acc = (acc + state) >>> 0;
  }
  const cs = new Uint8Array(8), cdv = new DataView(cs.buffer);
  cdv.setUint32(0, (swapLast ^ state) >>> 0, true); cdv.setUint32(4, (swapAcc ^ acc) >>> 0, true);
  return (hex(cs) + "-" + hex(dig)).toUpperCase();
}
function gec(skew) {
  let t = Math.floor(Date.now() / 1000 + skew) + 11644473600;
  t -= t % 300;
  return v2(String(BigInt(t) * 10000000n));
}
async function open(ver) {
  const major = ver.split("-")[1].split(".")[0];
  let skew = 0;
  for (let i = 0; i < 2; i++) {
    const url = `https://${BASE}?TrustedClientToken=${TOKEN}&ConnectionId=${rnd(16).toLowerCase()}&Sec-MS-GEC=${await gec(skew)}&Sec-MS-GEC-Version=${ver}`;
    const r = await fetch(url, { headers: {
      Upgrade: "websocket", Origin: ORIGIN, Pragma: "no-cache", "Cache-Control": "no-cache", "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
      Cookie: `muid=${rnd(16)};`,
    } });
    if (r.webSocket) { r.webSocket.accept(); return { ws: r.webSocket }; }
    const d = Date.parse(r.headers.get("Date") || "");
    if (r.status === 403 && d && i === 0) { skew = (d - Date.now()) / 1000; continue; } // clock-skew retry
    return { err: `connect ${r.status}` };
  }
  return { err: "connect failed" };
}
const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()]} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
};
const esc = (s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const full = (v) => { const m = /^([a-z]{2,3}-[A-Z]{2,4})-(.+)$/.exec(v); return m ? `Microsoft Server Speech Text to Speech Voice (${m[1]}, ${m[2]})` : v; };

function synth(ws, voice, rate, pitch, text) {
  return new Promise((resolve, reject) => {
    const chunks = []; let done = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(1000); } catch {} fn(v); };
    const timer = setTimeout(() => end(reject, new Error("timeout")), 15000);
    ws.addEventListener("message", (ev) => {
      const d = ev.data;
      if (typeof d === "string") {
        if (d.includes("Path:turn.end")) {
          let n = 0; for (const c of chunks) n += c.length;
          const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
          end(resolve, out);
        }
        return;
      }
      const u = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer);
      const hl = (u[0] << 8) | u[1];
      if (new TextDecoder().decode(u.subarray(2, 2 + hl)).includes("Path:audio")) chunks.push(u.subarray(2 + hl));
    });
    ws.addEventListener("error", () => end(reject, new Error("socket error")));
    ws.addEventListener("close", () => end(reject, new Error("closed early")));
    ws.send(`X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
    ws.send(`X-RequestId:${rnd(16).toLowerCase()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-GB'><voice name='${full(voice)}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${esc(text)}</prosody></voice></speak>`);
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
    const text = (new URL(request.url).searchParams.get("t") || "").trim().slice(0, MAX_CHARS);
    if (!text) return new Response("missing t", { status: 400 });

    const voice = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9]+$/.test(env.VOICE || "") ? env.VOICE : "en-GB-RyanNeural";
    const rate = /^[+-]\d{1,3}%$/.test(env.RATE || "") ? env.RATE : "-8%";
    const pitch = /^[+-]\d{1,3}Hz$/.test(env.PITCH || "") ? env.PITCH : "-4Hz";

    // identical sentences are served from Cloudflare's edge cache (a line keeps the same take, no repeat calls)
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`edge|${voice}|${rate}|${pitch}|${text}`));
    const key = new Request("https://jarvis-tts.cache/" + hex(digest));
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) return hit;

    let audio, lastErr = "";
    for (const ver of [...new Set([env.EDGE_VER, ...VERSIONS].filter(Boolean))]) {
      const o = await open(ver);
      if (o.err) { lastErr = `${ver} ${o.err}`; continue; }
      try { audio = await synth(o.ws, voice, rate, pitch, text); } catch (e) { lastErr = `${ver} ${e.message}`; continue; }
      if (audio && audio.length > 600) break;
      lastErr = `${ver} empty audio`; audio = null;
    }
    if (!audio) return new Response("tts upstream error " + lastErr, { status: 502 });

    const out = new Response(audio, { headers: { "Content-Type": "audio/mpeg", "X-Jarvis-Engine": "edge", "Cache-Control": "public, max-age=31536000" } });
    ctx.waitUntil(cache.put(key, out.clone()));
    return out;
  },
};
