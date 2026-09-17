(function () {
  const key = "gezycbt-theme";
  const saved = localStorage.getItem(key);
  const theme = saved === "light" || saved === "dark" ? saved : "system";
  const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
})();
