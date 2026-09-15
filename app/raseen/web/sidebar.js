/* Shared chrome for every Raseen page: the top bar and the left rail.

   There are three places to be: the Kingdom, and the plant's two views. The rail is the
   only place those three links exist. The Plant page used to repeat "Supervisory /
   Gradient Control" as a tab strip inside itself while the rail carried the same two
   choices — two controls for one decision. Now the rail nests the plant's views under a
   heading that is a label rather than a fourth button, and the page listens for the hash.

   Links must work both on the live server (routes /kingdom, /plant, /control) and on the
   static GitHub Pages build, where the pages are files (kingdom.html, …) served under a
   project sub-path. In static mode we use relative *.html links so they resolve against
   whatever base path the site is hosted at. */
(function () {
  const STATIC = window.RASEEN && window.RASEEN.static;
  const href = (name) => (STATIC ? name + ".html" : "/" + name);
  const base = (document.currentScript && document.currentScript.src || "").replace(/sidebar\.js.*$/, "");

  /* page: the file/route. hash: which view of that page. alias: another route this item owns. */
  const LINKS = [
    { key: "kingdom", page: "kingdom", icon: "◎", label: "Kingdom" },
    { group: "Plant — Humaij" },
    { key: "overview", page: "plant", hash: "", icon: "▦", label: "Overview", sub: true },
    { key: "gradient", page: "plant", hash: "#gradient", alias: "control", icon: "◐", label: "Gradient control", sub: true },
  ];

  const file = location.pathname.split("/").pop() || "";
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const onPage = (page) =>
    STATIC
      ? file === page + ".html" || (page === "kingdom" && (file === "" || file === "index.html"))
      : path === "/" + page || (page === "kingdom" && path === "/");

  const isActive = (t) => {
    // The standalone /control page still exists; the Gradient control item owns it.
    if (t.alias && onPage(t.alias)) return true;
    if (!onPage(t.page)) return false;
    if (t.hash === undefined) return true;
    return t.hash ? location.hash === "#gradient" : location.hash !== "#gradient";
  };

  // ── top bar ─────────────────────────────────────────────────────────────
  const banner = document.createElement("header");
  banner.className = "rs-banner-bar";
  banner.innerHTML =
    '<a class="bb-logo" href="' + href("kingdom") + '">' +
    '<img src="' + base + 'logo-white.svg" alt="Raseen">' +
    "<span>Block gradient control</span></a>" +
    '<span class="bb-spacer"></span>' +
    '<span class="bb-plant">Reference plant <b>Humaij</b>, 3 000 MW</span>' +
    '<span class="bb-chip" title="Nothing on this page is measured data"><i></i>Simulation</span>';
  document.body.prepend(banner);

  // ── left rail ───────────────────────────────────────────────────────────
  const link = (t) =>
    '<a class="rs-nav' + (isActive(t) ? " is-active" : "") + '" data-rs-tab="' + t.key + '"' +
    ' href="' + href(t.page) + (t.hash || "") + '">' +
    '<span class="rs-nav-icon">' + t.icon + "</span>" +
    '<span class="rs-nav-label">' + t.label + "</span></a>";

  const top = LINKS.filter((t) => !t.group && !t.sub).map(link).join("");
  const heading = LINKS.find((t) => t.group);
  const subs = LINKS.filter((t) => t.sub).map(link).join("");

  const nav = document.createElement("nav");
  nav.className = "rs-sidebar";
  nav.setAttribute("aria-label", "Pages");
  nav.innerHTML =
    top +
    '<h2 class="rs-nav-group">' + heading.group + "</h2>" +
    '<div class="rs-subnav">' + subs + "</div>" +
    '<div class="rs-sidebar-foot">' +
    '<span class="rs-chip"><span class="rs-chip-dot"></span>Simulated</span>' +
    '<span class="rs-ver">No SCADA connected</span></div>';
  document.body.prepend(nav);
  document.documentElement.classList.add("rs-has-sidebar");

  // The two plant views share a URL, so re-resolve the active item when the hash moves.
  window.addEventListener("hashchange", function () {
    for (const a of nav.querySelectorAll(".rs-nav")) {
      const t = LINKS.find((x) => x.key === a.dataset.rsTab);
      if (t) a.classList.toggle("is-active", isActive(t));
    }
  });
})();
