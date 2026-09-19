import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const baseUrl = (__ENV.K6_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/u, "");
const fixturePath = __ENV.K6_FIXTURE_FILE || "./participants.json";
const fixture = JSON.parse(open(fixturePath));
const participants = Array.isArray(fixture) ? fixture : fixture.participants;
if (!Array.isArray(participants) || participants.length === 0) {
  throw new Error("K6_FIXTURE_FILE must contain a non-empty participants array");
}

const profile = __ENV.K6_PROFILE || "smoke";
const soakDuration = __ENV.K6_SOAK_DURATION || "4h";
const profiles = {
  smoke: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "15s", target: Math.min(10, participants.length) },
      { duration: "30s", target: Math.min(10, participants.length) },
      { duration: "15s", target: 0 },
    ],
  },
  load_1000: {
    // Each fixture participant must run exactly once because MAIN schedules
    // have one attempt. Arrival is spread in examFlow rather than using a
    // looping VU profile, which would repeatedly hit ATTEMPT_LIMIT_REACHED.
    executor: "per-vu-iterations",
    vus: Math.min(1000, participants.length),
    iterations: 1,
    maxDuration: "15m",
  },
  load_1000_once: {
    executor: "per-vu-iterations",
    vus: Math.min(1000, participants.length),
    iterations: 1,
    maxDuration: "10m",
  },
  soak: {
    executor: "per-vu-iterations",
    vus: Math.min(1000, participants.length),
    iterations: 1,
    maxDuration: __ENV.K6_SOAK_MAX_DURATION || "4h30m",
  },
};
if (!profiles[profile]) throw new Error(`Unknown K6_PROFILE: ${profile}`);
if (profile !== "smoke" && participants.length < 1000) {
  throw new Error("load_1000 and soak profiles require at least 1000 fixture participants");
}

const runtimeErrors = new Rate("exam_runtime_errors");
const answerConflicts = new Counter("exam_answer_conflicts");
const duplicateSubmits = new Counter("exam_duplicate_submits");
const loginDuration = new Trend("exam_login_duration", true);
const startDuration = new Trend("exam_start_duration", true);
const resumeDuration = new Trend("exam_resume_duration", true);
const autosaveDuration = new Trend("exam_autosave_duration", true);
const submitDuration = new Trend("exam_submit_duration", true);

export const options = {
  scenarios: {
    exam_runtime: profiles[profile],
    ...(String(__ENV.K6_MONITOR).toLowerCase() === "true"
      ? {
          monitor: {
            executor: "constant-vus",
            vus: 1,
            duration: profile === "soak" ? soakDuration : "30m",
            exec: "monitorFlow",
          },
        }
      : {}),
  },
  thresholds: {
    http_req_failed: ["rate<0.005"],
    exam_runtime_errors: ["rate<0.005"],
    exam_autosave_duration: ["p(95)<750", "p(99)<2000"],
    exam_start_duration: ["p(95)<2000"],
    exam_resume_duration: ["p(95)<2000"],
    exam_submit_duration: ["p(95)<3000"],
  },
  discardResponseBodies: false,
};

export default function examFlow() {
  const participant = participants[(__VU - 1) % participants.length];
  if (profile === "soak") {
    soakFlow(participant);
    return;
  }
  if (profile === "load_1000") {
    const spreadSeconds = Math.max(
      0,
      Number(__ENV.K6_START_SPREAD_SECONDS || 600),
    );
    if (spreadSeconds > 0 && participants.length > 1) {
      sleep(((__VU - 1) / (participants.length - 1)) * spreadSeconds);
    }
  }
  const auth = login(participant);
  if (!auth) return;
  const scheduleId = String(__ENV.K6_SCHEDULE_ID || "");
  const schedule = scheduleId ? { id: scheduleId } : readSchedule();
  if (!schedule?.id) return;
  const start = startSession(participant, schedule.id, auth);
  if (!start) return;
  let finalAnswers = buildAnswers(start.manifest);
  if (finalAnswers.length > 0) {
    const outcomes = saveAnswers(start.session.id, finalAnswers, auth);
    finalAnswers = applySavedVersions(finalAnswers, outcomes);
  }

  if (String(__ENV.K6_RECONNECT).toLowerCase() !== "false") {
    sleep(Number(__ENV.K6_RECONNECT_DELAY_SECONDS || 1));
    const resumed = resumeSession(start.session.id, auth);
    if (resumed) {
      const resumedAnswers = buildAnswers(resumed.manifest, resumed.answers);
      if (resumedAnswers.length > 0) {
        const outcomes = saveAnswers(start.session.id, resumedAnswers, auth);
        finalAnswers = applySavedVersions(resumedAnswers, outcomes);
      }
    }
  }

  if (String(__ENV.K6_TIMEOUT_MODE).toLowerCase() === "true") {
    sleep(Number(__ENV.K6_TIMEOUT_WAIT_SECONDS || 2));
  }
  submitSession(start.session.id, finalAnswers, auth);
}

