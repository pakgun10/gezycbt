# ADR-010 — Deployment production tanpa container

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Issue:** ISS-005

## Context

Target awal satu VPS sekitar 2 GiB RAM. Container orchestration tidak diperlukan; overhead dan jumlah moving parts harus minimal. Release perlu dapat di-rollback dan service tetap diawasi.

## Decision

Deploy binary/runtime Bun dan static asset sebagai immutable release directory di host. Nginx menangani TLS, static asset, compression, dan reverse proxy. `systemd` menjalankan API dengan user non-root, resource limits, restart policy, dan graceful shutdown. MariaDB berjalan sebagai service host terpisah dari process API.

Release memakai symlink `current` ke directory versioned, migration gate sebelum switch, health/readiness check sesudah switch, dan rollback ke release sebelumnya bila smoke test gagal. Secret berada di environment file/secret store host dengan permission terbatas, bukan repository.

## Consequences

Operasional sederhana dan hemat RAM. Isolasi process lebih lemah dibanding container; hardening user, filesystem, firewall, dan systemd wajib. Upgrade OS/runtime dilakukan staged di staging.

## Re-evaluation

Tinjau bila ada multi-host deployment, kebutuhan immutable infrastructure, atau isolation requirement yang tidak dapat dipenuhi systemd.
