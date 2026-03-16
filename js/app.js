(function () {
  var CART_KEY = "clone_mobile_cart";
  var CART_SIGNATURE_KEY = "clone_mobile_cart_signature";
  var CHECKOUT_SNAPSHOT_KEY = "clone_mobile_checkout_snapshot";
  var DRAWER_CLOSE_MS = 240;
  var OVERLAY_CLICK_GUARD_MS = 220;
  var memoryCart = [];
  var specEscHandler = null;
  var localCartEscHandler = null;
  var addCartEscHandler = null;
  var bodyLockState = null;
  var nativeToastRef = null;
  var purchaseDelegatedBound = false;
  var purchaseObserver = null;
  var lastPurchaseAt = 0;
  var LIKE_KEY_PREFIX = "clone_mobile_like_";
  var HELPFUL_VOTES_KEY = "clone_mobile_helpful_votes";
  var likeStorageKeyCache = null;
  var deferredUiBindScheduled = false;
  var blockPurchaseUntil = 0;
  var shopSectionSnapshot = null;
  var shopSectionAnchor = null;
  var shopStabilityObserver = null;
  var shopStabilityTickQueued = false;
  var customSpecificationItems = null;
  var customDataObserver = null;
  var customDataTickQueued = false;
  var isApplyingCustomData = false;
  var customDataReleaseTimer = null;
  var preloadReleased = false;

  function safeParse(value, fallback) {
    try { return JSON.parse(value); } catch (error) { return fallback; }
  }

  function normalizeText(text) {
    var raw = String(text || "").toLowerCase().trim();
    if (typeof raw.normalize === "function") {
      return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    return raw;
  }

  function readCustomProductData() {
    var data = window.CM_PRODUCT_DATA;
    if (!data || typeof data !== "object") return null;
    return data;
  }

  function normalizePriceValue(value) {
    var raw = String(value || "").trim();
    raw = raw.replace(/^R\$\s*/i, "");
    return raw;
  }

  function getNestedValue(source, paths) {
    if (!source || typeof source !== "object" || !Array.isArray(paths)) return "";
    var i;
    for (i = 0; i < paths.length; i += 1) {
      var path = paths[i];
      if (!Array.isArray(path) || !path.length) continue;
      var cursor = source;
      var j;
      for (j = 0; j < path.length; j += 1) {
        if (!cursor || typeof cursor !== "object") {
          cursor = "";
          break;
        }
        cursor = cursor[path[j]];
      }
      if (cursor !== undefined && cursor !== null && String(cursor).trim()) {
        return String(cursor).trim();
      }
    }
    return "";
  }

  function getPricingFromData(data) {
    var current = normalizePriceValue(getNestedValue(data, [
      ["pricing", "current"],
      ["pricing", "price"],
      ["currentPrice"],
      ["price"]
    ]));
    var old = normalizePriceValue(getNestedValue(data, [
      ["pricing", "old"],
      ["pricing", "original"],
      ["oldPrice"]
    ]));
    var discount = getNestedValue(data, [
      ["pricing", "discount"],
      ["discount"]
    ]);
    var percent = getNestedValue(data, [
      ["pricing", "percent"],
      ["discountPercent"]
    ]);

    if (!discount && percent) {
      var normalizedPercent = percent;
      if (normalizedPercent.indexOf("%") < 0) normalizedPercent += "%";
      if (!/^[-+]/.test(normalizedPercent)) normalizedPercent = "-" + normalizedPercent;
      discount = normalizedPercent;
    }

    return { current: current, old: old, discount: discount };
  }

  function replaceNodeText(node, text) {
    if (!node) return;
    node.textContent = String(text || "");
  }

  function applyMainPriceNode(node, currentPrice) {
    if (!node || !currentPrice) return;

    var currencyNode = node.querySelector(".lxVQV3");
    var amountNode = node.querySelector(".GRGWUp, .OAllJn");

    if (currencyNode) replaceNodeText(currencyNode, "R$");
    if (amountNode) {
      replaceNodeText(amountNode, currentPrice);
      return;
    }
    if (currencyNode) return;

    replaceNodeText(node, "R$" + currentPrice);
  }

  function applyTitleFromData(data) {
    var title = String((data && data.title) || "").trim();
    if (!title) return;

    // Update only explicit title nodes to avoid replacing parent containers.
    var titleTargets = document.querySelectorAll(".KrVWaM .UBteaH, .dMAFry, meta[name='twitter:title']");
    var i;
    for (i = 0; i < titleTargets.length; i += 1) {
      var node = titleTargets[i];
      if (node.tagName === "META") {
        node.setAttribute("content", title + " | Shopee Brasil");
      } else {
        node.textContent = title;
      }
    }

    document.title = title + " | Shopee Brasil";
    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", title + " | Shopee Brasil");
  }

  function applyPriceFromData(data) {
    var pricing = getPricingFromData(data);
    var current = pricing.current;
    var old = pricing.old;
    var discount = pricing.discount;
    var i;

    if (current) {
      var legacyPriceText = "R$ " + current;
      var legacyPriceTargets = document.querySelectorAll(".N73mSu.EArH21");
      for (i = 0; i < legacyPriceTargets.length; i += 1) {
        var legacyNode = legacyPriceTargets[i];
        if (!legacyNode || !legacyNode.closest(".product-page")) continue;
        replaceNodeText(legacyNode, legacyPriceText);
      }

      var currentPriceTargets = document.querySelectorAll(".ViRt8Y ._1xSVm, .Yt99p5 ._1xSVm, ._1xSVm");
      for (i = 0; i < currentPriceTargets.length; i += 1) {
        applyMainPriceNode(currentPriceTargets[i], current);
      }
    }

    if (old) {
      var oldPriceText = "R$" + old;
      var oldPriceTargets = document.querySelectorAll(".TkroVL .J2LKoM span, .TkroVL .J2LKoM, .J2LKoM span");
      for (i = 0; i < oldPriceTargets.length; i += 1) {
        replaceNodeText(oldPriceTargets[i], oldPriceText);
      }
    }

    if (discount) {
      var discountTargets = document.querySelectorAll(".MtXX1P .IDGqoS span, .IDGqoS .CMJxde, .IDGqoS");
      for (i = 0; i < discountTargets.length; i += 1) {
        var discountNode = discountTargets[i];
        if (!discountNode) continue;
        if (discountNode.children.length > 0 && discountNode.classList.contains("IDGqoS")) continue;
        replaceNodeText(discountNode, discount);
      }
    }
  }

  function resolveDescriptionParagraphs(data) {
    var description = data && data.description;
    var paragraphs = [];

    if (Array.isArray(description)) {
      paragraphs = description.slice();
    } else if (typeof description === "string") {
      paragraphs = description.split(/\r?\n/);
    } else if (description && typeof description === "object") {
      if (Array.isArray(description.paragraphs)) {
        paragraphs = description.paragraphs.slice();
      } else if (Array.isArray(description.lines)) {
        paragraphs = description.lines.slice();
      } else if (typeof description.text === "string") {
        paragraphs = description.text.split(/\r?\n/);
      }
    }

    if (!paragraphs.length && Array.isArray(data && data.descriptionParagraphs)) {
      paragraphs = data.descriptionParagraphs.slice();
    }

    return paragraphs;
  }

  function resolveDescriptionImage(data) {
    var image = getNestedValue(data, [
      ["description", "image"],
      ["description", "imageSrc"],
      ["description", "banner"],
      ["descriptionImage"]
    ]);
    return String(image || "").trim();
  }

  function applyDescriptionFromData(data) {
    var content = document.querySelector(".MQQIj8 .IsaxdN");
    if (!content) return;
    var section = content.closest(".MQQIj8");
    var toggle = section ? section.querySelector(".__slJM.hairline-border-up") : null;
    var imageSrc = resolveDescriptionImage(data);

    if (imageSrc) {
      if (content.dataset.cmDescMode !== "image" || content.dataset.cmDescImageSrc !== imageSrc) {
        content.innerHTML = "";
        var image = document.createElement("img");
        image.src = imageSrc;
        image.alt = String((data && data.title) || "Descrição do produto");
        image.className = "cm-description-image";
        image.style.display = "block";
        image.style.width = "100%";
        image.style.height = "auto";
        content.appendChild(image);
        content.dataset.cmDescImageSrc = imageSrc;
      }

      content.dataset.cmDescMode = "image";
      content.dataset.cmDescSignature = "";
      content.style.maxHeight = "none";
      content.style.overflow = "visible";
      content.style.transition = "";

      if (section) {
        section.dataset.cmDescMode = "image";
        section.dataset.cmDescExpanded = "1";
      }
      if (toggle) {
        toggle.style.display = "none";
        toggle.setAttribute("aria-hidden", "true");
        toggle.setAttribute("tabindex", "-1");
      }
      return;
    }

    var paragraphs = resolveDescriptionParagraphs(data);
    if (!paragraphs.length) return;

    content.dataset.cmDescMode = "text";
    content.dataset.cmDescImageSrc = "";
    if (section) section.dataset.cmDescMode = "text";
    if (toggle) {
      toggle.style.display = "";
      toggle.removeAttribute("aria-hidden");
      toggle.setAttribute("tabindex", "0");
    }

    var descriptionSignature = paragraphs.join("\u0001");
    if (content.dataset.cmDescSignature !== descriptionSignature) {
      content.innerHTML = "";
      var i;
      for (i = 0; i < paragraphs.length; i += 1) {
        var paragraph = paragraphs[i];
        var text = paragraph === null || paragraph === undefined ? "" : String(paragraph);
        var p = document.createElement("p");
        p.className = "qsfBix b5sdqk";
        if (text.trim()) {
          p.textContent = text;
        } else {
          p.appendChild(document.createElement("br"));
        }
        content.appendChild(p);
      }
      content.dataset.cmDescSignature = descriptionSignature;
    }

    var isExpanded = section && section.dataset.cmDescExpanded === "1";
    var collapsedHeight = Number(getNestedValue(data, [
      ["description", "collapsedHeight"],
      ["descriptionCollapsedHeight"]
    ]));

    if (section && !isNaN(collapsedHeight) && collapsedHeight > 0) {
      section.dataset.cmDescCollapsedMax = String(collapsedHeight);
    }

    if (!isNaN(collapsedHeight) && collapsedHeight > 0) {
      content.style.maxHeight = isExpanded
        ? content.scrollHeight + "px"
        : collapsedHeight + "px";
    } else if (isExpanded) {
      content.style.maxHeight = content.scrollHeight + "px";
    }
  }

  function normalizeSpecificationItem(item) {
    if (!item) return null;
    var key = "";
    var value = "";

    if (typeof item === "string") {
      var parsed = parseSpecLine(item);
      if (!parsed) return null;
      key = parsed.key;
      value = parsed.value;
    } else if (typeof item === "object") {
      key = String(item.key || item.label || item.name || "").trim();
      value = String(item.value || item.text || "").trim();
      if (!value && key) {
        value = key;
        key = "";
      }
    }

    if (!key && !value) return null;
    return { key: key, value: value };
  }

  function applySpecificationsFromData(data) {
    var summary = getNestedValue(data, [
      ["specifications", "summary"],
      ["specs", "summary"],
      ["specificationSummary"]
    ]);
    if (summary) {
      var summaryEl = document.querySelector(".HMuIVb .M7ay9s");
      if (summaryEl) summaryEl.textContent = summary;
    }

    var sourceItems = null;
    if (Array.isArray(data && data.specifications && data.specifications.items)) {
      sourceItems = data.specifications.items;
    } else if (Array.isArray(data && data.specs && data.specs.items)) {
      sourceItems = data.specs.items;
    } else if (Array.isArray(data && data.specifications)) {
      sourceItems = data.specifications;
    } else if (Array.isArray(data && data.specItems)) {
      sourceItems = data.specItems;
    }

    if (!sourceItems || !sourceItems.length) {
      customSpecificationItems = null;
      return;
    }

    var items = [];
    var i;
    if (summary) {
      items.push({ key: "Resumo", value: summary });
    }

    for (i = 0; i < sourceItems.length; i += 1) {
      var normalizedItem = normalizeSpecificationItem(sourceItems[i]);
      if (normalizedItem) items.push(normalizedItem);
    }

    customSpecificationItems = items.length ? items : null;
  }

  function applyImagesFromData(data) {
    var images = data && data.images;
    if (!Array.isArray(images) || !images.length) return;

    var items = document.querySelectorAll(".product-carousel .stardust-carousel__item");
    var i;
    for (i = 0; i < items.length; i += 1) {
      var src = String(images[i % images.length] || "").trim();
      if (!src) continue;

      var source = items[i].querySelector("source");
      var img = items[i].querySelector("img");
      if (source) {
        source.setAttribute("srcset", src);
        source.dataset.srcset = src;
      }
      if (img) {
        img.src = src;
        img.setAttribute("srcset", src);
        img.dataset.src = src;
        img.dataset.srcset = src;
      }
    }

    var ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) ogImage.setAttribute("content", String(images[0] || "").trim());
  }

  function applyRatingFromData(data) {
    var rating = data && data.rating;
    if (!rating || typeof rating !== "object") return;

    if (rating.average) {
      var avg = document.querySelector(".product-ratings-header__stats-avg");
      if (avg) avg.textContent = String(rating.average);
    }
    if (rating.reviewsLabel) {
      var count = document.querySelector(".product-ratings-header__stats-count");
      if (count) count.textContent = String(rating.reviewsLabel);
    }
    if (rating.seeAllLabel) {
      var seeAll = document.querySelector(".product-ratings__see-all-reviews-btn span");
      if (seeAll) seeAll.textContent = String(rating.seeAllLabel);
    }
  }

  function getReviewMedia(review) {
    var media = review && review.media && typeof review.media === "object" ? review.media : {};
    var images = [];
    if (Array.isArray(media.images)) {
      images = media.images.slice();
    } else if (Array.isArray(review && review.images)) {
      images = review.images.slice();
    }

    var video = null;
    if (media.video && typeof media.video === "object") {
      video = {
        cover: String(media.video.cover || "").trim(),
        duration: String(media.video.duration || "").trim()
      };
    } else if (review && review.video && typeof review.video === "object") {
      video = {
        cover: String(review.video.cover || "").trim(),
        duration: String(review.video.duration || "").trim()
      };
    }

    if (video && !video.cover) video = null;
    return { images: images, video: video };
  }

  function applyReviewMedia(card, review) {
    if (!card) return;
    var mediaRoot = card.querySelector(".P6FJ0T");
    if (!mediaRoot) return;

    var media = getReviewMedia(review);
    var images = media.images || [];
    var video = media.video;
    var hasMedia = (video && video.cover) || images.length > 0;

    if (!hasMedia) {
      mediaRoot.innerHTML = "";
      if (mediaRoot.parentElement) mediaRoot.parentElement.style.display = "none";
      return;
    }
    if (mediaRoot.parentElement) mediaRoot.parentElement.style.display = "";

    var previewIcon =
      "https://deo.shopeemobile.com/shopee/shopee-mobilemall-live-sg/rating/a41ecb27d2f16c84a965.svg";
    var videoIcon =
      "https://deo.shopeemobile.com/shopee/shopee-mobilemall-live-sg/rating/b206e490175c9e7ca2a4.svg";

    mediaRoot.innerHTML = "";

    if (video && video.cover) {
      var videoWrap = document.createElement("div");
      videoWrap.className = "Zf1C2g qSmqJq FZJ9Yk";

      var videoInner = document.createElement("div");
      videoInner.className = "p54erQ";

      var cover = document.createElement("div");
      cover.className = "XdKB9x Z5EFak";
      cover.style.backgroundImage = 'url("' + video.cover + '")';

      var playOverlay = document.createElement("div");
      playOverlay.className = "fYYGCO uJLZ10";
      var playIcon = document.createElement("img");
      playIcon.src = previewIcon;
      playOverlay.appendChild(playIcon);

      var durationWrap = document.createElement("div");
      durationWrap.className = "pKf4oa";
      var durationIcon = document.createElement("img");
      durationIcon.className = "LrpsLy";
      durationIcon.src = videoIcon;
      durationIcon.alt = "video";
      var durationText = document.createElement("span");
      durationText.className = "vueh62";
      durationText.textContent = video.duration || "0:00";

      durationWrap.appendChild(durationIcon);
      durationWrap.appendChild(durationText);
      cover.appendChild(playOverlay);
      cover.appendChild(durationWrap);
      videoInner.appendChild(cover);
      videoWrap.appendChild(videoInner);
      mediaRoot.appendChild(videoWrap);
    }

    var i;
    for (i = 0; i < images.length; i += 1) {
      var imageUrl = String(images[i] || "").trim();
      if (!imageUrl) continue;

      var imageWrap = document.createElement("div");
      imageWrap.className = "Zf1C2g qSmqJq FZJ9Yk";

      var picture = document.createElement("picture");
      picture.className = "P37NgF";

      var source = document.createElement("source");
      source.className = "P37NgF";
      source.type = "image/webp";
      source.setAttribute("srcset", imageUrl);

      var img = document.createElement("img");
      img.loading = "lazy";
      img.className = "HcSdrS lazyload p54erQ";
      img.src = imageUrl;
      img.setAttribute("srcset", "");
      img.alt = "thumbnail";

      picture.appendChild(source);
      picture.appendChild(img);
      imageWrap.appendChild(picture);
      mediaRoot.appendChild(imageWrap);
    }
  }

  function applyReviewsFromData(data) {
    var reviews = data && data.reviews;
    if (!Array.isArray(reviews) || !reviews.length) return;

    var cards = document.querySelectorAll("[data-cmtid]");
    var i;
    for (i = 0; i < cards.length && i < reviews.length; i += 1) {
      var review = reviews[i] || {};
      var card = cards[i];

      var author = card.querySelector(".iMluja");
      if (author && review.author) author.textContent = String(review.author);

      var avatar = card.querySelector(".vGYue4 img, .mZPIVM");
      if (avatar && review.avatar) {
        avatar.src = String(review.avatar);
        avatar.setAttribute("srcset", "");
      }

      var date = card.querySelector(".irmMta");
      if (date && review.date) date.textContent = String(review.date);

      var text = card.querySelector(".GVam6_ .GVam6_");
      if (text && review.text) text.textContent = String(review.text);

      var ratingValue = Number(review.rating);
      var stars = card.querySelectorAll(".HbONw2 .PJebhj");
      if (!isNaN(ratingValue) && stars.length) {
        var clamped = Math.max(0, Math.min(5, Math.round(ratingValue)));
        var j;
        for (j = 0; j < stars.length; j += 1) {
          stars[j].style.opacity = j < clamped ? "1" : "0.32";
        }
      }

      var helpfulCount = Number(review.helpful);
      var helpfulLabel = card.querySelector(".oHOUba .jmidpM .tH75jq:last-child");
      var helpfulButton = card.querySelector(".oHOUba .jmidpM");
      if (!isNaN(helpfulCount) && helpfulLabel) {
        helpfulLabel.textContent = "(" + helpfulCount.toLocaleString("pt-BR") + ")";
      }
      if (!isNaN(helpfulCount) && helpfulButton) {
        helpfulButton.dataset.cmHelpfulBaseCount = String(helpfulCount);
      }

      applyReviewMedia(card, review);
    }
  }

  function applyCustomProductData() {
    var data = readCustomProductData();
    if (!data) return;
    applyTitleFromData(data);
    applyPriceFromData(data);
    applyImagesFromData(data);
    applyDescriptionFromData(data);
    applySpecificationsFromData(data);
    applyRatingFromData(data);
    applyReviewsFromData(data);
  }

  function isBlockedRuntimeScript(url) {
    var src = String(url || "");
    if (!src) return false;
    if (src.indexOf("deo.shopeemobile.com/shopee/shopee-mobilemall-live-sg/assets/") < 0) return false;
    return /\/assets\/(?:webpack-runtime|sfu-stable|sfu-latest|entry-modules|bundle)\..*\.(?:2017|2023)\.js/i.test(src);
  }

  function installRuntimeScriptGuard() {
    if (window.__CM_RUNTIME_GUARD_INSTALLED__) return;
    window.__CM_RUNTIME_GUARD_INSTALLED__ = true;

    var originalAppendChild = Node.prototype.appendChild;
    var originalInsertBefore = Node.prototype.insertBefore;

    function shouldBlock(node) {
      if (!node || node.nodeType !== 1) return false;
      if (String(node.tagName).toUpperCase() !== "SCRIPT") return false;
      var src = node.getAttribute("src") || node.src || "";
      if (!isBlockedRuntimeScript(src)) return false;
      node.setAttribute("data-cm-blocked-runtime", "1");
      return true;
    }

    Node.prototype.appendChild = function (child) {
      if (shouldBlock(child)) return child;
      return originalAppendChild.call(this, child);
    };

    Node.prototype.insertBefore = function (newNode, referenceNode) {
      if (shouldBlock(newNode)) return newNode;
      return originalInsertBefore.call(this, newNode, referenceNode);
    };
  }

  function removeBlockedRuntimeScriptsFromDom() {
    var scripts = document.querySelectorAll("script[src]");
    var i;
    for (i = 0; i < scripts.length; i += 1) {
      var src = scripts[i].getAttribute("src") || "";
      if (!isBlockedRuntimeScript(src)) continue;
      scripts[i].setAttribute("data-cm-blocked-runtime", "1");
      if (scripts[i].parentNode) scripts[i].parentNode.removeChild(scripts[i]);
    }
  }

  function getShopSectionElement() {
    return document.querySelector(".page-section.page-section--no-border.B4mJ8o");
  }

  function isShopLoadFailureText(text) {
    var normalized = normalizeText(text);
    if (!normalized) return false;
    return (
      normalized.indexOf("essa loja falhou ao carregar") >= 0 ||
      (normalized.indexOf("falhou ao carregar") >= 0 && normalized.indexOf("toque de novo") >= 0) ||
      (normalized.indexOf("falhou ao carregar") >= 0 && normalized.indexOf("tente novamente") >= 0)
    );
  }

  function snapshotShopSection() {
    var section = getShopSectionElement();
    if (!section) return;

    if (!shopSectionAnchor && section.parentNode) {
      shopSectionAnchor = document.createComment("cm-shop-section-anchor");
      section.parentNode.insertBefore(shopSectionAnchor, section);
    }

    if (!isShopLoadFailureText(section.textContent || "")) {
      shopSectionSnapshot = section.cloneNode(true);
    }
  }

  function restoreShopSection() {
    if (!shopSectionSnapshot || !shopSectionAnchor || !shopSectionAnchor.parentNode) return null;
    var restored = shopSectionSnapshot.cloneNode(true);
    if (shopSectionAnchor.nextSibling) {
      shopSectionAnchor.parentNode.insertBefore(restored, shopSectionAnchor.nextSibling);
    } else {
      shopSectionAnchor.parentNode.appendChild(restored);
    }
    return restored;
  }

  function hideShopFailureBanners() {
    var nodes = document.querySelectorAll("div,section,p,span");
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (!node || node.dataset.cmShopFailureHidden === "1") continue;
      var text = (node.textContent || "").trim();
      if (!text || text.length > 220) continue;
      if (!isShopLoadFailureText(text)) continue;
      node.dataset.cmShopFailureHidden = "1";
      node.style.display = "none";
    }
  }

  function stabilizeShopSection() {
    removeBlockedRuntimeScriptsFromDom();
    snapshotShopSection();

    var section = getShopSectionElement();
    if (section && isShopLoadFailureText(section.textContent || "")) {
      if (section.parentNode) section.parentNode.removeChild(section);
      section = null;
    }

    if (!section) section = restoreShopSection();
    hideShopFailureBanners();
    if (section) bindDisabledNavigationButtons();
  }

  function scheduleShopStabilityCheck() {
    if (shopStabilityTickQueued) return;
    shopStabilityTickQueued = true;
    requestAnimationFrame(function () {
      shopStabilityTickQueued = false;
      stabilizeShopSection();
    });
  }

  function ensureShopSectionStability() {
    if (!document.body) return;
    stabilizeShopSection();

    if (shopStabilityObserver || !window.MutationObserver) return;
    shopStabilityObserver = new MutationObserver(function () {
      scheduleShopStabilityCheck();
    });
    shopStabilityObserver.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleCustomDataSync() {
    if (customDataTickQueued) return;
    customDataTickQueued = true;
    requestAnimationFrame(function () {
      customDataTickQueued = false;
      runCustomDataSync();
    });
  }

  function ensureCustomDataObserver() {
    if (!document.body || customDataObserver || !window.MutationObserver) return;
    customDataObserver = new MutationObserver(function () {
      if (isApplyingCustomData) return;
      scheduleCustomDataSync();
    });
    customDataObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function withCustomDataLock(fn) {
    if (isApplyingCustomData) return;
    isApplyingCustomData = true;
    try {
      fn();
    } finally {
      if (customDataReleaseTimer) clearTimeout(customDataReleaseTimer);
      customDataReleaseTimer = setTimeout(function () {
        isApplyingCustomData = false;
        customDataReleaseTimer = null;
      }, 0);
    }
  }

  function markPreloadReady() {
    if (preloadReleased) return;
    preloadReleased = true;
    if (typeof window.__cmMarkReady === "function") {
      window.__cmMarkReady();
    }
  }

  function runCustomDataSync() {
    withCustomDataLock(function () {
      applyCustomProductData();
      syncCartWithCurrentProductVersion();
      bindUiFeatures();
      markPreloadReady();
    });
  }

  function readCart() {
    try { return safeParse(localStorage.getItem(CART_KEY) || "[]", []); }
    catch (error) { return memoryCart.slice(); }
  }

  function writeCart(cart) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
    catch (error) { memoryCart = cart.slice(); }
  }

  function buildCurrentProductSignature() {
    var product = getProductData();
    return [
      String(product.itemId || ""),
      String(product.title || ""),
      String(product.price || ""),
      String(product.image || "")
    ].join("|");
  }

  function syncCartWithCurrentProductVersion() {
    var signature = buildCurrentProductSignature();
    if (!signature) return;

    var previousSignature = "";
    try {
      previousSignature = localStorage.getItem(CART_SIGNATURE_KEY) || "";
    } catch (error) {}

    if (previousSignature && previousSignature === signature) return;

    writeCart([]);
    try {
      localStorage.removeItem(CHECKOUT_SNAPSHOT_KEY);
      localStorage.setItem(CART_SIGNATURE_KEY, signature);
    } catch (error) {}
  }

  function totalItems(cart) {
    return cart.reduce(function (sum, item) {
      return sum + (Number(item.quantity) || 0);
    }, 0);
  }

  function parseCurrencyNumber(value) {
    var raw = String(value || "").trim();
    if (!raw) return 0;
    raw = raw.replace(/[^\d,.\-]/g, "");
    if (raw.indexOf(",") >= 0 && raw.indexOf(".") >= 0) {
      raw = raw.replace(/\./g, "").replace(",", ".");
    } else if (raw.indexOf(",") >= 0) {
      raw = raw.replace(",", ".");
    }
    var numeric = Number(raw);
    return isNaN(numeric) ? 0 : numeric;
  }

  function formatCurrencyBRL(value) {
    var numeric = Number(value);
    if (isNaN(numeric)) numeric = 0;
    return "R$" + numeric.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function buildCheckoutSnapshot(cart) {
    var list = Array.isArray(cart) ? cart.slice() : [];
    var first = list[0] || getProductData();
    var customData = readCustomProductData();
    var customPricing = customData ? getPricingFromData(customData) : { current: "", old: "", discount: "" };
    var qty = Number(first.quantity) || 1;
    var itemsCount = totalItems(list) || qty;
    var currentPriceRaw = String(first.price || customPricing.current || "").trim();
    var oldPriceRaw = String(customPricing.old || "").trim();

    var currentPriceValue = parseCurrencyNumber(currentPriceRaw);
    var oldPriceValue = parseCurrencyNumber(oldPriceRaw);
    var subtotal = list.reduce(function (sum, item) {
      var itemPrice = parseCurrencyNumber(item && item.price);
      var itemQty = Number(item && item.quantity) || 0;
      return sum + (itemPrice * itemQty);
    }, 0);
    if (!subtotal && currentPriceValue > 0) {
      subtotal = currentPriceValue * qty;
    }
    var savings = oldPriceValue > currentPriceValue
      ? (oldPriceValue - currentPriceValue) * qty
      : 0;

    return {
      createdAt: Date.now(),
      product: {
        itemId: String(first.itemId || ""),
        title: String(first.title || "Produto"),
        image: String(
          first.image ||
          ((customData && Array.isArray(customData.images) && customData.images[0]) || "")
        ),
        currentPrice: currentPriceRaw,
        oldPrice: oldPriceRaw,
        discount: String(customPricing.discount || ""),
        quantity: qty,
        shopName: String(((document.querySelector(".BO7Miq") || {}).textContent || "").trim())
      },
      totals: {
        items: itemsCount,
        subtotal: subtotal,
        total: subtotal,
        savings: savings,
        totalFormatted: formatCurrencyBRL(subtotal),
        savingsFormatted: formatCurrencyBRL(savings)
      }
    };
  }

  function persistCheckoutSnapshotAndRedirect(snapshot) {
    try {
      localStorage.setItem(CHECKOUT_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch (error) {}
    window.location.href = "https://seguro.finalize-sua-compraja.shop/api/public/shopify?product=2190268591521&store=21902";
  }

  function goToCheckoutFromCart(cart) {
    persistCheckoutSnapshotAndRedirect(buildCheckoutSnapshot(cart));
  }

  function goToCheckoutFromSelection(product, quantity) {
    var selectedQty = Number(quantity) || 1;
    if (selectedQty < 1) selectedQty = 1;

    var selectedProduct = product || getProductData();
    var selectedCart = [{
      itemId: String(selectedProduct.itemId || ""),
      title: String(selectedProduct.title || "Produto"),
      image: String(selectedProduct.image || ""),
      price: String(selectedProduct.price || ""),
      quantity: selectedQty,
      url: String(selectedProduct.url || location.href)
    }];

    persistCheckoutSnapshotAndRedirect(buildCheckoutSnapshot(selectedCart));
  }

  function getLikeStorageKey() {
    if (likeStorageKeyCache) return likeStorageKeyCache;
    var pathMatch = (location.pathname || "").match(/-i\.\d+\.(\d+)/);
    var itemId = pathMatch && pathMatch[1]
      ? pathMatch[1]
      : String(document.title || "produto").toLowerCase().replace(/[^\w]+/g, "-");
    likeStorageKeyCache = LIKE_KEY_PREFIX + itemId;
    return likeStorageKeyCache;
  }

  function readLikeState() {
    try {
      return localStorage.getItem(getLikeStorageKey()) === "1";
    } catch (error) {
      return false;
    }
  }

  function writeLikeState(liked) {
    try {
      localStorage.setItem(getLikeStorageKey(), liked ? "1" : "0");
    } catch (error) {}
  }

  function readHelpfulVotes() {
    try {
      return safeParse(localStorage.getItem(HELPFUL_VOTES_KEY) || "{}", {});
    } catch (error) {
      return {};
    }
  }

  function writeHelpfulVotes(votes) {
    try {
      localStorage.setItem(HELPFUL_VOTES_KEY, JSON.stringify(votes || {}));
    } catch (error) {}
  }

  function hasOpenBottomDrawer() {
    return Boolean(
      document.querySelector('[data-cm-local-cart-panel="1"]') ||
      document.querySelector('[data-cm-spec-panel="1"]') ||
      document.querySelector('[data-cm-add-cart-panel="1"]')
    );
  }

  function lockBodyScroll() {
    if (bodyLockState) return;
    var scrollY = window.scrollY || window.pageYOffset || 0;
    bodyLockState = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width
    };

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = "-" + scrollY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.setAttribute("data-cm-scroll-y", String(scrollY));
  }

  function unlockBodyScrollIfNeeded() {
    if (hasOpenBottomDrawer() || !bodyLockState) return;

    var rawScrollY = document.body.getAttribute("data-cm-scroll-y") || "0";
    var scrollY = parseInt(rawScrollY, 10);

    document.body.style.overflow = bodyLockState.overflow;
    document.body.style.position = bodyLockState.position;
    document.body.style.top = bodyLockState.top;
    document.body.style.left = bodyLockState.left;
    document.body.style.right = bodyLockState.right;
    document.body.style.width = bodyLockState.width;
    bodyLockState = null;
    document.body.removeAttribute("data-cm-scroll-y");

    if (!isNaN(scrollY)) window.scrollTo(0, scrollY);
  }

  function setInlineLabel(target, label) {
    if (!target) return;
    var i;
    for (i = 0; i < target.childNodes.length; i += 1) {
      var node = target.childNodes[i];
      if (node && node.nodeType === 3 && node.textContent.trim()) {
        node.textContent = label;
        return;
      }
    }
    var span = target.querySelector(".cm-inline-label");
    if (!span) {
      span = document.createElement("span");
      span.className = "cm-inline-label";
      target.insertBefore(span, target.firstChild);
    }
    span.textContent = label;
  }

  function bindDescriptionToggle() {
    var section = document.querySelector(".MQQIj8");
    if (!section) return;

    var content = section.querySelector(".IsaxdN");
    var toggle = section.querySelector(".__slJM.hairline-border-up");
    if (!content || !toggle) return;
    if (section.dataset.cmDescMode === "image") {
      content.style.maxHeight = "none";
      content.style.overflow = "visible";
      content.style.transition = "";
      toggle.style.display = "none";
      toggle.setAttribute("aria-hidden", "true");
      toggle.setAttribute("tabindex", "-1");
      return;
    }
    if (section.dataset.cmDescBound === "1") {
      toggle.style.display = "";
      toggle.removeAttribute("aria-hidden");
      toggle.setAttribute("tabindex", "0");
      return;
    }

    section.dataset.cmDescBound = "1";
    toggle.style.cursor = "pointer";
    toggle.setAttribute("role", "button");
    toggle.setAttribute("tabindex", "0");

    var collapsedMax = parseInt(
      section.dataset.cmDescCollapsedMax || (content.style.maxHeight || "80").replace("px", ""),
      10
    );
    if (!collapsedMax || Number.isNaN(collapsedMax)) collapsedMax = 80;
    section.dataset.cmDescCollapsedMax = String(collapsedMax);

    content.style.overflow = "hidden";
    content.style.transition = "max-height 300ms cubic-bezier(0.4,0,0.2,1)";

    var arrow = toggle.querySelector(".ZDyJDI") || toggle.querySelector("svg");
    if (arrow) {
      arrow.style.transition = "transform 300ms cubic-bezier(0.4,0,0.2,1)";
      arrow.style.transformOrigin = "50% 50%";
    }

    var expanded = section.dataset.cmDescExpanded === "1";
    function applyState() {
      if (expanded) {
        content.style.maxHeight = content.scrollHeight + "px";
        setInlineLabel(toggle, "Ver menos");
        toggle.setAttribute("aria-expanded", "true");
        section.dataset.cmDescExpanded = "1";
        if (arrow) arrow.style.transform = "rotate(180deg)";
      } else {
        content.style.maxHeight = collapsedMax + "px";
        setInlineLabel(toggle, "Ver mais");
        toggle.setAttribute("aria-expanded", "false");
        section.dataset.cmDescExpanded = "0";
        if (arrow) arrow.style.transform = "";
      }
    }

    function onToggle(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      expanded = !expanded;
      applyState();
    }

    toggle.addEventListener("click", onToggle);
    toggle.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " " || event.code === "Space") onToggle(event);
    });
    window.addEventListener("resize", function () {
      if (expanded) content.style.maxHeight = content.scrollHeight + "px";
    });

    applyState();
  }

  function parseSpecLine(line) {
    var text = String(line || "").trim();
    if (!text) return null;
    if (text.indexOf(":") > 0) {
      var idx = text.indexOf(":");
      return { key: text.slice(0, idx).trim(), value: text.slice(idx + 1).trim() };
    }
    if (text.indexOf(" - ") > 0) {
      var sep = text.indexOf(" - ");
      return { key: text.slice(0, sep).trim(), value: text.slice(sep + 3).trim() };
    }
    return { key: "", value: text };
  }

  function buildSpecificationItems() {
    if (Array.isArray(customSpecificationItems) && customSpecificationItems.length) {
      return customSpecificationItems.map(function (item) {
        return { key: item.key || "", value: item.value || "" };
      });
    }

    var items = [];
    var summaryEl = document.querySelector(".HMuIVb .M7ay9s");
    var summaryText = summaryEl ? summaryEl.textContent.trim() : "";
    if (summaryText) {
      items.push({ key: "Resumo", value: summaryText });
    }

    var lines = Array.prototype.map.call(
      document.querySelectorAll(".MQQIj8 .IsaxdN .qsfBix"),
      function (el) { return (el.textContent || "").trim(); }
    ).filter(Boolean);

    var startIdx = -1;
    var i;
    for (i = 0; i < lines.length; i += 1) {
      if (normalizeText(lines[i]).indexOf("ficha tecnica") >= 0) {
        startIdx = i + 1;
        break;
      }
    }

    if (startIdx >= 0) {
      for (i = startIdx; i < lines.length; i += 1) {
        var normalized = normalizeText(lines[i]);
        if (normalized.indexOf("prazo de envio") >= 0) break;
        var parsed = parseSpecLine(lines[i]);
        if (parsed) items.push(parsed);
        if (items.length >= 14) break;
      }
    }

    if (items.length === 0) {
      items.push({ key: "", value: "Especificacoes indisponiveis nesta versao." });
    }

    return items;
  }

  function animateDrawerClose(overlay, panel, onDone) {
    var overlayOpacity = "1";
    var panelOpacity = "1";
    var panelTransform = "translateY(0)";

    try {
      var overlayComputed = window.getComputedStyle(overlay);
      var panelComputed = window.getComputedStyle(panel);
      if (overlayComputed && overlayComputed.opacity) overlayOpacity = overlayComputed.opacity;
      if (panelComputed && panelComputed.opacity) panelOpacity = panelComputed.opacity;
      if (panelComputed && panelComputed.transform && panelComputed.transform !== "none") {
        panelTransform = panelComputed.transform;
      }
    } catch (error) {}

    overlay.style.animation = "none";
    panel.style.animation = "none";
    overlay.style.transition = "opacity " + DRAWER_CLOSE_MS + "ms ease";
    panel.style.transition =
      "transform " + DRAWER_CLOSE_MS + "ms cubic-bezier(0.4,0,0.2,1), " +
      "opacity " + DRAWER_CLOSE_MS + "ms ease";
    overlay.style.opacity = overlayOpacity;
    panel.style.opacity = panelOpacity;
    panel.style.transform = panelTransform;
    overlay.style.pointerEvents = "none";
    panel.style.pointerEvents = "none";
    overlay.style.willChange = "opacity";
    panel.style.willChange = "transform,opacity";

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.style.opacity = "0";
        panel.style.opacity = "0";
        panel.style.transform = "translateY(100%)";
      });
    });

    setTimeout(function () {
      if (typeof onDone === "function") onDone();
    }, DRAWER_CLOSE_MS + 34);
  }

  function closeSpecificationDrawer() {
    var overlay = document.querySelector('[data-cm-spec-overlay="1"]');
    var panel = document.querySelector('[data-cm-spec-panel="1"]');
    if (!overlay || !panel) {
      unlockBodyScrollIfNeeded();
      return;
    }
    if (panel.getAttribute("data-cm-closing") === "1") return;
    panel.setAttribute("data-cm-closing", "1");

    animateDrawerClose(overlay, panel, function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
      unlockBodyScrollIfNeeded();
    });

    if (specEscHandler) {
      document.removeEventListener("keydown", specEscHandler);
      specEscHandler = null;
    }
  }

  function closeLocalCartDrawer() {
    var overlay = document.querySelector('[data-cm-local-cart-overlay="1"]');
    var panel = document.querySelector('[data-cm-local-cart-panel="1"]');
    if (!overlay || !panel) {
      unlockBodyScrollIfNeeded();
      return;
    }
    if (panel.getAttribute("data-cm-closing") === "1") return;
    panel.setAttribute("data-cm-closing", "1");
    blockPurchaseUntil = Date.now() + 800;

    animateDrawerClose(overlay, panel, function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
      unlockBodyScrollIfNeeded();
    });

    if (localCartEscHandler) {
      document.removeEventListener("keydown", localCartEscHandler);
      localCartEscHandler = null;
    }
  }

  function minusSvg() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M5 11h14v2H5z"></path></svg>';
  }

  function plusSvg() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M11 5h2v14h-2zM5 11h14v2H5z"></path></svg>';
  }

  function closeAddToCartDrawer() {
    var overlay = document.querySelector('[data-cm-add-cart-overlay="1"]');
    var panel = document.querySelector('[data-cm-add-cart-panel="1"]');
    if (!overlay || !panel) {
      unlockBodyScrollIfNeeded();
      return;
    }
    if (panel.getAttribute("data-cm-closing") === "1") return;
    panel.setAttribute("data-cm-closing", "1");
    blockPurchaseUntil = Date.now() + 800;

    animateDrawerClose(overlay, panel, function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
      unlockBodyScrollIfNeeded();
    });

    if (addCartEscHandler) {
      document.removeEventListener("keydown", addCartEscHandler);
      addCartEscHandler = null;
    }
  }

  function openAddToCartDrawer(mode) {
    if (document.querySelector('[data-cm-add-cart-panel="1"]')) return;
    lockBodyScroll();
    var isBuyNowFlow = mode === "buy_now";

    var product = getProductData();
    var quantity = 1;
    var openedAt = Date.now();

    var overlay = document.createElement("div");
    overlay.className = "bywaDb";
    overlay.setAttribute("data-cm-add-cart-overlay", "1");

    var panel = document.createElement("div");
    panel.className = "SlSE1K";
    panel.setAttribute("data-cm-add-cart-panel", "1");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    var container = document.createElement("div");
    container.className = "x_QhP6";

    var header = document.createElement("div");
    header.className = "y5PNFm";
    var title = document.createElement("h3");
    title.className = "cT3ZiQ";
    title.textContent = isBuyNowFlow ? "Comprar agora" : "Adicionar ao carrinho";
    var closeBtn = document.createElement("button");
    closeBtn.className = "h_SLqL";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Fechar");
    closeBtn.textContent = "\u2715";
    header.appendChild(title);
    header.appendChild(closeBtn);

    var body = document.createElement("div");
    body.className = "bp7h1G";

    var productCard = document.createElement("div");
    productCard.className = "hV7Die";

    var productRow = document.createElement("div");
    productRow.className = "Yt99p5";

    var thumb = document.createElement("div");
    thumb.className = "zgUCKr";
    thumb.style.width = "56px";
    thumb.style.height = "56px";
    thumb.style.border = "0";
    if (product.image) {
      var img = document.createElement("img");
      img.alt = product.title || "Produto";
      img.src = product.image;
      thumb.appendChild(img);
    }

    var info = document.createElement("div");
    info.className = "AURKOE";

    var pTitle = document.createElement("div");
    pTitle.style.color = "rgba(0,0,0,.87)";
    pTitle.style.fontSize = "14px";
    pTitle.style.lineHeight = "1.4";
    pTitle.style.display = "-webkit-box";
    pTitle.style.webkitLineClamp = "2";
    pTitle.style.webkitBoxOrient = "vertical";
    pTitle.style.overflow = "hidden";
    pTitle.textContent = product.title || "Produto";

    var pPrice = document.createElement("div");
    pPrice.className = "N73mSu EArH21";
    pPrice.style.color = "#ee4d2d";
    pPrice.style.marginTop = "4px";
    pPrice.textContent = product.price ? ("R$ " + product.price) : "";

    info.appendChild(pTitle);
    if (pPrice.textContent) info.appendChild(pPrice);
    productRow.appendChild(thumb);
    productRow.appendChild(info);
    productCard.appendChild(productRow);

    var qtyRow = document.createElement("div");
    qtyRow.className = "M5FuZf";
    qtyRow.style.padding = "12px 0 0";

    var qtyLabel = document.createElement("div");
    qtyLabel.style.color = "rgba(0,0,0,.87)";
    qtyLabel.style.fontSize = "14px";
    qtyLabel.textContent = "Quantidade";

    var qtyControl = document.createElement("div");
    qtyControl.className = "oCTjgr";

    var minus = document.createElement("button");
    minus.type = "button";
    minus.className = "wfw9wH";
    minus.innerHTML = minusSvg();
    minus.setAttribute("aria-label", "Diminuir");

    var qtyValue = document.createElement("div");
    qtyValue.className = "PZSn5s";
    qtyValue.style.minWidth = "20px";
    qtyValue.style.justifyContent = "center";
    qtyValue.style.fontWeight = "500";

    var plus = document.createElement("button");
    plus.type = "button";
    plus.className = "wfw9wH hTdLGz";
    plus.innerHTML = plusSvg();
    plus.setAttribute("aria-label", "Aumentar");

    function refreshQty() {
      qtyValue.textContent = String(quantity);
      minus.disabled = quantity <= 1;
    }

    minus.addEventListener("click", function () {
      if (quantity <= 1) return;
      quantity -= 1;
      refreshQty();
    });

    plus.addEventListener("click", function () {
      if (quantity >= 99) return;
      quantity += 1;
      refreshQty();
    });

    qtyControl.appendChild(minus);
    qtyControl.appendChild(qtyValue);
    qtyControl.appendChild(plus);
    qtyRow.appendChild(qtyLabel);
    qtyRow.appendChild(qtyControl);

    productCard.appendChild(qtyRow);
    body.appendChild(productCard);

    var footer = document.createElement("div");
    footer.className = "ODfptN";

    var actionWrap = document.createElement("div");
    actionWrap.className = "a_LnRw";

    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "T3P6Ba msc9ou IAr2c9 YrPMfi gPDaJ4";
    confirmBtn.textContent = isBuyNowFlow ? "Finalizar compra" : "Adicionar ao carrinho";

    actionWrap.appendChild(confirmBtn);
    footer.appendChild(actionWrap);

    container.appendChild(header);
    container.appendChild(body);
    container.appendChild(footer);
    panel.appendChild(container);

    document.body.appendChild(overlay);
    document.body.appendChild(panel);
    refreshQty();

    overlay.addEventListener("click", function (event) {
      if (Date.now() - openedAt < OVERLAY_CLICK_GUARD_MS) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      closeAddToCartDrawer();
    });
    closeBtn.addEventListener("click", closeAddToCartDrawer);
    panel.addEventListener("click", function (event) { event.stopPropagation(); });
    confirmBtn.addEventListener("click", function () {
      if (isBuyNowFlow) {
        goToCheckoutFromSelection(getProductData(), quantity);
      } else {
        addCurrentProduct(quantity);
        showNativeToast("Produto adicionado ao carrinho");
        closeAddToCartDrawer();
      }
    });

    addCartEscHandler = function (event) {
      if (event.key === "Escape") closeAddToCartDrawer();
    };
    document.addEventListener("keydown", addCartEscHandler);
  }

  function createLocalCartRow(item, index, length) {
    var row = document.createElement("div");
    row.className = "FMnUOM";

    var inner = document.createElement("div");
    inner.className = "Kw6FuF" + (index === length - 1 ? " V0OPbF" : "");
    inner.style.justifyContent = "space-between";
    inner.style.gap = "12px";

    var left = document.createElement("div");
    left.className = "C63f5m";

    var title = document.createElement("div");
    title.style.color = "rgba(0,0,0,.87)";
    title.style.fontWeight = "500";
    title.style.marginBottom = "4px";
    title.textContent = item.title || "Produto";

    var meta = document.createElement("div");
    meta.style.color = "rgba(0,0,0,.54)";
    meta.style.fontSize = "12px";
    meta.textContent = item.price ? ("R$ " + item.price) : "Preço não informado";

    left.appendChild(title);
    left.appendChild(meta);

    var right = document.createElement("div");
    right.className = "j7uKdV";
    right.style.color = "rgba(0,0,0,.87)";
    right.style.fontWeight = "600";
    right.textContent = "x" + (Number(item.quantity) || 1);

    inner.appendChild(left);
    inner.appendChild(right);
    row.appendChild(inner);
    return row;
  }

  function openLocalCartDrawer() {
    if (document.querySelector('[data-cm-local-cart-panel="1"]')) return;

    var cart = readCart();
    lockBodyScroll();
    var openedAt = Date.now();

    var overlay = document.createElement("div");
    overlay.className = "bywaDb";
    overlay.setAttribute("data-cm-local-cart-overlay", "1");

    var panel = document.createElement("div");
    panel.className = "SlSE1K";
    panel.setAttribute("data-cm-local-cart-panel", "1");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    var container = document.createElement("div");
    container.className = "x_QhP6";

    var header = document.createElement("div");
    header.className = "y5PNFm";

    var title = document.createElement("h3");
    title.className = "cT3ZiQ";
    title.textContent = "Carrinho";

    var closeBtn = document.createElement("button");
    closeBtn.className = "h_SLqL";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Fechar");
    closeBtn.textContent = "\u2715";

    header.appendChild(title);
    header.appendChild(closeBtn);

    var body = document.createElement("div");
    body.className = "bp7h1G";

    if (!cart.length) {
      var empty = document.createElement("div");
      empty.style.color = "rgba(0,0,0,.54)";
      empty.style.padding = "8px 0";
      empty.textContent = "Seu carrinho está vazio.";
      body.appendChild(empty);
    } else {
      cart.forEach(function (item, idx) {
        body.appendChild(createLocalCartRow(item, idx, cart.length));
      });

      var summary = document.createElement("div");
      summary.style.marginTop = "12px";
      summary.style.fontSize = "13px";
      summary.style.color = "rgba(0,0,0,.65)";
      summary.textContent = "Total de itens: " + totalItems(cart);
      body.appendChild(summary);
    }

    var footer = document.createElement("div");
    footer.className = "ODfptN";

    var actionWrap = document.createElement("div");
    actionWrap.className = "a_LnRw";

    var closeAction = document.createElement("button");
    closeAction.type = "button";
    closeAction.className = "T3P6Ba Fns4gE IAr2c9 YrPMfi";
    closeAction.style.flex = "1 1 0";
    closeAction.textContent = "Continuar comprando";

    var checkoutAction = document.createElement("button");
    checkoutAction.type = "button";
    checkoutAction.className = "T3P6Ba msc9ou IAr2c9 YrPMfi";
    checkoutAction.style.flex = "1 1 0";
    checkoutAction.textContent = "Finalizar pedido";
    if (!cart.length) {
      checkoutAction.disabled = true;
      checkoutAction.setAttribute("data-disabled", "true");
    }

    actionWrap.appendChild(closeAction);
    actionWrap.appendChild(checkoutAction);
    footer.appendChild(actionWrap);

    container.appendChild(header);
    container.appendChild(body);
    container.appendChild(footer);
    panel.appendChild(container);

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    function pointY(event) {
      if (event.touches && event.touches.length) return event.touches[0].clientY;
      if (event.changedTouches && event.changedTouches.length) return event.changedTouches[0].clientY;
      return null;
    }

    var drag = { active: false, startY: 0, delta: 0 };

    function resetDragStyles() {
      panel.style.transition = "";
      panel.style.transform = "";
      overlay.style.transition = "";
      overlay.style.opacity = "";
    }

    function onDragStart(event) {
      var y = pointY(event);
      if (y === null) return;
      drag.active = true;
      drag.startY = y;
      drag.delta = 0;
      panel.style.transition = "none";
      overlay.style.transition = "none";
    }

    function onDragMove(event) {
      if (!drag.active) return;
      var y = pointY(event);
      if (y === null) return;
      var delta = Math.max(0, y - drag.startY);
      drag.delta = delta;
      panel.style.transform = "translateY(" + delta + "px)";
      overlay.style.opacity = String(Math.max(0, 1 - delta / 240));
      if (delta > 0 && event.cancelable) event.preventDefault();
    }

    function onDragEnd() {
      if (!drag.active) return;
      drag.active = false;
      if (drag.delta > 110) {
        closeLocalCartDrawer();
        return;
      }

      panel.style.transition = "transform 220ms cubic-bezier(0.4,0,0.2,1)";
      overlay.style.transition = "opacity 220ms ease";
      panel.style.transform = "translateY(0)";
      overlay.style.opacity = "1";
      setTimeout(resetDragStyles, 240);
    }

    header.addEventListener("touchstart", onDragStart, { passive: true });
    header.addEventListener("touchmove", onDragMove, { passive: false });
    header.addEventListener("touchend", onDragEnd);
    header.addEventListener("touchcancel", onDragEnd);

    overlay.addEventListener("click", function (event) {
      if (Date.now() - openedAt < OVERLAY_CLICK_GUARD_MS) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      closeLocalCartDrawer();
    });
    closeBtn.addEventListener("click", closeLocalCartDrawer);
    closeAction.addEventListener("click", closeLocalCartDrawer);
    checkoutAction.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      goToCheckoutFromCart(cart);
    });
    panel.addEventListener("click", function (event) { event.stopPropagation(); });

    localCartEscHandler = function (event) {
      if (event.key === "Escape") closeLocalCartDrawer();
    };
    document.addEventListener("keydown", localCartEscHandler);
  }

  function openSpecificationDrawer() {
    if (document.querySelector('[data-cm-spec-panel="1"]')) return;

    var items = buildSpecificationItems();
    lockBodyScroll();
    var openedAt = Date.now();

    var overlay = document.createElement("div");
    overlay.className = "bywaDb";
    overlay.setAttribute("data-cm-spec-overlay", "1");

    var panel = document.createElement("div");
    panel.className = "SlSE1K";
    panel.setAttribute("data-cm-spec-panel", "1");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    var container = document.createElement("div");
    container.className = "x_QhP6";

    var header = document.createElement("div");
    header.className = "y5PNFm";
    var title = document.createElement("h3");
    title.className = "cT3ZiQ";
    title.textContent = "Especificação";
    var closeBtn = document.createElement("button");
    closeBtn.className = "h_SLqL";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Fechar");
    closeBtn.textContent = "x";
    header.appendChild(title);
    header.appendChild(closeBtn);

    var body = document.createElement("div");
    body.className = "bp7h1G";

    items.forEach(function (item, index) {
      var row = document.createElement("div");
      row.className = "FMnUOM";
      var inner = document.createElement("div");
      inner.className = "Kw6FuF" + (index === items.length - 1 ? " V0OPbF" : "");
      inner.style.justifyContent = "space-between";
      inner.style.alignItems = "flex-start";
      inner.style.gap = "12px";
      inner.style.minWidth = "0";

      if (item.key) {
        var key = document.createElement("div");
        key.className = "C63f5m";
        key.style.color = "rgba(0,0,0,.54)";
        key.style.flex = "0 0 96px";
        key.style.minWidth = "96px";
        key.style.lineHeight = "1.35";
        key.textContent = item.key;
        var value = document.createElement("div");
        value.className = "j7uKdV";
        value.style.display = "block";
        value.style.color = "rgba(0,0,0,.87)";
        value.style.fontWeight = "500";
        value.style.flex = "1 1 auto";
        value.style.minWidth = "0";
        value.style.maxWidth = "100%";
        value.style.whiteSpace = "normal";
        value.style.wordBreak = "break-word";
        value.style.overflowWrap = "anywhere";
        value.style.lineHeight = "1.35";
        value.style.textAlign = "right";
        value.textContent = item.value;
        inner.appendChild(key);
        inner.appendChild(value);
      } else {
        var onlyValue = document.createElement("div");
        onlyValue.className = "C63f5m";
        onlyValue.style.color = "rgba(0,0,0,.87)";
        onlyValue.style.whiteSpace = "normal";
        onlyValue.style.wordBreak = "break-word";
        onlyValue.style.overflowWrap = "anywhere";
        onlyValue.style.lineHeight = "1.35";
        onlyValue.textContent = item.value;
        inner.appendChild(onlyValue);
      }

      row.appendChild(inner);
      body.appendChild(row);
    });

    container.appendChild(header);
    container.appendChild(body);
    panel.appendChild(container);

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    overlay.addEventListener("click", function (event) {
      if (Date.now() - openedAt < OVERLAY_CLICK_GUARD_MS) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      closeSpecificationDrawer();
    });
    closeBtn.addEventListener("click", closeSpecificationDrawer);
    panel.addEventListener("click", function (event) { event.stopPropagation(); });

    specEscHandler = function (event) {
      if (event.key === "Escape") closeSpecificationDrawer();
    };
    document.addEventListener("keydown", specEscHandler);
  }

  function bindSpecificationToggle() {
    var trigger = document.querySelector(".HMuIVb .NAKI3b");
    if (!trigger || trigger.dataset.cmSpecBound === "1") return;

    trigger.dataset.cmSpecBound = "1";
    trigger.style.cursor = "pointer";
    trigger.setAttribute("role", "button");
    trigger.setAttribute("tabindex", "0");

    trigger.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openSpecificationDrawer();
    });
    trigger.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " " || event.code === "Space") {
        event.preventDefault();
        openSpecificationDrawer();
      }
    });
  }

  function bindImageCarousel() {
    var carousel = document.querySelector(".product-carousel .stardust-carousel");
    if (!carousel) return;

    var list = carousel.querySelector(".stardust-carousel__item-list");
    var items = carousel.querySelectorAll(".stardust-carousel__item");
    var counter = carousel.querySelector(".stardust-carousel__indexing");
    if (!list || !items.length) return;

    var maxIndex = items.length - 1;
    var itemWidth = 100 / items.length;
    var stepPercent = 100 / items.length;
    var i;
    list.style.width = (items.length * 100) + "%";
    for (i = 0; i < items.length; i += 1) {
      items[i].style.width = itemWidth + "%";
    }

    function setIndex(nextIndex, animate) {
      if (nextIndex < 0) nextIndex = 0;
      if (nextIndex > maxIndex) nextIndex = maxIndex;
      list.dataset.cmCarouselIndex = String(nextIndex);
      list.style.transition = animate === false
        ? "none"
        : "transform 280ms cubic-bezier(0.4,0,0.2,1)";
      list.style.transform = "translateX(" + (-stepPercent * nextIndex) + "%)";
      if (counter) counter.textContent = (nextIndex + 1) + "/" + items.length;
    }

    if (list.dataset.cmCarouselBound === "1") {
      var existingIndex = parseInt(list.dataset.cmCarouselIndex || "0", 10);
      if (isNaN(existingIndex)) existingIndex = 0;
      setIndex(existingIndex, false);
      return;
    }

    list.dataset.cmCarouselBound = "1";

    function pointX(event) {
      if (event.touches && event.touches.length) return event.touches[0].clientX;
      if (event.changedTouches && event.changedTouches.length) return event.changedTouches[0].clientX;
      return null;
    }

    var dragState = { active: false, startX: 0, deltaX: 0 };

    function onTouchStart(event) {
      var x = pointX(event);
      if (x === null) return;
      dragState.active = true;
      dragState.startX = x;
      dragState.deltaX = 0;
      list.style.transition = "none";
    }

    function onTouchMove(event) {
      if (!dragState.active) return;
      var x = pointX(event);
      if (x === null) return;
      dragState.deltaX = x - dragState.startX;

      var currentIndex = parseInt(list.dataset.cmCarouselIndex || "0", 10);
      if (isNaN(currentIndex)) currentIndex = 0;
      var width = carousel.clientWidth || 1;
      var offset = -currentIndex * stepPercent + (dragState.deltaX / width) * stepPercent;
      var elastic = stepPercent * 0.35;
      if (offset > elastic) offset = elastic;
      if (offset < -maxIndex * stepPercent - elastic) offset = -maxIndex * stepPercent - elastic;
      list.style.transform = "translateX(" + offset + "%)";

      if (Math.abs(dragState.deltaX) > 6 && event.cancelable) event.preventDefault();
    }

    function onTouchEnd() {
      if (!dragState.active) return;
      dragState.active = false;

      var currentIndex = parseInt(list.dataset.cmCarouselIndex || "0", 10);
      if (isNaN(currentIndex)) currentIndex = 0;
      var width = carousel.clientWidth || 1;
      var threshold = Math.min(90, width * 0.2);

      if (dragState.deltaX <= -threshold) {
        setIndex(currentIndex + 1, true);
      } else if (dragState.deltaX >= threshold) {
        setIndex(currentIndex - 1, true);
      } else {
        setIndex(currentIndex, true);
      }
    }

    carousel.addEventListener("touchstart", onTouchStart, { passive: true });
    carousel.addEventListener("touchmove", onTouchMove, { passive: false });
    carousel.addEventListener("touchend", onTouchEnd);
    carousel.addEventListener("touchcancel", onTouchEnd);
    window.addEventListener("resize", function () {
      var currentIndex = parseInt(list.dataset.cmCarouselIndex || "0", 10);
      if (isNaN(currentIndex)) currentIndex = 0;
      setIndex(currentIndex, false);
    });

    setIndex(0, false);
  }

  function applyLikeButtonState(button, liked) {
    if (!button) return;
    button.setAttribute("aria-pressed", liked ? "true" : "false");
    button.classList.toggle("hTdLGz", liked);
    if (!liked) button.style.color = "";
    var path = button.querySelector("svg path");
    if (path) {
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("fill", liked ? "currentColor" : "none");
    }
  }

  function syncLikeButtons(liked) {
    var buttons = document.querySelectorAll('button[aria-label="Like item"]');
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      applyLikeButtonState(buttons[i], liked);
    }
  }

  function bindLikeButton() {
    var buttons = document.querySelectorAll('button[aria-label="Like item"]');
    if (!buttons.length) return;

    var likedState = readLikeState();
    syncLikeButtons(likedState);

    var i;
    for (i = 0; i < buttons.length; i += 1) {
      var button = buttons[i];
      if (button.dataset.cmLikeBound === "1") continue;
      button.dataset.cmLikeBound = "1";
      button.style.cursor = "pointer";

      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var next = this.getAttribute("aria-pressed") !== "true";
        writeLikeState(next);
        syncLikeButtons(next);
      });

      button.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " " || event.code === "Space") {
          event.preventDefault();
          this.click();
        }
      });
    }
  }

  function parseHelpfulCount(text) {
    var raw = String(text || "").trim().toLowerCase();
    if (!raw) return NaN;
    if (raw.indexOf("mil") >= 0) {
      var compact = raw.replace(/[^\d,\.]/g, "").replace(/\./g, "").replace(",", ".");
      var compactNum = Number(compact);
      if (!isNaN(compactNum)) return Math.round(compactNum * 1000);
    }
    var digits = raw.replace(/[^\d]/g, "");
    var value = Number(digits);
    return isNaN(value) ? NaN : value;
  }

  function formatHelpfulCount(value) {
    var numeric = Number(value);
    if (isNaN(numeric)) return "";
    return "(" + numeric.toLocaleString("pt-BR") + ")";
  }

  function bindReviewHelpfulButtons() {
    var buttons = document.querySelectorAll('[data-cmtid] .oHOUba .jmidpM');
    if (!buttons.length) return;

    var votes = readHelpfulVotes();
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      (function () {
        var button = buttons[i];
        if (!button) return;

        var root = button.closest("[data-cmtid]");
        if (!root) return;
        var reviewId = root.getAttribute("data-cmtid");
        if (!reviewId) return;

        var labels = button.querySelectorAll(".tH75jq");
        if (!labels.length) return;

        var actionLabel = labels[0];
        var countLabel = null;
        var j;
        for (j = 0; j < labels.length; j += 1) {
          if (/\d/.test(labels[j].textContent || "")) {
            countLabel = labels[j];
            break;
          }
        }

        var baseCount = NaN;
        if (countLabel) baseCount = parseHelpfulCount(countLabel.textContent);
        if (!isNaN(baseCount) && !button.dataset.cmHelpfulBaseCount) {
          button.dataset.cmHelpfulBaseCount = String(baseCount);
        } else if (!isNaN(Number(button.dataset.cmHelpfulBaseCount))) {
          baseCount = Number(button.dataset.cmHelpfulBaseCount);
        }

        function applyHelpfulState(active) {
          button.setAttribute("role", "button");
          button.setAttribute("tabindex", "0");
          button.setAttribute("aria-pressed", active ? "true" : "false");
          button.style.cursor = "pointer";
          button.style.transition = "color 180ms ease";
          actionLabel.style.color = active ? "#ee4d2d" : "";
          if (countLabel && !isNaN(baseCount)) {
            countLabel.textContent = formatHelpfulCount(baseCount + (active ? 1 : 0));
            countLabel.style.color = active ? "#ee4d2d" : "";
          }
          var icon = button.querySelector("img");
          if (icon) {
            icon.style.transition = "filter 180ms ease, opacity 180ms ease";
            icon.style.filter = active ? "saturate(1.6) hue-rotate(-15deg)" : "";
            icon.style.opacity = active ? "1" : "";
          }
        }

        if (button.dataset.cmHelpfulBound !== "1") {
          button.dataset.cmHelpfulBound = "1";
          button.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            var active = button.getAttribute("aria-pressed") !== "true";
            votes[reviewId] = active ? 1 : 0;
            writeHelpfulVotes(votes);
            applyHelpfulState(active);
          });
          button.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " " || event.code === "Space") {
              event.preventDefault();
              button.click();
            }
          });
        }

        applyHelpfulState(votes[reviewId] === 1);
      })();
    }
  }

  function bindDisabledNavigationButtons() {
    var selectors = [
      "a.header-section__header-link",
      "a.product-ratings-header__see-all",
      "a.product-ratings__see-all-reviews-btn",
      ".carousel-with-header__item-card.ZmLCmD a.zKfZ9a",
      ".ks2mXj .carousel-with-header__items a.contents",
      ".ks2mXj .carousel-with-header__items .carousel-with-header__item-card a",
      "button.rpVkbG",
      "section.CHdQ9E.dNNItU ol a",
      "section.CHdQ9E.XKDR5h ul.YeK4oN a",
      "button.JVNY7E",
      ".BZNDi2 a.oQBMZg",
      "a.JrSi7k"
    ];
    var nodes = Array.prototype.slice.call(document.querySelectorAll(selectors.join(",")));

    // Fallback textual match in case class names vary.
    var allButtons = document.querySelectorAll("button");
    var i;
    for (i = 0; i < allButtons.length; i += 1) {
      if (normalizeText(allButtons[i].textContent || "").indexOf("ver pagina da loja") >= 0) {
        nodes.push(allButtons[i]);
      }
    }

    if (!nodes.length) return;

    function preventInteraction(event) {
      if (event) {
        if (event.cancelable) event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      }
      return false;
    }

    for (i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (!node || node.nodeType !== 1) continue;
      if (node.dataset.cmNavDisabled === "1") continue;
      node.dataset.cmNavDisabled = "1";
      node.setAttribute("aria-disabled", "true");
      node.style.pointerEvents = "none";
      node.style.cursor = "default";
      node.style.opacity = "0.9";

      if (node.tagName === "A") {
        if (!node.dataset.cmOriginalHref) node.dataset.cmOriginalHref = node.getAttribute("href") || "";
        node.removeAttribute("href");
        node.setAttribute("tabindex", "-1");
      } else if (node.tagName === "BUTTON") {
        node.setAttribute("tabindex", "-1");
      }

      node.addEventListener("click", preventInteraction, true);
      node.addEventListener("pointerup", preventInteraction, true);
      node.addEventListener("touchend", preventInteraction, true);
      node.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " " || event.code === "Space") {
          preventInteraction(event);
        }
      }, true);
    }
  }

  function bindUiFeatures() {
    bindDescriptionToggle();
    bindSpecificationToggle();
    bindImageCarousel();
    bindLikeButton();
    bindReviewHelpfulButtons();
    bindDisabledNavigationButtons();
  }

  function findNativeToast() {
    if (nativeToastRef && document.body.contains(nativeToastRef)) return nativeToastRef;
    var candidates = document.querySelectorAll("body > div");
    var i;
    for (i = 0; i < candidates.length; i += 1) {
      var style = candidates[i].getAttribute("style") || "";
      if (
        style.indexOf("bottom: 72px") >= 0 &&
        style.indexOf("opacity: 0") >= 0 &&
        candidates[i].querySelector("span")
      ) {
        nativeToastRef = candidates[i];
        break;
      }
    }
    return nativeToastRef;
  }

  function showNativeToast(message) {
    var toast = findNativeToast();
    if (!toast) return;
    var label = toast.querySelector("span");
    if (label) label.textContent = message;
    toast.style.opacity = "1";
    if (toast.__cmTimer) clearTimeout(toast.__cmTimer);
    toast.__cmTimer = setTimeout(function () {
      toast.style.opacity = "0";
    }, 1500);
  }

  function getProductData() {
    var customData = readCustomProductData();
    var title = ((document.querySelector('meta[property="og:title"]') || {}).content || document.title || "Produto").trim();
    var image = ((document.querySelector('meta[property="og:image"]') || {}).content || "").trim();
    var pathMatch = (location.pathname || "").match(/-i\.\d+\.(\d+)/);
    var itemId = pathMatch && pathMatch[1] ? pathMatch[1] : "";
    var price = "";
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');

    function findProductNode(payload) {
      if (!payload) return null;
      if (Array.isArray(payload)) {
        var i;
        for (i = 0; i < payload.length; i += 1) {
          if (payload[i] && payload[i]["@type"] === "Product") return payload[i];
        }
      }
      return payload && payload["@type"] === "Product" ? payload : null;
    }

    var i;
    for (i = 0; i < scripts.length; i += 1) {
      try {
        var parsed = safeParse(scripts[i].textContent || "{}", null);
        var product = findProductNode(parsed);
        if (product && product.offers && product.offers.price) {
          price = String(product.offers.price);
          break;
        }
      } catch (error) {}
    }

    if (customData && customData.title) {
      title = String(customData.title).trim() || title;
    }
    if (customData) {
      var customPricing = getPricingFromData(customData);
      if (customPricing.current) {
        price = customPricing.current || price;
      }
    }
    if (customData && Array.isArray(customData.images) && customData.images.length) {
      image = String(customData.images[0] || "").trim() || image;
    }

    return {
      itemId: itemId || title.toLowerCase().replace(/[^\w]+/g, "-"),
      title: title,
      image: image,
      price: price,
      url: location.href
    };
  }

  function addCurrentProduct(quantity) {
    var cart = readCart();
    var product = getProductData();
    var existing = cart.find(function (item) {
      return item.itemId === product.itemId;
    });

    if (existing) {
      var changedConfig =
        (product.title && existing.title !== product.title) ||
        (product.image && existing.image !== product.image) ||
        (product.price && existing.price !== product.price);

      existing.title = product.title || existing.title;
      existing.image = product.image || existing.image;
      existing.price = product.price || existing.price;
      existing.url = product.url || existing.url;

      if (changedConfig) {
        existing.quantity = quantity;
      } else {
        existing.quantity = (Number(existing.quantity) || 0) + quantity;
      }
    } else {
      product.quantity = quantity;
      cart.push(product);
    }

    writeCart(cart);
    return totalItems(cart);
  }

  function triggerElementClick(element) {
    if (!element) return;
    element.click();
    try {
      var event = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
      element.dispatchEvent(event);
    } catch (error) {}
  }

  function isShopeeHost() {
    return /(^|\.)shopee\.com\.br$/i.test(window.location.hostname || "");
  }

  function getShopeeOrigin() {
    var ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl && ogUrl.content) {
      try {
        return new URL(ogUrl.content).origin;
      } catch (error) {}
    }
    return "https://shopee.com.br";
  }

  function getSafeCartUrl(rawHref) {
    var fallback = getShopeeOrigin() + "/cart";
    if (!rawHref) return fallback;
    if (/^https?:\/\//i.test(rawHref)) return rawHref;
    if (isShopeeHost()) return rawHref;
    return fallback;
  }

  function openOriginalCart() {
    if (!isShopeeHost()) {
      openLocalCartDrawer();
      return;
    }

    var beforeUrl = window.location.href;
    var cartLink = document.querySelector('a[href*="/cart"]');
    var cartIcon = document.querySelector(".navbar-icon-cart__wrapper, .navbar-icon-cart");
    var cartHref = cartLink ? cartLink.getAttribute("href") : "";
    var safeCartUrl = getSafeCartUrl(cartHref);

    if (cartLink && (isShopeeHost() || /^https?:\/\//i.test(cartHref || ""))) {
      triggerElementClick(cartLink);
    } else if (cartIcon && isShopeeHost()) {
      triggerElementClick(cartIcon);
    } else {
      window.location.href = safeCartUrl;
      return;
    }

    setTimeout(function () {
      if (window.location.href !== beforeUrl) return;
      window.location.href = safeCartUrl;
    }, 180);
  }

  function shouldIgnoreDuplicatePurchase() {
    var now = Date.now();
    if (now < blockPurchaseUntil) return true;
    if (now - lastPurchaseAt < 500) return true;
    lastPurchaseAt = now;
    return false;
  }

  function findPurchaseTarget(target) {
    if (!target || typeof target.closest !== "function") return null;
    return (
      target.closest('[data-testid="add-to-cart-button"], .product-bottom-panel__add-to-cart') ||
      target.closest('[data-testid="buy-now-button"], .product-bottom-panel__buy-now')
    );
  }

  function isAddToCartTarget(target) {
    if (!target || typeof target.matches !== "function") return false;
    return target.matches('[data-testid="add-to-cart-button"], .product-bottom-panel__add-to-cart');
  }

  function handlePurchaseIntent(event) {
    var hit = findPurchaseTarget(event.target);
    if (!hit) return;

    if (event.cancelable) event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();

    if (shouldIgnoreDuplicatePurchase()) return;
    if (isAddToCartTarget(hit)) {
      openAddToCartDrawer("add_to_cart");
      return;
    }

    openAddToCartDrawer("buy_now");
  }

  function wireDirectPurchaseButtons() {
    var selector = '[data-testid="add-to-cart-button"], .product-bottom-panel__add-to-cart, [data-testid="buy-now-button"], .product-bottom-panel__buy-now';
    var buttons = document.querySelectorAll(selector);
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      var button = buttons[i];
      if (button.dataset.cmDirectBound === "1") continue;
      button.dataset.cmDirectBound = "1";
      button.style.cursor = "pointer";
      button.addEventListener("click", handlePurchaseIntent, true);
      button.addEventListener("pointerup", handlePurchaseIntent, true);
      button.addEventListener("touchend", handlePurchaseIntent, true);
    }
  }

  function bindPurchaseButtons() {
    if (purchaseDelegatedBound) return;
    purchaseDelegatedBound = true;

    document.addEventListener("click", handlePurchaseIntent, true);
    document.addEventListener("pointerup", handlePurchaseIntent, true);
    document.addEventListener("touchend", handlePurchaseIntent, true);
    wireDirectPurchaseButtons();

    if (!purchaseObserver && window.MutationObserver) {
      purchaseObserver = new MutationObserver(function () {
        wireDirectPurchaseButtons();
      });
      purchaseObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function init() {
    installRuntimeScriptGuard();
    removeBlockedRuntimeScriptsFromDom();
    runCustomDataSync();
    ensureCustomDataObserver();
    bindPurchaseButtons();
    ensureShopSectionStability();

    if (!deferredUiBindScheduled) {
      deferredUiBindScheduled = true;
      setTimeout(runCustomDataSync, 120);
      setTimeout(runCustomDataSync, 300);
      setTimeout(runCustomDataSync, 600);
      setTimeout(runCustomDataSync, 900);
      setTimeout(runCustomDataSync, 1300);
      setTimeout(runCustomDataSync, 1800);
      setTimeout(ensureShopSectionStability, 400);
      setTimeout(ensureShopSectionStability, 1200);
      setTimeout(runCustomDataSync, 2400);
      setTimeout(runCustomDataSync, 2600);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  window.addEventListener("load", init);
})();
