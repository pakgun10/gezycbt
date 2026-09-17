<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ParticipantHeader from "../components/ParticipantHeader.vue";
import FeedbackState from "../components/FeedbackState.vue";
import { ApiClientError } from "../lib/api";
import { HttpParticipantApi, normalizeToken } from "../features/participant/api";
import type { ParticipantSchedule } from "../features/participant/types";

const route = useRoute();
const router = useRouter();
const api = new HttpParticipantApi();
const schedule = ref<ParticipantSchedule | null>(null);
const loading = ref(true);
const starting = ref(false);
const stage = ref("Menyiapkan ujian…");
const loadError = ref("");
const actionError = ref("");
const mainAccessCode = ref("");
const slow = ref(false);
const statusBusy = ref(false);
const startKey = crypto.randomUUID();
let slowTimer: number | undefined;
let statusTimer: number | undefined;
onBeforeUnmount(() => {
  if (slowTimer !== undefined) window.clearTimeout(slowTimer);
  if (statusTimer !== undefined) window.clearTimeout(statusTimer);
});

async function load(): Promise<void> {
  try {
    const all = await api.schedules();
    schedule.value = all.find((item) => item.id === String(route.params.id)) ?? null;
    if (!schedule.value) loadError.value = "Jadwal ujian tidak ditemukan atau tidak dapat diakses.";
  } catch (cause) { loadError.value = cause instanceof ApiClientError ? cause.message : "Koneksi tidak tersedia. Coba lagi."; }
  finally { loading.value = false; }
}
void load();

async function start(): Promise<void> {
  if (!schedule.value || starting.value) return;
  if ((schedule.value.mainAccessCodeRequired ?? schedule.value.mode === "MAIN") && normalizeToken(mainAccessCode.value).length !== 5) {
    actionError.value = "Kode ujian utama 5 karakter wajib diisi.";
    return;
  }
  starting.value = true; actionError.value = "";
  slow.value = false;
  stage.value = "Menyiapkan ujian…";
  slowTimer = window.setTimeout(() => { stage.value = "Persiapan lebih lama dari biasanya"; }, 3000);
  statusTimer = window.setTimeout(() => { slow.value = true; }, 15000);
  try {
    const result = await api.startMain(schedule.value.id, startKey, mainAccessCode.value);
    await router.push(`/participant/exam/${result.session.id}`);
  }
  catch (cause) {
    actionError.value = cause instanceof ApiClientError ? cause.message : "Koneksi terputus. Periksa status untuk melanjutkan.";
    const retryable = !(cause instanceof ApiClientError) || cause.status === 429 || cause.status >= 500;
    slow.value = retryable;
    starting.value = retryable;
  }
  finally {
    if (slowTimer !== undefined) window.clearTimeout(slowTimer);
    if (statusTimer !== undefined) window.clearTimeout(statusTimer);
  }
}
async function checkStatus(): Promise<void> {
  if (!schedule.value || !starting.value || statusBusy.value) return;
  statusBusy.value = true;
  try {
    const result = await api.startMain(schedule.value.id, startKey, mainAccessCode.value);
    await router.push(`/participant/exam/${result.session.id}`);
  } catch (cause) {
    actionError.value = cause instanceof ApiClientError ? cause.message : "Status belum tersedia. Permintaan akan tetap dicoba dengan kode yang sama.";
  } finally { statusBusy.value = false; }
}
const starts = computed(() => schedule.value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(schedule.value.startsAt)) : "");
</script>

<template>
  <ParticipantHeader title="Persiapan Ujian" />
  <main class="page narrow"><FeedbackState v-if="loading" title="Memuat detail ujian…" /><FeedbackState v-else-if="loadError" title="Ujian belum dapat dimuat" :message="loadError" tone="error"><button class="btn-secondary" type="button" @click="router.back()">Kembali</button></FeedbackState><section v-else-if="schedule" class="card panel" aria-labelledby="preexam-title"><p class="eyebrow">{{ schedule.subjectName ?? "Ujian" }}</p><h1 id="preexam-title">{{ schedule.title }}</h1><dl><div><dt>Waktu mulai</dt><dd>{{ starts }} WIB</dd></div><div><dt>Durasi</dt><dd>{{ Math.round(schedule.durationSeconds / 60) }} menit</dd></div><div><dt>Percobaan</dt><dd>{{ schedule.attemptsUsed ?? 0 }} / {{ schedule.maxAttempts }}</dd></div></dl><div v-if="schedule.mainAccessCodeRequired ?? schedule.mode === 'MAIN'" class="form-row"><label for="main-access-code">Kode tambahan ujian</label><input id="main-access-code" v-model="mainAccessCode" maxlength="7" pattern="[A-Za-z0-9-]{5,7}" inputmode="text" autocapitalize="characters" autocomplete="off" placeholder="ABCDE" @input="mainAccessCode = mainAccessCode.toUpperCase()" /><small class="muted">Masukkan 5 karakter. Huruf kecil dan tanda hubung akan dinormalisasi. <span v-if="schedule.mainAccessCodeHint">Petunjuk: {{ schedule.mainAccessCodeHint }}</span></small></div><div class="alert alert-info">Jawaban disimpan bertahap. Waktu berakhir mengikuti server dan tidak berhenti ketika koneksi Anda terputus.</div><FeedbackState v-if="actionError" title="Ujian belum dapat dimulai" :message="actionError" tone="error" /><FeedbackState v-if="starting" :title="stage" message="Soal dan waktu sedang disiapkan. Jangan tutup halaman ini." /><div v-if="starting && slow" class="stack"><span class="muted">Permintaan masih diproses dengan kode start yang sama.</span><button class="btn-secondary" type="button" :disabled="statusBusy" @click="checkStatus">{{ statusBusy ? "Memeriksa…" : "Periksa status" }}</button></div><button v-else-if="!starting" class="btn-primary" type="button" @click="start">Mulai Ujian</button></section></main>
</template>

<style scoped>.narrow { width: min(700px, 100%); }.panel { padding: 24px; }.panel h1 { margin-top: 0; }.eyebrow { color: var(--primary); font-weight: 700; } dl { display: grid; gap: 12px; margin: 24px 0; } dt { color: var(--subtle); font-size: .85rem; } dd { margin: 2px 0 0; font-weight: 600; }</style>
