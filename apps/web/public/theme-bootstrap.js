(() => {
  try {
    const preference = localStorage.getItem("gezycbt-theme") || "system";
    const dark = preference === "dark" ||
      (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
