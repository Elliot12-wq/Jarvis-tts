// JARVIS TTS backend (Cloudflare Worker): Microsoft Edge neural voices, free, NO API key and NO billing.
// Deploy:  npx wrangler deploy        (same wrangler.toml as before; the GOOGLE_TTS_KEY secret is no longer needed)
// Optional vars (wrangler.toml [vars] or dashboard):
//   VOICE     default "en-GB-RyanNeural" (deep, warm British male). Other British males: en-GB-ThomasNeural (mature), en-GB-OllieMultilingualNeural, en-GB-AlfieNeural
//   RATE      default "-8%"   (slower = more butler)      e.g. "-12%" .. "+0%"
//   PITCH     default "-4Hz"  (lower = more gravitas)     e.g. "-8Hz" .. "+0Hz"
//   EDGE_VER  default "1-143.0.3650.75" (Edge's Sec-MS-GEC-Version; if every request starts failing with 403, set the newest Edge/Chromium version as "1-<version>")
// In the script: Main page > "Jarvis voice server" box, or say: "Jarvis, set voice server https://jarvis-tts.<you>.workers.dev"
const MAX_CHARS = 450;
const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const BASE = "speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const VERSIONS = ["1-143.0.3650.75", "1-130.0.2849.68"];
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const rnd = (n) => hex(crypto.getRandomValues(new Uint8Array(n))).toUpperCase();

async function gec(skew) {
  const t = BigInt(Math.floor(Date.now() / 1000 + skew) + 11644473600);
  const f = (t - (t % 300n)) * 10000000n;
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${f}${TOKEN}`))).toUpperCase();
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
