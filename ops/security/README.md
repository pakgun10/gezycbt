# Security gate

Run `ops/security/security-gate.sh` in CI or before a release. It checks the Nginx policy (TLS headers, CSP, frame denial and internal protected locations), prevents tracked credentials, runs the complete repository quality gate, and validates Nginx syntax when Nginx is installed. A release with an unresolved high-severity finding, exposed secret, CSP regression, IDOR/leakage test failure, or failed upload validation is blocked.

Rotate database/session/CSRF/agent/backup secrets independently. Keep old credentials only for the documented rotation window, then revoke them and verify the audit event.
