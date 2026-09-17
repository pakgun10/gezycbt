<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import FeedbackState from "../components/FeedbackState.vue";
import ThemeToggle from "../components/ThemeToggle.vue";
import { ApiClientError } from "../lib/api";
import { HttpParticipantApi } from "../features/participant/api";
import { useParticipantAuth } from "../features/participant/auth-store";

const router = useRouter();
const route = useRoute();
const api = new HttpParticipantApi();
const auth = useParticipantAuth();
const username = ref("");
const password = ref("");
const busy = ref(false);
const error = ref("");
const requestId = ref("");

async function login(): Promise<void> {
  error.value = "";
  requestId.value = "";
  if (!username.value.trim() || !password.value) {
    error.value = "Username dan password wajib diisi.";
    return;
  }
  busy.value = true;
  try {
    const result = await api.login(username.value.trim(), password.value);
    auth.setLogin(result);
    password.value = "";
    const redirect = typeof route.query.redirect === "string" && route.query.redirect.startsWith("/participant/")
      ? route.query.redirect
      : "/participant/schedules";
    await router.push(redirect);
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      error.value = cause.message;
      requestId.value = cause.requestId ?? "";
    } else error.value = "Koneksi tidak tersedia. Coba lagi.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-card card" aria-labelledby="login-title">
      <div class="between"><div><p class="eyebrow">GezyCBT</p><h1 id="login-title">Masuk sebagai peserta</h1></div><ThemeToggle /></div>
      <p class="muted">Gunakan akun peserta untuk ujian utama. Untuk ujian latihan, gunakan token latihan.</p>
      <FeedbackState v-if="error" title="Login belum berhasil" :message="error" tone="error">
        <small v-if="requestId">Request ID: {{ requestId }}</small>
      </FeedbackState>
      <form @submit.prevent="login">
        <div class="form-row"><label for="username">Username</label><input id="username" v-model="username" autocomplete="username" required /></div>
        <div class="form-row"><label for="password">Password</label><input id="password" v-model="password" type="password" autocomplete="current-password" required /></div>
        <button class="btn-primary submit" type="submit" :disabled="busy">{{ busy ? "Memeriksa…" : "Masuk" }}</button>
      </form>
      <p class="practice-link"><RouterLink to="/practice/token">Masuk ke ujian latihan dengan token</RouterLink></p>
    </section>
  </main>
</template>

<style scoped>
.login-page { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
.login-card { width: min(460px, 100%); padding: 24px; }
.login-card h1 { margin: 0; font-size: 1.65rem; }
.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }
.submit { width: 100%; margin-top: 8px; }
.practice-link { margin: 20px 0 0; text-align: center; }
.alert { margin: 16px 0; }
</style>
