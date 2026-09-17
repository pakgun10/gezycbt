# ADR-004 — Opaque database-backed authentication session

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Issue:** ISS-005

## Context

Admin, guru, dan peserta utama membutuhkan login username/password. Session harus dapat direvoke, terlihat di audit, dan tidak menaruh role atau data ujian dalam token yang tidak dapat dicabut. Single VPS tidak memerlukan JWT untuk komunikasi antar service.

## Decision

Gunakan cookie `HttpOnly`, `Secure` pada HTTPS, `SameSite=Lax` (atau `Strict` bila flow memungkinkan) yang berisi random opaque token minimum 256-bit. Server hanya menyimpan digest token pada `auth_sessions`, bersama actor/user, expiry, last-used, revoked-at, dan metadata keamanan.

Login merotasi token; logout dan revoke mengubah row server-side. CSRF token terpisah digunakan untuk mutation browser. Password memakai Argon2id dengan parameter yang dikalibrasi pada VPS; plaintext password tidak pernah disimpan atau dilog.

Practice guest memakai cookie/session terpisah dan tidak dapat ditukar dengan username/password peserta utama. Session expiry tidak mengakhiri exam session; resume memerlukan re-login dan ownership check.

## Consequences

Revocation dan concurrent-login policy dapat ditegakkan server-side. Setiap request auth memerlukan lookup session, sehingga index dan pool harus dijaga. JWT tidak digunakan sebagai shortcut.

## Security constraints

Cookie domain/path dibatasi, login failure di-rate-limit, reset password diaudit, dan response tidak membocorkan apakah username terdaftar.

## Re-evaluation

Tinjau bila ada kebutuhan multi-service lintas trust boundary; jika muncul, token exchange dan key rotation memerlukan ADR baru.
