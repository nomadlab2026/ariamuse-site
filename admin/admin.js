/* ==========================================================================
   ARIA MUSE — Studio Admin runtime

   Publishing model:
     The admin edits data/site.json in the browser, then commits it to the
     GitHub repository through the REST API using a Personal Access Token.
     The commit triggers the "Deploy to GitHub Pages" workflow, which
     republishes the site. Nothing needs to be uploaded by hand.
   ========================================================================== */
(function () {
  "use strict";

  /* --------------------------------------------------------------- config */
  var CONFIG = {
    passcodeKey: "aria.admin.passcode",
    tokenKey: "aria.admin.token",
    ownerKey: "aria.admin.owner",
    repoKey: "aria.admin.repo",
    branchKey: "aria.admin.branch",
    dataPath: "data/site.json",
    photosDir: "assets/photos",
    api: "https://api.github.com"
  };

  var DEFAULTS = {
    owner: "nomadlab2026",
    repo: "ariamuse-site",
    branch: "main"
  };

  var state = {
    data: null,
    dirty: false,
    busy: false,
    galleryItems: []
  };

  /* ----------------------------------------------------------------- dom */
  function $(id) { return document.getElementById(id); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function escapeHTML(v) {
    return String(v === undefined || v === null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* --------------------------------------------------------------- toast */
  var toastTimer = null;

  function toast(message, kind) {
    var node = $("toast");
    node.textContent = message;
    node.className = "toast" + (kind ? " is-" + kind : "");
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 3600);
  }

  function setStatus(id, message, kind, code) {
    var box = $(id);
    if (!box) return;
    box.hidden = false;
    box.className = "status-box" + (kind ? " is-" + kind : "");
    box.innerHTML = "";
    box.appendChild(el("div", null, message));
    if (code) box.appendChild(el("code", null, code));
  }

  /* -------------------------------------------------------------- utils */
  function getPath(obj, path) {
    return path.split(".").reduce(function (acc, key) {
      return acc === undefined || acc === null ? undefined : acc[key];
    }, obj);
  }

  function setPath(obj, path, value) {
    var keys = path.split(".");
    var last = keys.pop();
    var target = obj;
    keys.forEach(function (k) {
      if (typeof target[k] !== "object" || target[k] === null) target[k] = {};
      target = target[k];
    });
    target[last] = value;
  }

  function ensureObject(obj, path) {
    var keys = path.split(".");
    var target = obj;
    keys.forEach(function (k) {
      if (typeof target[k] !== "object" || target[k] === null) target[k] = {};
      target = target[k];
    });
    return target;
  }

  function getSetting(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function setSetting(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* private mode — settings just won't persist */ }
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "image";
  }

  /**
   * Resolve a site-relative asset path against the site root.
   * The admin panel is served from /admin/, so "assets/x.jpg" would
   * otherwise resolve to /admin/assets/x.jpg and 404.
   */
  function siteRoot(path) {
    if (!path) return "";
    if (/^(https?:)?\/\//i.test(path) || path.startsWith("data:")) return path;
    if (path.charAt(0) === "/") return path;
    return "../" + path;
  }

  /** Hash the passcode so it can be stored without exposing it. */
  function hash(text) {
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(text))
        .then(function (buf) {
          return Array.prototype.map
            .call(new Uint8Array(buf), function (b) {
              return ("00" + b.toString(16)).slice(-2);
            })
            .join("");
        });
    }
    // Fallback for older browsers / insecure contexts.
    var h = 5381;
    var s = "aria:" + text;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return Promise.resolve("fallback:" + (h >>> 0).toString(16));
  }

  /* --------------------------------------------------------- github api */
  function ghConfig() {
    return {
      owner: ($("gh-owner").value || DEFAULTS.owner).trim(),
      repo: ($("gh-repo").value || DEFAULTS.repo).trim(),
      branch: ($("gh-branch").value || DEFAULTS.branch).trim(),
      token: ($("gh-token").value || "").trim()
    };
  }

  function ghHeaders(token) {
    return {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    };
  }

  /** GET a file's content + sha from the repo. */
  function ghGetFile(cfg, path) {
    var endpoint =
      CONFIG.api + "/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path + "?ref=" + encodeURIComponent(cfg.branch);
    return fetch(endpoint, { headers: ghHeaders(cfg.token) }).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) {
        return res.json().then(function (body) {
          throw new Error(body.message || "HTTP " + res.status);
        });
      }
      return res.json();
    });
  }

  /** PUT a file's content, creating it when missing. */
  function ghPutFile(cfg, path, contentBase64, message, sha) {
    var endpoint = CONFIG.api + "/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path;
    var body = {
      message: message,
      content: contentBase64,
      branch: cfg.branch
    };
    if (sha) body.sha = sha;

    return fetch(endpoint, {
      method: "PUT",
      headers: ghHeaders(cfg.token),
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (payload) {
        if (!res.ok) throw new Error(payload.message || "HTTP " + res.status);
        return payload;
      });
    });
  }

  function toBase64(str) {
    // Handle UTF-8 properly so Chinese / emoji survive the round trip.
    return Promise.resolve(
      new TextEncoder().encode(str).reduce(function (acc, byte, i, arr) {
        return acc + String.fromCharCode(byte);
      }, "")
    ).then(function (binary) {
      return btoa(binary);
    });
  }

  function ghUser(cfg) {
    return fetch(CONFIG.api + "/user", { headers: ghHeaders(cfg.token) }).then(function (res) {
      if (!res.ok) throw new Error("Invalid token");
      return res.json();
    });
  }

  /* ------------------------------------------------------------- images */
  /**
   * Downscale + re-encode an image in the browser so uploads stay small
   * (GitHub's API rejects files over ~1 MB in a single request).
   */
  function compressImage(file, maxEdge, quality) {
    maxEdge = maxEdge || 1800;
    quality = quality || 0.86;

    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Could not read file")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("Not a valid image")); };
        img.onload = function () {
          var w = img.width;
          var h = img.height;
          var scale = Math.min(1, maxEdge / Math.max(w, h));
          var cw = Math.round(w * scale);
          var ch = Math.round(h * scale);

          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, cw, ch);

          canvas.toBlob(
            function (blob) {
              if (!blob) {
                reject(new Error("Compression failed"));
                return;
              }
              var reader2 = new FileReader();
              reader2.onerror = function () { reject(new Error("Could not read result")); };
              reader2.onload = function () {
                var binary = reader2.result.split(",")[1];
                resolve({
                  base64: binary,
                  width: cw,
                  height: ch,
                  size: blob.size
                });
              };
              reader2.readAsDataURL(blob);
            },
            "image/jpeg",
            quality
          );
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function uploadPhoto(file, destination) {
    var cfg = ghConfig();
    var queue = $("upload-queue");
    var item = el("div", "upload-item");

    var thumb = el("img", "upload-thumb");
    thumb.alt = "";
    item.appendChild(thumb);

    var nameWrap = el("div", "upload-name");
    nameWrap.textContent = file.name;
    item.appendChild(nameWrap);

    var status = el("span", "upload-status", "Compressing…");
    item.appendChild(status);

    queue.appendChild(item);
    queue.hidden = false;

    var previewURL = URL.createObjectURL(file);
    thumb.src = previewURL;

    var folder = destination === "social" ? "social" : "gallery";

    return compressImage(file)
      .then(function (result) {
        status.textContent = "Uploading…";
        var base = slugify(file.name.replace(/\.[^.]+$/, ""));
        var filename = base + "-" + Date.now().toString(36) + ".jpg";
        var path = CONFIG.photosDir + "/" + folder + "/" + filename;

        return ghGetFile(cfg, path).then(function (existing) {
          return ghPutFile(
            cfg,
            path,
            result.base64,
            "Add photo: " + filename,
            existing ? existing.sha : null
          );
        }).then(function () {
          URL.revokeObjectURL(previewURL);
          status.textContent = "Uploaded ✓";
          status.classList.add("is-ok");
          return { path: path, caption: base.replace(/-/g, " ") };
        });
      })
      .catch(function (err) {
        URL.revokeObjectURL(previewURL);
        status.textContent = "Failed: " + err.message;
        status.classList.add("is-err");
        throw err;
      });
  }

  /* ------------------------------------------------------------ bindings */
  function bindFields() {
    qsa("[data-bind]").forEach(function (input) {
      var path = input.getAttribute("data-bind");
      var type = input.getAttribute("data-type");

      var value = getPath(state.data, path);
      if (value === undefined || value === null) value = type === "lines" ? "" : type === "bool" ? false : "";
      if (type === "bool") input.checked = !!value;
      else if (type === "lines") input.value = Array.isArray(value) ? value.join("\n") : value;
      else input.value = value;

      var eventName = input.tagName === "SELECT" || input.type === "checkbox" ? "change" : "input";

      input.addEventListener(eventName, function () {
        var val;
        if (type === "bool") val = input.checked;
        else if (type === "lines") {
          val = input.value
            .split("\n")
            .map(function (l) { return l.trim(); })
            .filter(function (l) { return l.length > 0; });
        } else {
          val = input.value;
        }
        setPath(state.data, path, val);
        markDirty();
      });
    });
  }

  function markDirty() {
    state.dirty = true;
    var label = $("save-state");
    label.textContent = "Unsaved changes";
    label.classList.add("is-dirty");
  }

  function markClean() {
    state.dirty = false;
    var label = $("save-state");
    label.textContent = "All changes saved";
    label.classList.remove("is-dirty");
  }

  /* ------------------------------------------------------------ repeater */
  /**
   * Generic list editor. Each entry declares its fields so we can render
   * add / remove / reorder uniformly.
   */
  function renderRepeater(containerId, list, spec, onChange) {
    var container = $(containerId);
    container.innerHTML = "";

    list.forEach(function (entry, index) {
      var row = el("div", "rep-row");
      var fields = el("div", "rep-fields");

      // Consecutive "inline" fields share one grid row so a compact
      // spec (name + handle + url) stays on a single line.
      var inlineRow = null;
      var flushInline = function () {
        if (inlineRow) {
          fields.appendChild(inlineRow);
          inlineRow = null;
        }
      };

      spec.fields.forEach(function (f) {
        var wrap = el("label", "field");

        if (f.type === "checkbox") {
          flushInline();
          wrap.className = "field field--inline";
          var box = el("input");
          box.type = "checkbox";
          box.checked = !!entry[f.key];
          box.addEventListener("change", function () {
            entry[f.key] = box.checked;
            // Only one platform can hold the featured slot.
            if (box.checked && spec.exclusiveKey === f.key) {
              list.forEach(function (other) {
                if (other !== entry) other[spec.exclusiveKey] = false;
              });
            }
            renderRepeater(containerId, list, spec, onChange);
            onChange();
          });
          wrap.appendChild(box);
          wrap.appendChild(el("span", "field-label", f.label));
          fields.appendChild(wrap);
          return;
        }

        wrap.appendChild(el("span", "field-label", f.label));

        if (f.type === "textarea") {
          flushInline();
          var ta = el("textarea");
          ta.rows = f.rows || 2;
          ta.value = entry[f.key] === undefined ? "" : entry[f.key];
          ta.addEventListener("input", function () {
            entry[f.key] = ta.value;
            onChange();
          });
          wrap.appendChild(ta);
        } else if (f.type === "select") {
          var sel = el("select");
          f.options.forEach(function (opt) {
            var o = el("option", null, opt);
            o.value = opt;
            if (entry[f.key] === opt) o.selected = true;
            sel.appendChild(o);
          });
          sel.addEventListener("change", function () {
            entry[f.key] = sel.value;
            onChange();
          });
          wrap.appendChild(sel);
          if (f.inline) {
            if (!inlineRow) inlineRow = el("div", "rep-inline");
            inlineRow.appendChild(wrap);
            return;
          }
        } else {
          var input = el("input");
          input.type = "text";
          input.value = entry[f.key] === undefined ? "" : entry[f.key];
          input.addEventListener("input", function () {
            entry[f.key] = input.value;
            onChange();
          });
          wrap.appendChild(input);
        }

        if (f.type === "inline") {
          if (!inlineRow) inlineRow = el("div", "rep-inline");
          inlineRow.appendChild(wrap);
        } else {
          flushInline();
          fields.appendChild(wrap);
        }
      });

      flushInline();

      if (spec.thumb) {
        var img = el("img", "rep-thumb");
        img.alt = "";
        // The admin lives in /admin/, so a bare "assets/..." path would
        // resolve to /admin/assets/... — prefix it with the site root.
        img.src = siteRoot(entry[spec.thumb]);
        img.addEventListener("error", function () {
          img.style.visibility = "hidden";
        });
        img.addEventListener("load", function () {
          img.style.visibility = "visible";
        });
        fields.appendChild(img);
      }

      var actions = el("div", "rep-actions");

      var up = el("button", "icon-btn", "↑");
      up.title = "Move up";
      up.type = "button";
      up.addEventListener("click", function () {
        if (index === 0) return;
        var tmp = list[index - 1];
        list[index - 1] = list[index];
        list[index] = tmp;
        renderRepeater(containerId, list, spec, onChange);
        onChange();
      });

      var down = el("button", "icon-btn", "↓");
      down.title = "Move down";
      down.type = "button";
      down.addEventListener("click", function () {
        if (index === list.length - 1) return;
        var tmp = list[index + 1];
        list[index + 1] = list[index];
        list[index] = tmp;
        renderRepeater(containerId, list, spec, onChange);
        onChange();
      });

      var del = el("button", "icon-btn icon-btn--danger", "✕");
      del.title = "Remove";
      del.type = "button";
      del.addEventListener("click", function () {
        list.splice(index, 1);
        renderRepeater(containerId, list, spec, onChange);
        onChange();
      });

      actions.appendChild(up);
      actions.appendChild(down);
      actions.appendChild(del);

      row.appendChild(fields);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  /* ------------------------------------------------------------ repeaters */
  var STATS_SPEC = {
    fields: [
      { key: "value", label: "Value", type: "inline" },
      { key: "label", label: "Label", type: "inline" }
    ]
  };

  var RELEASE_LINKS_SPEC = {
    fields: [
      { key: "label", label: "Button text", type: "inline" },
      { key: "url", label: "Link URL", type: "inline" }
    ]
  };

  var MEDIA_SPEC = {
    fields: [
      { key: "label", label: "Platform name", type: "inline" },
      { key: "handle", label: "Handle", type: "inline" },
      { key: "url", label: "Profile URL", type: "inline" },
      {
        key: "icon",
        label: "Icon",
        type: "select",
        inline: true,
        options: ["fanvue", "instagram", "threads", "tiktok", "youtube", "x", "spotify", "sparkle", "link"]
      },
      { key: "iconImage", label: "Icon image path (optional — overrides the icon with a custom logo, e.g. assets/photos/fanvue-logo.png)" },
      { key: "note", label: "Description (featured card only)", type: "textarea", rows: 2 },
      { key: "featured", label: "Feature as the main card (one only)", type: "checkbox" }
    ],
    exclusiveKey: "featured"
  };

  var GALLERY_SPEC = {
    thumb: "src",
    fields: [
      { key: "src", label: "Image path", type: "inline" },
      { key: "caption", label: "Caption", type: "inline" },
      { key: "alt", label: "Alt text", type: "inline" }
    ]
  };

  var SOCIAL_SPEC = {
    thumb: "src",
    fields: [
      { key: "src", label: "Image path", type: "inline" },
      { key: "caption", label: "Caption", type: "inline" }
    ]
  };

  function renderAllRepeaters() {
    ensureObject(state.data, "about.stats");
    ensureObject(state.data, "release.links");
    ensureObject(state.data, "media.links");
    ensureObject(state.data, "gallery.items");
    ensureObject(state.data, "social.items");

    renderRepeater("stats-repeater", state.data.about.stats, STATS_SPEC, markDirty);
    renderRepeater("release-links-repeater", state.data.release.links, RELEASE_LINKS_SPEC, markDirty);
    renderRepeater("media-repeater", state.data.media.links, MEDIA_SPEC, markDirty);
    renderRepeater("gallery-repeater", state.data.gallery.items, GALLERY_SPEC, markDirty);
    renderRepeater("social-repeater", state.data.social.items, SOCIAL_SPEC, markDirty);
  }

  /* ---------------------------------------------------------------- tabs */
  function initTabs() {
    qsa(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        qsa(".tab").forEach(function (t) { t.classList.remove("is-active"); });
        qsa(".panel").forEach(function (p) { p.classList.remove("is-active"); });
        tab.classList.add("is-active");
        var panel = document.querySelector('[data-panel="' + tab.getAttribute("data-tab") + '"]');
        if (panel) panel.classList.add("is-active");
      });
    });

    qsa("[data-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var kind = btn.getAttribute("data-add");
        if (kind === "stats") {
          state.data.about.stats.push({ value: "0", label: "New" });
          renderRepeater("stats-repeater", state.data.about.stats, STATS_SPEC, markDirty);
        } else if (kind === "releaseLinks") {
          state.data.release.links.push({ label: "Listen", url: "https://" });
          renderRepeater("release-links-repeater", state.data.release.links, RELEASE_LINKS_SPEC, markDirty);
        } else if (kind === "media") {
          state.data.media.links.push({ label: "New Platform", handle: "@handle", url: "https://", icon: "link" });
          renderRepeater("media-repeater", state.data.media.links, MEDIA_SPEC, markDirty);
        } else if (kind === "gallery") {
          state.data.gallery.items.push({ src: "assets/photos/gallery/look-01.jpg", caption: "New photo", alt: "" });
          renderRepeater("gallery-repeater", state.data.gallery.items, GALLERY_SPEC, markDirty);
        } else if (kind === "social") {
          state.data.social.items.push({ src: "assets/photos/social/post-01.jpg", caption: "@ariamuse", alt: "" });
          renderRepeater("social-repeater", state.data.social.items, SOCIAL_SPEC, markDirty);
        }
        markDirty();
      });
    });
  }

  /* ------------------------------------------------------------ uploading */
  function initDropzone() {
    var zone = $("dropzone");
    var input = $("file-input");

    $("browse-btn").addEventListener("click", function () { input.click(); });

    ["dragenter", "dragover"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.add("is-over");
      });
    });

    ["dragleave", "drop"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        if (evt === "dragleave" && zone.contains(e.relatedTarget)) return;
        zone.classList.remove("is-over");
      });
    });

    zone.addEventListener("drop", function (e) {
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      handleFiles(files);
    });

    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(input.files || []);
      handleFiles(files);
      input.value = "";
    });
  }

  function handleFiles(files) {
    if (!files.length) return;
    var cfg = ghConfig();
    if (!cfg.token) {
      toast("Add your GitHub token in the Settings tab first.", "err");
      return;
    }

    var destination = "gallery";
    var checked = document.querySelector('input[name="upload-dest"]:checked');
    if (checked) destination = checked.value;

    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain
        .then(function () {
          return uploadPhoto(file, destination).then(function (result) {
            var entry = { src: result.path, caption: result.caption, alt: "" };
            if (destination === "social") {
              entry.caption = "@ariamuse";
              state.data.social.items.push(entry);
              renderRepeater("social-repeater", state.data.social.items, SOCIAL_SPEC, markDirty);
            } else {
              state.data.gallery.items.push(entry);
              renderRepeater("gallery-repeater", state.data.gallery.items, GALLERY_SPEC, markDirty);
            }
            markDirty();
          });
        })
        .catch(function () { /* individual failure already reported */ });
    });

    chain.then(function () {
      toast("Photos uploaded. Press “Save & Publish” to go live.", "ok");
    });
  }

  /* ------------------------------------------------------------ publishing */
  function initPublish() {
    $("publish-btn").addEventListener("click", function () {
      if (state.busy) return;

      var cfg = ghConfig();
      if (!cfg.owner || !cfg.repo || !cfg.token) {
        toast("Fill in your GitHub username, repo and token in Settings first.", "err");
        showTab("settings");
        return;
      }
      if (!state.dirty) {
        toast("Nothing to publish — no changes yet.");
        return;
      }

      state.busy = true;
      var btn = $("publish-btn");
      btn.disabled = true;
      btn.textContent = "Publishing…";
      $("save-state").textContent = "Publishing…";

      var payload = JSON.stringify(state.data, null, 2);

      Promise.all([toBase64(payload), ghGetFile(cfg, CONFIG.dataPath)])
        .then(function (parts) {
          var encoded = parts[0];
          var existing = parts[1];
          return ghPutFile(
            cfg,
            CONFIG.dataPath,
            encoded,
            "Update site content via Studio Admin",
            existing ? existing.sha : null
          );
        })
        .then(function () {
          markClean();
          toast("Published! Your site refreshes in about a minute.", "ok");
        })
        .catch(function (err) {
          var message = err.message || "Unknown error";
          toast("Publish failed: " + message, "err");
          setStatus(
            "conn-status",
            "Publish failed.",
            "err",
            message +
              "\n\nIf the token is expired, create a new one with “Contents: read and write” on this repository."
          );
          showTab("settings");
        })
        .then(function () {
          state.busy = false;
          btn.disabled = false;
          btn.textContent = "Save & Publish";
        });
    });
  }

  function showTab(name) {
    var tab = document.querySelector('.tab[data-tab="' + name + '"]');
    if (tab) tab.click();
  }

  /* ------------------------------------------------------------- settings */
  function initSettings() {
    $("gh-owner").value = getSetting(CONFIG.ownerKey, DEFAULTS.owner);
    $("gh-repo").value = getSetting(CONFIG.repoKey, DEFAULTS.repo);
    $("gh-branch").value = getSetting(CONFIG.branchKey, DEFAULTS.branch);
    $("gh-token").value = getSetting(CONFIG.tokenKey, "");

    function persist() {
      setSetting(CONFIG.ownerKey, $("gh-owner").value.trim());
      setSetting(CONFIG.repoKey, $("gh-repo").value.trim());
      setSetting(CONFIG.branchKey, $("gh-branch").value.trim());
      setSetting(CONFIG.tokenKey, $("gh-token").value.trim());
      $("foot-repo").textContent =
        ($("gh-owner").value.trim() || "—") + "/" + ($("gh-repo").value.trim() || "—") + " · " + ($("gh-branch").value.trim() || "main");
    }

    ["gh-owner", "gh-repo", "gh-branch", "gh-token"].forEach(function (id) {
      $(id).addEventListener("input", persist);
    });
    persist();

    $("test-token-btn").addEventListener("click", function () {
      var cfg = ghConfig();
      if (!cfg.token) {
        setStatus("conn-status", "Paste your token first.", "warn");
        return;
      }
      setStatus("conn-status", "Testing…", "");
      ghUser(cfg)
        .then(function (user) {
          return ghGetFile(cfg, CONFIG.dataPath).then(function (file) {
            var note = file
              ? "Token works. Found data/site.json — ready to publish."
              : "Token works. No data/site.json yet — publishing will create it.";
            setStatus("conn-status", note, "ok", "Signed in as " + user.login);
          });
        })
        .catch(function (err) {
          setStatus("conn-status", "Could not connect to GitHub.", "err", err.message);
        });
    });

    $("logout-token-btn").addEventListener("click", function () {
      $("gh-token").value = "";
      persist();
      setStatus("conn-status", "Token removed from this browser.", "ok");
    });

    $("logout-btn").addEventListener("click", function () {
      setSetting(CONFIG.passcodeKey, "");
      $("app").hidden = true;
      $("gate").style.display = "";
      $("passcode").value = "";
    });

    $("change-passcode-btn").addEventListener("click", function () {
      $("passcode-modal").hidden = false;
      $("new-passcode").value = "";
      $("confirm-passcode").value = "";
      $("new-passcode").focus();
    });

    $("cancel-passcode").addEventListener("click", function () {
      $("passcode-modal").hidden = true;
    });

    $("save-passcode").addEventListener("click", function () {
      var next = $("new-passcode").value.trim();
      var confirm = $("confirm-passcode").value.trim();

      if (next.length < 6) {
        toast("Use at least 6 characters.", "err");
        return;
      }
      if (next !== confirm) {
        toast("The two passcodes don't match.", "err");
        return;
      }
      var cfg = ghConfig();
      if (!cfg.token) {
        toast("Add your GitHub token first.", "err");
        $("passcode-modal").hidden = true;
        showTab("settings");
        return;
      }

      hash(next)
        .then(function (hashed) {
          var body = JSON.stringify({ passcode: hashed }, null, 2);
          return toBase64(body).then(function (encoded) {
            return ghGetFile(cfg, "data/admin.json").then(function (existing) {
              return ghPutFile(cfg, "data/admin.json", encoded, "Update admin passcode", existing ? existing.sha : null);
            });
          });
        })
        .then(function () {
          $("passcode-modal").hidden = true;
          setSetting(CONFIG.passcodeKey, next);
          toast("Passcode changed.", "ok");
        })
        .catch(function (err) {
          toast("Could not save: " + err.message, "err");
        });
    });
  }

  /* ------------------------------------------------------------ data load */
  function loadData() {
    var cfg = ghConfig();

    // Prefer the repo copy (the freshest), fall back to the local file.
    var localFetch = fetch("../data/site.json?t=" + Date.now(), { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("local missing");
      return res.json();
    });

    if (cfg.token && cfg.owner && cfg.repo) {
      ghGetFile(cfg, CONFIG.dataPath)
        .then(function (file) {
          if (!file) return localFetch;
          var decoded = decodeBase64(file.content.replace(/\n/g, ""));
          return JSON.parse(decoded);
        })
        .then(applyData)
        .catch(function () {
          return localFetch.then(applyData);
        });
    } else {
      localFetch.then(applyData);
    }
  }

  function decodeBase64(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function applyData(json) {
    state.data = json;
    // Guarantee every section exists so the forms never crash.
    ["site", "hero", "about", "marquee", "release", "gallery", "social", "media", "contact"].forEach(function (key) {
      if (!state.data[key] || typeof state.data[key] !== "object") state.data[key] = {};
    });
    if (!Array.isArray(state.data.about.body)) state.data.about.body = state.data.about.body ? [state.data.about.body] : [];
    if (!Array.isArray(state.data.marquee.items)) state.data.marquee.items = [];
    if (!Array.isArray(state.data.gallery.items)) state.data.gallery.items = [];
    if (!Array.isArray(state.data.social.items)) state.data.social.items = [];
    if (!Array.isArray(state.data.media.links)) state.data.media.links = [];
    if (!Array.isArray(state.data.release.links)) state.data.release.links = [];
    if (!Array.isArray(state.data.about.stats)) state.data.about.stats = [];

    bindFields();
    renderAllRepeaters();
    markClean();
  }

  /* ---------------------------------------------------------------- boot */
  function unlock() {
    var input = $("passcode").value.trim();
    var error = $("gate-error");

    if (!input) {
      error.hidden = false;
      error.textContent = "Please enter your passcode.";
      return;
    }

    hash(input)
      .then(function (hashed) {
        // no-store plus a cache-busting query: GitHub Pages sits behind a
        // CDN, and a stale admin.json would make a freshly changed
        // passcode look wrong (or an old one look right).
        return fetch("../data/admin.json?t=" + Date.now(), { cache: "no-store" })
          .then(function (res) {
            if (!res.ok) throw new Error("no-admin-file");
            return res.json();
          })
          .then(function (cfgFile) {
            if (cfgFile.passcode && cfgFile.passcode !== hashed) {
              throw new Error("wrong-passcode");
            }
            return true;
          })
          .catch(function (err) {
            if (err.message === "wrong-passcode") throw err;
            // No admin.json reachable — accept the locally stored passcode.
            var stored = getSetting(CONFIG.passcodeKey, "");
            if (stored && stored !== input) throw new Error("wrong-passcode");
            return true;
          });
      })
      .then(function () {
        setSetting(CONFIG.passcodeKey, input);
        error.hidden = true;
        $("gate").style.display = "none";
        $("app").hidden = false;
        initTabs();
        initDropzone();
        initPublish();
        initSettings();
        loadData();
      })
      .catch(function (err) {
        error.hidden = false;
        error.textContent =
          err.message === "wrong-passcode"
            ? "That passcode isn't right. Try again."
            : "Could not verify the passcode. Check your connection and try again.";
      });
  }

  /**
   * Forgotten passcode: verify the GitHub token against the repository, then
   * write a fresh passcode hash to data/admin.json. The token is used for the
   * API call only and is not stored.
   */
  function resetPasscode() {
    var error = $("gate-error");
    var token = ($("reset-token").value || "").trim();
    var a = $("reset-passcode").value;
    var b = $("reset-passcode-2").value;

    if (!token) {
      error.hidden = false;
      error.textContent = "Paste your GitHub token to continue.";
      return;
    }
    if (!a) {
      error.hidden = false;
      error.textContent = "Choose a new passcode.";
      return;
    }
    if (a !== b) {
      error.hidden = false;
      error.textContent = "The two passcodes do not match.";
      return;
    }

    var cfg = ghConfig();
    cfg.token = token;
    var btn = $("reset-btn");
    btn.disabled = true;
    btn.textContent = "Resetting…";

    hash(a)
      .then(function (hashed) {
        return fetch(CONFIG.api + "/repos/" + cfg.owner + "/" + cfg.repo, {
          headers: ghHeaders(token)
        }).then(function (res) {
          if (!res.ok) {
            return res.json().then(function (body) {
              throw new Error(body.message || "HTTP " + res.status);
            });
          }
          return res.json();
        }).then(function () {
          return toBase64(JSON.stringify({ passcode: hashed }, null, 2)).then(function (encoded) {
            return ghGetFile(cfg, "data/admin.json").then(function (existing) {
              return ghPutFile(cfg, "data/admin.json", encoded, "Reset admin passcode", existing ? existing.sha : null);
            });
          });
        });
      })
      .then(function () {
        setSetting(CONFIG.passcodeKey, a);
        error.hidden = false;
        error.textContent = "Passcode reset. Enter it below to unlock.";
        $("passcode").value = a;
        $("reset-token").value = "";
        $("reset-passcode").value = "";
        $("reset-passcode-2").value = "";
        $("gate-reset").hidden = true;
        $("gate-error").style.background = "rgba(111, 207, 151, 0.14)";
        $("gate-error").style.color = "#8ee0b0";
      })
      .catch(function (err) {
        error.hidden = false;
        error.style.background = "";
        error.style.color = "";
        error.textContent = "Could not reset the passcode: " + (err.message || "unknown error");
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "Reset passcode";
      });
  }

  function boot() {
    $("unlock-btn").addEventListener("click", unlock);
    $("passcode").addEventListener("keydown", function (e) {
      if (e.key === "Enter") unlock();
    });

    $("forgot-btn").addEventListener("click", function () {
      $("gate-reset").hidden = false;
      $("gate-error").hidden = true;
      $("reset-token").focus();
    });
    $("reset-back").addEventListener("click", function () {
      $("gate-reset").hidden = true;
      $("gate-error").hidden = true;
      $("passcode").focus();
    });
    $("reset-btn").addEventListener("click", resetPasscode);
    $("passcode").focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
