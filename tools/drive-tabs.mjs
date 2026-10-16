/**
 * For the drives written before a page's parts became tabs: show every
 * part at once, as the page looked when they were written, so they keep
 * testing what they test — the domain — rather than which tab is open.
 * The tabs themselves are driven in tools/drive-ui-sections.mjs.
 */
export async function showAllTabs(page) {
  await page.addInitScript(() => {
    const css = ".ptab-panel > [data-tab-hidden]{display:revert !important}";
    const add = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
    if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
  });
}
