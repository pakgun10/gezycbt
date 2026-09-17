<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import StaffLayout from "../components/StaffLayout.vue";
import StaffDashboardView from "./StaffDashboardView.vue";
import AdminUsersView from "./AdminUsersView.vue";
import AcademicView from "./AcademicView.vue";
import QuestionsView from "./QuestionsView.vue";
import ExamsView from "./ExamsView.vue";
import SchedulesView from "./SchedulesView.vue";
import MonitoringView from "./MonitoringView.vue";
import ResultsView from "./ResultsView.vue";
import ExportsView from "./ExportsView.vue";
import AuditView from "./AuditView.vue";

const route = useRoute();
const path = computed(() => route.path);
const page = computed(() => {
  if (path.value.endsWith("/users")) return AdminUsersView;
  if (path.value.endsWith("/academic")) return AcademicView;
  if (path.value.includes("/questions")) return QuestionsView;
  if (path.value.includes("/exams")) return ExamsView;
  if (path.value.includes("/schedules")) return SchedulesView;
  if (path.value.includes("/monitoring")) return MonitoringView;
  if (path.value.includes("/results")) return ResultsView;
  if (path.value.includes("/exports")) return ExportsView;
  if (path.value.endsWith("/audit")) return AuditView;
  return StaffDashboardView;
});
const title = computed(() => path.value.startsWith("/admin") ? "Admin" : "Guru");
</script>

<template>
  <StaffLayout :title="title" :area="title"><component :is="page" /></StaffLayout>
</template>
