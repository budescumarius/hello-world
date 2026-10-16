(function () {
  "use strict";

  /* Mobile menu */
  var toggle = document.getElementById("menu-toggle");
  var nav = document.getElementById("main-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) toggle.click();
    });
  }

  /* Project filters */
  var chips = document.querySelectorAll(".filters .chip");
  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var f = chip.dataset.filter;
      chips.forEach(function (c) { c.setAttribute("aria-pressed", String(c === chip)); });
      document.querySelectorAll("#pgrid .pcard").forEach(function (card) {
        card.hidden = !!f && card.dataset.cat !== f;
      });
    });
  });

  /* Before / after slider */
  document.querySelectorAll(".ba").forEach(function (ba) {
    var range = ba.querySelector(".ba-range");
    var set = function (v) { ba.style.setProperty("--pos", v + "%"); };
    range.addEventListener("input", function () { set(range.value); });
  });

  /* Lightbox */
  var lb = document.getElementById("lightbox");
  if (lb) {
    var img = lb.querySelector("img");
    var cap = lb.querySelector("figcaption");
    var items = [];
    var idx = 0;
    var lastFocus = null;
    var show = function (i) {
      idx = (i + items.length) % items.length;
      img.src = items[idx].href;
      img.alt = items[idx].querySelector("img").alt;
      cap.textContent = items[idx].dataset.caption || "";
    };
    var close = function () {
      lb.hidden = true;
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus();
    };
    document.querySelectorAll("[data-gallery]").forEach(function (g) {
      var list = Array.prototype.slice.call(g.querySelectorAll(".gallery-item"));
      list.forEach(function (a, i) {
        a.addEventListener("click", function (e) {
          e.preventDefault();
          items = list;
          lastFocus = a;
          show(i);
          lb.hidden = false;
          document.body.style.overflow = "hidden";
          lb.querySelector(".lb-close").focus();
        });
      });
    });
    lb.querySelector(".lb-close").addEventListener("click", close);
    lb.querySelector(".lb-prev").addEventListener("click", function () { show(idx - 1); });
    lb.querySelector(".lb-next").addEventListener("click", function () { show(idx + 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
    document.addEventListener("keydown", function (e) {
      if (lb.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(idx - 1);
      if (e.key === "ArrowRight") show(idx + 1);
    });
    var startX = null;
    lb.addEventListener("touchstart", function (e) { startX = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
      startX = null;
    });
  }

  /* Analytics only after consent */
  var banner = document.getElementById("cookie");
  if (banner && window.GA_ID) {
    var choice = null;
    try { choice = localStorage.getItem("madibu-consent"); } catch (e) {}
    var loadGA = function () {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(window.GA_ID);
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", window.GA_ID, { anonymize_ip: true });
    };
    if (choice === "yes") loadGA();
    else if (choice !== "no") banner.hidden = false;
    banner.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cookie]");
      if (!b) return;
      try { localStorage.setItem("madibu-consent", b.dataset.cookie); } catch (err) {}
      banner.hidden = true;
      if (b.dataset.cookie === "yes") loadGA();
    });
  }
})();
