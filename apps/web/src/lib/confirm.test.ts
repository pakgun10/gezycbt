import { describe, expect, test } from "bun:test";
import {
  confirmRequest,
  dismissToast,
  requestConfirm,
  resolveConfirm,
  showToast,
  toasts,
} from "./confirm";

describe("confirm service", () => {
  test("resolves true when confirmed and clears the request", async () => {
    const promise = requestConfirm({
      title: "Hapus?",
      message: "Tindakan ini tidak dapat dibatalkan.",
      danger: true,
    });
    expect(confirmRequest.value?.title).toBe("Hapus?");
    expect(confirmRequest.value?.danger).toBe(true);
    resolveConfirm(true);
    await expect(promise).resolves.toBe(true);
    expect(confirmRequest.value).toBeNull();
  });

  test("a new request cancels the pending one instead of stacking", async () => {
    const first = requestConfirm({ title: "Pertama", message: "Satu" });
    const second = requestConfirm({ title: "Kedua", message: "Dua" });
    await expect(first).resolves.toBe(false);
    expect(confirmRequest.value?.title).toBe("Kedua");
    resolveConfirm(false);
    await expect(second).resolves.toBe(false);
  });

  test("toasts can be added and dismissed individually", () => {
    const before = toasts.value.length;
    const id = showToast("Password berhasil direset.", "success");
    expect(toasts.value.length).toBe(before + 1);
    expect(toasts.value[toasts.value.length - 1]?.message).toBe(
      "Password berhasil direset.",
    );
    dismissToast(id);
    expect(toasts.value.some((toast) => toast.id === id)).toBe(false);
  });
});
