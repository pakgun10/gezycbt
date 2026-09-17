<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import ParticipantHeader from "../components/ParticipantHeader.vue";
import FeedbackState from "../components/FeedbackState.vue";
import { ApiClientError } from "../lib/api";
import { HttpParticipantApi } from "../features/participant/api";
import { getPracticeFlow } from "../features/participant/practice-flow";

const router = useRouter();
const api = new HttpParticipantApi();
const flow = getPracticeFlow();
const identity = ref<Record<string, string>>({});
const busy = ref(false);
const error = ref("");
const fieldErrors = ref<Record<string, string>>({});
const fields = computed(() => flow.identityFields);

async function start(): Promise<void> {
  error.value = "";
  fieldErrors.value = {};
  const normalized: Record<string, string> = {};
  for (const field of fields.value) {
    const value = identity.value[field.key]?.trim() ?? "";
    if (field.required && value.length === 0) fieldErrors.value[field.key] = `${field.label} wajib diisi.`;
    else if (field.key === "name" && (value.length < 2 || value.length > 200)) fieldErrors.value[field.key] = "Nama harus terdiri dari 2–200 karakter.";
    else if (value.length > (field.maxLength ?? 200)) fieldErrors.value[field.key] = `${field.label} maksimal ${field.maxLength ?? 200} karakter.`;
    if (value) normalized[field.key] = value;
  }
  const firstError = fields.value.find((field) => fieldErrors.value[field.key]);
  if (firstError) {
    error.value = fieldErrors.value[firstError.key] ?? "Periksa identitas Anda.";
    document.getElementById(`identity-${firstError.key}`)?.focus();
    return;
  }
  busy.value = true;
  try {
    const result = await api.startPractice(flow.schedule?.scheduleId ?? "", flow.token, normalized, crypto.randomUUID());
    await router.push(`/practice/exam/${result.session.id}`);
  } catch (cause) { error.value = cause instanceof ApiClientError ? cause.message : "Koneksi tidak tersedia. Coba lagi."; }
  finally { busy.value = false; }
}
</script>

<template>
  <ParticipantHeader title="Identitas Peserta Latihan" />
  <main class="page narrow"><section v-if="flow.schedule" class="card panel" aria-labelledby="identity-title"><p class="eyebrow">{{ flow.schedule.title }}</p><h1 id="identity-title">Isi identitas</h1><p class="muted">Identitas disimpan sebagai snapshot hasil dan tidak dapat diubah setelah ujian dimulai.</p><FeedbackState v-if="error" title="Identitas belum valid" :message="error" tone="error" /><form @submit.prevent="start"><div v-for="field in fields" :key="field.key" class="form-row"><label :for="`identity-${field.key}`">{{ field.label }}<span v-if="field.required"> *</span></label><input :id="`identity-${field.key}`" v-model="identity[field.key]" :maxlength="field.maxLength ?? 200" :required="field.required" autocomplete="off" :aria-invalid="Boolean(fieldErrors[field.key])" :aria-describedby="fieldErrors[field.key] ? `error-${field.key}` : undefined" /><small v-if="fieldErrors[field.key]" :id="`error-${field.key}`" class="form-error">{{ fieldErrors[field.key] }}</small></div><button class="btn-primary" type="submit" :disabled="busy">{{ busy ? "Menyiapkan ujian…" : "Mulai Latihan" }}</button></form></section><FeedbackState v-else title="Sesi latihan tidak ditemukan" message="Mulai kembali dari token latihan." tone="error"><RouterLink to="/practice/token">Masukkan token</RouterLink></FeedbackState></main>
</template>

<style scoped>.narrow { width: min(620px, 100%); }.panel { padding: 24px; }.panel h1 { margin-top: 0; }.eyebrow { color: var(--primary); font-weight: 700; }</style>
