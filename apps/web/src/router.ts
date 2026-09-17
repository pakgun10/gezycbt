import { createRouter, type RouterHistory } from "vue-router";
import { useParticipantAuth } from "./features/participant/auth-store";
import { useStaffAuth } from "./features/staff/auth-store";

const AreaView = () => import("./views/AreaView.vue");
const NotFoundView = () => import("./views/NotFoundView.vue");
const ParticipantLoginView = () => import("./views/ParticipantLoginView.vue");
const ParticipantDashboardView = () =>
  import("./views/ParticipantDashboardView.vue");
const PracticeTokenView = () => import("./views/PracticeTokenView.vue");
const PracticeIdentityView = () => import("./views/PracticeIdentityView.vue");
const PreExamView = () => import("./views/PreExamView.vue");
const ExamView = () => import("./views/ExamView.vue");
const ResultView = () => import("./views/ResultView.vue");
const StaffLoginView = () => import("./views/StaffLoginView.vue");
const StaffAreaView = () => import("./views/StaffAreaView.vue");
const ForbiddenView = () => import("./views/ForbiddenView.vue");

export function createGezyRouter(history: RouterHistory) {
  const router = createRouter({
    history,
    routes: [
      { path: "/", redirect: "/participant/login" },
      {
        path: "/staff/login",
        name: "staff-login",
        component: StaffLoginView,
        meta: { area: "Staff" },
      },
      {
        path: "/staff/forbidden",
        name: "staff-forbidden",
        component: ForbiddenView,
        meta: { area: "Staff" },
      },
      {
        path: "/admin/login",
        redirect: (to) => ({ name: "staff-login", query: to.query }),
      },
      {
        path: "/teacher/login",
        redirect: (to) => ({ name: "staff-login", query: to.query }),
      },
      {
        path: "/participant/login",
        name: "participant-login",
        component: ParticipantLoginView,
        meta: { area: "Peserta" },
      },
      {
        path: "/participant/schedules",
        name: "participant-dashboard",
        component: ParticipantDashboardView,
        meta: { area: "Peserta", requiresParticipant: true },
      },
      {
        path: "/participant/schedules/:id/pre-exam",
        name: "participant-pre-exam",
        component: PreExamView,
        meta: { area: "Peserta", requiresParticipant: true },
      },
      {
        path: "/participant/exam/:id",
        name: "participant-exam",
        component: ExamView,
        meta: { area: "Peserta", exam: true, requiresParticipant: true },
      },
      {
        path: "/participant/results/:id",
        name: "participant-result",
        component: ResultView,
        meta: { area: "Peserta", requiresParticipant: true },
      },
      {
        path: "/practice/token",
        name: "practice-token",
        component: PracticeTokenView,
        meta: { area: "Latihan" },
      },
      {
        path: "/practice/identity",
        name: "practice-identity",
        component: PracticeIdentityView,
        meta: { area: "Latihan" },
      },
      {
        path: "/practice/exam/:id",
        name: "practice-exam",
        component: ExamView,
        meta: { area: "Latihan", exam: true },
      },
      {
        path: "/practice/results/:id",
        name: "practice-result",
        component: ResultView,
        meta: { area: "Latihan" },
      },
      {
        path: "/admin/:pathMatch(.*)*",
        name: "admin",
        component: StaffAreaView,
        meta: { area: "Admin", requiresStaff: true, staffRole: "ADMIN" },
      },
      {
        path: "/teacher/:pathMatch(.*)*",
        name: "teacher",
        component: StaffAreaView,
        meta: { area: "Guru", requiresStaff: true, staffRole: "TEACHER" },
      },
      {
        path: "/participant/:pathMatch(.*)*",
        name: "participant",
        component: AreaView,
        meta: { area: "Peserta" },
      },
      {
        path: "/practice/:pathMatch(.*)*",
        name: "practice",
        component: AreaView,
        meta: { area: "Latihan" },
      },
      { path: "/:pathMatch(.*)*", name: "not-found", component: NotFoundView },
    ],
  });
  const auth = useParticipantAuth();
  const staffAuth = useStaffAuth();
  router.beforeEach((to) => {
    if (to.meta.requiresParticipant && !auth.user.value)
      return {
        name: "participant-login",
        query: { redirect: to.fullPath },
      };
    if (to.meta.requiresStaff) {
      const current = staffAuth.user.value;
      if (!current)
        return { name: "staff-login", query: { redirect: to.fullPath } };
      if (to.meta.staffRole === "ADMIN" && current.role !== "ADMIN")
        return { name: "staff-forbidden" };
    }
    return true;
  });
  return router;
}
