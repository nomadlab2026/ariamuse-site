/* ==========================================================================
   Aria Muse — Links Admin runtime

   Publishing model:
     The admin edits links/data/links.json in the browser and commits it to
     the GitHub repository through the REST API using a Personal Access
     Token. The commit triggers the "Deploy to GitHub Pages" workflow,
     which republishes the site. Nothing is uploaded by hand.
   ========================================================================== */
(function () {
  "use strict";

  /* --------------------------------------------------------------- config */
  var CONFIG = {
    passcodeKey: "aria.links.passcode",
    tokenKey: "aria.links.token",
    ownerKey: "aria.links.owner",
    repoKey: "aria.links.repo",
    branchKey: "aria.links.branch",
    dataPath: "links/data/links.json",
    assetsDir: "links/assets/img",
    iconDir: "links/assets/icons",
    /* Shared with the main site admin: the passcode hash lives here so the
       same password works on both panels and on any device. */
    authPath: "data/admin.json",
    api: "https://api.github.com"
  };

  var DEFAULTS = {
    owner: "nomadlab2026",
    repo: "ariamuse-site",
    branch: "main"
  };

  var ICONS = [
    "instagram", "tiktok", "x", "threads", "telegram", "bitcoin", "ethereum",
    "tether", "github", "youtube", "spotify", "discord", "mail", "link",
    "globe", "fanvue", "coffee", "gift", "star"
  ];

  var state = {
    data: null,
    dirty: false,
    busy: false
  };

  /* ----------------------------------------------------------------- dom */
  function $(id) { return document.getElementById(id); }
  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function escapeHTML(v) {
    return String(v === undefined || v === null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* --------------------------------------------------------------- toast */
  var toastTimer = null;

  function toast(message, kind) {
    var node = $("toast");
    node.textContent = message;
    node.classList.add("is-visible");
    node.classList.toggle("is-err", kind === "err");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.classList.remove("is-visible");
    }, 3600);
  }

  function setStatus(id, message, kind, code) {
    var node = $(id);
    node.textContent = message + (code ? "\n\n" + code : "");
    node.classList.toggle("is-ok", kind === "ok");
    node.classList.toggle("is-err", kind === "err");
  }

  /* ------------------------------------------------------------ settings */
  function getSetting(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }

  function setSetting(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  /* --------------------------------------------------------------- paths */
  /**
   * Resolve a page-relative asset path against the site root.
   * The admin is served from /links/admin/, so "assets/x.jpg" would
   * otherwise resolve to /links/admin/assets/x.jpg and 404.
   */
  function siteRoot(path) {
    if (!path) return "";
    if (/^(https?:)?\/\//i.test(path) || path.startsWith("data:")) return path;
    if (path.charAt(0) === "/") return path;
    return "../" + path;
  }

  /** Strip the repo-relative prefix so the stored value stays portable. */
  function stripRepoPrefix(path) {
    if (!path) return "";
    return path.replace(/^links\//, "");
  }

  /* -------------------------------------------------------------- auth ---
   * The passcode is stored as a SHA-256 hash in data/admin.json, which is
   * shared with the main site admin. Using the same file means one
   * password works on both panels, and it works on any device — a local
   * copy in localStorage is only a fast-path / offline fallback.
   */
  var remotePasscode = undefined;   // undefined = not fetched yet

  function fetchRemotePasscode() {
    if (remotePasscode !== undefined) {
      return Promise.resolve(remotePasscode);
    }
    var url = "../../" + CONFIG.authPath + "?t=" + Date.now();
    return fetch(url, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (cfg) {
        remotePasscode = (cfg && cfg.passcode) ? cfg.passcode : null;
        return remotePasscode;
      })
      .catch(function () {
        remotePasscode = null;
        return null;
      });
  }

  /** Check a digest against both the remote hash and the local one. */
  function passcodeMatches(digest) {
    var local = getSetting(CONFIG.passcodeKey, "");
    if (local && digest === local) return Promise.resolve(true);
    return fetchRemotePasscode().then(function (remote) {
      return !!(remote && digest === remote);
    });
  }

  /* --------------------------------------------------------------- hash */
  function hash(text) {
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(text))
        .then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ("00" + b.toString(16)).slice(-2);
          }).join("");
        });
    }
    var h = 5381;
    var s = "aria:" + text;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Promise.resolve("fallback:" + (h >>> 0).toString(16));
  }

  /* ----------------------------------------------------------- github api */
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

  function ghGetFile(cfg, path) {
    var endpoint = CONFIG.api + "/repos/" + cfg.owner + "/" + cfg.repo +
      "/contents/" + path + "?ref=" + encodeURIComponent(cfg.branch);
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

  function ghPutFile(cfg, path, contentBase64, message, sha) {
    var endpoint = CONFIG.api + "/repos/" + cfg.owner + "/" + cfg.repo +
      "/contents/" + path;
    var payload = {
      message: message,
      content: contentBase64,
      branch: cfg.branch
    };
    if (sha) payload.sha = sha;
    return fetch(endpoint, {
      method: "PUT",
      headers: ghHeaders(cfg.token),
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (body) {
          throw new Error(body.message || "HTTP " + res.status);
        });
      }
      return res.json();
    });
  }

  function toBase64(str) {
    if (window.TextEncoder) {
      return new TextEncoder().encode(str).reduce(function (acc, byte, i, arr) {
        return acc + String.fromCharCode(byte);
      }, "").then(function (binary) {
        return btoa(binary);
      });
    }
    return Promise.resolve(btoa(unescape(encodeURIComponent(str))));
  }

  /* ---------------------------------------------------------- image work */
  function compressImage(file, maxEdge, quality, mime) {
    maxEdge = maxEdge || 1400;
    quality = quality || 0.82;
    mime = mime || "image/jpeg";

    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Could not read file")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("Not a valid image")); };
        img.onload = function () {
          var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));

          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          if (mime === "image/png") {
            // 保留透明通道
            ctx.clearRect(0, 0, w, h);
          }
          ctx.drawImage(img, 0, 0, w, h);

          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error("Could not encode image")); return; }
            var reader2 = new FileReader();
            reader2.onerror = function () { reject(new Error("Could not encode image")); };
            reader2.onload = function () {
              var binary = reader2.result.split(",")[1];
              resolve({ base64: binary, width: w, height: h });
            };
            reader2.readAsDataURL(blob);
          }, mime, quality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "image";
  }

  function uploadImage(file, destination, maxEdge, opts) {
    opts = opts || {};
    var asPng = !!opts.png;
    var dir = opts.dir || CONFIG.assetsDir;
    var prefix = opts.prefix || "assets/img/";
    var cfg = ghConfig();
    if (!cfg.token) {
      return Promise.reject(new Error("Add your GitHub token in Settings first"));
    }

    var queue = $("upload-queue");
    var item = el("div", "upload-item");
    var thumb = el("img", "upload-thumb");
    var nameWrap = el("div", "upload-name", file.name);
    var status = el("span", "upload-status", "Compressing…");
    item.appendChild(thumb);
    item.appendChild(nameWrap);
    item.appendChild(status);
    queue.appendChild(item);
    queue.hidden = false;

    var previewURL = URL.createObjectURL(file);
    thumb.src = previewURL;

    return compressImage(file, maxEdge, asPng ? undefined : 0.82,
                         asPng ? "image/png" : "image/jpeg")
      .then(function (result) {
        status.textContent = "Uploading…";
        var base = slugify(file.name.replace(/\.[^.]+$/, ""));
        var filename = base + "-" + Date.now().toString(36) + (asPng ? ".png" : ".jpg");
        var repoPath = dir + "/" + filename;

        return ghGetFile(cfg, repoPath).then(function (existing) {
          return ghPutFile(
            cfg, repoPath, result.base64,
            "Upload " + destination + ": " + filename,
            existing ? existing.sha : null
          );
        }).then(function () {
          URL.revokeObjectURL(previewURL);
          status.textContent = "Uploaded ✓";
          status.classList.add("is-ok");
          // Stored value is page-relative so the same data file works
          // regardless of where the page is hosted.
          return prefix + filename;
        });
      })
      .catch(function (err) {
        URL.revokeObjectURL(previewURL);
        status.textContent = "Failed: " + err.message;
        status.classList.add("is-err");
        throw err;
      });
  }

  /* --------------------------------------------------------------- state */
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

  /* --------------------------------------------------------- path access */
  function getPath(obj, path) {
    return path.split(".").reduce(function (acc, key) {
      return acc === undefined || acc === null ? undefined : acc[key];
    }, obj);
  }

  function setPath(obj, path, value) {
    var keys = path.split(".");
    var last = keys.pop();
    var target = keys.reduce(function (acc, key) {
      if (typeof acc[key] !== "object" || acc[key] === null) acc[key] = {};
      return acc[key];
    }, obj);
    target[last] = value;
  }

  function ensureObject(obj, path) {
    var keys = path.split(".");
    return keys.reduce(function (acc, key) {
      if (typeof acc[key] !== "object" || acc[key] === null) acc[key] = {};
      return acc[key];
    }, obj);
  }

  /* -------------------------------------------------------------- fields */
  function bindFields() {
    qsa("[data-bind]").forEach(function (input) {
      var path = input.getAttribute("data-bind");
      var value = getPath(state.data, path);

      if (input.type === "checkbox") {
        input.checked = !!value;
      } else {
        input.value = value === undefined || value === null ? "" : value;
      }

      var eventName = input.tagName === "SELECT" ? "change" :
        (input.type === "checkbox" ? "change" : "input");

      // The gate can be locked and unlocked repeatedly, and start() runs
      // each time — without this guard the listener would be attached
      // again on every unlock, so one keystroke would fire it N times.
      if (input.dataset.bound === "1") return;
      input.dataset.bound = "1";

      input.addEventListener(eventName, function () {
        var v = input.type === "checkbox" ? input.checked : input.value;
        if (input.type === "number") {
          v = v === "" ? "" : Number(v);
        }
        setPath(state.data, path, v);
        markDirty();
        if (path.indexOf("profile.") === 0) syncProfilePreviews();
      });
    });
  }

  function syncProfilePreviews() {
    var avatar = getPath(state.data, "profile.avatar") || "";
    var bg = getPath(state.data, "profile.background") || "";
    var a = $("avatar-preview");
    var b = $("bg-preview");
    a.src = avatar ? siteRoot(avatar) : "";
    a.style.display = avatar ? "" : "none";
    b.src = bg ? siteRoot(bg) : "";
    b.style.display = bg ? "" : "none";
  }

  /* ------------------------------------------------------- section editor */
  function iconSelect(value, link) {
    var wrap = el("div", "icon-picker");
    var sel = el("select");
    var blank = el("option", null, "— none —");
    blank.value = "";
    sel.appendChild(blank);
    ICONS.forEach(function (name) {
      var o = el("option", null, name);
      o.value = name;
      if (value === name) o.selected = true;
      sel.appendChild(o);
    });
    wrap.appendChild(sel);

    // 预览：优先显示自定义图标图，其次品牌色方块，最后单色 SVG
    var prev = el("div", "icon-preview");
    prev.innerHTML = '<img alt="" />';
    var prevImg = prev.querySelector("img");
    var prevBox = el("div", "icon-preview__box");
    prevBox.appendChild(prevImg);
    prev.appendChild(prevBox);
    wrap.appendChild(prev);   // 预览图必须挂进 DOM，否则看不到

    function refresh() {
      var custom = link && link.iconImage;
      if (custom) {
        prevImg.src = siteRoot(custom);
        prevImg.className = "is-custom";
        return;
      }
      var name = sel.value;
      if (!name) {
        prevImg.removeAttribute("src");
        prevImg.className = "";
        return;
      }
      prevImg.className = "is-brand";
      prevImg.src = siteRoot("assets/icons/br-" + name + ".png");
      prevImg.onerror = function () {
        // 没有品牌方块时回退到单色 SVG
        prevImg.className = "";
        prevImg.removeAttribute("src");
        prevBox.style.background = "rgba(245,239,233,.07)";
      };
    }

    sel.addEventListener("change", function () {
      if (link) {
        link.icon = sel.value;
        // 切换图标时清掉旧的自定义图，否则会一直盖住新图标
        if (link.iconImage) {
          link.iconImage = "";
          if (link._iconImageInput) link._iconImageInput.value = "";
        }
      }
      refresh();
      markDirty();
    });
    refresh();

    // 上传自定义图标（PNG 保留透明）
    var uploadLabel = el("label", "btn btn--ghost btn--sm file-btn");
    uploadLabel.appendChild(document.createTextNode("Upload icon"));
    var fileInput = el("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    uploadLabel.appendChild(fileInput);
    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      uploadImage(f, "icon", 512, {
        png: true, dir: CONFIG.iconDir || "links/assets/icons",
        prefix: "assets/icons/"
      }).then(function (path) {
        if (link) {
          link.iconImage = path;
          if (link._iconImageInput) link._iconImageInput.value = path;
        }
        refresh();
        markDirty();
      }).catch(function () { /* 错误已在上传队列中提示 */ });
      fileInput.value = "";
    });
    wrap.appendChild(uploadLabel);

    wrap._refresh = refresh;
    wrap._sel = sel;
    return wrap;
  }

  function field(labelText, input) {
    var wrap = el("label", "field");
    wrap.appendChild(el("span", "field-label", labelText));
    wrap.appendChild(input);
    return wrap;
  }

  function textInput(value, placeholder, onInput) {
    var input = el("input");
    input.type = "text";
    input.value = value === undefined || value === null ? "" : value;
    input.placeholder = placeholder || "";
    input.addEventListener("input", function () {
      onInput(input.value);
      markDirty();
    });
    return input;
  }

  function selectInput(value, options, onChange) {
    var sel = el("select");
    options.forEach(function (opt) {
      var o = el("option", null, opt.label);
      o.value = opt.value;
      if (value === opt.value) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      onChange(sel.value);
      markDirty();
    });
    return sel;
  }

  function checkboxInput(checked, labelText, onChange) {
    var wrap = el("label", "field field--inline");
    var box = el("input");
    box.type = "checkbox";
    box.checked = !!checked;
    box.addEventListener("change", function () {
      onChange(box.checked);
      markDirty();
    });
    wrap.appendChild(box);
    wrap.appendChild(el("span", "field-label", labelText));
    return wrap;
  }

  function moveButton(label, title, handler) {
    var btn = el("button", "icon-btn", label);
    btn.type = "button";
    btn.title = title;
    btn.addEventListener("click", handler);
    return btn;
  }

  function renderSections() {
    var host = $("section-list");
    host.innerHTML = "";

    var sections = state.data.sections || [];
    sections.forEach(function (section, sIndex) {
      var block = el("div", "section-block");

      /* ---- section header ---- */
      var head = el("div", "section-head");
      var emojiField = field("Emoji", textInput(section.emoji || "", "🔥", function (v) {
        section.emoji = v;
      }));
      emojiField.classList.add("section-emoji");
      head.appendChild(emojiField);

      var titleField = field("Section title", textInput(section.title || "", "Hot content", function (v) {
        section.title = v;
      }));
      titleField.classList.add("section-title-field");
      head.appendChild(titleField);

      var linksCount = el("span", "badge", (section.links || []).length + " links");
      head.appendChild(linksCount);

      var actions = el("div", "link-actions");
      actions.appendChild(moveButton("↑", "Move section up", function () {
        if (sIndex === 0) return;
        var tmp = sections[sIndex - 1];
        sections[sIndex - 1] = sections[sIndex];
        sections[sIndex] = tmp;
        renderSections();
        markDirty();
      }));
      actions.appendChild(moveButton("↓", "Move section down", function () {
        if (sIndex === sections.length - 1) return;
        var tmp = sections[sIndex + 1];
        sections[sIndex + 1] = sections[sIndex];
        sections[sIndex] = tmp;
        renderSections();
        markDirty();
      }));
      actions.appendChild(moveButton("✕", "Remove section", function () {
        if (!window.confirm("Remove the section “" + (section.title || "") + "” and all its links?")) return;
        sections.splice(sIndex, 1);
        renderSections();
        markDirty();
      }));
      head.appendChild(actions);
      block.appendChild(head);

      /* ---- links ---- */
      block.appendChild(el("div", "section-links-label", "Links"));

      var links = section.links || [];
      links.forEach(function (link, lIndex) {
        var row = el("div", "link-row");
        var fields = el("div", "link-fields");

        var labelField = field("Label", textInput(link.label || "", "Instagram", function (v) {
          link.label = v;
        }));
        labelField.classList.add("field--wide");
        fields.appendChild(labelField);

        var urlField = field("URL", textInput(link.url || "", "https://…", function (v) {
          link.url = v;
        }));
        urlField.classList.add("field--wide");
        fields.appendChild(urlField);

        fields.appendChild(field("Note", textInput(link.note || "", "@handle", function (v) {
          link.note = v;
        })));

        var iconPicker = iconSelect(link.icon || "", link);
        var iconField = field("Icon", iconPicker);
        fields.appendChild(iconField);

        fields.appendChild(field("Badge", textInput(link.badge || "", "BTC", function (v) {
          link.badge = v;
        })));

        fields.appendChild(field("Wallet address <em>— enables copy + QR</em>",
          textInput(link.copy || "", "0x…", function (v) {
            link.copy = v;
          })));

        var iconImgInput = textInput(link.iconImage || "",
          "assets/icons/br-fanvue.png", function (v) {
            link.iconImage = v;
            if (iconPicker._refresh) iconPicker._refresh();
          });
        link._iconImageInput = iconImgInput;
        fields.appendChild(field("Icon image <em>— optional, overrides the icon</em>",
          iconImgInput));

        var flags = el("div", "link-flags");
        flags.appendChild(checkboxInput(link.featured, "Featured style", function (v) {
          link.featured = v;
        }));
        flags.appendChild(checkboxInput(link.qr, "Show QR button", function (v) {
          link.qr = v;
        }));
        flags.appendChild(checkboxInput(link.enabled !== false, "Visible", function (v) {
          link.enabled = v;
        }));
        fields.appendChild(flags);

        row.appendChild(fields);

        var linkActions = el("div", "link-actions");
        linkActions.appendChild(moveButton("↑", "Move link up", function () {
          if (lIndex === 0) return;
          var tmp = links[lIndex - 1];
          links[lIndex - 1] = links[lIndex];
          links[lIndex] = tmp;
          renderSections();
          markDirty();
        }));
        linkActions.appendChild(moveButton("↓", "Move link down", function () {
          if (lIndex === links.length - 1) return;
          var tmp = links[lIndex + 1];
          links[lIndex + 1] = links[lIndex];
          links[lIndex] = tmp;
          renderSections();
          markDirty();
        }));
        linkActions.appendChild(moveButton("✕", "Remove link", function () {
          links.splice(lIndex, 1);
          renderSections();
          markDirty();
        }));
        row.appendChild(linkActions);

        block.appendChild(row);
      });

      var rowActions = el("div", "row-actions");
      var addLink = el("button", "btn btn--ghost btn--sm", "+ Add link");
      addLink.type = "button";
      addLink.addEventListener("click", function () {
        links.push({
          id: "l-" + Date.now().toString(36),
          label: "New link",
          note: "",
          url: "https://",
          icon: "link",
          iconImage: "",
          badge: "",
          featured: false,
          enabled: true
        });
        renderSections();
        markDirty();
      });
      rowActions.appendChild(addLink);
      block.appendChild(rowActions);

      host.appendChild(block);
    });
  }

  function initAddSection() {
    $("add-section").addEventListener("click", function () {
      if (!state.data.sections) state.data.sections = [];
      state.data.sections.push({
        id: "s-" + Date.now().toString(36),
        title: "New section",
        emoji: "✨",
        links: []
      });
      renderSections();
      markDirty();
    });
  }

  /* ---------------------------------------------------------- uploads */
  function initUploads() {
    $("avatar-file").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      uploadImage(file, "avatar", 700)
        .then(function (path) {
          state.data.profile.avatar = path;
          $("avatar-preview").src = siteRoot(path);
          $("avatar-preview").style.display = "";
          var input = qsa("[data-bind='profile.avatar']")[0];
          if (input) input.value = path;
          markDirty();
          toast("Avatar uploaded. Press “Save & Publish” to go live.", "ok");
        })
        .catch(function (err) { toast("Upload failed: " + err.message, "err"); });
      this.value = "";
    });

    $("bg-file").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      uploadImage(file, "background", 1600)
        .then(function (path) {
          state.data.profile.background = path;
          $("bg-preview").src = siteRoot(path);
          $("bg-preview").style.display = "";
          var input = qsa("[data-bind='profile.background']")[0];
          if (input) input.value = path;
          markDirty();
          toast("Background uploaded. Press “Save & Publish” to go live.", "ok");
        })
        .catch(function (err) { toast("Upload failed: " + err.message, "err"); });
      this.value = "";
    });

    $("avatar-clear").addEventListener("click", function () {
      state.data.profile.avatar = "";
      var input = qsa("[data-bind='profile.avatar']")[0];
      if (input) input.value = "";
      $("avatar-preview").style.display = "none";
      markDirty();
    });

    $("bg-clear").addEventListener("click", function () {
      state.data.profile.background = "";
      var input = qsa("[data-bind='profile.background']")[0];
      if (input) input.value = "";
      $("bg-preview").style.display = "none";
      markDirty();
    });
  }

  /* --------------------------------------------------------------- tabs */
  function initTabs() {
    qsa(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        qsa(".tab").forEach(function (t) { t.classList.remove("is-active"); });
        tab.classList.add("is-active");
        qsa(".panel").forEach(function (p) { p.classList.remove("is-active"); });
        var panel = qsa('.panel[data-panel="' + tab.getAttribute("data-tab") + '"]')[0];
        if (panel) panel.classList.add("is-active");
      });
    });
  }

  /* ----------------------------------------------------------- publishing */
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
      var path = ($("gh-path").value || CONFIG.dataPath).trim();

      Promise.all([toBase64(payload), ghGetFile(cfg, path)])
        .then(function (parts) {
          return ghPutFile(
            cfg, path, parts[0],
            "Update link page via Links Admin",
            parts[1] ? parts[1].sha : null
          );
        })
        .then(function () {
          markClean();
          setStatus("conn-status", "Published successfully.", "ok");
          toast("Published! The page refreshes in about a minute.", "ok");
        })
        .catch(function (err) {
          var message = err.message || "Unknown error";
          toast("Publish failed: " + message, "err");
          setStatus("conn-status", "Publish failed.", "err",
            message + "\n\nIf the token is expired, create a new one with “Contents: read and write” on the repository.");
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
    var tab = qsa('.tab[data-tab="' + name + '"]')[0];
    if (tab) tab.click();
  }

  /* -------------------------------------------------------------- settings */
  function initSettings() {
    $("gh-owner").value = getSetting(CONFIG.ownerKey, DEFAULTS.owner);
    $("gh-repo").value = getSetting(CONFIG.repoKey, DEFAULTS.repo);
    $("gh-branch").value = getSetting(CONFIG.branchKey, DEFAULTS.branch);
    $("gh-token").value = getSetting(CONFIG.tokenKey, "");
    $("gh-path").value = CONFIG.dataPath;

    ["gh-owner", "gh-repo", "gh-branch", "gh-token"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        setSetting(CONFIG.ownerKey, $("gh-owner").value.trim());
        setSetting(CONFIG.repoKey, $("gh-repo").value.trim());
        setSetting(CONFIG.branchKey, $("gh-branch").value.trim());
        setSetting(CONFIG.tokenKey, $("gh-token").value.trim());
      });
    });

    $("set-passcode").addEventListener("click", function () {
      var a = $("new-passcode").value;
      var b = $("confirm-passcode").value;
      if (!a) {
        toast("Enter a passcode first.", "err");
        return;
      }
      if (a !== b) {
        toast("The two passcodes do not match.", "err");
        return;
      }
      hash(a).then(function (digest) {
        setSetting(CONFIG.passcodeKey, digest);
        $("new-passcode").value = "";
        $("confirm-passcode").value = "";
        toast("Passcode saved for this browser.", "ok");
      });
    });

    $("clear-passcode").addEventListener("click", function () {
      setSetting(CONFIG.passcodeKey, "");
      toast("Passcode removed from this browser.", "ok");
    });
  }

  /* ----------------------------------------------------------------- boot */
  function defaultData() {
    return {
      profile: {
        name: "Aria Muse",
        tagline: "",
        bio: "",
        avatar: "assets/img/avatar.jpg",
        background: "assets/img/background.jpg",
        accent: "#e08fa8",
        showAvatarRing: true
      },
      theme: {
        bg: "#12100f", surface: "#1c1918", surfaceAlt: "#241f1e",
        text: "#f5efe9", muted: "#a89e98", accent: "#e08fa8", radius: 18
      },
      sections: [],
      footer: { show: true, text: "", note: "" }
    };
  }

  function loadData() {
    var url = ($("gh-path").value || CONFIG.dataPath).trim();
    // Load the published file from the live site so the admin always edits
    // what is currently deployed.
    var liveUrl = "../data/links.json";
    return fetch(liveUrl, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        state.data = json;
        // Normalise — a hand-edited file may be missing pieces.
        var d = defaultData();
        if (!state.data.profile) state.data.profile = d.profile;
        else state.data.profile = Object.assign({}, d.profile, state.data.profile);
        if (!state.data.theme) state.data.theme = d.theme;
        else state.data.theme = Object.assign({}, d.theme, state.data.theme);
        if (!Array.isArray(state.data.sections)) state.data.sections = [];
        if (!state.data.footer) state.data.footer = d.footer;
        else state.data.footer = Object.assign({}, d.footer, state.data.footer);
      })
      .catch(function (err) {
        state.data = defaultData();
        setStatus("conn-status", "Could not load the current data file.", "err", String(err.message || err));
      });
  }

  function initGate() {
    var errorBox = $("gate-error");

    /* ------------------------------------------------------------------
       The passcode is a SHA-256 hash kept in data/admin.json (shared with
       the main site admin) and mirrored into this browser's localStorage
       as a fast path. The gate therefore has three states:
         setup  — no passcode anywhere → offer to set one right here
         unlock — a passcode exists    → ask for it
         reset  — passcode forgotten   → prove ownership with a GitHub token
       ------------------------------------------------------------------ */

    function showMode(mode) {
      $("gate-setup").hidden = mode !== "setup";
      $("gate-unlock").hidden = mode !== "unlock";
      $("gate-reset").hidden = mode !== "reset";
      errorBox.hidden = true;
    }

    function enterApp() {
      $("gate").hidden = true;
      $("app").hidden = false;
      errorBox.hidden = true;
      start();
    }

    function showError(message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
    }

    /* ---- state 2: unlock with an existing passcode ---- */
    function attempt() {
      var value = $("passcode").value;
      if (!value) {
        showError("Please enter your passcode.");
        return;
      }
      hash(value).then(function (digest) {
        return passcodeMatches(digest);
      }).then(function (ok) {
        if (ok) {
          enterApp();
        } else {
          showError("Wrong passcode.");
        }
      });
    }

    /* ---- state 1: first run — set a passcode immediately ----
       The hash is mirrored into this browser AND written to the shared
       data/admin.json (when a GitHub token is available), so the same
       password works on the main site admin and on any device. */
    function savePasscode() {
      var a = $("setup-passcode").value;
      var b = $("setup-passcode-2").value;
      if (!a) {
        showError("Choose a passcode first.");
        return;
      }
      if (a !== b) {
        showError("The two passcodes do not match.");
        return;
      }
      hash(a).then(function (digest) {
        setSetting(CONFIG.passcodeKey, digest);
        $("setup-passcode").value = "";
        $("setup-passcode-2").value = "";
        enterApp();

        // Best effort: also publish the hash so the password is not tied to
        // this browser. Failure is not fatal — the local copy still works.
        publishPasscode(digest);
      });
    }

    function publishPasscode(digest) {
      var token = (getSetting(CONFIG.tokenKey, "") || "").trim();
      if (!token) return;
      var cfg = {
        owner: (getSetting(CONFIG.ownerKey, DEFAULTS.owner) || DEFAULTS.owner).trim(),
        repo: (getSetting(CONFIG.repoKey, DEFAULTS.repo) || DEFAULTS.repo).trim(),
        branch: (getSetting(CONFIG.branchKey, DEFAULTS.branch) || DEFAULTS.branch).trim(),
        token: token
      };
      Promise.all([
        toBase64(JSON.stringify({ passcode: digest }, null, 2)),
        ghGetFile(cfg, CONFIG.authPath)
      ]).then(function (parts) {
        return ghPutFile(
          cfg, CONFIG.authPath, parts[0],
          "Set the shared admin passcode from Links Admin",
          parts[1] ? parts[1].sha : null
        );
      }).then(function () {
        remotePasscode = digest;
        toast("Passcode saved and synced to the shared admin file.", "ok");
      }).catch(function () {
        toast("Passcode saved in this browser only (could not sync to the server).", "err");
      });
    }

    /* ---- state 3: forgotten passcode — reset it with a GitHub token ----
       The token proves the caller owns the repository; it is used for the API
       call only and is never written to disk by this flow.               */
    function resetPasscode() {
      var token = ($("reset-token").value || "").trim();
      var a = $("reset-passcode").value;
      var b = $("reset-passcode-2").value;

      if (!token) {
        showError("Paste your GitHub token to continue.");
        return;
      }
      if (!a) {
        showError("Choose a new passcode.");
        return;
      }
      if (a !== b) {
        showError("The two passcodes do not match.");
        return;
      }

      var cfg = {
        owner: (getSetting(CONFIG.ownerKey, DEFAULTS.owner) || DEFAULTS.owner).trim(),
        repo: (getSetting(CONFIG.repoKey, DEFAULTS.repo) || DEFAULTS.repo).trim(),
        branch: (getSetting(CONFIG.branchKey, DEFAULTS.branch) || DEFAULTS.branch).trim(),
        token: token
      };
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
            // Token is valid for the repository — write the new hash to the
            // shared file so both panels and every device accept it.
            return toBase64(JSON.stringify({ passcode: hashed }, null, 2)).then(function (encoded) {
              return ghGetFile(cfg, CONFIG.authPath).then(function (existing) {
                return ghPutFile(cfg, CONFIG.authPath, encoded, "Reset the shared admin passcode", existing ? existing.sha : null);
              });
            }).then(function () {
              return hashed;
            });
          });
        })
        .then(function (hashed) {
          setSetting(CONFIG.passcodeKey, hashed);
          remotePasscode = hashed;
          $("reset-token").value = "";
          $("reset-passcode").value = "";
          $("reset-passcode-2").value = "";
          showMode("unlock");
          showError("Passcode reset. Enter the new passcode below.");
          $("passcode").value = a;
        })
        .catch(function (err) {
          showError("Could not reset the passcode: " + (err.message || "unknown error"));
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = "Reset passcode";
        });
    }

    $("unlock-btn").addEventListener("click", attempt);
    $("passcode").addEventListener("keydown", function (e) {
      if (e.key === "Enter") attempt();
    });

    $("setup-btn").addEventListener("click", savePasscode);
    $("setup-passcode-2").addEventListener("keydown", function (e) {
      if (e.key === "Enter") savePasscode();
    });

    $("forgot-btn").addEventListener("click", function () {
      showMode("reset");
    });
    $("reset-back").addEventListener("click", function () {
      // Always go back to the unlock screen — the point of the reset
      // panel is to recover an existing passcode, not to create one.
      showMode("unlock");
    });
    $("reset-btn").addEventListener("click", resetPasscode);

    $("logout-btn").addEventListener("click", function () {
      $("gate").hidden = false;
      $("app").hidden = true;
      $("passcode").value = "";
      showMode("unlock");
    });

    // Decide which screen to show. If a passcode already exists on the
    // server (it is shared with the main site admin) we always ask for it
    // and never offer to create a new one, so the shared password cannot
    // be overwritten by accident. Only when there is no passcode anywhere
    // do we offer the setup screen.
    showMode("unlock");
    fetchRemotePasscode().then(function (remote) {
      if (!getSetting(CONFIG.passcodeKey, "") && !remote) {
        showMode("setup");
      }
    });
  }

  function start() {
    loadData().then(function () {
      bindFields();
      renderSections();
      syncProfilePreviews();
      markClean();
      setStatus("conn-status", "Loaded. Fill in your GitHub token to enable publishing.", "");
    });
  }

  function init() {
    initTabs();
    initGate();
    initAddSection();
    initUploads();
    initPublish();
    initSettings();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
