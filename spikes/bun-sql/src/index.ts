import { SQL } from "bun";

type Adapter = "mariadb" | "mysql";
type SqlClient = ReturnType<typeof SQL>;

type Config = {
  adapter: Adapter;
  hostname: string;
  port: number;
  database: string;
  username: string;
  password: string;
  socket?: string;
  max: number;
  connectionTimeout: number;
};

type Outcome = {
  id: string;
  status: "PASS" | "FAIL" | "SKIP";
  durationMs: number;
  detail?: string;
  error?: string;
};

const databaseUrl = Bun.env.SPIKE_DATABASE_URL ?? "mariadb://root:root@127.0.0.1:3306/gezy_spike";

function parseConfig(): Config {
  const parsed = new URL(databaseUrl);
  const adapter = (Bun.env.SPIKE_ADAPTER ?? (parsed.protocol === "mariadb:" ? "mariadb" : "mysql")) as Adapter;

  if (adapter !== "mariadb" && adapter !== "mysql") {
    throw new Error(`SPIKE_ADAPTER must be mariadb or mysql, got ${adapter}`);
  }

  const port = Number(parsed.port || "3306");
  const max = Number(Bun.env.SPIKE_POOL_MAX ?? "4");
  const connectionTimeout = Number(Bun.env.SPIKE_CONNECTION_TIMEOUT_SECONDS ?? "5");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid database port: ${parsed.port}`);
  }
  if (!Number.isInteger(max) || max < 2) {
    throw new Error(`SPIKE_POOL_MAX must be an integer >= 2, got ${max}`);
  }

  return {
    adapter,
    hostname: parsed.hostname,
    port,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    socket: Bun.env.SPIKE_SOCKET_PATH,
    max,
    connectionTimeout,
  };
}

function createClient(config: Config, overrides: Partial<Config> = {}): SqlClient {
  const effective = { ...config, ...overrides };
  const options: Record<string, unknown> = {
    adapter: effective.adapter,
    hostname: effective.hostname,
    port: effective.port,
    database: effective.database,
    username: effective.username,
    password: effective.password,
    max: effective.max,
    idleTimeout: 30,
    maxLifetime: 300,
    connectionTimeout: effective.connectionTimeout,
    bigint: true,
  };

  if (effective.socket) {
    options.socket = effective.socket;
  }

  return new SQL(options as never) as SqlClient;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const candidate = error as { code?: unknown; errno?: unknown; message?: unknown };
  return [candidate.code, candidate.errno].filter(Boolean).join("/") || String(candidate.message ?? "UNKNOWN");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${errorCode(error)}: ${error.message}`;
  return String(error);
}

function tableIdentifier(): string {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9_]/gi, "");
  return `bun_sql_spike_${suffix}`;
}

function placeholders(rowCount: number, columnCount: number): string {
  return Array.from({ length: rowCount }, () => `(${Array.from({ length: columnCount }, () => "?").join(", ")})`).join(", ");
}

function flatten(rows: unknown[][]): unknown[] {
  return rows.flat();
}

async function runTest(id: string, fn: () => Promise<string | void>): Promise<Outcome> {
  const started = performance.now();
  try {
    const detail = await fn();
    return { id, status: "PASS", durationMs: Math.round(performance.now() - started), detail };
  } catch (error) {
    return { id, status: "FAIL", durationMs: Math.round(performance.now() - started), error: errorMessage(error) };
  }
}

function skipTest(id: string, detail: string): Outcome {
  return { id, status: "SKIP", durationMs: 0, detail };
}

