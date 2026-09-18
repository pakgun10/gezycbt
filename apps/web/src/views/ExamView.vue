<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import QuestionPalette from "../components/exam/QuestionPalette.vue";
import QuestionRenderer from "../components/exam/QuestionRenderer.vue";
import SaveStatus from "../components/SaveStatus.vue";
import ParticipantHeader from "../components/ParticipantHeader.vue";
import FeedbackState from "../components/FeedbackState.vue";
import { ApiClientError } from "../lib/api";
import { HttpParticipantApi } from "../features/participant/api";
import { useExamSession } from "../features/exam/use-exam-session";
import type { AnswerResponse, RuntimeQuestionManifest } from "../features/participant/types";
import { useParticipantAuth } from "../features/participant/auth-store";

const route = useRoute();
const router = useRouter();
const api = new HttpParticipantApi();
const auth = useParticipantAuth();
const authExpired = ref(false);
const authUsername = ref(auth.user.value?.username ?? "");
const authPassword = ref("");
const authBusy = ref(false);
const authError = ref("");
const loadError = ref("");
const submitError = ref("");
const submitBusy = ref(false);
const showPalette = ref(false);
const showSubmit = ref(false);
const current = ref(0);
const marked = ref(new Set<string>());
const heading = ref<HTMLElement | null>(null);
const wasOffline = ref(false);
const announcedThresholds = new Set<number>();
const liveMessage = ref("");
const paletteTrigger = ref<HTMLButtonElement | null>(null);
const paletteClose = ref<HTMLButtonElement | null>(null);

const authExpiryHandler = () => {
  authExpired.value = true;
  authError.value = "";
};
const exam = useExamSession(
  api,
  auth.csrfToken.value
    ? { csrfToken: auth.csrfToken.value, onAuthExpired: authExpiryHandler }
    : { onAuthExpired: authExpiryHandler },
);
const session = exam.session;
const manifest = exam.manifest;
const answerMap = exam.answers;
const saveState = exam.state;
const remaining = exam.remainingSeconds;
const conflicts = exam.conflicts;
const practiceRoute = computed(() => route.path.startsWith("/practice/"));
const currentQuestion = computed(() => exam.manifest.value[current.value] ?? null);
const answeredIds = computed(() => new Set([...exam.answers.value.values()].filter((answer) => !isEmpty(answer.response)).map((answer) => answer.sessionQuestionId)));
const unansweredCount = computed(() => Math.max(0, exam.manifest.value.length - answeredIds.value.size));
const timerText = computed(() => formatDuration(exam.remainingSeconds.value));
const timerTone = computed(() => exam.remainingSeconds.value <= 300 ? "danger" : exam.remainingSeconds.value <= 600 ? "warning" : "normal");

onMounted(async () => {
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  thresholdTimer = window.setInterval(() => {
    const message = thresholdMessage();
    if (message) liveMessage.value = message;
  }, 1000);
  try {
    await exam.resume(await api.session(String(route.params.id)));
    if (exam.manifest.value.length === 0) loadError.value = "Sesi tidak memiliki soal. Muat ulang atau hubungi guru.";
    await focusHeading();
  } catch (cause) {
    if (cause instanceof ApiClientError && cause.status === 401) authExpired.value = true;
    else loadError.value = cause instanceof ApiClientError ? cause.message : "Sesi ujian belum dapat dimuat.";
  }
});
onUnmounted(() => {
  window.removeEventListener("offline", onOffline);
  window.removeEventListener("online", onOnline);
  if (thresholdTimer !== undefined) window.clearInterval(thresholdTimer);
});

let thresholdTimer: number | undefined;

