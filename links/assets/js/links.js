/* ==========================================================================
   Aria Muse — link page runtime
   Renders sections/links from data/links.json, handles copy-to-clipboard,
   QR display and share. No framework, no build step.
   ========================================================================== */
(function () {
  "use strict";

  var DATA_URL = "data/links.json";
  var ICON_URL = "assets/icons/";

  var els = {
    bgImage: document.getElementById("bg-image"),
    avatar: document.getElementById("avatar"),
    avatarRing: document.getElementById("avatar-ring"),
    name: document.getElementById("name"),
    tagline: document.getElementById("tagline"),
    bio: document.getElementById("bio"),
    sections: document.getElementById("sections"),
    footer: document.getElementById("footer"),
    footerText: document.getElementById("footer-text"),
    footerNote: document.getElementById("footer-note"),
    toast: document.getElementById("toast"),
    shareBtn: document.getElementById("share-btn"),
    qrModal: document.getElementById("qr-modal"),
    qrHolder: document.getElementById("qr-holder"),
    qrLabel: document.getElementById("qr-label"),
    qrTitle: document.getElementById("qr-title"),
    qrCopy: document.getElementById("qr-copy"),
    qrClose: document.getElementById("qr-close")
  };

  var iconCache = {};
  var qrPayload = "";

  /* ------------------------------------------------------------- helpers */
  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function svgIcon(pathData, className) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    if (className) svg.setAttribute("class", className);
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);
    return svg;
  }

  /** Inline SVG markup for the small UI glyphs used inside cards. */
  var UI = {
    copy:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/>' +
      '<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    qr:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/>' +
      '<rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>' +
      '<path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/></svg>',
    chevron:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
  };

  function uiIcon(name, className) {
    var wrap = document.createElement("span");
    wrap.innerHTML = UI[name] || "";
    var svg = wrap.firstChild;
    if (svg && className) svg.setAttribute("class", className);
    return svg;
  }

  /** Load an icon's SVG path data once and reuse it. */
  function loadIcon(name) {
    if (iconCache[name] !== undefined) return Promise.resolve(iconCache[name]);
    return fetch(ICON_URL + name + ".svg")
      .then(function (res) {
        if (!res.ok) throw new Error("icon " + name);
        return res.text();
      })
      .then(function (text) {
        var m = text.match(/d="([^"]+)"/);
        var d = m ? m[1] : "";
        iconCache[name] = d;
        return d;
      })
      .catch(function () {
        iconCache[name] = "";
        return "";
      });
  }

  var toastTimer = null;
  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("is-visible");
    }, 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for non-secure contexts.
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  /** Shorten an address for display: first 10 … last 8. */
  function truncate(text, head, tail) {
    if (!text || text.length <= head + tail + 3) return text || "";
    return text.slice(0, head) + "…" + text.slice(-tail);
  }

  /* -------------------------------------------------------------- render */
  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    var map = {
      "--bg": theme.bg,
      "--surface": theme.surface,
      "--surface-alt": theme.surfaceAlt,
      "--text": theme.text,
      "--muted": theme.muted,
      "--accent": theme.accent
    };
    Object.keys(map).forEach(function (key) {
      if (map[key]) root.style.setProperty(key, map[key]);
    });
    if (theme.radius) root.style.setProperty("--radius", theme.radius + "px");
  }

  function renderProfile(profile) {
    if (!profile) return;
    if (profile.name) {
      els.name.textContent = profile.name;
      document.title = profile.name + " — Links";
    }
    els.tagline.textContent = profile.tagline || "";
    els.tagline.hidden = !profile.tagline;
    els.bio.textContent = profile.bio || "";
    els.bio.hidden = !profile.bio;

    if (profile.avatar) {
      els.avatar.src = profile.avatar;
      els.avatar.alt = profile.name || "Avatar";
    }
    if (profile.background) {
      els.bgImage.src = profile.background;
    }
    if (profile.accent) {
      document.documentElement.style.setProperty("--accent", profile.accent);
    }
    els.avatarRing.classList.toggle("is-plain", profile.showAvatarRing === false);
  }

  function buildIcon(link) {
    var box = el("div", "link-icon");
    if (link.iconImage) {
      var img = el("img");
      img.src = link.iconImage;
      img.alt = "";
      img.addEventListener("error", function () {
        // Fall back to the named icon if the image is missing.
        box.innerHTML = "";
        if (link.icon) {
          loadIcon(link.icon).then(function (d) {
            if (d) box.appendChild(svgIcon(d));
          });
        }
      });
      box.appendChild(img);
      return box;
    }
    if (link.icon) {
      loadIcon(link.icon).then(function (d) {
        if (d) box.appendChild(svgIcon(d));
        else box.appendChild(svgIcon(
          "M10.6 13.4a2 2 0 0 0 2.8 0l3.2-3.2a2 2 0 1 0-2.8-2.8l-1.6 1.6M13.4 10.6" +
          "a2 2 0 0 0-2.8 0l-3.2 3.2a2 2 0 1 0 2.8 2.8l1.6-1.6"));
      });
    }
    return box;
  }

  function isWallet(link) {
    return !!(link.copy || link.qr || /^(bitcoin|ethereum|tether|usdt|btc|eth|litecoin|dogecoin|solana|tron|matic):/i.test(link.url || ""));
  }

  function buildLink(link) {
    var card = el("a", "link-card");
    card.href = link.url || "#";
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    if (link.featured) card.classList.add("is-featured");

    var wallet = isWallet(link);
    if (wallet) card.classList.add("is-wallet");

    card.appendChild(buildIcon(link));

    var body = el("div", "link-body");
    var label = el("div", "link-label");
    label.appendChild(document.createTextNode(link.label || ""));
    if (link.badge) label.appendChild(el("span", "link-badge", link.badge));
    body.appendChild(label);

    var note = link.note || "";
    if (wallet && link.copy) note = truncate(link.copy, 12, 10);
    if (note) {
      var noteEl = el("div", "link-note", note);
      if (wallet && link.copy) noteEl.title = link.copy;
      body.appendChild(noteEl);
    }
    card.appendChild(body);

    if (wallet && link.qr && window.QRCode) {
      var qrBtn = el("button", "link-qr");
      qrBtn.type = "button";
      qrBtn.title = "Show QR code";
      qrBtn.setAttribute("aria-label", "Show QR code for " + (link.label || ""));
      qrBtn.appendChild(uiIcon("qr"));
      qrBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openQr(link);
      });
      card.appendChild(qrBtn);
    }

    if (wallet && link.copy) {
      var copyBtn = el("button", "link-copy");
      copyBtn.type = "button";
      copyBtn.title = "Copy address";
      copyBtn.setAttribute("aria-label", "Copy " + (link.label || "address"));
      copyBtn.appendChild(uiIcon("copy"));
      copyBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        copyText(link.copy)
          .then(function () { toast("Address copied"); })
          .catch(function () { toast("Copy failed — long-press to select"); });
      });
      card.appendChild(copyBtn);
    } else {
      var cta = el("span", "link-cta");
      cta.appendChild(uiIcon("chevron"));
      card.appendChild(cta);
    }

    return card;
  }

  function renderSections(sections) {
    els.sections.innerHTML = "";
    (sections || []).forEach(function (section) {
      var links = (section.links || []).filter(function (l) {
        return l.enabled !== false;
      });
      if (!links.length) return;

      var wrap = el("section", "section");

      var title = el("h2", "section-title");
      if (section.emoji) {
        var emo = el("span", "emoji", section.emoji);
        title.appendChild(emo);
      }
      title.appendChild(document.createTextNode(section.title || ""));
      wrap.appendChild(title);

      var list = el("div", "link-list");
      links.forEach(function (link) {
        list.appendChild(buildLink(link));
      });
      wrap.appendChild(list);
      els.sections.appendChild(wrap);
    });
  }

  function renderFooter(footer) {
    if (!footer || footer.show === false) {
      els.footer.hidden = true;
      return;
    }
    els.footerText.textContent = footer.text || "";
    els.footerNote.textContent = footer.note || "";
    els.footerNote.hidden = !footer.note;
  }

  /* ----------------------------------------------------------- qr modal */
  function openQr(link) {
    var payload = link.copy || link.url;
    if (!payload || !window.QRCode) return;

    qrPayload = payload;
    els.qrTitle.textContent = "Scan to pay — " + (link.label || "");
    els.qrLabel.textContent = payload;
    els.qrHolder.innerHTML = "";
    try {
      els.qrHolder.innerHTML = window.QRCode.toSvg(payload, { margin: 3 });
    } catch (e) {
      els.qrHolder.textContent = "QR unavailable";
    }
    els.qrModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeQr() {
    els.qrModal.hidden = true;
    document.body.style.overflow = "";
  }

  els.qrClose.addEventListener("click", closeQr);
  els.qrModal.addEventListener("click", function (e) {
    if (e.target.hasAttribute("data-close")) closeQr();
  });
  els.qrCopy.addEventListener("click", function () {
    copyText(qrPayload)
      .then(function () { toast("Address copied"); })
      .catch(function () { toast("Copy failed"); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !els.qrModal.hidden) closeQr();
  });

  /* ------------------------------------------------------------- share */
  els.shareBtn.addEventListener("click", function () {
    var url = window.location.href;
    var title = els.name.textContent || "Links";
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function () {});
      return;
    }
    copyText(url)
      .then(function () { toast("Link copied"); })
      .catch(function () { toast("Copy failed"); });
  });

  /* --------------------------------------------------------------- load */
  function render(data) {
    applyTheme(data.theme);
    renderProfile(data.profile);
    renderSections(data.sections);
    renderFooter(data.footer);
  }

  function boot() {
    fetch(DATA_URL, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(render)
      .catch(function (err) {
        // Keep the page usable even if the data file cannot be fetched
        // (for example when opened straight from the file system).
        console.error("Failed to load link data:", err);
        document.body.setAttribute("data-load-error", "1");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