async function main(): Promise<void> {
  const config = parseConfig();
  const db = createClient(config);
  const table = tableIdentifier();
  const childTable = `${table}_child`;
  const results: Outcome[] = [];
  const clients: SqlClient[] = [db];

  const safeConfig = `${config.adapter}://${config.hostname}:${config.port}/${config.database} pool=${config.max}`;
  console.log(`Bun.SQL MariaDB spike — Bun ${Bun.version}`);
  console.log(`Target: ${safeConfig}`);
  console.log(`Table: ${table}`);

  try {
    await db.unsafe(`
      CREATE TABLE \`${table}\` (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        big_value BIGINT UNSIGNED NOT NULL,
        decimal_value DECIMAL(30, 10) NOT NULL,
        json_value JSON NOT NULL,
        bool_value BOOLEAN NOT NULL,
        unicode_value VARCHAR(255) CHARACTER SET utf8mb4 NOT NULL,
        happened_at DATETIME(6) NOT NULL,
        version_no INT NOT NULL DEFAULT 0,
        unique_value VARCHAR(80) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_${table}_unique (unique_value),
        CONSTRAINT ck_${table}_version CHECK (version_no >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.unsafe(`
      CREATE TABLE \`${childTable}\` (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        parent_id BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT fk_${table}_child_parent FOREIGN KEY (parent_id) REFERENCES \`${table}\` (id)
      ) ENGINE=InnoDB
    `);

    results.push(
      await runTest("connection-server-metadata", async () => {
        const [row] = await db`SELECT VERSION() AS server_version, CONNECTION_ID() AS connection_id, @@character_set_connection AS charset_name, @@time_zone AS session_timezone`;
        assert(row, "metadata query returned no row");
        assert(String(row.charset_name).toLowerCase() === "utf8mb4", `expected utf8mb4, got ${row.charset_name}`);
        return `server=${row.server_version} connection=${row.connection_id} timezone=${row.session_timezone}`;
      }),
    );

    results.push(
      await runTest("parameter-binding-and-injection-marker", async () => {
        const marker = "name'); DROP TABLE should_not_run; -- 💾";
        const insert = await db.unsafe(
          `INSERT INTO \`${table}\` (big_value, decimal_value, json_value, bool_value, unicode_value, happened_at, unique_value) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [1n, "1.2500000000", JSON.stringify({ marker: true }), true, marker, "2026-01-02 03:04:05.123456", "binding-marker"],
        );
        assert(insert.affectedRows === 1, `expected one inserted row, got ${insert.affectedRows}`);
        const [row] = await db.unsafe(`SELECT unicode_value FROM \`${table}\` WHERE unique_value = ?`, ["binding-marker"]);
        assert(row?.unicode_value === marker, "bound Unicode/injection marker changed unexpectedly");
        await db.unsafe(`SELECT 1 FROM \`${table}\` LIMIT 1`);
      }),
    );

    results.push(
      await runTest("type-round-trip", async () => {
        const expectedBig = 9007199254740993n;
        const expectedDecimal = "123456789012345.6789000000";
        const expectedDatetime = "2026-01-02 03:04:05.123456";
        await db.unsafe(
          `INSERT INTO \`${table}\` (big_value, decimal_value, json_value, bool_value, unicode_value, happened_at, unique_value) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [expectedBig, expectedDecimal, JSON.stringify({ nested: { answer: 42 }, values: ["a", "b"] }), true, "类型 ✅", expectedDatetime, "type-round-trip"],
        );
        const [row] = await db.unsafe(
          `SELECT big_value, CAST(big_value AS CHAR) AS big_text, decimal_value, json_value, bool_value, unicode_value, DATE_FORMAT(happened_at, '%Y-%m-%d %H:%i:%s.%f') AS datetime_text FROM \`${table}\` WHERE unique_value = ?`,
          ["type-round-trip"],
        );
        assert(row, "type query returned no row");
        assert(String(row.big_value) === expectedBig.toString(), `BIGINT precision changed: ${String(row.big_value)}`);
        assert(row.big_text === expectedBig.toString(), `BIGINT server text changed: ${row.big_text}`);
        assert(row.decimal_value === expectedDecimal, `DECIMAL changed: ${row.decimal_value}`);
        const json = typeof row.json_value === "string" ? JSON.parse(row.json_value) : row.json_value;
        assert(json?.nested?.answer === 42, "JSON object was not decoded");
        assert(row.bool_value === true || row.bool_value === 1, `BOOLEAN changed: ${row.bool_value}`);
        assert(row.unicode_value === "类型 ✅", "Unicode value changed");
        assert(row.datetime_text === expectedDatetime, `DATETIME(6) changed: ${row.datetime_text}`);
        return `bigint=${typeof row.big_value} decimal=${typeof row.decimal_value} json=${typeof row.json_value}`;
      }),
    );

    results.push(
      await runTest("transaction-commit-rollback-pinning", async () => {
        let committedId = 0;
        await db.begin(async (tx) => {
          const insert = await tx.unsafe(
            `INSERT INTO \`${table}\` (big_value, decimal_value, json_value, bool_value, unicode_value, happened_at, unique_value) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [2n, "2.0", JSON.stringify({ tx: "commit" }), true, "commit", "2026-01-02 03:04:05.000000", "tx-commit"],
          );
          committedId = Number(insert.lastInsertRowid);
          const [first] = await tx`SELECT CONNECTION_ID() AS connection_id`;
          const [second] = await tx`SELECT CONNECTION_ID() AS connection_id`;
          assert(first?.connection_id === second?.connection_id, "transaction was not pinned to one connection");
        });
        const [committed] = await db.unsafe(`SELECT id FROM \`${table}\` WHERE unique_value = ?`, ["tx-commit"]);
        assert(Number(committed?.id) === committedId, "committed row was not visible");

        try {
          await db.begin(async (tx) => {
            await tx.unsafe(
              `INSERT INTO \`${table}\` (big_value, decimal_value, json_value, bool_value, unicode_value, happened_at, unique_value) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [3n, "3.0", JSON.stringify({ tx: "rollback" }), true, "rollback", "2026-01-02 03:04:05.000000", "tx-rollback"],
            );
            throw new Error("rollback-sentinel");
          });
        } catch (error) {
          assert(error instanceof Error && error.message === "rollback-sentinel", "unexpected rollback error");
        }
        const [rolledBack] = await db.unsafe(`SELECT COUNT(*) AS count FROM \`${table}\` WHERE unique_value = ?`, ["tx-rollback"]);
        assert(Number(rolledBack?.count) === 0, "rollback row remained visible");
      }),
    );

    results.push(
      await runTest("batch-insert-100-and-conditional-update", async () => {
        const rows = Array.from({ length: 100 }, (_, index) => [
          BigInt(index + 100),
          "1.0000000000",
          JSON.stringify({ index }),
          index % 2 === 0 ? 1 : 0,
          `batch-${index}`,
          "2026-01-02 03:04:05.000000",
          `batch-${index}`,
        ]);
        const result = await db.unsafe(
          `INSERT INTO \`${table}\` (big_value, decimal_value, json_value, bool_value, unicode_value, happened_at, unique_value) VALUES ${placeholders(rows.length, 7)}`,
          flatten(rows),
        );
        assert(result.affectedRows === 100, `expected 100 inserted rows, got ${result.affectedRows}`);
        const update = await db.unsafe(`UPDATE \`${table}\` SET version_no = version_no + 1 WHERE unique_value = ? AND version_no = ?`, ["batch-1", 0]);
        assert(update.affectedRows === 1, `expected conditional update to affect one row, got ${update.affectedRows}`);
        const unchanged = await db.unsafe(`UPDATE \`${table}\` SET version_no = version_no + 1 WHERE unique_value = ? AND version_no = ?`, ["batch-1", 0]);
        assert(unchanged.affectedRows === 0, `expected stale conditional update to affect zero rows, got ${unchanged.affectedRows}`);
      }),
    );

    results.push(
      await runTest("constraint-and-error-mapping", async () => {
        let uniqueCode = "";
        try {
          await db.unsafe(
            `INSERT INTO \`${table}\` (big_value, decimal_value, json_value, bool_value, unicode_value, happened_at, unique_value) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [4n, "4.0", JSON.stringify({}), true, "duplicate", "2026-01-02 03:04:05.000000", "binding-marker"],
          );
        } catch (error) {
          uniqueCode = errorCode(error);
        }
        assert(uniqueCode.includes("DUP") || uniqueCode.includes("1062"), `unexpected unique error: ${uniqueCode}`);

        let checkCode = "";
        try {
          await db.unsafe(
            `INSERT INTO \`${table}\` (big_value, decimal_value, json_value, bool_value, unicode_value, happened_at, version_no, unique_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [5n, "5.0", JSON.stringify({}), true, "check", "2026-01-02 03:04:05.000000", -1, "check-failure"],
          );
        } catch (error) {
          checkCode = errorCode(error);
        }
        assert(checkCode.length > 0, "CHECK violation did not produce an error");

        let foreignKeyCode = "";
        try {
          await db.unsafe(`INSERT INTO \`${childTable}\` (parent_id) VALUES (?)`, [999999999n]);
        } catch (error) {
          foreignKeyCode = errorCode(error);
        }
        assert(foreignKeyCode.includes("FOREIGN") || foreignKeyCode.includes("1452"), `unexpected FK error: ${foreignKeyCode}`);
        return `unique=${uniqueCode} check=${checkCode} foreign_key=${foreignKeyCode}`;
      }),
    );

    results.push(
      await runTest("select-for-update-two-connections", async () => {
        const first = await db.reserve();
        const second = await db.reserve();
        try {
          await first.unsafe("START TRANSACTION");
          await second.unsafe("START TRANSACTION");
          const [row] = await db.unsafe(`SELECT id FROM \`${table}\` WHERE unique_value = ? LIMIT 1`, ["binding-marker"]);
          const rowId = row?.id;
          assert(rowId !== undefined, "lock fixture row was not found");
          await first.unsafe(`SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`, [rowId]);
          let waiting = true;
          const blocked = second.unsafe(`SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`, [rowId]).finally(() => {
            waiting = false;
          });
          await Bun.sleep(150);
          assert(waiting, "second SELECT FOR UPDATE did not wait");
          await first.unsafe("ROLLBACK");
          await blocked;
          await second.unsafe("ROLLBACK");
        } finally {
          try { await first.unsafe("ROLLBACK"); } catch { /* already rolled back */ }
          try { await second.unsafe("ROLLBACK"); } catch { /* already rolled back */ }
          first.release();
          second.release();
        }
      }),
    );

    results.push(
      await runTest("deadlock-error-code", async () => {
        const first = await db.reserve();
        const second = await db.reserve();
        try {
          const [rowA] = await db.unsafe(`SELECT id FROM \`${table}\` WHERE unique_value = ?`, ["batch-2"]);
          const [rowB] = await db.unsafe(`SELECT id FROM \`${table}\` WHERE unique_value = ?`, ["batch-3"]);
          assert(rowA?.id !== undefined && rowB?.id !== undefined, "deadlock fixture rows were not found");
          await first.unsafe("START TRANSACTION");
          await second.unsafe("START TRANSACTION");
          await first.unsafe(`SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`, [rowA.id]);
          await second.unsafe(`SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`, [rowB.id]);
          const [a, b] = await Promise.allSettled([
            first.unsafe(`SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`, [rowB.id]),
            second.unsafe(`SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`, [rowA.id]),
          ]);
          const errors = [a, b].filter((item): item is PromiseRejectedResult => item.status === "rejected");
          assert(errors.length >= 1, "expected one transaction to lose the deadlock");
          const codes = errors.map((item) => errorCode(item.reason)).join(",");
          assert(codes.includes("DEADLOCK") || codes.includes("1213"), `unexpected deadlock code: ${codes}`);
          return codes;
        } finally {
          try { await first.unsafe("ROLLBACK"); } catch { /* deadlock may auto-rollback */ }
          try { await second.unsafe("ROLLBACK"); } catch { /* deadlock may auto-rollback */ }
          first.release();
          second.release();
        }
      }),
    );

    results.push(
      await runTest("lock-wait-timeout-error-code", async () => {
        const first = await db.reserve();
        const second = await db.reserve();
        try {
          const [row] = await db.unsafe(`SELECT id FROM \`${table}\` WHERE unique_value = ?`, ["batch-4"]);
          assert(row?.id !== undefined, "lock-timeout fixture row was not found");
          await first.unsafe("START TRANSACTION");
          await second.unsafe("START TRANSACTION");
          await second.unsafe("SET SESSION innodb_lock_wait_timeout = 1");
          await first.unsafe(`SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`, [row.id]);
          let timeoutCode = "";
          try {
            await second.unsafe(`SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`, [row.id]);
          } catch (error) {
            timeoutCode = errorCode(error);
          }
          assert(timeoutCode.includes("LOCK_WAIT") || timeoutCode.includes("1205"), `unexpected lock wait code: ${timeoutCode}`);
          return timeoutCode;
        } finally {
          try { await first.unsafe("ROLLBACK"); } catch { /* cleanup */ }
          try { await second.unsafe("ROLLBACK"); } catch { /* cleanup */ }
          first.release();
          second.release();
        }
      }),
    );

    results.push(
      await runTest("pool-reserve-cancellation", async () => {
        const limited = createClient(config, { max: 1 });
        clients.push(limited);
        const reserved = await limited.reserve();
        try {
          let cancelled = false;
          try {
            await limited.reserve({ signal: AbortSignal.timeout(100) });
          } catch (error) {
            cancelled = error instanceof DOMException || String(error).includes("Timeout");
          }
          assert(cancelled, "reserve did not honor AbortSignal timeout");
        } finally {
          reserved.release();
          await limited.close({ timeout: 1 });
        }
      }),
    );

    results.push(
      await runTest("query-cancellation-and-connection-timeout", async () => {
        const worker = await db.reserve();
        const killer = await db.reserve();
        try {
          const [connection] = await worker`SELECT CONNECTION_ID() AS connection_id`;
          const connectionId = Number(connection?.connection_id);
          assert(Number.isInteger(connectionId) && connectionId > 0, "could not obtain worker connection id");
          const started = performance.now();
          const query = worker`SELECT SLEEP(8) AS delayed`;
          await Bun.sleep(100);
          await killer.unsafe(`KILL QUERY ${connectionId}`);
          let queryError = "none";
          try {
            await query;
          } catch (error) {
            queryError = errorCode(error);
          }
          const elapsedMs = performance.now() - started;
          assert(elapsedMs < 7000, `query cancellation did not complete early: ${Math.round(elapsedMs)} ms`);

          const unreachable = createClient(config, { port: 65530, connectionTimeout: 1 });
          clients.push(unreachable);
          const timeoutStarted = performance.now();
          let connectionError = "none";
          try {
            await unreachable`SELECT 1`;
          } catch (error) {
            connectionError = errorCode(error);
          }
          const timeoutElapsedMs = performance.now() - timeoutStarted;
          assert(connectionError !== "none", "unreachable connection unexpectedly succeeded");
          assert(timeoutElapsedMs < 3000, `connection timeout probe took too long: ${Math.round(timeoutElapsedMs)} ms`);
          return `query=${queryError} queryMs=${Math.round(elapsedMs)} connection=${connectionError} connectionMs=${Math.round(timeoutElapsedMs)}`;
        } finally {
          worker.release();
          killer.release();
        }
      }),
    );

    results.push(
      await runTest("concurrency-memory-probe", async () => {
        const before = process.memoryUsage().rss;
        const started = performance.now();
        await Promise.all(
          Array.from({ length: 100 }, (_, index) => db.unsafe(`SELECT COUNT(*) AS count, ? AS probe FROM \`${table}\``, [index])),
        );
        const after = process.memoryUsage().rss;
        return `queries=100 elapsedMs=${Math.round(performance.now() - started)} rssDeltaBytes=${after - before}`;
      }),
    );

    if (config.socket) {
      results.push(
        await runTest("unix-socket-connection", async () => {
          const socketClient = createClient(config, { hostname: "localhost", socket: config.socket });
          clients.push(socketClient);
          const [row] = await socketClient`SELECT 1 AS ok`;
          assert(row?.ok === 1, "Unix socket SELECT 1 did not return 1");
          await socketClient.close({ timeout: 1 });
        }),
      );
    } else {
      results.push(skipTest("unix-socket-connection", "SPIKE_SOCKET_PATH tidak diberikan"));
    }

    results.push(skipTest("streaming-or-cursor-api", "Bun.SQL MySQL/MariaDB handle tidak menyediakan streaming/cursor API pada release yang diuji; export wajib memakai pagination atau adapter terpisah"));

    const restartWaitSeconds = Number(Bun.env.SPIKE_RESTART_WAIT_SECONDS ?? "0");
    if (Number.isInteger(restartWaitSeconds) && restartWaitSeconds > 0) {
      results.push(
        await runTest("server-restart-and-broken-connection-recovery", async () => {
          await db`SELECT 1 AS before_restart`;
          console.log(`Restart probe ready — restart MariaDB sekarang; menunggu ${restartWaitSeconds} detik`);
          await Bun.sleep(restartWaitSeconds * 1000);

          const sameClientErrors: string[] = [];
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
              const [row] = await db`SELECT 1 AS after_restart`;
              assert(row?.after_restart === 1, "same-client recovery returned an unexpected value");
              return `same-client recovery attempt=${attempt}`;
            } catch (error) {
              sameClientErrors.push(errorCode(error));
              await Bun.sleep(250 * attempt);
            }
          }

          const recovered = createClient(config);
          clients.push(recovered);
          const [row] = await recovered`SELECT 1 AS fresh_client_recovery`;
          assert(row?.fresh_client_recovery === 1, "fresh client could not reconnect after restart");
          return `fresh-client recovery after ${sameClientErrors.join(",")}`;
        }),
      );
    } else {
      results.push(skipTest("server-restart-and-broken-connection-recovery", "Manual gate: set SPIKE_RESTART_WAIT_SECONDS, restart MariaDB during the wait, and retain the log"));
    }
  } finally {
    try { await db.unsafe(`DROP TABLE IF EXISTS \`${childTable}\``); } catch { /* best-effort cleanup */ }
    try { await db.unsafe(`DROP TABLE IF EXISTS \`${table}\``); } catch { /* best-effort cleanup */ }
    for (const client of clients) {
      try { await client.close({ timeout: 1 }); } catch { /* already closed */ }
    }
  }

  for (const result of results) {
    const suffix = result.detail ? ` — ${result.detail}` : result.error ? ` — ${result.error}` : "";
    console.log(`${result.status.padEnd(4)} ${result.id} (${result.durationMs} ms)${suffix}`);
  }

  const failed = results.filter((result) => result.status === "FAIL");
  const skipped = results.filter((result) => result.status === "SKIP");
  console.log(`Summary: pass=${results.length - failed.length - skipped.length} fail=${failed.length} skip=${skipped.length}`);

  if (failed.length > 0) process.exitCode = 1;
}

await main();