function onOffline(): void { wasOffline.value = true; liveMessage.value = "Anda sedang offline. Jawaban disimpan di perangkat."; }
function onOnline(): void {
  if (wasOffline.value) liveMessage.value = "Koneksi pulih. Menyinkronkan jawaban.";
  wasOffline.value = false;
  void exam.flush().catch(() => undefined);
}
function responseFor(item: RuntimeQuestionManifest): AnswerResponse {
  const saved = exam.answers.value.get(item.sessionQuestionId)?.response;
  if (saved) return saved;
  if (item.question.type === "SINGLE_CHOICE") return { selectedOptionId: null };
  if (item.question.type === "MULTIPLE_RESPONSE") return { selectedOptionIds: [] };
  return { statements: [] };
}
async function updateAnswer(response: AnswerResponse): Promise<void> {
  if (!currentQuestion.value) return;
  await exam.setAnswer(currentQuestion.value.sessionQuestionId, response);
}
async function navigate(index: number): Promise<void> {
  if (index < 0 || index >= exam.manifest.value.length) return;
  try {
    await exam.flush();
  } catch {
    // Local outbox remains authoritative for navigation.
  }
  current.value = index;
  showPalette.value = false;
  await focusHeading();
}
async function focusHeading(): Promise<void> {
  await nextTick();
  const questionHeading = document.querySelector<HTMLElement>(".question h2");
  (questionHeading ?? heading.value)?.focus();
}
function toggleMark(): void {
  const id = currentQuestion.value?.sessionQuestionId;
  if (!id) return;
  const next = new Set(marked.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  marked.value = next;
}
async function submit(): Promise<void> {
  if (submitBusy.value || !exam.session.value) return;
  submitBusy.value = true; submitError.value = "";
  try {
    const result = await exam.submit();
    const prefix = route.path.startsWith("/practice/")
      ? "/practice/results"
      : "/participant/results";
    await router.push(`${prefix}/${exam.session.value.id}?submitted=1`);
    void result;
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      if (cause.status === 409 && cause.code === "SESSION_EXPIRED") {
        const prefix = route.path.startsWith("/practice/")
          ? "/practice/results"
          : "/participant/results";
        await router.push(`${prefix}/${exam.session.value?.id ?? route.params.id}`);
        return;
      }
      if (cause.status === 409 && cause.code === "ANSWER_VERSION_CONFLICT") submitError.value = "Jawaban berubah di perangkat lain. Muat state server, periksa jawaban Anda, lalu coba lagi.";
      else if (cause.status === 503) submitError.value = "Server sedang sibuk. Mencoba lagi dapat dilakukan tanpa kehilangan jawaban.";
      else if (cause.status === 401) submitError.value = "Sesi login berakhir. Masuk ulang untuk melanjutkan.";
      else submitError.value = cause.message;
    } else submitError.value = "Koneksi terputus. Jawaban yang belum terkirim tetap aman di perangkat.";
  } finally { submitBusy.value = false; showSubmit.value = Boolean(submitError.value); }
}
async function retryAuth(): Promise<void> {
  if (authBusy.value) return;
  authError.value = "";
  if (!authUsername.value.trim() || !authPassword.value) {
    authError.value = "Username dan password wajib diisi.";
    return;
  }
  authBusy.value = true;
  try {
    const result = await api.login(authUsername.value.trim(), authPassword.value);
    auth.setLogin(result);
    exam.setCsrfToken(result.csrfToken);
    authPassword.value = "";
    // The initial session request may have failed before the controller had a
    // session object. Resume from the route ID so re-login works in that case
    // as well as when authentication expires during an active exam.
    await exam.resume(await api.session(String(route.params.id)));
    authExpired.value = false;
  } catch (cause) {
    authError.value = cause instanceof ApiClientError
      ? cause.message
      : "Login ulang belum berhasil. Coba lagi.";
  } finally {
    authBusy.value = false;
  }
}
function openPalette(): void {
  showPalette.value = true;
  void nextTick(() => paletteClose.value?.focus());
}
function closePalette(): void {
  showPalette.value = false;
  void nextTick(() => paletteTrigger.value?.focus());
}
function formatDuration(seconds: number): string { const m = Math.floor(seconds / 60).toString().padStart(2, "0"); const s = (seconds % 60).toString().padStart(2, "0"); const h = Math.floor(Number(m) / 60); return `${h > 0 ? `${h.toString().padStart(2, "0")}:` : ""}${(Number(m) % 60).toString().padStart(2, "0")}:${s}`; }
function isEmpty(response: AnswerResponse): boolean { if ("selectedOptionId" in response) return response.selectedOptionId === null; if ("selectedOptionIds" in response) return response.selectedOptionIds.length === 0; return response.statements.length !== 3; }
function thresholdMessage(): string { if (!exam.session.value) return ""; const seconds = exam.remainingSeconds.value; const threshold = seconds <= 0 ? 0 : seconds <= 60 ? 60 : seconds <= 300 ? 300 : seconds <= 600 ? 600 : -1; if (threshold >= 0 && !announcedThresholds.has(threshold)) { announcedThresholds.add(threshold); return threshold === 0 ? "Waktu habis. Sistem sedang mengumpulkan ujian." : `Sisa waktu ${Math.floor(threshold / 60)} menit.`; } return ""; }
watch(showPalette, (open) => {
  if (open) void nextTick(() => paletteClose.value?.focus());
});
</script>

