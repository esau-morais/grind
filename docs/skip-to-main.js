(() => {
  const LINK_ID = "skip-to-main-link";
  const CONTENT_ID = "content-area";

  const injectLink = () => {
    if (document.getElementById(LINK_ID)) return;
    const link = document.createElement("a");
    link.id = LINK_ID;
    link.href = `#${CONTENT_ID}`;
    link.textContent = "Skip to main content";
    link.addEventListener("click", (e) => {
      const target = document.getElementById(CONTENT_ID);
      if (!target) return;
      e.preventDefault();
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
    document.body.insertBefore(link, document.body.firstChild);
  };

  const observer = new MutationObserver(injectLink);

  const init = () => {
    injectLink();
    observer.observe(document.body, { childList: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
