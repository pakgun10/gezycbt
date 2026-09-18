# Nginx/TLS installation

1. Install `gezycbt.conf` as a site, replace the example hostname and certificate paths.
2. Install `security-headers.conf` as `/etc/nginx/snippets/gezycbt-security-headers.conf`.
3. Create `/var/lib/gezycbt/media` and `/var/lib/gezycbt/exports`, owned by the service account and not by the web user.
4. Run `nginx -t`, reload Nginx, and verify HTTPS, CSP, frame denial, `nosniff`, referrer and permissions headers.
5. Keep `/metrics` reachable only from localhost or the monitoring network; do not publish it through a public location.

`theme-bootstrap.js` is loaded using a same-origin `<script src>` with a content-hashed build filename in release artifacts. With `script-src 'self'`, CSP needs neither `unsafe-inline` nor a nonce for that script.