<template>
  <div class="exam-page">
    <ParticipantHeader title="Ujian" compact>
      <template #actions><button ref="paletteTrigger" class="btn-quiet palette-button" type="button" @click="openPalette">☰ Soal</button></template>
    </ParticipantHeader>
    <main v-if="!loadError && session" class="exam-main" aria-label="Halaman ujian">
      <header class="exam-toolbar"><div><span class="progress">Soal {{ current + 1 }} dari {{ manifest.length }}</span><span class="mobile-status"><SaveStatus :state="saveState" /></span></div><div class="toolbar-status"><span :class="`timer timer-${timerTone}`" aria-label="Sisa waktu">{{ timerText }}</span><SaveStatus :state="saveState" /></div></header>
      <div v-if="wasOffline" class="offline-banner" role="alert" aria-live="assertive">Anda sedang offline. Jawaban disimpan di perangkat dan akan dikirim saat koneksi kembali.</div>
      <section v-if="saveState === 'CONFLICT' && conflicts.length" class="alert alert-warning conflict-panel" aria-labelledby="conflict-title"><h2 id="conflict-title">Jawaban perlu disinkronkan</h2><p>Jawaban ini berubah di perangkat lain. Pilih versi yang ingin dipakai.</p><div v-for="conflict in conflicts" :key="conflict.sessionQuestionId" class="conflict-row"><span>Soal {{ (manifest.findIndex((item) => item.sessionQuestionId === conflict.sessionQuestionId) + 1) || "?" }}</span><div class="dialog-actions"><button class="btn-secondary" type="button" @click="exam.resolveConflict(conflict.sessionQuestionId, 'server')">Gunakan versi server</button><button class="btn-primary" type="button" @click="exam.resolveConflict(conflict.sessionQuestionId, 'local')">Pertahankan jawaban saya</button></div></div></section>
      <div class="exam-layout">
        <section class="question-panel"><div class="question-actions"><button class="btn-secondary" type="button" @click="toggleMark">{{ currentQuestion && marked.has(currentQuestion.sessionQuestionId) ? "Hapus tanda" : "Tandai soal" }}</button></div><QuestionRenderer v-if="currentQuestion" :question="currentQuestion.question" :response="responseFor(currentQuestion)" @update="updateAnswer" /><FeedbackState v-else title="Soal tidak dapat ditampilkan" message="Coba muat ulang sesi ini." tone="error" /></section>
      <aside class="palette-side"><h2>Daftar Soal</h2><QuestionPalette :manifest="manifest" :current="current" :answered="answeredIds" :marked="marked" @select="navigate" /><button class="btn-primary submit-desktop" type="button" :disabled="saveState === 'ENDED' || submitBusy" @click="showSubmit = true">Kumpulkan Ujian</button></aside>
      </div>
      <nav class="exam-navigation" aria-label="Navigasi soal"><button class="btn-secondary" type="button" :disabled="current === 0" @click="navigate(current - 1)">Sebelumnya</button><button class="btn-primary" type="button" :disabled="saveState === 'ENDED' || submitBusy" @click="current === manifest.length - 1 ? (showSubmit = true) : navigate(current + 1)">{{ current === manifest.length - 1 ? "Tinjau & Kumpulkan" : "Berikutnya" }}</button></nav>
    </main>
    <FeedbackState v-else-if="loadError" title="Sesi belum dapat dimuat" :message="loadError" tone="error"><button class="btn-secondary" type="button" @click="router.go(0)">Muat ulang</button></FeedbackState>
    <FeedbackState v-else title="Memuat sesi ujian…" message="Manifest dan jawaban sedang disiapkan." />
    <div ref="heading" tabindex="-1" class="sr-only" aria-live="off">Soal {{ current + 1 }} dari {{ manifest.length }}</div>
    <div class="sr-only" aria-live="assertive">{{ liveMessage }}</div>
    <div v-if="showPalette" class="overlay" role="dialog" aria-modal="true" aria-label="Daftar soal"><div class="drawer"><div class="between"><h2>Daftar Soal</h2><button ref="paletteClose" class="btn-secondary" type="button" @click="closePalette">Tutup</button></div><QuestionPalette :manifest="manifest" :current="current" :answered="answeredIds" :marked="marked" @select="navigate" /></div></div>
    <div v-if="authExpired" class="overlay" role="dialog" aria-modal="true" aria-labelledby="auth-expired-title"><div class="dialog card"><h2 id="auth-expired-title">{{ practiceRoute ? "Kredensial latihan berakhir" : "Sesi login berakhir" }}</h2><p v-if="practiceRoute">Kredensial latihan tidak tersedia. Mulai kembali dari token latihan.</p><template v-else><p>Ujian masih berjalan dan waktu tetap berjalan. Masuk kembali untuk menyinkronkan.</p><FeedbackState v-if="authError" title="Login ulang belum berhasil" :message="authError" tone="error" /><form @submit.prevent="retryAuth"><div class="form-row"><label for="resume-username">Username</label><input id="resume-username" v-model="authUsername" autocomplete="username" required /></div><div class="form-row"><label for="resume-password">Password</label><input id="resume-password" v-model="authPassword" type="password" autocomplete="current-password" required /></div><button class="btn-primary" type="submit" :disabled="authBusy">{{ authBusy ? "Masuk dan memuat…" : "Masuk ulang" }}</button></form></template><RouterLink v-if="practiceRoute" class="btn-secondary action-link" to="/practice/token">Masukkan token lagi</RouterLink></div></div>
    <div v-if="showSubmit" class="overlay" role="dialog" aria-modal="true" aria-labelledby="submit-title"><div class="dialog card"><h2 id="submit-title">Kumpulkan ujian?</h2><p>Jawaban tidak dapat diubah setelah dikumpulkan.</p><dl><div><dt>Jumlah soal</dt><dd>{{ manifest.length }}</dd></div><div><dt>Sudah dijawab</dt><dd>{{ answeredIds.size }}</dd></div><div><dt>Belum dijawab</dt><dd>{{ unansweredCount }}</dd></div></dl><FeedbackState v-if="submitError" title="Pengumpulan belum selesai" :message="submitError" tone="error" /><div class="dialog-actions"><button class="btn-secondary" type="button" :disabled="submitBusy" @click="showSubmit = false">Batal</button><button class="btn-primary" type="button" :disabled="submitBusy" @click="submit">{{ submitBusy ? "Mengumpulkan…" : "Kumpulkan Ujian" }}</button></div></div></div>
  </div>
