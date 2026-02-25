(() => {
  const NAV_TABS_SELECTOR = ".nav-tabs";
  const ACTIVE_UNDERLINE_SELECTOR = ".nav-tabs-item > div.bg-primary";
  const UNDERLINE_CLASS = "nav-tabs-underline";
  const READY_CLASS = "nav-tabs-underline-ready";

  // Module-level last position — survives nav-tabs DOM remounts
  let lastX = null;
  let lastWidth = null;

  const observers = new Map();

  const ensureUnderline = (tabs) => {
    let underline = tabs.querySelector(`.${UNDERLINE_CLASS}`);
    if (!underline) {
      underline = document.createElement("div");
      underline.className = UNDERLINE_CLASS;
      tabs.appendChild(underline);
    }
    return underline;
  };

  const getActiveTab = (tabs) => {
    const el = tabs.querySelector(ACTIVE_UNDERLINE_SELECTOR);
    return el?.closest(".nav-tabs-item") ?? null;
  };

  const updateUnderline = (tabs) => {
    ensureUnderline(tabs);

    const activeTab = getActiveTab(tabs);
    if (!activeTab) {
      tabs.classList.remove(READY_CLASS);
      return;
    }

    const navRect = tabs.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    const left = tabRect.left - navRect.left;

    tabs.style.setProperty("--nav-tab-underline-x", `${left}px`);
    tabs.style.setProperty("--nav-tab-underline-width", `${tabRect.width}px`);
    tabs.classList.add(READY_CLASS);

    lastX = left;
    lastWidth = tabRect.width;
  };

  const setupNavTabs = (tabs) => {
    if (observers.has(tabs)) return;

    ensureUnderline(tabs);

    // Restore last known position synchronously so the CSS transition
    // animates from the previous tab, not from the default (0, 0).
    if (lastX !== null && lastWidth !== null) {
      tabs.style.setProperty("--nav-tab-underline-x", `${lastX}px`);
      tabs.style.setProperty("--nav-tab-underline-width", `${lastWidth}px`);
      tabs.classList.add(READY_CLASS);
    }

    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => updateUnderline(tabs));
    });
    observer.observe(tabs, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    observers.set(tabs, observer);

    // Update to actual active position in next frame so transition runs
    requestAnimationFrame(() => updateUnderline(tabs));
  };

  const setupAllNavTabs = () => {
    document.querySelectorAll(NAV_TABS_SELECTOR).forEach(setupNavTabs);
  };

  const rootObserver = new MutationObserver(setupAllNavTabs);

  const onResize = () => {
    observers.forEach((_, tabs) => requestAnimationFrame(() => updateUnderline(tabs)));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setupAllNavTabs();
      rootObserver.observe(document.body, { childList: true, subtree: true });
    });
  } else {
    setupAllNavTabs();
    rootObserver.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("resize", onResize);
  void document.fonts?.ready?.then(onResize, () => {});
})();
