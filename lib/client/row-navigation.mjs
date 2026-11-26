export function rowNavigation(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return 0;
  if (event.key === "ArrowDown" || event.key === "PageDown") return 1;
  if (event.key === "ArrowUp" || event.key === "PageUp") return -1;
  return 0;
}