</template>

<style scoped>
.exam-page { min-height: 100vh; background: var(--canvas); }.exam-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 56px; padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--surface); }.progress { font-weight: 700; }.toolbar-status { display: flex; align-items: center; gap: 16px; }.mobile-status { display: none; }.timer { min-width: 78px; font-variant-numeric: tabular-nums; font-weight: 700; }.timer-warning { color: var(--warning); }.timer-danger { color: var(--danger); }.offline-banner { margin: 12px 16px 0; padding: 10px 12px; color: var(--warning); background: var(--warning-soft); border-radius: 8px; }.exam-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; max-width: 1240px; margin: 0 auto; }.question-panel { min-width: 0; padding: 24px 32px 96px; }.question-actions { display: flex; justify-content: flex-end; margin-bottom: 12px; }.palette-side { padding: 24px 16px; border-left: 1px solid var(--border); background: var(--surface); }.palette-side h2 { margin-top: 0; font-size: 1.1rem; }.submit-desktop { width: 100%; margin-top: 20px; }.exam-navigation { position: fixed; right: 0; bottom: 0; left: 0; z-index: 5; display: flex; justify-content: space-between; gap: 12px; padding: 10px max(16px, calc((100vw - 1180px) / 2)); border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 94%, transparent); }.exam-navigation button { min-width: 130px; }.palette-button { display: none; }.overlay { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 16px; background: rgb(2 6 23 / 60%); }.dialog { width: min(480px, 100%); padding: 24px; }.dialog h2 { margin-top: 0; }.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }.drawer { align-self: stretch; width: min(360px, 100%); margin-left: auto; overflow: auto; background: var(--surface); }.drawer .between { padding: 16px; border-bottom: 1px solid var(--border); }.drawer h2 { margin: 0; font-size: 1.1rem; }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.conflict-panel { margin: 12px 16px 0; }.conflict-panel h2 { margin: 0 0 4px; font-size: 1rem; }.conflict-panel p { margin: 0 0 12px; }.conflict-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--warning) 25%, transparent); }.conflict-row .dialog-actions { margin: 0; }
@media (max-width: 767px) { .exam-toolbar { flex-wrap: wrap; }.toolbar-status { width: 100%; justify-content: space-between; }.toolbar-status .save-status { display: none; }.mobile-status { display: block; margin-top: 6px; }.palette-side { display: none; }.palette-button { display: inline-flex; align-items: center; }.question-panel { padding: 16px 16px 88px; }.exam-layout { display: block; }.exam-navigation button { flex: 1; min-width: 0; }.exam-navigation { padding: 10px 16px; } }
</style>
