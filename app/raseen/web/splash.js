/* The opening title card. Loaded from the document head — before the body exists — so the
   mark is on screen from the first paint rather than appearing over a half-drawn page.

   It runs once per browsing session: a title card, not a loading spinner. Navigating
   between Kingdom and Plant should not replay it. Styles live in shell.css. */
(function () {
  try {
    if (sessionStorage.getItem("rs-splash") === "seen") return;
    sessionStorage.setItem("rs-splash", "seen");
  } catch (e) {
    /* private mode: show it, once, and move on */
  }
  var base = (document.currentScript && document.currentScript.src || "").replace(/splash\.js.*$/, "");
  var el = document.createElement("div");
  el.id = "rs-splash";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = '<img src="' + base + 'logo.svg" alt="">';
  document.documentElement.appendChild(el);

  var reduced = false;
  try { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* older browsers */ }
  var hold = reduced ? 260 : 700;
  requestAnimationFrame(function () { el.classList.add("in"); });
  setTimeout(function () { el.classList.add("out"); }, hold);
  setTimeout(function () { el.remove(); }, hold + (reduced ? 20 : 260));
})();
