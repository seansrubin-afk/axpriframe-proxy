// apiframe-proxy.js
// ---------------------------------------------------------------------------
// Tiny relay so a browser tool can drive APIFRAME (Midjourney) WITHOUT
//   (a) getting blocked by CORS, or
//   (b) ever exposing your API key in the page source.
// Deploy this as its own Railway service (keeps it clean of Switchboard).
// Requires Node 18+ (uses the built-in global fetch).
//
// SETUP (your usual GitHub-web-editor -> Railway flow):
//   1. New repo with this file + the package.json shown at the bottom.
//   2. Railway -> New Project -> Deploy from GitHub.
//   3. Railway -> Variables -> add:  APIFRAME_KEY = <your raw APIFRAME key>
//      (raw key, no "Bearer" in front of it)
//   4. Start command:  node apiframe-proxy.js
//   5. Copy the public Railway URL -> paste it into the HTML tool.
//
// If APIFRAME ever returns 401, flip AUTH_PREFIX to 'Bearer ' and redeploy.
// ---------------------------------------------------------------------------

const express = require('express');
const cors = require('cors');
const archiver = require('archiver');

const APIFRAME_BASE = 'https://api.apiframe.pro';
const APIFRAME_KEY = process.env.APIFRAME_KEY || '';
const AUTH_PREFIX = ''; // set to 'Bearer ' only if you get 401s

const app = express();
app.use(cors());                          // let the browser tool call from anywhere
app.use(express.json({ limit: '4mb' }));

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': AUTH_PREFIX + APIFRAME_KEY,
  };
}

// Generic POST relay to an APIFRAME endpoint
async function relay(path, body) {
  const r = await fetch(APIFRAME_BASE + path, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body || {}),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: r.status, data };
}

// Health check (the HTML tool's "Test connection" button hits this)
app.get('/', (_req, res) => res.json({ ok: true, service: 'apiframe-proxy' }));

// Submit one Midjourney /imagine job
app.post('/mj/imagine', async (req, res) => {
  const { status, data } = await relay('/imagine', req.body);
  res.status(status).json(data);
});

// Poll many jobs at once
app.post('/mj/fetch-many', async (req, res) => {
  const { status, data } = await relay('/fetch-many', req.body);
  res.status(status).json(data);
});

// Optional: high-res upscale (2x / 4x) if you ever want bigger frames
app.post('/mj/upscale-highres', async (req, res) => {
  const { status, data } = await relay('/upscale-highres', req.body);
  res.status(status).json(data);
});

// Mass download: fetch every image server-side (no CORS) and stream ONE zip.
// Body: { items: [{ url, name }] }  OR  { urls: ["...", "..."] }
app.post('/mj/zip', async (req, res) => {
  const items = Array.isArray(req.body?.items)
    ? req.body.items
    : (req.body?.urls || []).map((u, i) => ({ url: u, name: `frame-${i + 1}.png` }));

  if (!items.length) return res.status(400).json({ error: 'No images provided' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="midjourney-batch.zip"');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => { try { res.status(500); } catch {} res.end(); });
  archive.pipe(res);

  for (let i = 0; i < items.length; i++) {
    const { url, name } = items[i];
    try {
      const r = await fetch(url);
      if (!r.ok) continue;            // skip a dead URL, keep the rest
      const buf = Buffer.from(await r.arrayBuffer());
      archive.append(buf, { name: name || `frame-${i + 1}.png` });
    } catch { /* skip and continue */ }
  }
  archive.finalize();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('apiframe-proxy listening on ' + PORT));

/* ---------------------------------------------------------------------------
package.json  (put this next to apiframe-proxy.js)

{
  "name": "apiframe-proxy",
  "version": "1.0.0",
  "main": "apiframe-proxy.js",
  "scripts": { "start": "node apiframe-proxy.js" },
  "dependencies": {
    "express": "^4.19.2",
    "cors": "^2.8.5",
    "archiver": "^7.0.1"
  }
}
--------------------------------------------------------------------------- */