/** Keep one MAIN attempt active for the soak window. */
function soakFlow(participant) {
  const spreadSeconds = Math.max(
    0,
    Number(__ENV.K6_SOAK_START_SPREAD_SECONDS || 600),
  );
  if (spreadSeconds > 0 && participants.length > 1) {
    sleep(((__VU - 1) / (participants.length - 1)) * spreadSeconds);
  }
  const auth = login(participant);
  if (!auth) return;
  const scheduleId = String(__ENV.K6_SCHEDULE_ID || "");
  const schedule = scheduleId ? { id: scheduleId } : readSchedule();
  if (!schedule?.id) return;
  const start = startSession(participant, schedule.id, auth);
  if (!start) return;
  let finalAnswers = buildAnswers(start.manifest);
  if (finalAnswers.length > 0) {
    const outcomes = saveAnswers(start.session.id, finalAnswers, auth);
    finalAnswers = applySavedVersions(finalAnswers, outcomes);
  }

  const holdSeconds = Math.max(
    1,
    Number(__ENV.K6_SOAK_HOLD_SECONDS || 4 * 60 * 60),
  );
  const intervalSeconds = Math.max(
    1,
    Number(__ENV.K6_SOAK_INTERVAL_SECONDS || 15),
  );
  const saveEverySeconds = Math.max(
    intervalSeconds,
    Number(__ENV.K6_SOAK_SAVE_EVERY_SECONDS || 60),
  );
  const startedAt = Date.now();
  let lastSaveAt = startedAt;
  while (Date.now() - startedAt < holdSeconds * 1000) {
    sleep(intervalSeconds);
    const resumed = resumeSession(start.session.id, auth);
    if (!resumed) continue;
    if (Date.now() - lastSaveAt < saveEverySeconds * 1000) continue;
    const answers = buildAnswers(resumed.manifest, resumed.answers);
    if (answers.length > 0) {
      const outcomes = saveAnswers(start.session.id, answers, auth);
      finalAnswers = applySavedVersions(answers, outcomes);
    }
    lastSaveAt = Date.now();
  }
  submitSession(start.session.id, finalAnswers, auth);
}

export function monitorFlow() {
  const username = __ENV.K6_STAFF_USERNAME;
  const password = __ENV.K6_STAFF_PASSWORD;
  const scheduleId = __ENV.K6_SCHEDULE_ID;
  if (!username || !password || !scheduleId) return;
  const response = http.post(
    `${baseUrl}/api/v1/auth/staff/login`,
    JSON.stringify({ username, password }),
    requestOptions(),
  );
  const ok = check(response, { "staff login succeeds": (r) => r.status === 200 });
  runtimeErrors.add(!ok);
  if (!ok) return;
  const monitor = http.get(
    `${baseUrl}/api/v1/teacher/schedules/${scheduleId}/monitor?limit=50`,
    requestOptions(),
  );
  const monitorOk = check(monitor, {
    "monitor request succeeds": (r) => r.status === 200,
  });
  runtimeErrors.add(!monitorOk);
  sleep(Number(__ENV.K6_MONITOR_INTERVAL_SECONDS || 15));
}

function login(participant) {
  const started = Date.now();
  const response = http.post(
    `${baseUrl}/api/v1/auth/participant/login`,
    JSON.stringify({ username: participant.username, password: participant.password }),
    requestOptions(),
  );
  loginDuration.add(Date.now() - started);
  const ok = check(response, { "participant login succeeds": (r) => r.status === 200 });
  runtimeErrors.add(!ok);
  if (!ok) return null;
  const body = safeJson(response);
  return { csrfToken: body.csrfToken || "" };
}

function readSchedule() {
  const response = http.get(`${baseUrl}/api/v1/participant/schedules`, requestOptions());
  const ok = check(response, { "schedule list succeeds": (r) => r.status === 200 });
  runtimeErrors.add(!ok);
  if (!ok) return null;
  const items = safeJson(response)?.data?.items;
  return Array.isArray(items) ? items.find((item) => item.mode === "MAIN") || items[0] : null;
}

function startSession(participant, scheduleId, auth) {
  const started = Date.now();
  const startKey = uuidFor(__VU, __ITER);
  const response = http.post(
    `${baseUrl}/api/v1/participant/schedules/${scheduleId}/sessions`,
    JSON.stringify({
      mainAccessCode: participant.mainAccessCode || __ENV.K6_MAIN_ACCESS_CODE,
      startIdempotencyKey: startKey,
    }),
    mutationOptions(auth, startKey),
  );
  startDuration.add(Date.now() - started);
  const ok = check(response, { "exam start succeeds": (r) => r.status === 200 || r.status === 201 });
  runtimeErrors.add(!ok);
  if (!ok) return null;
  return safeJson(response)?.data || null;
}

