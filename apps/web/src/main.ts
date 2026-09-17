import { createApp } from "vue";
import { createWebHistory } from "vue-router";
import App from "./App.vue";
import { HttpParticipantApi } from "./features/participant/api";
import { useParticipantAuth } from "./features/participant/auth-store";
import { createGezyRouter } from "./router";
import "./styles.css";
import { HttpStaffApi } from "./features/staff/api";
import { useStaffAuth } from "./features/staff/auth-store";
import { applyTheme, initializeTheme, readThemePreference } from "./lib/theme";

initializeTheme();
const media = window.matchMedia("(prefers-color-scheme: dark)");
media.addEventListener("change", () => {
  if (readThemePreference() === "system") applyTheme("system");
});

async function bootstrap(): Promise<void> {
  const auth = useParticipantAuth();
  const staffAuth = useStaffAuth();
  if (window.location.pathname.startsWith("/participant/")) {
    try {
      auth.setLogin(await withTimeout(new HttpParticipantApi().me(), 3_000));
    } catch {
      auth.clear();
    }
  }
  if (
    window.location.pathname.startsWith("/admin/") ||
    window.location.pathname.startsWith("/teacher/")
  ) {
    try {
      staffAuth.setLogin(await withTimeout(new HttpStaffApi().me(), 3_000));
    } catch {
      staffAuth.clear();
    }
  }
  createApp(App).use(createGezyRouter(createWebHistory())).mount("#app");
}

void bootstrap();

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error("Authentication bootstrap timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
