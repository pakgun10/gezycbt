import { createRouter, type RouterHistory } from "vue-router";

const AreaView = () => import("./views/AreaView.vue");
const NotFoundView = () => import("./views/NotFoundView.vue");

export function createGezyRouter(history: RouterHistory) {
  return createRouter({
    history,
    routes: [
      {
        path: "/admin/:pathMatch(.*)*",
        name: "admin",
        component: AreaView,
        meta: { area: "Admin" },
      },
      {
        path: "/teacher/:pathMatch(.*)*",
        name: "teacher",
        component: AreaView,
        meta: { area: "Guru" },
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
}
