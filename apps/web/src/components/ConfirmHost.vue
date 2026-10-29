<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  confirmRequest,
  dismissToast,
  resolveConfirm,
  toasts,
} from "../lib/confirm";
import { useEscapeClose, useFocusTrap } from "../lib/dialog-a11y";

const dialogRef = ref<HTMLElement | null>(null);
const request = computed(() => confirmRequest.value);
const active = computed(() => request.value !== null);

useEscapeClose(active, () => resolveConfirm(false));
useFocusTrap(active, dialogRef);

const timers = new Map<number, ReturnType<typeof setTimeout>>();
watch(
  toasts,
  (items) => {
    for (const item of items) {
      if (timers.has(item.id)) continue;
      timers.set(
        item.id,
        setTimeout(() => dismissToast(item.id), 8000),
      );
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
});
</script>

<template>
  <div
    v-if="request"
    ref="dialogRef"
    class="confirm-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="confirm-dialog-title"
    @click.self="resolveConfirm(false)"
  >
    <section class="card confirm-dialog" tabindex="-1">
      <h2 id="confirm-dialog-title">{{ request.title }}</h2>
      <p class="confirm-message">{{ request.message }}</p>
      <div class="dialog-actions">
        <button class="btn-secondary" type="button" @click="resolveConfirm(false)">
          {{ request.cancelLabel }}
        </button>
        <button
          :class="request.danger ? 'btn-danger' : 'btn-primary'"
          type="button"
          @click="resolveConfirm(true)"
        >
          {{ request.confirmLabel }}
        </button>
      </div>
    </section>
  </div>
  <div class="toast-stack" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast"
      :class="`toast-${toast.tone}`"
      :role="toast.tone === 'error' ? 'alert' : 'status'"
    >
      <span class="toast-message">{{ toast.message }}</span>
      <button
        class="btn-quiet toast-close"
        type="button"
        aria-label="Tutup pemberitahuan"
        @click="dismissToast(toast.id)"
      >
        Tutup
      </button>
    </div>
  </div>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 25;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(2 6 23 / 60%);
}
.confirm-dialog {
  width: min(480px, 100%);
  padding: 24px;
}
.confirm-dialog h2 {
  margin-top: 0;
}
.confirm-message {
  white-space: pre-line;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.toast-stack {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 30;
  display: grid;
  gap: 8px;
  width: min(420px, calc(100vw - 32px));
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow);
}
.toast-success {
  color: var(--success);
  background: var(--success-soft);
}
.toast-info {
  color: var(--info);
  background: var(--info-soft);
}
.toast-error {
  color: var(--danger);
  background: var(--danger-soft);
}
.toast-message {
  flex: 1;
}
.toast-close {
  min-height: 36px;
  flex-shrink: 0;
}
</style>
