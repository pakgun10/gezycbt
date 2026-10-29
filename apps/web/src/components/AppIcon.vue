<script setup lang="ts">
export type IconName =
  | "home"
  | "users"
  | "academic"
  | "teacher"
  | "questions"
  | "exams"
  | "schedules"
  | "monitoring"
  | "results"
  | "exports"
  | "audit"
  | "backup"
  | "integrations"
  | "search"
  | "menu"
  | "close"
  | "flag"
  | "check"
  | "chevron-left"
  | "chevron-right";

defineProps<{ readonly name: IconName }>();
</script>

<template>
  <svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <g v-if="name === 'home'">
      <path d="M3 11 L12 3 L21 11" />
      <path d="M5 10 V21 H19 V10" />
      <path d="M9 21 V15 H15 V21" />
    </g>
    <g v-if="name === 'users'">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 19 C3 16 6 15 9 15 C12 15 15 16 15 19" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.5 C18.5 15 20 16.5 20 19" />
    </g>
    <g v-if="name === 'academic'">
      <path d="M4 7 C7 5 10 5 12 7 C14 5 17 5 20 7 V17 C17 15 14 15 12 17 C10 15 7 15 4 17 Z" />
      <path d="M12 7 V17" />
    </g>
    <g v-if="name === 'teacher'">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20 C5 16.5 8 15 12 15 C16 15 19 16.5 19 20" />
    </g>
    <g v-if="name === 'questions'">
      <path d="M7 3 H15 L20 8 V21 H7 Z" />
      <path d="M12 9 V13" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </g>
    <g v-if="name === 'exams'">
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 13 L11 15 L15 11" />
    </g>
    <g v-if="name === 'schedules'">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7 V12 L15 14" />
    </g>
    <g v-if="name === 'monitoring'">
      <path d="M2 12 C6 6 10 5 12 5 C14 5 18 6 22 12 C18 18 14 19 12 19 C10 19 6 18 2 12 Z" />
      <circle cx="12" cy="12" r="3" />
    </g>
    <g v-if="name === 'results'">
      <path d="M5 20 V11" />
      <path d="M11 20 V5" />
      <path d="M17 20 V14" />
      <path d="M3 20 H21" />
    </g>
    <g v-if="name === 'exports'">
      <path d="M12 3 V15" />
      <path d="M7 10 L12 15 L17 10" />
      <path d="M4 20 H20" />
    </g>
    <g v-if="name === 'audit'">
      <circle cx="5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 6 H20" />
      <path d="M9 12 H20" />
      <path d="M9 18 H20" />
    </g>
    <g v-if="name === 'backup'">
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9 V20 H19 V9" />
      <path d="M10 13 H14" />
    </g>
    <g v-if="name === 'integrations'">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8 7 L10.5 15.5" />
      <path d="M16 7 L13.5 15.5" />
      <path d="M8.5 6 H15.5" />
    </g>
    <g v-if="name === 'search'">
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16 L21 21" />
    </g>
    <g v-if="name === 'menu'">
      <path d="M4 6 H20" />
      <path d="M4 12 H20" />
      <path d="M4 18 H20" />
    </g>
    <g v-if="name === 'close'">
      <path d="M6 6 L18 18" />
      <path d="M18 6 L6 18" />
    </g>
    <g v-if="name === 'flag'">
      <path d="M6 21 V4" />
      <path d="M6 4 C9 2 12 5 18 4 V14 C12 15 9 12 6 14" />
    </g>
    <g v-if="name === 'check'">
      <path d="M5 12 L10 17 L19 7" />
    </g>
    <g v-if="name === 'chevron-left'">
      <path d="M14 6 L8 12 L14 18" />
    </g>
    <g v-if="name === 'chevron-right'">
      <path d="M10 6 L16 12 L10 18" />
    </g>
  </svg>
</template>

<style scoped>
.app-icon {
  width: 1.15em;
  height: 1.15em;
  flex: none;
}
</style>
