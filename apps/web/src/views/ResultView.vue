<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ParticipantHeader from "../components/ParticipantHeader.vue";
import FeedbackState from "../components/FeedbackState.vue";
import { ApiClientError } from "../lib/api";
import { HttpParticipantApi } from "../features/participant/api";
import { getPracticeFlow } from "../features/participant/practice-flow";
import type { ParticipantResultResponse, ParticipantSessionView } from "../features/participant/types";

const route = useRoute();
const router = useRouter();
const api = new HttpParticipantApi();
const view = ref<ParticipantSessionView | null>(null);
const resultData = ref<ParticipantResultResponse["data"] | null>(null);
const loading = ref(true);
const error = ref("");
const practice = computed(() => String(route.path).startsWith("/practice/"));

onMounted(async () => {
  try {
    const [session, result] = await Promise.all([
      api.session(String(route.params.id)),
      api.result(String(route.params.id)),
    ]);
    view.value = session;
    resultData.value = result;
  }
  catch (cause) { error.value = cause instanceof ApiClientError ? cause.message : "Hasil belum dapat dimuat."; }
  finally { loading.value = false; }
});

const result = computed(() => resultData.value?.result ?? null);
function date(value: string): string { return `${new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value))} WIB`; }
function retryPractice(): void { const flow = getPracticeFlow(); if (flow.schedule) void router.push("/practice/identity"); else void router.push("/practice/token"); }
function retryReason(): string {
  const reason = resultData.value?.canRetryReason;
  if (reason === "SCHEDULE_CLOSED") return "Jadwal latihan sudah ditutup.";
  if (reason === "TOKEN_INVALID_OR_EXPIRED") return "Token latihan sudah tidak berlaku.";
  if (reason === "ATTEMPT_LIMIT_REACHED") return "Batas percobaan latihan sudah tercapai.";
  return "Latihan ini tidak dapat diulang saat ini.";
}
</script>

<template>
  <ParticipantHeader title="Hasil Ujian" />
  <main class="page narrow"><FeedbackState v-if="loading" title="Memuat hasil…" /><FeedbackState v-else-if="error" title="Hasil belum tersedia" :message="error" tone="error"><button class="btn-secondary" type="button" @click="router.go(0)">Coba lagi</button></FeedbackState><section v-else-if="view && result" class="card result-card" aria-labelledby="result-title"><p class="eyebrow">{{ practice ? "Latihan" : "Ujian Utama" }}</p><h1 id="result-title">{{ practice ? "Hasil latihan" : "Ujian berhasil dikumpulkan" }}</h1><p class="muted">Selesai pada {{ date(result.scoredAt) }}</p><div class="score-grid"><div><span>Nilai</span><strong>{{ result.earnedScore }} / {{ result.maxScore }}</strong></div><div><span>Persentase</span><strong>{{ result.percentage }}%</strong></div><div><span>Benar</span><strong>{{ result.correctCount }}</strong></div><div><span>Salah</span><strong>{{ result.incorrectCount }}</strong></div><div><span>Belum dijawab</span><strong>{{ result.unansweredCount }}</strong></div></div><div v-if="!practice" class="alert alert-info">Hasil ujian utama telah dirilis sesuai kebijakan sekolah.</div><p class="muted">Kunci jawaban dan pembahasan per soal tidak ditampilkan.</p><button v-if="practice && resultData?.canRetry" class="btn-primary" type="button" @click="retryPractice">Coba Lagi</button><p v-else-if="practice" class="muted">{{ retryReason() }}</p><RouterLink v-else class="btn-secondary action-link" to="/participant/schedules">Kembali ke dashboard</RouterLink></section></main>
</template>

<style scoped>.narrow { width: min(700px, 100%); }.result-card { padding: 24px; }.result-card h1 { margin-top: 0; }.eyebrow { color: var(--primary); font-weight: 700; }.score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; margin: 24px 0; }.score-grid div { padding: 14px; background: var(--surface-elevated); border-radius: 8px; }.score-grid span, .score-grid strong { display: block; }.score-grid span { color: var(--muted); font-size: .85rem; }.score-grid strong { margin-top: 5px; font-size: 1.35rem; }.action-link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px; text-decoration: none; }</style>
