/* Shared chrome for every Raseen page: a full-width purple banner across the top and a
   lavender rail of pill buttons down the left. Injected as fixed elements; the page body is
   offset by CSS in shell.css. Pure vanilla, no dependencies, safe to include anywhere.

   Links must work both on the live server (routes /kingdom, /plant, /control) and on the
   static GitHub Pages / Vercel build, where the pages are files (kingdom.html, …) served
   under a project sub-path. In static mode we use relative *.html links so they resolve
   against whatever base path the site is hosted at. */
(function () {
  const STATIC = window.RASEEN && window.RASEEN.static;
  const href = (name) => (STATIC ? name + ".html" : "/" + name);
  /* Gradient Control lives inside the Plant page, so its tab deep-links to plant#gradient
     and the two tabs share a pathname — the hash decides which one reads as active. */
  const TABS = [
    { name: "kingdom", icon: "◎", label: "Kingdom" },
    { name: "plant", icon: "▦", label: "Plant" },
    { name: "control", icon: "◐", label: "Gradient Control", page: "plant", hash: "#gradient" },
  ];
  const file = location.pathname.split("/").pop() || "";
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const onPage = (page) =>
    STATIC
      ? file === page + ".html" || (page === "kingdom" && (file === "" || file === "index.html"))
      : path === "/" + page || (page === "kingdom" && path === "/");
  const isActive = (t) => {
    const page = t.page || t.name;
    if (!onPage(page)) return false;
    if (page !== "plant") return true;
    return t.hash ? location.hash === "#gradient" : location.hash !== "#gradient";
  };

  // ── banner ──────────────────────────────────────────────────────────────
  const banner = document.createElement("header");
  banner.className = "rs-banner-bar";
  banner.innerHTML =
    '<a class="bb-logo" href="' + href("kingdom") + '">' +
    '<span class="bb-mark" aria-hidden="true"></span>' +
    "<span><b>Raseen رَصين</b><br><small>Block Gradient Control</small></span></a>" +
    "<h1>Grid Operations Dashboard</h1>" +
    '<span class="bb-chip"><i></i>LIVE SIM</span>';
  document.body.prepend(banner);

  // ── sidebar ─────────────────────────────────────────────────────────────
  const nav = document.createElement("nav");
  nav.className = "rs-sidebar";
  nav.setAttribute("aria-label", "Pages");
  nav.innerHTML =
    TABS.map((t) => {
      const active = isActive(t) ? " is-active" : "";
      return (
        '<a class="rs-nav' + active + '" data-rs-tab="' + t.name + '" href="' +
        href(t.page || t.name) + (t.hash || "") + '">' +
        '<span class="rs-nav-icon">' + t.icon + "</span>" +
        '<span class="rs-nav-label">' + t.label + "</span></a>"
      );
    }).join("") +
    '<div class="rs-sidebar-foot">' +
    '<div class="rs-social" aria-hidden="true">' +
    '<a href="#" title="Overview">in</a>' +
    '<a href="#" title="Share">f</a>' +
    '<a href="#" title="Contact">@</a></div>' +
    '<span class="rs-chip"><span class="rs-chip-dot"></span>SIM</span>' +
    '<span class="rs-ver">no measured data</span></div>';
  document.body.prepend(nav);
  document.documentElement.classList.add("rs-has-sidebar");

  // Plant and Gradient Control share a URL, so re-resolve the active pill when the hash moves.
  window.addEventListener("hashchange", function () {
    for (const a of nav.querySelectorAll(".rs-nav")) {
      const t = TABS.find((x) => x.name === a.dataset.rsTab);
      if (t) a.classList.toggle("is-active", isActive(t));
    }
  });
})();
