<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import ThemeToggle from "./ThemeToggle.vue";
import { HttpParticipantApi } from "../features/participant/api";
import { useParticipantAuth } from "../features/participant/auth-store";
import { participantOutbox } from "../features/exam/outbox";

defineProps<{
  readonly title?: string | undefined;
  readonly compact?: boolean;
}>();

const api = new HttpParticipantApi();
const auth = useParticipantAuth();
const router = useRouter();
const loggingOut = ref(false);

async function logout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await api.logout(auth.csrfToken.value);
  } catch {
    // Clear the local auth state even when the network is unavailable. The
    // server session will expire/revoke independently, while this prevents a
    // stale participant UI from remaining visible.
  } finally {
    // Explicit account logout is the privacy boundary for browser-persisted
    // exam data. Auth-expiry recovery does not call this path and therefore
    // still keeps the outbox for the same participant to resume.
    await participantOutbox.clearAll().catch(() => undefined);
    auth.clear();
    loggingOut.value = false;
    await router.replace("/participant/login");
  }
}
</script>

<template>
  <header class="participant-header">
    <a class="brand" href="/participant/schedules" aria-label="GezyCBT, beranda peserta">GezyCBT</a>
    <span v-if="title" class="title">{{ title }}</span>
    <div class="header-actions">
      <ThemeToggle />
      <button v-if="auth.user.value" class="logout-button" type="button" :disabled="loggingOut" @click="logout">
        {{ loggingOut ? "Keluar…" : "Keluar" }}
      </button>
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.participant-header { min-height: 56px; display: flex; align-items: center; gap: 16px; padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--surface); }
.brand { color: var(--text); font-size: 1.125rem; font-weight: 700; text-decoration: none; }
.title { overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
.header-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.logout-button { min-height: 40px; padding: 8px 12px; border: 1px solid var(--border-strong); border-radius: 8px; color: var(--text); background: transparent; cursor: pointer; }
.logout-button:hover { background: var(--surface-elevated); }
.logout-button:disabled { cursor: wait; opacity: .7; }
</style>
