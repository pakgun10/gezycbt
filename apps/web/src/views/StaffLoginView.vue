<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiClientError } from "../lib/api";
import { HttpStaffApi } from "../features/staff/api";
import { useStaffAuth } from "../features/staff/auth-store";

const api = new HttpStaffApi();
const auth = useStaffAuth();
const route = useRoute();
const router = useRouter();
const username = ref("");
const password = ref("");
const showPassword = ref(false);
const loading = ref(false);
const error = ref("");

async function submit(): Promise<void> {
  error.value = "";
  if (!username.value.trim() || !password.value) {
    error.value = "Username dan password wajib diisi.";
    return;
  }
  loading.value = true;
  try {
    const result = await api.login(username.value, password.value);
    if (result.user.role === "PARTICIPANT") {
      error.value = "Akun peserta tidak dapat masuk ke halaman staf.";
      return;
    }
    auth.setLogin(result);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : `/${result.user.role === "ADMIN" ? "admin" : "teacher"}/dashboard`;
    await router.replace(redirect);
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "Login tidak dapat diproses.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card card" aria-labelledby="staff-login-title">
      <p class="eyebrow">GezyCBT · Staff</p>
      <h1 id="staff-login-title">Masuk ke ruang kerja</h1>
      <p class="muted">Gunakan akun admin atau guru yang diberikan sekolah.</p>
      <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
      <form @submit.prevent="submit">
        <div class="form-row">
          <label for="staff-username">Username</label>
          <input id="staff-username" v-model="username" autocomplete="username" required :disabled="loading" />
        </div>
        <div class="form-row">
          <label for="staff-password">Password</label>
          <div class="password-field">
            <input id="staff-password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" required :disabled="loading" />
            <button type="button" class="btn-quiet" :aria-label="showPassword ? 'Sembunyikan password' : 'Tampilkan password'" @click="showPassword = !showPassword">{{ showPassword ? "Sembunyikan" : "Lihat" }}</button>
          </div>
        </div>
        <button class="btn-primary full-width" type="submit" :disabled="loading">{{ loading ? "Memeriksa…" : "Masuk" }}</button>
      </form>
      <p class="auth-foot muted">Sesi staf berakhir setelah idle timeout untuk melindungi data sekolah.</p>
    </section>
  </main>
</template>

<style scoped>
.auth-page { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; }
.auth-card { width: min(440px, 100%); padding: 28px; }
.auth-card h1 { margin: 4px 0 8px; }
.eyebrow { margin: 0; color: var(--primary); font-weight: 700; }
.password-field { display: flex; gap: 8px; }
.password-field input { flex: 1; }
.full-width { width: 100%; }
.auth-foot { margin: 20px 0 0; font-size: .875rem; }
</style>
