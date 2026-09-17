<script setup lang="ts">
import type { ExamSaveState } from "../features/exam/session-controller";

const props = defineProps<{ readonly state: ExamSaveState }>();
const labels: Record<ExamSaveState, string> = {
  READY: "Tersimpan",
  DIRTY: "Belum tersimpan",
  SAVING: "Menyimpan…",
  OFFLINE_DIRTY: "Offline — tersimpan di perangkat",
  CONFLICT: "Perlu sinkronisasi",
  FINALIZING: "Mengumpulkan ujian…",
  ENDED: "Sesi diakhiri",
};
</script>

<template>
  <span class="save-status" :class="`status-${props.state.toLowerCase()}`" :aria-label="labels[props.state]" aria-live="polite">
    <span aria-hidden="true">{{ props.state === "READY" ? "✓" : props.state === "SAVING" || props.state === "FINALIZING" ? "…" : "●" }}</span>
    {{ labels[props.state] }}
  </span>
</template>

<style scoped>
.save-status { display: inline-flex; align-items: center; gap: 6px; font-size: .875rem; font-weight: 600; }
.status-ready { color: var(--success); }
.status-dirty, .status-saving { color: var(--warning); }
.status-offline_dirty, .status-conflict, .status-finalizing { color: var(--danger); }
.status-ended { color: var(--muted); }
</style>
