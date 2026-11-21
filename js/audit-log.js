document.addEventListener("DOMContentLoaded", async () => {
  const user = await EduShelf.initPage();
  if (!user) return;

  const banner = document.getElementById("pageBanner");
  const searchInput = document.getElementById("logSearch");
  const actionSelect = document.getElementById("logAction");
  const clearButton = document.getElementById("clearLogFilters");
  const logCount = document.getElementById("logCount");
  const tableBody = document.getElementById("logsTableBody");
  const template = document.getElementById("logRowTemplate");
  const loadingRow = document.getElementById("logsLoadingRow");

  const state = {
    query: "",
    action: "",
  };

  let requestToken = 0;

  const debouncedSearch = EduShelf.debounce(() => {
    state.query = searchInput.value.trim();
    loadLogs();
  }, 300);

  searchInput.addEventListener("input", () => {
    EduShelf.hideBanner(banner);
    debouncedSearch();
  });

  actionSelect.addEventListener("change", () => {
    state.action = actionSelect.value;
    loadLogs();
  });

  clearButton.addEventListener("click", () => {
    state.query = "";
    state.action = "";
    searchInput.value = "";
    actionSelect.value = "";
    EduShelf.hideBanner(banner);
    loadLogs();
  });

  await loadLogs();

  async function loadLogs() {
    const token = ++requestToken;
    if (logCount) logCount.textContent = "Loading activity...";

    try {
      const logs = await EduShelf.api.get(buildPath());
      if (token !== requestToken) return;
      renderLogs(logs);
    } catch (error) {
      if (token !== requestToken) return;
      EduShelf.showBanner(
        banner,
        error.message || "Unable to load the audit log.",
        "error"
      );
      if (loadingRow) loadingRow.remove();
      tableBody.replaceChildren(
        EduShelf.createEmptyRow(
          5,
          "Unable to load the audit log. Please refresh the page."
        )
      );
      if (logCount) logCount.textContent = "Unable to load activity.";
    }
  }

  function buildPath() {
    const params = new URLSearchParams();
    if (state.query) params.set("q", state.query);
    if (state.action) params.set("action", state.action);
    const suffix = params.toString();
    return suffix ? `/logs?${suffix}` : "/logs";
  }

  function renderLogs(logs) {
    tableBody.replaceChildren();

    if (logCount) {
      const label = logs.length === 1 ? "entry" : "entries";
      logCount.textContent = `Showing ${EduShelf.formatNumber(logs.length)} log ${label}`;
    }

    if (logs.length === 0) {
      tableBody.append(
        EduShelf.createEmptyRow(
          5,
          "No activity matches the current filters."
        )
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    logs.forEach((log) => {
      fragment.append(createLogRow(log));
    });
    tableBody.append(fragment);
  }

  function createLogRow(log) {
    const clone = template.content.cloneNode(true);

    EduShelf.setField(
      clone,
      "timestamp",
      EduShelf.formatDateTime(log.created_at)
    );
    EduShelf.setField(clone, "details", log.details);
    EduShelf.setField(clone, "user", log.full_name || "System");
    EduShelf.setField(clone, "productCode", log.product_code || "—");

    const actionBadge = clone.querySelector("[data-field='action']");
    if (actionBadge) {
      actionBadge.textContent = log.action;
      actionBadge.className = `inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${EduShelf.actionBadgeClass(log.action)}`;
    }

    return clone;
  }
});
