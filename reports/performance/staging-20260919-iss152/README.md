# ISS-152 staging evidence — 2026-09-19

Host: `43.156.50.50` (VM-0-13-ubuntu, 2 vCPU, 1.9 GiB RAM, 2 GiB swap)
Release under test: staging release `3be8205` (the API process was already running on this release).
Schedule: `14` (MAIN, one attempt, 1,000 class-targeted participants)

## Run

- Profile: `load_1000`
- Arrival spread: 600 seconds
- Fixture: 1,000 staging-only participant accounts
- Duration: 10m04.7s
- The first fixture was generated without the staging password and was discarded before this run. The accepted run used the correct staging password and a fresh schedule.

## k6 gate

- HTTP error rate: 0.033% (2 failed requests / 5,995 requests), below 0.5%.
- Runtime error rate: 0.033%, below 0.5%.
- Autosave p95/p99: 105 ms / below 2 s.
- Start p95: 107 ms.
- Resume p95: 119 ms.
- Submit p95: 1,055 ms.
- One participant had a transient request failure and was retried once after the run; the final verifier includes that participant. This is within the runtime-error budget and is recorded here explicitly.

## Data gate

`data-verification.json` passes: 1,000 sessions, 1,000 distinct participants, 1,000 results, 1,000 answers; no duplicate main attempts, results, or answers; zero active sessions at verification.

## Host observations

- API remained ready and did not restart (`NRestarts=0`).
- API memory remained below the 512 MiB service limit; host available memory after run was about 1.2 GiB.
- MariaDB `Max_used_connections` was 16 against the configured 120 maximum; the Bun pool is configured for 8 connections.
- Disk usage was 20% and no disk guard rejection occurred.
- `query-plans.json` records the post-run EXPLAIN capture.

The all-at-once spike is tracked separately; it intentionally exercises login backpressure and is not the staged capacity profile.
