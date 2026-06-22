const express = require('express');
const cors = require('cors');
const archiver = require('archiver');

// APIFRAME V2 API
const BASE = 'https://api.apiframe.ai/v2';
const KEY = process.env.APIFRAME_KEY || '';

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-API-Key': KEY,
  };
}

// Health check
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'apiframe-proxy-v2', hasKey: !!KEY, keyPrefix: KEY.slice(0, 4) });
});

// Submit a Midjourney imagine job (v2 endpoint)
app.post('/mj/imagine', async (req, res) => {
  const { prompt, aspect_ratio } = req.body;
  const body = {
    model: 'midjourney',
    prompt: prompt,
    midjourneyParams: {}
  };
  if (aspect_ratio) body.midjourneyParams.aspect_ratio = aspect_ratio;

  console.log('[proxy] POST /images/generate', JSON.stringify(body).slice(0, 200));
  try {
    const r = await fetch(BASE + '/images/generate', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const text = await r.text();
    console.log('[proxy] <-', r.status, text.slice(0, 300));
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.status(r.status).json(data);
  } catch (err) {
    console.error('[proxy] error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Poll a single job by ID (v2 uses GET /jobs/:id)
app.get('/mj/job/:id', async (req, res) => {
  try {
    const r = await fetch(BASE + '/jobs/' + req.params.id, {
      method: 'GET',
      headers: headers(),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Poll many jobs at once (proxy batches individual v2 calls)
app.post('/mj/poll', async (req, res) => {
  const ids = req.body.ids || [];
  console.log('[proxy] polling', ids.length, 'jobs');
  const results = [];
  for (const id of ids) {
    try {
      const r = await fetch(BASE + '/jobs/' + id, {
        method: 'GET',
        headers: headers(),
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      data._jobId = id;
      results.push(data);
    } catch (err) {
      results.push({ _jobId: id, error: err.message });
    }
  }
  res.json(results);
});

// ZIP download
app.post('/mj/zip', async (req, res) => {
  const items = Array.isArray(req.body?.items)
    ? req.body.items
    : (req.body?.urls || []).map((u, i) => ({ url: u, name: `frame-${i + 1}.png` }));
  if (!items.length) return res.status(400).json({ error: 'No images' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="midjourney-batch.zip"');
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => res.end());
  archive.pipe(res);
  for (let i = 0; i < items.length; i++) {
    try {
      const r = await fetch(items[i].url);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      archive.append(buf, { name: items[i].name || `frame-${i + 1}.png` });
    } catch { /* skip */ }
  }
  archive.finalize();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('apiframe-proxy-v2 on port', PORT);
  console.log('Key loaded:', !!KEY, 'prefix:', KEY.slice(0, 4));
});
