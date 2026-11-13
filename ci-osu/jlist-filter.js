// REHEARSAL ONLY: read `pm2 jlist` on stdin, print one stable line per
// NON-NARO app: name, pid, restart count, start time, status. Used to prove a
// NARO deploy/rollback/migration never restarts, stops or starts a neighbour.
let s = '';
process.stdin.on('data', (d) => (s += d));
process.stdin.on('end', () => {
  const i = s.indexOf('[');
  const list = i >= 0 ? JSON.parse(s.slice(i)) : [];
  const rows = [];
  for (const p of list) {
    if (/^naro-(api|storefront|admin)$/.test(p.name)) continue;
    const e = p.pm2_env || {};
    rows.push([p.name, 'pid=' + p.pid, 'restarts=' + e.restart_time, 'unstable=' + e.unstable_restarts,
      'since=' + e.pm_uptime, 'status=' + e.status, 'mode=' + e.exec_mode].join(' '));
  }
  console.log(rows.sort().join('\n'));
});
