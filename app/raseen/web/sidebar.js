/* Shared left sidebar for every Raseen page. Injected as a fixed column; the page body is
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
  const nav = document.createElement("nav");
  nav.className = "rs-sidebar";
  nav.setAttribute("aria-label", "Pages");
  nav.innerHTML =
    '<a class="rs-brand" href="' + href("kingdom") + '">' +
    '<span class="rs-brand-mark" aria-hidden="true"></span>' +
    '<span class="rs-brand-text"><b>Raseen</b><small>رَصين</small></span></a>' +
    TABS.map((t) => {
      const active = isActive(t.name) ? " is-active" : "";
      return (
        '<a class="rs-nav' + active + '" href="' + href(t.name) + '">' +
        '<span class="rs-nav-icon">' + t.icon + "</span>" +
        '<span class="rs-nav-label">' + t.label + "</span></a>"
      );
    }).join("") +
    '<div class="rs-sidebar-foot">' +
    '<span class="rs-chip"><span class="rs-chip-dot"></span>SIM</span>' +
    '<span class="rs-ver">no measured data</span></div>';
  document.body.prepend(nav);
  document.documentElement.classList.add("rs-has-sidebar");
})();
