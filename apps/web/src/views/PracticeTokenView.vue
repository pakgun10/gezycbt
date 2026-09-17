<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import ParticipantHeader from "../components/ParticipantHeader.vue";
import FeedbackState from "../components/FeedbackState.vue";
import { ApiClientError } from "../lib/api";
import { HttpParticipantApi, normalizeToken } from "../features/participant/api";
import { setPracticeFlow } from "../features/participant/practice-flow";

const router = useRouter();
const api = new HttpParticipantApi();
const token = ref("");
const busy = ref(false);
const error = ref("");

async function resolve(): Promise<void> {
  error.value = "";
  if (normalizeToken(token.value).length !== 5) {
    error.value = "Masukkan token latihan 5 karakter.";
    return;
  }
  busy.value = true;
  try {
    const schedule = await api.resolvePractice(token.value);
    setPracticeFlow(schedule, normalizeToken(token.value));
    await router.push("/practice/identity");
  } catch (cause) { error.value = cause instanceof ApiClientError ? cause.message : "Koneksi tidak tersedia. Coba lagi."; }
  finally { busy.value = false; }
}
</script>

<template>
  <ParticipantHeader title="Ujian Latihan" />
  <main class="page narrow"><section class="card panel" aria-labelledby="practice-title"><h1 id="practice-title">Masukkan token latihan</h1><p class="muted">Token terdiri dari 5 huruf kapital/angka. Tanda hubung boleh digunakan saat mengetik.</p><FeedbackState v-if="error" title="Token belum dapat diperiksa" :message="error" tone="error" /><form @submit.prevent="resolve"><div class="form-row"><label for="practice-token">Token</label><input id="practice-token" v-model="token" maxlength="7" pattern="[A-Za-z0-9-]{5,7}" autocomplete="off" autocapitalize="characters" required @input="token = token.toUpperCase()" /></div><button class="btn-primary" type="submit" :disabled="busy">{{ busy ? "Memeriksa…" : "Lanjutkan" }}</button></form></section></main>
</template>

<style scoped>.narrow { width: min(620px, 100%); }.panel { padding: 24px; }.panel h1 { margin-top: 0; }</style>
