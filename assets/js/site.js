/* ==========================================================================
   ARIA MUSE — Front-end runtime
   Loads data/site.json and renders every dynamic section from it.
   The admin panel writes that same file, so the site is fully data-driven.
   ========================================================================== */
(function () {
  "use strict";

  var DATA_URL = "data/site.json";
  var data = null;
  var lightboxImages = [];
  var lightboxIndex = 0;

  /* ---------------------------------------------------------------- utils */
  function $(id) { return document.getElementById(id); }

  function setText(id, value) {
    var el = $(id);
    if (el && typeof value === "string" && value !== "") el.textContent = value;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /** Resolve an image path against the site root (handles absolute URLs). */
  function imgSrc(src) {
    if (!src) return "";
    if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:")) return src;
    return src.replace(/^\.?\//, "");
  }

  /* ------------------------------------------------------------ icon set */
  var ICONS = {
    instagram:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="2.5" width="19" height="19" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></svg>',
    tiktok:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14.5 3v10.8a3.4 3.4 0 1 1-2.9-3.36"/><path d="M14.5 3c.4 2.3 2 3.9 4.4 4.1"/></svg>',
    threads:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.186 24h-.007c-3.581-.024-6.031-1.162-7.798-3.464-1.627-2.109-2.194-4.966-2.234-7.981l-.006-.494v-.247c0-2.981.651-5.803 2.305-7.892C5.417 1.855 8.151.837 12.013.837c3.632 0 6.311.817 8.234 2.937 1.945 2.131 2.637 4.925 2.637 7.932v.247l-.006.5c-.042 3.044-.612 5.917-2.244 8.028-1.766 2.287-4.207 3.428-7.771 3.455h-.007zm.006-18.407c-2.972 0-5.15.895-6.65 2.776-1.381 1.764-1.926 4.294-1.961 7.036l-.004.438v.247c0 2.704.527 5.058 1.79 6.797 1.296 1.789 3.236 2.785 6.013 2.808h.006c2.679-.024 4.538-.926 5.84-2.644 1.182-1.594 1.7-3.91 1.737-6.677l.004-.438v-.247c0-2.737-.555-5.136-1.873-6.891-1.293-1.729-3.262-2.71-6.002-2.734zm-3.31 13.04c.64.27 1.12.36 1.83.36.97 0 1.66-.25 2.19-.74.5-.46.79-1.13.83-1.99v-4.05h1.51v4.22c0 1.15.16 2.03.51 2.66.39.69 1.04 1.05 1.99 1.05.84 0 1.45-.24 2.01-.7.51-.42.84-1.02.93-1.74.13-1.06-.32-1.87-1.25-2.52-.37-.27-.5-.45-.5-.74 0-.2.11-.38.34-.51.41-.23.93-.17 1.41.14.73.47 1.06 1.25 1.13 2.28.04.59.24.96.6 1.15.3.15.64.22 1.02.22.55 0 .98-.19 1.34-.56.4-.4.61-1.02.61-1.85v-7.4h-1.51v7.05c0 .42-.06.73-.2.91-.16.21-.42.32-.78.32-.31 0-.56-.11-.76-.33-.24-.26-.36-.66-.36-1.21v-6.74h-1.51v6.88c0 .69-.13 1.21-.39 1.55-.28.36-.69.54-1.19.54-.42 0-.76-.13-1.03-.4-.23-.23-.37-.56-.42-1 1.76-2.06 2.64-3.93 2.64-5.57v-.54h-1.55l-2.23 6.12-2.22-6.12h-1.55v.54c0 1.64.88 3.51 2.64 5.57-.05.44-.19.77-.42 1-.27.27-.61.4-1.03.4-.5 0-.91-.18-1.19-.54-.26-.34-.39-.86-.39-1.55v-6.88h-1.51v6.74c0 .55-.12.95-.36 1.21-.2.22-.45.33-.76.33-.36 0-.62-.11-.78-.32-.14-.18-.2-.49-.2-.91v-7.05h-1.5v7.4c0 .83.21 1.45.61 1.85.36.37.79.56 1.34.56z"/></svg>',
    youtube:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="5" width="20" height="14" rx="4.5"/><path d="M10.2 9.3v5.4L15.3 12z" fill="currentColor" stroke="none"/></svg>',
    x:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.2 3h3.3l-7.2 8.2L21.6 21h-6.6l-5.2-6.6L3.9 21H.6l7.7-8.8L.4 3H7l4.7 6.1zm-1.2 16h1.8L7.9 4.8H6z"/></svg>',
    spotify:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9.2"/><path d="M7.6 9.4c3-.8 6.3-.6 9.1.7"/><path d="M8.3 12.5c2.4-.6 5-.5 7.3.6"/><path d="M9 15.4c1.9-.4 3.9-.3 5.6.5"/></svg>',
    sparkle:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M12 2.5l2.3 6.2 6.2 2.3-6.2 2.3L12 19.5l-2.3-6.2L3.5 11l6.2-2.3z"/><path d="M18.8 16.2l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
    fanvue:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5h14l-9.4 9.1h5.2"/><path d="M5 19.5h14l-9.4-9.1"/></svg>',
    link:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M10 13.5a4 4 0 0 0 5.7.4l3-3a4 4 0 1 0-5.7-5.7l-1.5 1.5"/><path d="M14 10.5a4 4 0 0 0-5.7-.4l-3 3a4 4 0 1 0 5.7 5.7l1.5-1.5"/></svg>'
  };

  function iconFor(name) {
    var key = String(name || "link").toLowerCase().replace(/[^a-z]/g, "");
    return ICONS[key] || ICONS.link;
  }

  /** Build the media icon wrapper: an <img> when an iconImage is provided
      (e.g. the official Fanvue logo), otherwise the inline SVG. */
  function mediaIconEl(link) {
    var wrap = el("div", "media-icon");
    if (link && link.iconImage) {
      var img = el("img");
      img.src = imgSrc(link.iconImage);
      img.alt = (link.label || "platform") + " logo";
      img.loading = "lazy";
      wrap.appendChild(img);
    } else {
      wrap.innerHTML = iconFor(link && link.icon ? link.icon : (link && link.label));
    }
    return wrap;
  }

  /* -------------------------------------------------------------- render */
  function renderBrand() {
    var name = data.site && data.site.name ? data.site.name : "ARIA MUSE";
    var brand = $("brand-name");
    if (brand) brand.textContent = name + "®";

    var footerNav = $("footer-nav");
    if (footerNav) {
      footerNav.innerHTML = "";
      [
        { label: "About", href: "#about" },
        { label: "Portfolio", href: "#portfolio" },
        { label: "Release", href: "#release" },
        { label: "Media", href: "#media" },
        { label: "Contact", href: "#contact" }
      ].forEach(function (l) {
        var a = el("a", null, l.label);
        a.href = l.href;
        footerNav.appendChild(a);
      });
    }

    document.title = name + " — " + (data.site.tagline || "Official Site");
    var year = data.site.copyrightYear || new Date().getFullYear();
    setText("footer-copy", "© " + year + " " + name + ". All rights reserved.");
    setText("footer-location", data.site.location || "");

    // Header call-to-action: point it at the featured platform so the
    // subscribe path is always one click away.
    var featured = (data.media && data.media.links || []).filter(function (l) {
      return l.featured;
    })[0];
    var cta = $("nav-cta");
    if (cta && featured) {
      cta.textContent = "Subscribe";
      cta.href = featured.url || "#";
      cta.target = "_blank";
      cta.rel = "noopener noreferrer sponsored";
    }

    // Footer: add the featured platform as the first link.
    if (footerNav && featured) {
      var f = el("a", null, "Fanvue");
      f.href = featured.url || "#";
      f.target = "_blank";
      f.rel = "noopener noreferrer sponsored";
      footerNav.insertBefore(f, footerNav.firstChild);
    }
  }

  function renderHero() {
    var hero = data.hero || {};
    if (hero.image) {
      var img = $("hero-image");
      if (img) {
        img.src = imgSrc(hero.image);
        img.alt = (data.site && data.site.name ? data.site.name : "Aria Muse") + " hero portrait";
      }
    }
    setText("hero-eyebrow", hero.eyebrow || "");
    setText("hero-title", hero.title || (data.site && data.site.name) || "ARIA MUSE");
    setText("hero-sub", hero.subtitle || "");

    var actions = $("hero-actions");
    if (!actions) return;
    actions.innerHTML = "";
    [
      { cta: hero.primaryCta, cls: "" },
      { cta: hero.secondaryCta, cls: "btn--ghost" }
    ].forEach(function (entry) {
      var cta = entry.cta;
      if (!cta || !cta.label) return;
      var a = el("a", "btn " + entry.cls);
      a.href = cta.href || "#";
      if (/^(https?:)?\/\//i.test(cta.href || "")) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      a.appendChild(el("span", null, cta.label));
      a.appendChild(el("span", "arrow", "→"));
      actions.appendChild(a);
    });

    // A subscribe shortcut to the featured platform, if one is set.
    var featured = (data.media && data.media.links || []).filter(function (l) {
      return l.featured;
    })[0];
    if (featured) {
      var sub = el("a", "btn btn--gold");
      sub.href = featured.url || "#";
      sub.target = "_blank";
      sub.rel = "noopener noreferrer sponsored";
      sub.appendChild(el("span", null, "Subscribe on " + (featured.label || "Fanvue")));
      sub.appendChild(el("span", "arrow", "↗"));
      actions.appendChild(sub);
    }
  }

  function renderTicker() {
    var marquee = data.marquee || {};
    var track = $("ticker-track");
    var ticker = $("ticker");
    if (!track || !ticker) return;

    track.innerHTML = "";
    if (!marquee.enabled || !marquee.items || !marquee.items.length) {
      ticker.style.display = "none";
      return;
    }
    ticker.style.display = "";

    // Duplicated once so the -50% keyframe loops seamlessly.
    var run = function () {
      marquee.items.forEach(function (text) {
        track.appendChild(el("span", "ticker-item", text));
      });
    };
    run();
    run();
  }

  function renderAbout() {
    var about = data.about || {};
    setText("about-eyebrow", about.eyebrow || "");
    setText("about-title", about.title || "");

    var body = $("about-body");
    if (body) {
      body.innerHTML = "";
      var paragraphs = Array.isArray(about.body) ? about.body : [about.body];
      paragraphs.filter(Boolean).forEach(function (p) {
        body.appendChild(el("p", null, p));
      });
    }

    var stats = $("about-stats");
    if (stats) {
      stats.innerHTML = "";
      (about.stats || []).forEach(function (s) {
        var cell = el("div", "stat");
        cell.appendChild(el("div", "stat-value", s.value));
        cell.appendChild(el("div", "stat-label", s.label));
        stats.appendChild(cell);
      });
    }

    var portrait = $("about-portrait");
    if (portrait && about.portrait) portrait.src = imgSrc(about.portrait);
    setText("about-caption", about.caption || "");
  }

  /**
   * Paired column spans so every grid row fills exactly 12 columns —
   * no ragged gaps, and the rhythm alternates between wide and tall.
   *   pair 0 → 7 + 5    pair 1 → 5 + 7    pair 2 → 6 + 6
   */
  function spansForPair(pairIndex) {
    var patterns = [
      ["gallery-item--a", "gallery-item--b"],
      ["gallery-item--b", "gallery-item--a"],
      ["gallery-item--c", "gallery-item--c"]
    ];
    return patterns[pairIndex % patterns.length];
  }

  function renderGallery() {
    var gallery = data.gallery || {};
    setText("gallery-eyebrow", gallery.eyebrow || "");
    setText("gallery-title", gallery.title || "");

    var items = gallery.items || [];
    var grid = $("gallery-grid");
    if (!grid) return;
    grid.innerHTML = "";

    items.forEach(function (item, index) {
      var pair = spansForPair(Math.floor(index / 2));
      var spanClass = pair[index % 2];
      var figure = el("figure", "gallery-item reveal " + spanClass);

      var img = el("img");
      img.src = imgSrc(item.src);
      img.alt = item.alt || item.caption || "";
      img.loading = "lazy";
      figure.appendChild(img);

      var overlay = el("div", "gallery-overlay");
      overlay.appendChild(el("figcaption", "gallery-caption", item.caption || ""));
      figure.appendChild(overlay);

      figure.addEventListener("click", function () {
        openLightbox(items, index);
      });

      grid.appendChild(figure);
    });
  }

  function renderFilmstrip() {
    // Prefer the dedicated social feed; fall back to the gallery items.
    var social = (data.social && data.social.items) || [];
    var items = social.length ? social : ((data.gallery && data.gallery.items) || []);
    var track = $("filmstrip-track");
    var section = $("filmstrip");
    if (!track || !section) return;

    track.innerHTML = "";
    if (!items.length) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";

    if (data.social) {
      setText("filmstrip-eyebrow", data.social.eyebrow || "");
      setText("filmstrip-title", data.social.title || "Latest Frames");
    }

    var build = function () {
      items.forEach(function (item, index) {
        var card = el("figure", "filmstrip-card");
        var img = el("img");
        img.src = imgSrc(item.src);
        img.alt = item.alt || item.caption || "";
        img.loading = "lazy";
        card.appendChild(img);
        card.appendChild(el("figcaption", null, item.caption || ""));
        card.addEventListener("click", function () {
          openLightbox(items, index);
        });
        track.appendChild(card);
      });
    };

    build();
    build(); // duplicate for the seamless loop
  }

  function renderRelease() {
    var release = data.release || {};
    var section = $("release");
    if (!section) return;

    if (release.enabled === false) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";

    setText("release-eyebrow", release.eyebrow || "");
    setText("release-title", release.title || "");
    setText("release-artist", release.artist || (data.site && data.site.name) || "");
    setText("release-desc", release.description || "");

    var cover = $("release-cover");
    if (cover && release.cover) cover.src = imgSrc(release.cover);

    var badge = $("release-badge");
    if (badge && release.releaseDate) {
      var parsed = new Date(release.releaseDate);
      if (!isNaN(parsed.getTime())) {
        badge.textContent = parsed.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric"
        });
      }
    }

    var links = $("release-links");
    if (links) {
      links.innerHTML = "";
      (release.links || []).forEach(function (l) {
        if (!l.label) return;
        var a = el("a", "btn btn--dark");
        a.href = l.url || "#";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.appendChild(el("span", null, l.label));
        a.appendChild(el("span", "arrow", "↗"));
        links.appendChild(a);
      });
    }

    startCountdown(release.releaseDate);
  }

  function startCountdown(dateStr) {
    var target = dateStr ? new Date(dateStr) : null;
    var box = $("countdown");
    if (!target || isNaN(target.getTime())) {
      if (box) box.style.display = "none";
      return;
    }
    if (box) box.style.display = "";

    var pad = function (n) { return n < 10 ? "0" + n : String(n); };

    var tick = function () {
      var diff = target.getTime() - Date.now();
      if (diff <= 0) {
        setText("cd-days", "00");
        setText("cd-hours", "00");
        setText("cd-minutes", "00");
        setText("cd-seconds", "00");
        return;
      }
      var s = Math.floor(diff / 1000);
      setText("cd-days", String(Math.floor(s / 86400)));
      setText("cd-hours", pad(Math.floor((s % 86400) / 3600)));
      setText("cd-minutes", pad(Math.floor((s % 3600) / 60)));
      setText("cd-seconds", pad(s % 60));
    };

    tick();
    clearInterval(window.__ariaCountdown);
    window.__ariaCountdown = setInterval(tick, 1000);
  }

  function renderMedia() {
    var media = data.media || {};
    setText("media-eyebrow", media.eyebrow || "");
    setText("media-title", media.title || "");
    setText("media-blurb", media.blurb || "");

    var grid = $("media-grid");
    if (!grid) return;
    grid.innerHTML = "";

    var links = media.links || [];

    // The featured platform gets a full-width card above the rest.
    var featured = null;
    links.forEach(function (l) {
      if (!featured && l.featured) featured = l;
    });

    if (featured) {
      var fa = el("a", "media-card media-card--featured");
      fa.href = featured.url || "#";
      fa.target = "_blank";
      fa.rel = "noopener noreferrer";

      var fIcon = mediaIconEl(featured);
      fa.appendChild(fIcon);

      var fBody = el("div", "media-featured-body");
      fBody.appendChild(el("div", "media-featured-badge", "Subscribe"));
      fBody.appendChild(el("div", "media-label media-label--lg", featured.label || ""));
      if (featured.handle) fBody.appendChild(el("div", "media-handle", featured.handle));
      if (featured.note) fBody.appendChild(el("div", "media-note", featured.note));
      fa.appendChild(fBody);

      var fArrow = el("div", "media-arrow", "→");
      fa.appendChild(fArrow);

      grid.appendChild(fa);
    }

    links.forEach(function (l) {
      if (l === featured) return;

      var a = el("a", "media-card");
      a.href = l.url || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";

      var iconWrap = mediaIconEl(l);
      a.appendChild(iconWrap);

      a.appendChild(el("div", "media-label", l.label || ""));
      if (l.handle) a.appendChild(el("div", "media-handle", l.handle));

      grid.appendChild(a);
    });
  }

  function renderContact() {
    var contact = data.contact || {};
    setText("contact-eyebrow", contact.eyebrow || "");
    setText("contact-title", contact.title || "");
    setText("contact-blurb", contact.blurb || "");
    setText("contact-note", contact.socialNote || "");

    var list = $("contact-list");
    if (list) {
      list.innerHTML = "";
      // Single consolidated email address (all enquiries go to one inbox).
      if (contact.email) {
        var a = el("a", "contact-row");
        a.href = "mailto:" + contact.email;
        a.appendChild(el("span", "contact-row-label", "Email"));
        a.appendChild(el("span", "contact-row-value", contact.email));
        list.appendChild(a);
      }
    }

    var form = $("contact-form");
    if (form) {
      form.style.display = contact.formEnabled === false ? "none" : "";
      if (contact.formEndpoint) form.setAttribute("data-endpoint", contact.formEndpoint);
      else form.removeAttribute("data-endpoint");
    }
  }

  /* ------------------------------------------------------------ lightbox */
  function openLightbox(items, index) {
    lightboxImages = items;
    lightboxIndex = index;
    updateLightbox();
    var box = $("lightbox");
    box.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    $("lightbox").classList.remove("is-open");
    document.body.style.overflow = "";
  }

  function updateLightbox() {
    var item = lightboxImages[lightboxIndex];
    if (!item) return;
    $("lightbox-image").src = imgSrc(item.src);
    $("lightbox-image").alt = item.alt || item.caption || "";
    setText("lightbox-caption", item.caption || "");
  }

  function stepLightbox(delta) {
    if (!lightboxImages.length) return;
    lightboxIndex = (lightboxIndex + delta + lightboxImages.length) % lightboxImages.length;
    updateLightbox();
  }

  /* ------------------------------------------------------------- chrome */
  function initPreloader() {
    var fill = $("preloader-fill");
    var pct = 0;
    var timer = setInterval(function () {
      pct += Math.random() * 18 + 6;
      if (pct > 100) pct = 100;
      fill.style.width = pct + "%";
      if (pct >= 100) {
        clearInterval(timer);
        setTimeout(function () {
          $("preloader").classList.add("is-done");
        }, 320);
      }
    }, 130);

    // Never trap the user behind the preloader.
    setTimeout(function () {
      clearInterval(timer);
      if (fill) fill.style.width = "100%";
      var pre = $("preloader");
      if (pre) pre.classList.add("is-done");
    }, 3200);
  }

  function initHeader() {
    var header = $("site-header");
    var onScroll = function () {
      header.classList.toggle("is-stuck", window.scrollY > 40);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function initMobileNav() {
    var toggle = $("nav-toggle");
    var menu = $("mobile-menu");
    if (!toggle || !menu) return;

    var close = function () {
      toggle.classList.remove("is-open");
      menu.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    };

    toggle.addEventListener("click", function () {
      var open = !menu.classList.contains("is-open");
      toggle.classList.toggle("is-open", open);
      menu.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
    });

    Array.prototype.forEach.call(menu.querySelectorAll("a"), function (a) {
      a.addEventListener("click", close);
    });
  }

  function initReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      Array.prototype.forEach.call(items, function (i) { i.classList.add("is-visible"); });
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    Array.prototype.forEach.call(items, function (i) { observer.observe(i); });
  }

  function initLightbox() {
    var close = $("lightbox-close");
    var prev = $("lightbox-prev");
    var next = $("lightbox-next");
    var box = $("lightbox");
    if (!close || !prev || !next || !box) return;

    close.addEventListener("click", closeLightbox);
    prev.addEventListener("click", function () { stepLightbox(-1); });
    next.addEventListener("click", function () { stepLightbox(1); });

    box.addEventListener("click", function (e) {
      if (e.target === box) closeLightbox();
    });

    document.addEventListener("keydown", function (e) {
      if (!box.classList.contains("is-open")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") stepLightbox(-1);
      if (e.key === "ArrowRight") stepLightbox(1);
    });
  }

  /**
   * Contact form.
   * Uses Formspree if the admin configured an endpoint, otherwise falls back
   * to opening the visitor's mail client with the message pre-filled.
   */
  function initContactForm() {
    var form = $("contact-form");
    if (!form) return;

    // Lock the submit button until every required field is valid, so blank
    // submissions can never reach the (metered) Formspree endpoint.
    var sendBtn = form.querySelector('button[type="submit"]');
    function syncButtonState() {
      if (sendBtn) sendBtn.disabled = !form.checkValidity();
    }
    form.addEventListener("input", syncButtonState);
    form.addEventListener("change", syncButtonState);
    form.addEventListener("blur", syncButtonState, true);
    syncButtonState();

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var status = $("form-status");
      var endpoint = form.getAttribute("data-endpoint");
      var payload = {
        name: $("cf-name").value,
        email: $("cf-email").value,
        subject: $("cf-subject").value,
        message: $("cf-message").value
      };

      if (endpoint) {
        status.textContent = "Sending…";
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload)
        })
          .then(function (res) {
            if (!res.ok) throw new Error("Request failed");
            status.textContent = "Thank you — your message is on its way.";
            form.reset();
            syncButtonState();
          })
          .catch(function () {
            status.textContent = "Could not send. Please email us directly.";
          });
        return;
      }

      var target = (data.contact && data.contact.email) || "hello@ariamuse.com";
      var subject = payload.subject || "Enquiry from " + payload.name;
      var body = payload.message + "\n\n—\n" + payload.name + "\n" + payload.email;
      window.location.href =
        "mailto:" + target + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      status.innerHTML =
        "Opening your email app… If nothing happens, " +
        '<a href="mailto:' + target + '?subject=' + encodeURIComponent(subject) +
        '">click here to email ' + target + "</a>.";
    });
  }

  /* --------------------------------------------------------------- boot */
  function applyAll() {
    renderBrand();
    renderHero();
    renderTicker();
    renderAbout();
    renderGallery();
    renderFilmstrip();
    renderRelease();
    renderMedia();
    renderContact();
    initReveal();
  }

  function boot() {
    initPreloader();
    initHeader();
    initMobileNav();
    initLightbox();
    initContactForm();

    fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        data = json;
        applyAll();
      })
      .catch(function (err) {
        // Keep the statically-rendered markup as the fallback.
        console.warn("[Aria Muse] Could not load data/site.json —", err.message);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
