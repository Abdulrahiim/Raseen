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
  const TABS = [
    { name: "kingdom", icon: "◎", label: "Kingdom" },
    { name: "plant", icon: "▦", label: "Plant" },
    { name: "control", icon: "◐", label: "Gradient Control" },
  ];
  const file = location.pathname.split("/").pop() || "";
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const isActive = (name) =>
    STATIC
      ? file === name + ".html" || (name === "kingdom" && (file === "" || file === "index.html"))
      : path === "/" + name || (name === "kingdom" && path === "/");

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
      const active = isActive(t.name) ? " is-active" : "";
      return (
        '<a class="rs-nav' + active + '" href="' + href(t.name) + '">' +
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
})();
