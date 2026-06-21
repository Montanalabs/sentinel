/**
 * Self-contained Sentinel dashboard asset (no build step, no framework). This file
 * holds the single static HTML page the sidecar serves as the human-facing surface
 * over the signed provenance chain, escalation queue, and analytics.
 */

/**
 * Complete, framework-free dashboard page served verbatim by the sidecar.
 *
 * Polls the same-origin `/v1` API (`/v1/analytics`, `/v1/verify`,
 * `/v1/escalations`, `/v1/records`) every 4 seconds and lets a reviewer resolve
 * pending escalations in place. Served at `/dashboard` by the route in the
 * sidecar HTTP server.
 *
 * @remarks Inlined as a string so the stock image ships with zero front-end
 *   build; all dynamic values are escaped client-side before insertion.
 */
export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sentinel — Action Gate Console</title>
<style>
  :root {
    --bg:#0f1216; --panel:#171c23; --panel2:#1e242d; --line:#2a323d; --fg:#e7ecf2;
    --muted:#8b97a7; --allow:#3fb950; --block:#f85149; --escalate:#d29922; --accent:#4493f8;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
    font:14px/1.5 ui-sans-serif,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  header { display:flex; align-items:center; gap:16px; padding:16px 24px;
    border-bottom:1px solid var(--line); background:var(--panel); }
  .brand { font-weight:700; font-size:18px; letter-spacing:.3px; }
  .brand small { color:var(--muted); font-weight:400; margin-left:8px; }
  .badge { margin-left:auto; padding:6px 12px; border-radius:999px; font-weight:600; font-size:13px; }
  .badge.ok { background:rgba(63,185,80,.15); color:var(--allow); border:1px solid rgba(63,185,80,.4); }
  .badge.bad { background:rgba(248,81,73,.15); color:var(--block); border:1px solid rgba(248,81,73,.4); }
  main { padding:24px; max-width:1100px; margin:0 auto; }
  .cards { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:24px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .card .n { font-size:30px; font-weight:700; }
  .card .l { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.6px; }
  .card .r { font-size:12px; color:var(--muted); margin-top:4px; }
  .card.allow .n{color:var(--allow);} .card.block .n{color:var(--block);} .card.escalate .n{color:var(--escalate);}
  section { background:var(--panel); border:1px solid var(--line); border-radius:12px; margin-bottom:24px; overflow:hidden; }
  section h2 { margin:0; padding:14px 18px; font-size:14px; border-bottom:1px solid var(--line); background:var(--panel2); }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:10px 18px; border-bottom:1px solid var(--line); font-size:13px; vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
  tr:last-child td { border-bottom:none; }
  .v { font-weight:700; font-size:12px; padding:2px 8px; border-radius:6px; }
  .v.ALLOW{color:var(--allow);background:rgba(63,185,80,.12);}
  .v.BLOCK{color:var(--block);background:rgba(248,81,73,.12);}
  .v.ESCALATE{color:var(--escalate);background:rgba(210,153,34,.12);}
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--muted); font-size:12px; }
  .empty { padding:18px; color:var(--muted); }
  button { font:inherit; border:1px solid var(--line); background:var(--panel2); color:var(--fg);
    padding:6px 12px; border-radius:7px; cursor:pointer; }
  button.approve { border-color:rgba(63,185,80,.5); color:var(--allow); }
  button.deny { border-color:rgba(248,81,73,.5); color:var(--block); }
  button:hover { filter:brightness(1.2); }
  .controls { padding:12px 18px; display:flex; gap:10px; align-items:center; border-bottom:1px solid var(--line); }
  input { font:inherit; background:var(--bg); border:1px solid var(--line); color:var(--fg); padding:6px 10px; border-radius:7px; }
  .reason { color:var(--muted); }
  footer { text-align:center; color:var(--muted); font-size:12px; padding:8px 0 28px; }
</style>
</head>
<body>
<header>
  <div class="brand">Sentinel <small>independent action-gate console</small></div>
  <div id="chain" class="badge">checking chain…</div>
