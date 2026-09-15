/* The opening title card. Loaded from the document head — before the body exists — so the
   mark is on screen from the first paint rather than appearing over a half-drawn page.

   It plays on every load, refresh included: the mark eases in, holds, and fades out over
   about two and a half seconds — a title card, not a loading spinner. Styles and the
   durations of the transitions live in shell.css; the hold is set here.

   Being the first script on every page, it is also where the theme is applied: a stored
   choice goes onto the root element before the stylesheet is read, so a dark page never
   flashes light first. With nothing stored the root is left alone and the system preference
   decides, through the media query in shell.css. */
(function () {
  try {
    var theme = localStorage.getItem("rs-theme");
    if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  } catch (e) {
    /* private mode: the system preference decides */
  }
  var base = (document.currentScript && document.currentScript.src || "").replace(/splash\.js.*$/, "");
  var el = document.createElement("div");
  el.id = "rs-splash";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = '<img src="' + base + 'logo.svg" alt="">';
  document.documentElement.appendChild(el);

  var reduced = false;
  try { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* older browsers */ }
  // Ease in over 0.6 s, hold, fade out over 0.8 s (see shell.css); reduced motion cuts it short.
  var hold = reduced ? 400 : 1700;
  requestAnimationFrame(function () { el.classList.add("in"); });
  setTimeout(function () { el.classList.add("out"); }, hold);
  setTimeout(function () { el.remove(); }, hold + (reduced ? 20 : 820));
})();
