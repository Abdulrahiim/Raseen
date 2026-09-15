/* Shared left sidebar for every Raseen page. Injected as a fixed column; the page body is
   offset by CSS in shell.css. Pure vanilla, no dependencies, safe to include anywhere. */
(function () {
  const TABS = [
    { href: "/kingdom", icon: "◎", label: "Kingdom", match: ["/kingdom", "/"] },
    { href: "/plant", icon: "▦", label: "Plant", match: ["/plant"] },
    { href: "/control", icon: "◐", label: "Gradient Control", match: ["/control"] },
  ];
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const nav = document.createElement("nav");
  nav.className = "rs-sidebar";
  nav.setAttribute("aria-label", "Pages");
  nav.innerHTML =
    '<a class="rs-brand" href="/kingdom">' +
    '<span class="rs-brand-mark" aria-hidden="true"></span>' +
    '<span class="rs-brand-text"><b>Raseen</b><small>رَصين</small></span></a>' +
    TABS.map((t) => {
      const active = t.match.includes(path) ? " is-active" : "";
      return (
        '<a class="rs-nav' + active + '" href="' + t.href + '">' +
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
