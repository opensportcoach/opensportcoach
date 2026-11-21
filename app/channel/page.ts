/**
 * The Phase 0 spike's test page: ask the coach something, watch the request move
 * QUEUED → WORKING → DONE with timings, and press Send to watch on a plan the coach published.
 * Not the app — the real UI is app/web/.
 * Everything from the server is rendered with textContent: nothing it sends is parsed as HTML.
 */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenSportCoach · channel spike</title>
<style>
  :root { --bg:#07090B; --s1:#0E1114; --s2:#14181C; --ln:rgba(255,255,255,.08); --tx:#F1F3F4; --tx2:#AEB6BD; --tx3:#87919A;
          --g:#3DDC84; --y:#F2C14E; --r:#FF6B6B; --b:#4AA3FF; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--tx); font: 15px/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; }
  header { display: flex; gap: 16px; align-items: baseline; padding: 16px 24px; border-bottom: 1px solid var(--ln); }
  header b { letter-spacing: .22em; } header span { color: var(--tx2); font-size: 13px; }
  main { max-width: 860px; margin: 0 auto; padding: 24px; display: grid; gap: 20px; }
  section { background: var(--s1); border: 1px solid var(--ln); border-radius: 14px; padding: 16px; }
  h2 { margin: 0 0 10px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--tx3); }
  textarea, input { width: 100%; background: var(--s2); color: var(--tx); border: 1px solid var(--ln); border-radius: 10px; padding: 10px; font: inherit; }
  button { margin-top: 10px; background: var(--tx); color: var(--bg); border: 0; border-radius: 10px; padding: 9px 16px; font: inherit; font-weight: 600; cursor: pointer; }
  .row { display: flex; gap: 10px; align-items: center; } .row input { flex: 1; } .row button { margin-top: 0; }
  .req { border-top: 1px solid var(--ln); padding: 12px 0; } .req:first-child { border-top: 0; }
  .st { font-size: 11px; font-weight: 700; letter-spacing: .12em; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--ln); }
  .QUEUED { color: var(--tx2); } .WORKING { color: var(--b); } .DONE { color: var(--g); } .FAILED { color: var(--r); }
  .meta { color: var(--tx3); font-size: 12px; } .prog { color: var(--tx2); font-size: 13px; margin: 4px 0 0 4px; }
  .reply { white-space: pre-wrap; margin-top: 8px; } .err { color: var(--r); font-size: 13px; }
</style>
</head>
<body>
<header><b>OSC</b><span id="who">…</span><span id="conn">connecting…</span></header>
<main>
  <section>
    <h2>Ask the coach</h2>
    <form id="ask"><textarea id="q" rows="3" placeholder="e.g. What should I do today?"></textarea><button>Ask</button></form>
    <div id="askErr" class="err"></div>
  </section>
  <section>
    <h2>Requests</h2>
    <div id="list" class="meta">None yet.</div>
  </section>
</main>
<script>
const reqs = new Map();
const $ = (id) => document.getElementById(id);
const secs = (a, b) => a && b ? ((b - a) / 1000).toFixed(1) + ' s' : '';

function render() {
  const list = $('list');
  list.textContent = '';
  if (!reqs.size) { list.textContent = 'None yet.'; return; }
  for (const r of [...reqs.values()].reverse()) {
    const el = document.createElement('div'); el.className = 'req';
    const head = document.createElement('div'); head.className = 'row';
    const st = document.createElement('span'); st.className = 'st ' + r.state; st.textContent = r.state;
    const t = document.createElement('span'); t.textContent = r.id + ' · ' + r.kind + ' · ' + r.text;
    head.append(st, t); el.append(head);
    const m = document.createElement('div'); m.className = 'meta';
    m.textContent = ['picked up after ' + (secs(r.createdAt, r.ackedAt) || '—'), 'total ' + (secs(r.createdAt, r.finishedAt) || '—')].join(' · ');
    el.append(m);
    for (const p of r.progress) { const d = document.createElement('div'); d.className = 'prog'; d.textContent = '→ ' + p; el.append(d); }
    if (r.reply) { const d = document.createElement('div'); d.className = 'reply'; d.textContent = r.reply; el.append(d); }
    if (r.error) { const d = document.createElement('div'); d.className = 'err'; d.textContent = r.error; el.append(d); }
    if (r.result) {
      const pre = document.createElement('pre'); pre.className = 'reply'; pre.textContent = JSON.stringify(r.result.payload, null, 1); el.append(pre);
      if (r.result.kind === 'push_plan') {
        const b = document.createElement('button'); b.textContent = 'Send to watch · ' + r.result.payload.plan_hash;
        const err = document.createElement('div'); err.className = 'err';
        b.onclick = async () => { err.textContent = ''; try { const c = await post('/api/confirm', { plan_hash: r.result.payload.plan_hash }); reqs.set(c.id, c); render(); } catch (e) { err.textContent = String(e.message || e); } };
        el.append(b, err);
      }
    }
    list.append(el);
  }
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}

$('ask').onsubmit = async (e) => {
  e.preventDefault(); $('askErr').textContent = '';
  try { const r = await post('/api/requests', { text: $('q').value }); reqs.set(r.id, r); $('q').value = ''; render(); }
  catch (err) { $('askErr').textContent = String(err.message || err); }
};

fetch('/api/state').then((r) => r.json()).then((s) => {
  $('who').textContent = s.display + ' · Garmin: ' + (s.garmin_account || 'not bound');
  for (const r of s.requests) reqs.set(r.id, r);
  render();
});
const es = new EventSource('/api/events');
es.onopen = () => { $('conn').textContent = 'coach online'; };
es.onerror = () => { $('conn').textContent = 'coach offline'; };
es.addEventListener('request', (ev) => { const r = JSON.parse(ev.data); reqs.set(r.id, r); render(); });
</script>
</body>
</html>
`;
