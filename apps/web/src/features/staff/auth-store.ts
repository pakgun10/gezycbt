import { computed, ref } from "vue";
import type { StaffLoginResponse, StaffUser } from "./types";

const user = ref<StaffUser | null>(null);
const csrfToken = ref<string | undefined>();
const expiresAt = ref<string | undefined>();

export function useStaffAuth() {
  function setLogin(result: StaffLoginResponse): void {
    user.value = result.user;
    csrfToken.value = result.csrfToken;
    expiresAt.value = result.expiresAt;
  }
  function clear(): void {
    user.value = null;
    csrfToken.value = undefined;
    expiresAt.value = undefined;
  }
  return {
    user: computed(() => user.value),
    csrfToken: computed(() => csrfToken.value),
    expiresAt: computed(() => expiresAt.value),
    setLogin,
    clear,
  };
}