</header>
<main>
  <div class="cards">
    <div class="card"><div class="l">Decisions</div><div class="n" id="c-total">–</div><div class="r" id="c-window">all time</div></div>
    <div class="card allow"><div class="l">Allowed</div><div class="n" id="c-allow">–</div><div class="r" id="r-allow"></div></div>
    <div class="card block"><div class="l">Blocked</div><div class="n" id="c-block">–</div><div class="r" id="r-block"></div></div>
    <div class="card escalate"><div class="l">Escalated</div><div class="n" id="c-esc">–</div><div class="r" id="r-esc"></div></div>
  </div>

  <section>
    <h2>Pending escalations</h2>
    <div class="controls">
      <span class="reason">Approver</span>
      <input id="approver" value="reviewer@montanalabs.ai" />
      <span class="reason">— actions resolve here and append a signed human-decision record.</span>
    </div>
    <div id="escalations"><div class="empty">Loading…</div></div>
  </section>

  <section>
    <h2>Decision feed</h2>
    <table>
      <thead><tr><th>Time</th><th>Verdict</th><th>Action</th><th>Run</th><th>Reason</th><th>Record</th></tr></thead>
      <tbody id="feed"><tr><td class="empty" colspan="6">Loading…</td></tr></tbody>
    </table>
  </section>
  <footer>Auto-refreshing every 4s · provenance verified via <span class="mono">/v1/verify</span> · evidence via <span class="mono">/v1/export</span></footer>
</main>

<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct = (x) => (x * 100).toFixed(0) + '%';

async function refresh() {
  try {
    const [a, v, pending, records] = await Promise.all([
      fetch('/v1/analytics').then((r) => r.json()),
      fetch('/v1/verify').then((r) => r.json()),
      fetch('/v1/escalations?status=pending').then((r) => r.json()),
      fetch('/v1/records').then((r) => r.json()),
    ]);

    const chain = $('chain');
    chain.className = 'badge ' + (v.ok ? 'ok' : 'bad');
    chain.textContent = v.ok ? '● chain intact & verified' : '● chain broken @ ' + v.brokenAt;

    $('c-total').textContent = a.total;
    $('c-allow').textContent = a.byVerdict.ALLOW; $('r-allow').textContent = pct(a.allowRate);
    $('c-block').textContent = a.byVerdict.BLOCK; $('r-block').textContent = pct(a.blockRate);
    $('c-esc').textContent = a.byVerdict.ESCALATE; $('r-esc').textContent = pct(a.escalateRate);

    $('escalations').innerHTML = pending.length === 0
      ? '<div class="empty">No pending escalations.</div>'
      : '<table><thead><tr><th>Escalation</th><th>Approvers</th><th>Reason</th><th></th></tr></thead><tbody>' +
        pending.map((e) => '<tr><td class="mono">' + esc(e.id) + '</td><td>' + esc((e.approvers||[]).join(', ')) +
          '</td><td class="reason">' + esc(e.reason) + '</td><td>' +
          '<button class="approve" onclick="resolve(\\'' + e.id + '\\',\\'approve\\')">Approve</button> ' +
          '<button class="deny" onclick="resolve(\\'' + e.id + '\\',\\'deny\\')">Deny</button></td></tr>').join('') +
        '</tbody></table>';

    const rows = records.slice().reverse().slice(0, 50);
    $('feed').innerHTML = rows.length === 0
      ? '<tr><td class="empty" colspan="6">No decisions yet.</td></tr>'
      : rows.map((r) => '<tr><td class="mono">' + esc(r.ts.replace('T',' ').replace('Z','')) +
          '</td><td><span class="v ' + r.verdict + '">' + r.verdict + '</span></td><td>' + esc(r.action.type) +
          '</td><td class="mono">' + esc(r.context.runId) + '</td><td class="reason">' + esc(r.reason || '') +
          '</td><td class="mono" title="' + esc(r.contentHash) + '">' + esc(r.contentHash.slice(0,12)) + '…</td></tr>').join('');
  } catch (e) {
    $('chain').className = 'badge bad';
    $('chain').textContent = '● sidecar unreachable';
  }
}

async function resolve(id, decision) {
  await fetch('/v1/escalations/' + id + '/resolve', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision, approver: $('approver').value || 'unknown' }),
  });
  refresh();
}
window.resolve = resolve;
refresh();
setInterval(refresh, 4000);
</script>
</body>
</html>`;
