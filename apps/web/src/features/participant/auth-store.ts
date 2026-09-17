import { computed, ref } from "vue";
import type { LoginResponse, ParticipantUser } from "./types";

const user = ref<ParticipantUser | null>(null);
const csrfToken = ref<string | undefined>();
const expiresAt = ref<string | undefined>();

export function useParticipantAuth() {
  function setLogin(result: LoginResponse): void {
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
