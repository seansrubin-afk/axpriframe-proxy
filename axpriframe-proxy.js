const express = require('express');
const cors = require('cors');
const archiver = require('archiver');

const APIFRAME_BASE = 'https://api.apiframe.ai/v2';
const APIFRAME_KEY = process.env.APIFRAME_KEY || '';

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

function authHeaders() {
  return {
    'Content-Type': 'application/json',
'Authorization': APIFRAME_KEY,  };
}

async function relay(path, body) {
  console.log('[proxy] ->', path, JSON.stringify(body).slice(0, 200));
  try {
    const r = await fetch(APIFRAME_BASE + path, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body || {}),
    });
    const text = await r.text();
    console.log('[proxy] <-', r.status, text.slice(0, 300));
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: r.status, data };
  } catch (err) {
    console.error('[proxy] fetch error:', err.message);
    return { status: 502, data: { error: err.message } };
  }
}

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'apiframe-proxy', hasKey: !!APIFRAME_KEY });
});

app.post('/mj/imagine', async (req, res) => {
  const { status, data } = await relay('/imagine', req.body);
  res.status(status).json(data);
});

app.post('/mj/fetch-many', async (req, res) => {
  const { status, data } = await relay('/fetch-many', req.body);
  res.status(status).json(data);
});

app.post('/mj/upscale-highres', async (req, res) => {
  const { status, data } = await relay('/upscale-highres', req.body);
  res.status(status).json(data);
});

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
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      archive.append(buf, { name: name || `frame-${i + 1}.png` });
    } catch { /* skip */ }
  }
  archive.finalize();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('apiframe-proxy listening on ' + PORT);
  console.log('APIFRAME_KEY set:', !!APIFRAME_KEY, '(length:', APIFRAME_KEY.length + ')');
});
