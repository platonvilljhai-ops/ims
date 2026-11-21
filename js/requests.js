document.addEventListener("DOMContentLoaded", async () => {
  const user = await EduShelf.initPage();
  if (!user) return;

  const isAdmin = user.role === "Administrator";
  const pageBanner = document.getElementById("pageBanner");
  const formBanner = document.getElementById("formBanner");
  const form = document.getElementById("requestForm");
  const itemSelect = document.getElementById("requestItem");
  const quantityInput = document.getElementById("requestQuantity");
  const purposeInput = document.getElementById("requestPurpose");
  const stockHint = document.getElementById("requestStockHint");
  const submitButton = form.querySelector('button[type="submit"]');
  const tableBody = document.getElementById("requestsTableBody");
  const template = document.getElementById("requestRowTemplate");
  const loadingRow = document.getElementById("requestsLoadingRow");
  const pendingCount = document.getElementById("pendingCount");

  let items = [];
  let requests = [];

  const [itemsResult, requestsResult] = await Promise.allSettled([
    loadItems(),
    loadRequests(),
  ]);

  if (itemsResult.status === "rejected") {
    EduShelf.showBanner(
      formBanner,
      itemsResult.reason.message || "Unable to load the item catalog.",
      "error"
    );
    itemSelect.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Item catalog unavailable";
    itemSelect.append(option);
    submitButton.disabled = true;
  }

  if (requestsResult.status === "rejected") {
    EduShelf.showBanner(
      pageBanner,
      requestsResult.reason.message || "Unable to load supply requests.",
      "error"
    );
    if (loadingRow) loadingRow.remove();
    tableBody.replaceChildren(
      EduShelf.createEmptyRow(
        8,
        "Unable to load supply requests. Please refresh the page."
      )
    );
  }

  itemSelect.addEventListener("change", () => {
    EduShelf.hideBanner(formBanner);
    updateStockHint();
  });

  form.addEventListener("input", () => EduShelf.hideBanner(formBanner));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    EduShelf.hideBanner(formBanner);

    const selected = items.find((item) => item.product_code === itemSelect.value);
    if (!selected) {
      EduShelf.showBanner(formBanner, "Select an inventory item.", "error");
      return;
    }

    const quantity = Number(quantityInput.value);
    const available = Number(selected.quantity);
    if (quantity > available) {
      EduShelf.showBanner(
        formBanner,
        `Only ${EduShelf.formatNumber(available)} unit(s) are available for this item.`,
        "error"
      );
      return;
    }

    EduShelf.setButtonLoading(submitButton, true, "Submitting...");
    try {
      const created = await EduShelf.api.post("/requests", {
        product_code: selected.product_code,
        quantity_requested: quantity,
        purpose: purposeInput.value.trim(),
      });

      EduShelf.setButtonLoading(submitButton, false);
      form.reset();
      updateStockHint();
      EduShelf.showBanner(
        formBanner,
        `Request #${created.request_id} submitted for review.`,
        "success"
      );
      await refreshData();
    } catch (error) {
      EduShelf.showBanner(
        formBanner,
        error.message || "Unable to submit the request.",
        "error"
      );
      EduShelf.setButtonLoading(submitButton, false);
    }
  });

  async function loadItems() {
    items = await EduShelf.api.get("/items");
    populateItemSelect();
  }

  async function loadRequests() {
    requests = await EduShelf.api.get("/requests");
    renderRequests();
  }

  async function refreshData() {
    try {
      await Promise.all([loadItems(), loadRequests()]);
    } catch (error) {
      notifyPage(
        "The request list could not be refreshed. Please reload the page.",
        "info"
      );
    }
  }

  function populateItemSelect() {
    const previousValue = itemSelect.value;
    const queryCode = EduShelf.getQueryParam("code");

    itemSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select an inventory item";
    itemSelect.append(placeholder);

    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.product_code;
      option.textContent = `${item.product_name} (${item.product_code}) — ${EduShelf.formatNumber(item.quantity)} available`;
      itemSelect.append(option);
    });

    const preferred = [previousValue, queryCode].find(
      (value) =>
        value && items.some((item) => item.product_code === value)
    );
    if (preferred) itemSelect.value = preferred;
    updateStockHint();
  }

  function updateStockHint() {
    const selected = items.find((item) => item.product_code === itemSelect.value);
    if (!selected) {
      stockHint.textContent = "Select an item to see available stock.";
      stockHint.className = "text-[11px] text-slate-500 mt-1.5";
      quantityInput.removeAttribute("max");
      submitButton.disabled = items.length === 0;
      return;
    }

    const available = Number(selected.quantity);
    quantityInput.max = String(Math.max(available, 0));
    if (available <= 0) {
      stockHint.textContent = "This item is currently out of stock.";
      stockHint.className = "text-[11px] text-rose-600 mt-1.5";
      submitButton.disabled = true;
      return;
    }

    stockHint.textContent = `${EduShelf.formatNumber(available)} units available in the warehouse.`;
    stockHint.className = "text-[11px] text-slate-500 mt-1.5";
    submitButton.disabled = false;
  }

  function renderRequests() {
    const pending = requests.filter(
      (request) => request.status === "Pending"
    ).length;
    pendingCount.textContent = `${EduShelf.formatNumber(pending)} pending`;

    tableBody.replaceChildren();
    if (requests.length === 0) {
      tableBody.append(
        EduShelf.createEmptyRow(
          8,
          "No supply requests yet. Submit the first request above."
        )
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    requests.forEach((request) => {
      fragment.append(createRequestRow(request));
    });
    tableBody.append(fragment);
  }

  function createRequestRow(request) {
    const clone = template.content.cloneNode(true);

    EduShelf.setField(clone, "requestId", `#${request.request_id}`);
    EduShelf.setField(
      clone,
      "requestedAt",
      EduShelf.formatDateTime(request.created_at)
    );
    EduShelf.setField(clone, "productName", request.product_name);
    EduShelf.setField(clone, "productCode", request.product_code);
    EduShelf.setField(clone, "requester", request.full_name || "—");
    EduShelf.setField(
      clone,
      "quantity",
      EduShelf.formatNumber(request.quantity_requested)
    );
    EduShelf.setField(clone, "purpose", request.purpose);
    EduShelf.setField(clone, "reviewer", request.reviewer_name || "—");

    const statusBadge = clone.querySelector("[data-field='status']");
    if (statusBadge) {
      statusBadge.textContent = request.status;
      statusBadge.className = `inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${EduShelf.requestStatusBadgeClass(request.status)}`;
    }

    const actionsCell = clone.querySelector("[data-field='actionsCell']");
    if (!actionsCell) return clone;

    if (!isAdmin) {
      actionsCell.classList.add("hidden");
      return clone;
    }

    if (request.status !== "Pending") {
      actionsCell.replaceChildren();
      const dash = document.createElement("span");
      dash.className = "text-slate-400";
      dash.textContent = "—";
      actionsCell.append(dash);
      return clone;
    }

    const approveButton = clone.querySelector("[data-action='approve']");
    const rejectButton = clone.querySelector("[data-action='reject']");
    if (approveButton && rejectButton) {
      approveButton.addEventListener("click", () =>
        reviewRequest(request, "Approved", approveButton, rejectButton)
      );
      rejectButton.addEventListener("click", () =>
        reviewRequest(request, "Rejected", approveButton, rejectButton)
      );
    }

    return clone;
  }

  async function reviewRequest(request, status, clickedButton, otherButton) {
    EduShelf.hideBanner(pageBanner);
    EduShelf.setButtonLoading(
      clickedButton,
      true,
      status === "Approved" ? "Approving..." : "Rejecting..."
    );
    otherButton.disabled = true;
    otherButton.classList.add("opacity-60", "cursor-not-allowed");

    try {
      await EduShelf.api.patch(`/requests/${request.request_id}`, { status });
      notifyPage(
        `Request #${request.request_id} ${status.toLowerCase()}.`,
        "success"
      );
      await refreshData();
    } catch (error) {
      notifyPage(
        error.message || `Unable to ${status.toLowerCase()} the request.`,
        "error"
      );
      EduShelf.setButtonLoading(clickedButton, false);
      otherButton.disabled = false;
      otherButton.classList.remove("opacity-60", "cursor-not-allowed");
      if (error.status === 409) {
        await refreshData();
      }
    }
  }

  function notifyPage(message, type) {
    EduShelf.showBanner(pageBanner, message, type);
    pageBanner.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
