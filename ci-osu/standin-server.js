// REHEARSAL ONLY: a stand-in for a Next standalone server / a neighbour app.
// Serves a page that references one /_next/static asset (so the deploy's
// asset probe has something real to fetch) and 200 for that asset.
const http = require('http');
const label = process.env.STANDIN_LABEL || process.argv[2] || 'standin';
http
  .createServer((req, res) => {
    if (req.url.startsWith('/_next/static/')) {
      res.writeHead(200, { 'content-type': 'text/css' });
      return res.end('body{}');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><link rel="stylesheet" href="/_next/static/css/app.css"></head><body>' + label + ' ok</body></html>');
  })
  .listen(Number(process.env.PORT), process.env.HOST || '0.0.0.0');
