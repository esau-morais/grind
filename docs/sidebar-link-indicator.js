(() => {
  const CONTAINER_SELECTOR = "#sidebar-content";
  const ACTIVE_LINK_SELECTOR = "#navigation-items a.border-primary";
  const INDICATOR_CLASS = "sidebar-link-indicator";
  const READY_CLASS = "sidebar-link-indicator-ready";
  const NO_TRANSITION_CLASS = "sidebar-link-indicator-instant";

  let lastX = null;
  let lastY = null;
  let lastHeight = null;
  let lastGroup = null;

  const observers = new Map();

  const ensureIndicator = (container) => {
    let el = container.querySelector(`:scope > .${INDICATOR_CLASS}`);
    if (!el) {
      el = document.createElement("div");
      el.className = INDICATOR_CLASS;
      container.appendChild(el);
    }
    return el;
  };

  const updateIndicator = (container) => {
    ensureIndicator(container);

    const activeLink =
      container.querySelector(ACTIVE_LINK_SELECTOR.replace("#navigation-items ", "")) ??
      document.querySelector(ACTIVE_LINK_SELECTOR);
    if (!activeLink) {
      container.classList.remove(READY_CLASS);
      return;
    }

    const group = activeLink.closest(".sidebar-group");
    const crossGroup = lastGroup !== null && group !== lastGroup;

    const cRect = container.getBoundingClientRect();
    const lRect = activeLink.getBoundingClientRect();
    const x = lRect.left - cRect.left;
    const y = lRect.top - cRect.top + container.scrollTop;
    const h = lRect.height;

    if (crossGroup) {
      container.classList.add(NO_TRANSITION_CLASS);
    }

    container.style.setProperty("--sidebar-indicator-x", `${x}px`);
    container.style.setProperty("--sidebar-indicator-y", `${y}px`);
    container.style.setProperty("--sidebar-indicator-height", `${h}px`);
    container.classList.add(READY_CLASS);

    if (crossGroup) {
      requestAnimationFrame(() => container.classList.remove(NO_TRANSITION_CLASS));
    }

    lastX = x;
    lastY = y;
    lastHeight = h;
    lastGroup = group;
  };

  const setupContainer = (container) => {
    if (observers.has(container)) return;

    ensureIndicator(container);

    if (lastY !== null) {
      container.style.setProperty("--sidebar-indicator-x", `${lastX}px`);
      container.style.setProperty("--sidebar-indicator-y", `${lastY}px`);
      container.style.setProperty("--sidebar-indicator-height", `${lastHeight}px`);
      container.classList.add(READY_CLASS);
    }

    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => updateIndicator(container));
    });
    observer.observe(container, { subtree: true, attributes: true, attributeFilter: ["class"] });
    observers.set(container, observer);

    requestAnimationFrame(() => updateIndicator(container));
  };

  const setup = () => {
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (container) setupContainer(container);
  };

  const rootObserver = new MutationObserver(setup);

  const onResize = () => {
    observers.forEach((_, c) => requestAnimationFrame(() => updateIndicator(c)));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setup();
      rootObserver.observe(document.body, { childList: true, subtree: true });
    });
  } else {
    setup();
    rootObserver.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("resize", onResize);
  void document.fonts?.ready?.then(onResize, () => {});
})();
