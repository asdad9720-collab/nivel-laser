(function () {
  var STORAGE_KEY = "clone_mobile_utm_tracking";
  var PIXEL_ID = "6950665de596a0170c10133e";
  var TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var TRACKING_FIELDS = [
    "src",
    "sck",
    "utm_source",
    "utm_campaign",
    "utm_medium",
    "utm_content",
    "utm_term",
    "utm_id",
    "fbclid",
    "gclid",
    "gbraid",
    "wbraid",
    "ttclid",
    "xcod"
  ];

  function now() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function safeParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function safeGetLocalStorageItem(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (error) {
      return null;
    }
  }

  function safeSetLocalStorageItem(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (error) {}
  }

  function safeRemoveLocalStorageItem(key) {
    try {
      if (window.localStorage) window.localStorage.removeItem(key);
    } catch (error) {}
  }

  function pickString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeTrackingMap(source) {
    var result = {};
    var i;
    if (!source || typeof source !== "object") return result;
    for (i = 0; i < TRACKING_FIELDS.length; i += 1) {
      var field = TRACKING_FIELDS[i];
      var value = pickString(source[field]);
      if (value) result[field] = value;
    }
    if (source.landingPage) result.landingPage = pickString(source.landingPage);
    if (source.firstPage) result.firstPage = pickString(source.firstPage);
    if (Number(source.capturedAt) > 0) result.capturedAt = Number(source.capturedAt);
    if (Number(source.updatedAt) > 0) result.updatedAt = Number(source.updatedAt);
    if (Number(source.expiresAt) > 0) result.expiresAt = Number(source.expiresAt);
    return result;
  }

  function readStoredTracking() {
    var stored = normalizeTrackingMap(safeParse(safeGetLocalStorageItem(STORAGE_KEY) || "{}", {}));
    if (stored.expiresAt && stored.expiresAt < now()) {
      safeRemoveLocalStorageItem(STORAGE_KEY);
      return {};
    }
    return stored;
  }

  function readLegacyTracking() {
    var result = {};
    var i;
    for (i = 0; i < TRACKING_FIELDS.length; i += 1) {
      var field = TRACKING_FIELDS[i];
      var value = pickString(safeGetLocalStorageItem(field));
      if (value) result[field] = value;
    }
    return result;
  }

  function readQueryTracking() {
    var result = {};
    var params;
    var i;

    try {
      params = new URLSearchParams(window.location.search || "");
    } catch (error) {
      return result;
    }

    for (i = 0; i < TRACKING_FIELDS.length; i += 1) {
      var field = TRACKING_FIELDS[i];
      var value = pickString(params.get(field));
      if (value) result[field] = value;
    }
    return result;
  }

  function persistTracking(source) {
    var normalized = normalizeTrackingMap(source);
    var hasTracking = false;
    var i;

    for (i = 0; i < TRACKING_FIELDS.length; i += 1) {
      if (normalized[TRACKING_FIELDS[i]]) {
        hasTracking = true;
        break;
      }
    }

    if (!hasTracking) {
      safeRemoveLocalStorageItem(STORAGE_KEY);
      return {};
    }

    if (!normalized.firstPage) normalized.firstPage = pickString(window.location.href.split("#")[0]);
    if (!normalized.landingPage) normalized.landingPage = normalized.firstPage;
    if (!normalized.capturedAt) normalized.capturedAt = now();
    normalized.updatedAt = now();
    normalized.expiresAt = now() + TTL_MS;

    safeSetLocalStorageItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function captureTracking() {
    var stored = readStoredTracking();
    var legacy = readLegacyTracking();
    var current = readQueryTracking();
    return persistTracking(Object.assign({}, stored, legacy, current, {
      firstPage: stored.firstPage || pickString(window.location.href.split("#")[0]),
      landingPage: stored.landingPage || pickString(window.location.href.split("#")[0]),
      capturedAt: stored.capturedAt || now()
    }));
  }

  function readTracking() {
    return persistTracking(Object.assign({}, readStoredTracking(), readLegacyTracking()));
  }

  function appendScript(src, attributes) {
    var selector = 'script[src="' + src + '"]';
    var existing = document.querySelector(selector);
    var script;
    var key;

    if (existing) return existing;

    script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;

    if (attributes && typeof attributes === "object") {
      for (key in attributes) {
        if (Object.prototype.hasOwnProperty.call(attributes, key)) {
          script.setAttribute(key, attributes[key]);
        }
      }
    }

    (document.head || document.getElementsByTagName("head")[0]).appendChild(script);
    return script;
  }

  function ensureScriptsLoaded() {
    appendScript("https://cdn.utmify.com.br/scripts/utms/latest.js", {
      "data-utmify-prevent-xcod-sck": "",
      "data-utmify-prevent-subids": ""
    });

    if (!window.pixelId) {
      window.pixelId = PIXEL_ID;
    }

    appendScript("https://cdn.utmify.com.br/scripts/pixel/pixel.js");
  }

  var captured = captureTracking();

  window.CM_UTMIFY = {
    STORAGE_KEY: STORAGE_KEY,
    PIXEL_ID: PIXEL_ID,
    TRACKING_FIELDS: TRACKING_FIELDS.slice(),
    captureTracking: captureTracking,
    readTracking: readTracking,
    ensureScriptsLoaded: ensureScriptsLoaded,
    latest: captured
  };

  ensureScriptsLoaded();
})();
