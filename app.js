// Shared API client and UI helpers for the EduShelf frontend.
// This file is loaded as a classic script and exposes `window.EduShelf`.
(() => {
  "use strict";

  const API_BASE = "/api";

  const BANNER_CLASSES = {
    error: "bg-rose-50 border-rose-200 text-rose-700",
    success: "bg-emerald-50 border-emerald-200 text-emerald-700",
    info: "bg-slate-50 border-slate-200 text-slate-700",
  };

  const ACTION_BADGE_CLASSES = {
    "Initial Record": "bg-slate-100 text-slate-600",
    "Item Created": "bg-[#14AE5C]/10 text-[#14AE5C]",
    "Record Edited": "bg-blue-500/10 text-blue-700",
    "Item Deleted": "bg-rose-500/15 text-rose-700",
    "Supply Requested": "bg-amber-500/15 text-amber-700",
    "Request Approved": "bg-[#14AE5C]/10 text-[#14AE5C]",
    "Request Rejected": "bg-rose-500/15 text-rose-700",
    "User Registered": "bg-indigo-500/10 text-indigo-700",
    "User Login": "bg-slate-100 text-slate-600",
    "Security Alert: Account Locked": "bg-rose-500/15 text-rose-700",
  };

  const pesoFormatter = new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const numberFormatter = new Intl.NumberFormat("en-PH");

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.payload = payload;
    }
  }

  async function apiRequest(path, options = {}) {
    const {
      skipAuthRedirect = false,
      body,
      headers = {},
      method = "GET",
      ...rest
    } = options;

    const requestHeaders = { Accept: "application/json", ...headers };
    const requestOptions = {
      method,
      credentials: "same-origin",
      headers: requestHeaders,
      ...rest,
    };

    if (body !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
      requestOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, requestOptions);
    } catch (error) {
      throw new ApiError(
        "Unable to reach the server. Check your connection and try again.",
        0,
        null
      );
    }

    let payload = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await response.json().catch(() => null);
    }

    if (!response.ok) {
      if (response.status === 401 && !skipAuthRedirect) {
        window.location.replace("index.html");
      }
      const message =
        payload && typeof payload.message === "string" && payload.message
          ? payload.message
          : `Request failed (${response.status}).`;
      throw new ApiError(message, response.status, payload);
    }

    if (
      payload &&
      typeof payload === "object" &&
      Object.prototype.hasOwnProperty.call(payload, "data")
    ) {
      return payload.data;
    }
    return payload;
  }

  const api = {
    get: (path, options = {}) => apiRequest(path, { ...options, method: "GET" }),
    post: (path, body, options = {}) =>
      apiRequest(path, { ...options, method: "POST", body }),
    put: (path, body, options = {}) =>
      apiRequest(path, { ...options, method: "PUT", body }),
    patch: (path, body, options = {}) =>
      apiRequest(path, { ...options, method: "PATCH", body }),
    delete: (path, options = {}) =>
      apiRequest(path, { ...options, method: "DELETE" }),
  };

  function showBanner(element, message, type = "error") {
    if (!element) return;
    const palette = BANNER_CLASSES[type] || BANNER_CLASSES.info;
    element.className = `rounded-lg border px-4 py-3 text-sm ${palette}`;
    const textNode = element.querySelector("[data-banner-text]");
    if (textNode) {
      textNode.textContent = message;
    } else {
      element.textContent = message;
    }
  }

  function hideBanner(element) {
    if (!element) return;
    element.classList.add("hidden");
  }

  function setButtonLoading(button, isLoading, loadingText = "Working...") {
    if (!button) return;
    const label = button.querySelector("[data-button-label]");
    if (isLoading) {
      button.dataset.originalLabel = label
        ? label.textContent
        : button.textContent.trim();
      button.disabled = true;
      button.classList.add("opacity-70", "cursor-not-allowed");
      if (label) {
        label.textContent = loadingText;
      } else {
        button.textContent = loadingText;
      }
      return;
    }

    button.disabled = false;
    button.classList.remove("opacity-70", "cursor-not-allowed");
    if (button.dataset.originalLabel !== undefined) {
      if (label) {
        label.textContent = button.dataset.originalLabel;
      } else {
        button.textContent = button.dataset.originalLabel;
      }
      delete button.dataset.originalLabel;
    }
  }

  function initLucide() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function formatCurrency(value) {
    const numeric = Number(value);
    return `₱${pesoFormatter.format(Number.isFinite(numeric) ? numeric : 0)}`;
  }

  function formatNumber(value) {
    const numeric = Number(value);
    return numberFormatter.format(Number.isFinite(numeric) ? numeric : 0);
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function statusBadgeClass(status) {
    if (status === "Out of Stock") return "bg-rose-500/15 text-rose-700";
    if (status === "Low Stock") return "bg-amber-500/15 text-amber-700";
    return "bg-[#14AE5C]/10 text-[#14AE5C]";
  }

  function requestStatusBadgeClass(status) {
    if (status === "Rejected") return "bg-rose-500/15 text-rose-700";
    if (status === "Approved") return "bg-[#14AE5C]/10 text-[#14AE5C]";
    return "bg-amber-500/15 text-amber-700";
  }

  function actionBadgeClass(action) {
    return ACTION_BADGE_CLASSES[action] || "bg-slate-100 text-slate-600";
  }

  function debounce(callback, delay = 300) {
    let timer = null;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    };
  }

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function setField(root, field, value) {
    const element = root.querySelector(`[data-field='${field}']`);
    if (element) element.textContent = value;
  }

  function createEmptyRow(columnCount, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columnCount;
    cell.className = "py-10 px-6 text-center text-xs text-slate-500";
    cell.textContent = message;
    row.append(cell);
    return row;
  }

  function populateUserChrome(user) {
    const nameElement = document.getElementById("sidebarProfileName");
    const roleElement = document.getElementById("sidebarProfileRole");
    if (nameElement) nameElement.textContent = user.full_name;
    if (roleElement) roleElement.textContent = user.role;
  }

  function applyRoleVisibility(user) {
    const isAdmin = user.role === "Administrator";
    document.querySelectorAll("[data-admin-only]").forEach((element) => {
      element.classList.toggle("hidden", !isAdmin);
    });
    document.querySelectorAll("[data-staff-only]").forEach((element) => {
      element.classList.toggle("hidden", isAdmin);
    });
  }

  function setupLogout() {
    const button = document.getElementById("logoutBtn");
    if (!button) return;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.classList.add("opacity-60", "cursor-not-allowed");
      try {
        await apiRequest("/auth/logout", {
          method: "POST",
          skipAuthRedirect: true,
        });
      } catch (error) {
        // The local session is discarded by navigating to the login page.
      }
      window.location.replace("index.html");
    });
  }

  async function initPage() {
    try {
      const user = await apiRequest("/auth/me", { skipAuthRedirect: true });
      populateUserChrome(user);
      applyRoleVisibility(user);
      setupLogout();
      initLucide();
      return user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.location.replace("index.html");
        return null;
      }
      const banner = document.getElementById("pageBanner");
      if (banner) {
        showBanner(
          banner,
          error.message || "Unable to load your session.",
          "error"
        );
      }
      return null;
    }
  }

  async function initPublicPage() {
    initLucide();
    try {
      await apiRequest("/auth/me", { skipAuthRedirect: true });
      window.location.replace("dashboard.html");
    } catch (error) {
      // No active session: stay on the public page.
    }
  }

  window.EduShelf = Object.freeze({
    ApiError,
    api,
    initPage,
    initPublicPage,
    initLucide,
    showBanner,
    hideBanner,
    setButtonLoading,
    formatCurrency,
    formatNumber,
    formatDateTime,
    statusBadgeClass,
    requestStatusBadgeClass,
    actionBadgeClass,
    debounce,
    getQueryParam,
    setField,
    createEmptyRow,
  });
})();
