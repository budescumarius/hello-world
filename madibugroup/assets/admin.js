(function () {
  "use strict";
  var csrfEl = document.getElementById("csrf");
  var CSRF = csrfEl ? csrfEl.value : "";

  /* Confirmation before destructive actions */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-confirm]");
    if (b && !window.confirm(b.dataset.confirm)) e.preventDefault();
  });

  /* FR / NL tabs */
  document.querySelectorAll("[data-tabs]").forEach(function (tabs) {
    var panel = tabs.parentElement;
    tabs.addEventListener("click", function (e) {
      var b = e.target.closest("[data-tab]");
      if (!b) return;
      tabs.querySelectorAll("[data-tab]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      panel.querySelectorAll("[data-pane]").forEach(function (p) { p.hidden = p.dataset.pane !== b.dataset.tab; });
    });
  });

  /* Resize a photo in the browser before sending (lighter uploads, converts iPhone HEIC to JPEG in Safari). */
  function shrink(file, max) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || file.type === "image/gif") return resolve(file);
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1 && /jpe?g|png|webp/.test(file.type) && file.size < 6e6) { URL.revokeObjectURL(url); return resolve(file); }
        var c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) {
          resolve(blob ? new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file);
        }, "image/jpeg", 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function upload(file, target) {
    return shrink(file, 2400).then(function (f) {
      var fd = new FormData();
      fd.append("csrf", CSRF);
      fd.append("target", target);
      fd.append("file", f, f.name || "photo.jpg");
      return fetch("?a=upload", { method: "POST", body: fd, headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (r) {
          return r.json().catch(function () { throw new Error("Réponse inattendue du serveur (" + r.status + ")."); })
            .then(function (j) { if (!r.ok || j.error) throw new Error(j.error || "Erreur " + r.status); return j; });
        });
    });
  }

  /* Project photo dropzone: sequential uploads with progress */
  document.querySelectorAll("[data-upload]").forEach(function (zone) {
    var input = zone.querySelector("input[type=file]");
    var bar = zone.querySelector(".progress");
    var status = zone.querySelector(".upload-status");
    var target = "project:" + zone.dataset.project;
    var form = document.getElementById("project-form");
    var dirty = false;
    if (form) form.addEventListener("input", function () { dirty = true; });

    function run(files) {
      files = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name); });
      if (!files.length) return;
      if (dirty && !window.confirm("Vous avez des modifications non enregistrées. Elles seront perdues après l'envoi des photos. Continuer ?")) return;
      var done = 0, errors = [];
      bar.hidden = false;
      var step = function () {
        if (done >= files.length) {
          status.textContent = errors.length ? errors.join(" · ") : files.length + " photo(s) ajoutée(s). Mise à jour…";
          if (!errors.length || errors.length < files.length) setTimeout(function () { location.reload(); }, errors.length ? 2500 : 400);
          return;
        }
        status.textContent = "Envoi de la photo " + (done + 1) + " sur " + files.length + "…";
        upload(files[done], target).catch(function (err) { errors.push(files[done].name + " : " + err.message); })
          .then(function () { done++; bar.firstElementChild.style.width = (done / files.length * 100) + "%"; step(); });
      };
      step();
    }
    input.addEventListener("change", function () { run(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { zone.addEventListener(ev, function () { zone.classList.remove("is-over"); }); });
    zone.addEventListener("drop", function (e) { e.preventDefault(); run(e.dataTransfer.files); });
  });

  /* Reorder photos by drag and drop */
  var grid = document.getElementById("photo-grid");
  if (grid) {
    var dragged = null;
    grid.addEventListener("dragstart", function (e) {
      dragged = e.target.closest(".photo");
      if (!dragged) return;
      dragged.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    grid.addEventListener("dragend", function () { if (dragged) dragged.classList.remove("is-dragging"); dragged = null; });
    grid.addEventListener("dragover", function (e) {
      if (!dragged) return;
      e.preventDefault();
      var over = e.target.closest(".photo");
      if (!over || over === dragged) return;
      var r = over.getBoundingClientRect();
      var after = (e.clientX - r.left) > r.width / 2;
      grid.insertBefore(dragged, after ? over.nextSibling : over);
    });
  }

  /* Markdown toolbar */
  document.querySelectorAll(".md-bar").forEach(function (bar) {
    var ta = document.getElementById(bar.dataset.target);
    if (!ta) return;
    var preview = document.getElementById(bar.dataset.target + "-preview");
    function wrap(before, after, placeholder) {
      var s = ta.selectionStart, en = ta.selectionEnd, sel = ta.value.slice(s, en) || placeholder;
      ta.setRangeText(before + sel + after, s, en, "end");
      ta.focus();
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function block(prefix, placeholder) {
      var s = ta.selectionStart, en = ta.selectionEnd, sel = ta.value.slice(s, en) || placeholder;
      var lines = sel.split("\n").map(function (l) { return prefix + l; }).join("\n");
      var pre = s > 0 && ta.value[s - 1] !== "\n" ? "\n\n" : "";
      ta.setRangeText(pre + lines + "\n\n", s, en, "end");
      ta.focus();
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("[data-md]");
      if (!b) return;
      var cmd = b.dataset.md;
      if (cmd === "h2") block("## ", "Intertitre");
      if (cmd === "h3") block("### ", "Sous-titre");
      if (cmd === "b") wrap("**", "**", "texte en gras");
      if (cmd === "i") wrap("*", "*", "texte en italique");
      if (cmd === "ul") block("- ", "élément");
      if (cmd === "quote") block("> ", "citation");
      if (cmd === "link") {
        var u = window.prompt("Adresse du lien (https://…)", "https://");
        if (u) wrap("[", "](" + u + ")", "texte du lien");
      }
      if (cmd === "img") {
        var fi = document.createElement("input");
        fi.type = "file"; fi.accept = "image/*";
        fi.onchange = function () {
          if (!fi.files[0]) return;
          b.disabled = true; b.textContent = "Envoi…";
          upload(fi.files[0], "blog").then(function (j) {
            var alt = window.prompt("Légende de la photo (optionnelle)", "") || "";
            block("", "![" + alt.replace(/[\[\]]/g, "") + "](" + j.image.src + ")");
          }).catch(function (err) { window.alert(err.message); })
            .then(function () { b.disabled = false; b.textContent = "Photo"; });
        };
        fi.click();
      }
      if (cmd === "preview" && preview) {
        if (!preview.hidden) { preview.hidden = true; ta.hidden = false; b.textContent = "Aperçu"; return; }
        var fd = new FormData(); fd.append("csrf", CSRF); fd.append("md", ta.value);
        fetch("?a=preview", { method: "POST", body: fd, credentials: "same-origin" }).then(function (r) { return r.text(); }).then(function (html) {
          preview.innerHTML = html; preview.hidden = false; ta.hidden = true; b.textContent = "Modifier";
        });
      }
    });
  });

  /* Warn before leaving with unsaved changes */
  document.querySelectorAll("form.editor").forEach(function (f) {
    var changed = false;
    f.addEventListener("input", function () { changed = true; });
    f.addEventListener("submit", function () { changed = false; });
    window.addEventListener("beforeunload", function (e) { if (changed) { e.preventDefault(); e.returnValue = ""; } });
  });

  /* Legacy photo optimisation, in small batches */
  var opt = document.getElementById("opt-start");
  if (opt) {
    opt.addEventListener("click", function () {
      opt.disabled = true;
      var prog = document.getElementById("opt-progress");
      var status = document.getElementById("opt-status");
      var left = document.getElementById("opt-left");
      var total = parseInt(left.textContent, 10) || 1;
      var errors = [];
      prog.hidden = false;
      var run = function () {
        var fd = new FormData(); fd.append("csrf", CSRF);
        fetch("?a=optimize", { method: "POST", body: fd, credentials: "same-origin", headers: { Accept: "application/json" } })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            errors = errors.concat(j.errors || []);
            left.textContent = j.left;
            prog.firstElementChild.style.width = Math.round((total - j.left) / total * 100) + "%";
            if (j.left > 0 && (j.done > 0 || (j.errors || []).length)) { status.textContent = "Traitement en cours…"; run(); }
            else status.textContent = "Terminé." + (errors.length ? " Photos non traitées : " + errors.join(" · ") : "");
          })
          .catch(function (err) { status.textContent = "Erreur : " + err.message + ". Rechargez la page pour reprendre."; opt.disabled = false; });
      };
      run();
    });
  }
})();
