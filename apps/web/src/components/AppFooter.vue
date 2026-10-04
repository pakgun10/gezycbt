<script setup lang="ts">
import { APP_VERSION } from "../lib/app-version";
</script>

<template>
  <footer class="app-footer" aria-label="Informasi aplikasi">
    <span class="app-footer__copyright">
      © 2026 GezyTech. CBT-App. Dikembangkan oleh PakGun.
    </span>
    <span class="app-footer__version">Versi {{ APP_VERSION }}</span>
  </footer>
</template>

<style scoped>
.app-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  width: 100%;
  padding: 16px clamp(16px, 4vw, 48px);
  border-top: 1px solid var(--border);
  color: var(--muted);
  background: var(--surface);
  font-size: 0.8rem;
}

.app-footer__copyright {
  justify-self: start;
}

.app-footer__version {
  justify-self: end;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .app-footer {
    grid-template-columns: 1fr;
    align-items: start;
    gap: 6px;
  }

  .app-footer__version {
    justify-self: start;
  }
}
</style>