function resumeSession(sessionId, auth) {
  const started = Date.now();
  const response = http.get(`${baseUrl}/api/v1/participant/exam-sessions/${sessionId}`, requestOptions());
  resumeDuration.add(Date.now() - started);
  const ok = check(response, { "exam resume succeeds": (r) => r.status === 200 });
  runtimeErrors.add(!ok);
  return ok ? safeJson(response)?.data || null : null;
}

function saveAnswers(sessionId, answers, auth) {
  const key = `answer-${uuidFor(__VU, __ITER)}-${Date.now()}`;
  const started = Date.now();
  const response = http.post(
    `${baseUrl}/api/v1/participant/exam-sessions/${sessionId}/answers`,
    JSON.stringify({ items: answers.map((item) => ({ ...item, clientMutationId: key })) }),
    mutationOptions(auth, key),
  );
  autosaveDuration.add(Date.now() - started);
  const body = safeJson(response);
  const outcomes = body?.data?.outcomes || [];
  answerConflicts.add(outcomes.filter((item) => item.status === "CONFLICT").length);
  const ok = check(response, { "autosave succeeds": (r) => r.status === 200 });
  runtimeErrors.add(!ok);
  return ok ? outcomes : [];
}

function submitSession(sessionId, answers, auth) {
  const key = `submit-${uuidFor(__VU, __ITER)}`;
  const started = Date.now();
  const response = http.post(
    `${baseUrl}/api/v1/participant/exam-sessions/${sessionId}/submit`,
    JSON.stringify({ finalAnswers: answers.map(({ clientMutationId, ...item }) => item) }),
    mutationOptions(auth, key),
  );
  submitDuration.add(Date.now() - started);
  const ok = check(response, {
    "exam submit succeeds": (r) => r.status === 200,
    "submit returns result": (r) => Boolean(safeJson(r)?.data?.result),
  });
  if (response.status === 409) duplicateSubmits.add(1);
  runtimeErrors.add(!ok);
}

function applySavedVersions(answers, outcomes) {
  const versions = new Map(
    outcomes
      .filter((item) => item.status === "SAVED" && item.version !== undefined)
      .map((item) => [String(item.sessionQuestionId), Number(item.version)]),
  );
  return answers.map((answer) => ({
    ...answer,
    ...(versions.has(String(answer.sessionQuestionId))
      ? { baseVersion: versions.get(String(answer.sessionQuestionId)) }
      : {}),
  }));
}

function buildAnswers(manifest, committed = []) {
  if (!Array.isArray(manifest)) return [];
  const versions = new Map((committed || []).map((item) => [String(item.sessionQuestionId), item.version]));
  return manifest.slice(0, Number(__ENV.K6_ANSWER_COUNT || 5)).map((item) => ({
    sessionQuestionId: String(item.sessionQuestionId),
    baseVersion: Number(versions.get(String(item.sessionQuestionId)) || 0),
    response: responseFor(item),
  }));
}

function responseFor(item) {
  const question = item.question || {};
  if (question.type === "TRUE_FALSE") {
    return { statements: (item.statementOrder || question.statements || []).map((statement) => ({ statementId: String(statement.id || statement), value: true })) };
  }
  const optionIds = item.optionOrder || (question.options || []).map((option) => option.id);
  if (question.type === "MULTIPLE_RESPONSE") return { selectedOptionIds: optionIds.length ? [String(optionIds[0])] : [] };
  return { selectedOptionId: optionIds.length ? String(optionIds[0]) : null };
}

function requestOptions() {
  return {
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "X-Request-Id": `k6-${__VU}-${__ITER}`,
    },
    tags: { workload: "exam-runtime" },
  };
}

function mutationOptions(auth, key) {
  const options = requestOptions();
  options.headers["X-CSRF-Token"] = auth.csrfToken || "load-test-csrf-placeholder";
  options.headers["Idempotency-Key"] = key;
  return options;
}

function uuidFor(vu, iteration) {
  const runHash = hashRunId(__ENV.K6_RUN_ID || "default");
  const counter = `${(vu * 1000000 + iteration).toString(16)}`
    .padStart(8, "0")
    .slice(-8);
  const suffix = `${runHash}${counter}`.slice(-12);
  return `00000000-0000-4000-8000-${suffix}`;
}

function hashRunId(value) {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(4, "0").slice(-4);
}

function safeJson(response) {
  try {
    return response.json();
  } catch {
    return {};
  }
}

export function handleSummary(data) {
  const output = __ENV.K6_SUMMARY_FILE || "k6-summary.json";
  return {
    [output]: JSON.stringify(data, null, 2),
    stdout: JSON.stringify({
      profile,
      checks: data.metrics.checks,
      httpReqFailed: data.metrics.http_req_failed,
      httpReqDuration: data.metrics.http_req_duration,
    }),
  };
}
