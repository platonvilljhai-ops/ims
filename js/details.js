document.addEventListener("DOMContentLoaded", async () => {
  const user = await EduShelf.initPage();
  if (!user) return;

  const banner = document.getElementById("pageBanner");
  const loadingState = document.getElementById("loadingState");
  const notFoundState = document.getElementById("notFoundState");
  const detailsContent = document.getElementById("itemDetailsContent");
  const headerActions = document.getElementById("headerActions");
  const headerTitle = document.getElementById("detailHeaderTitle");
  const headerCode = document.getElementById("detailHeaderCode");
  const headerBadge = document.getElementById("detailHeaderBadge");
  const editButton = document.getElementById("editItemBtn");
  const deleteButton = document.getElementById("deleteItemBtn");
  const historyBody = document.getElementById("itemHistoryBody");
  const historyTemplate = document.getElementById("historyRowTemplate");
  const itemCode = EduShelf.getQueryParam("code");

  let currentItem = null;

  if (!itemCode) {
    showNotFound();
    return;
  }

  try {
    const data = await EduShelf.api.get(
      `/items/${encodeURIComponent(itemCode)}`
    );
    currentItem = data.item;
    renderItem(data.item, data.logs || []);
  } catch (error) {
    if (error.status === 404) {
      showNotFound();
      return;
    }
    if (loadingState) loadingState.classList.add("hidden");
    detailsContent.classList.add("hidden");
    headerActions.classList.add("hidden");
    EduShelf.showBanner(
      banner,
      error.message || "Unable to load the item details.",
      "error"
    );
  }

  deleteButton.addEventListener("click", async () => {
    if (!currentItem) return;
    const confirmed = window.confirm(
      `Delete ${currentItem.product_name} (${currentItem.product_code})? This action cannot be undone.`
    );
    if (!confirmed) return;

    EduShelf.hideBanner(banner);
    EduShelf.setButtonLoading(deleteButton, true, "Deleting...");
    try {
      await EduShelf.api.delete(
        `/items/${encodeURIComponent(currentItem.product_code)}`
      );
      window.location.href = "inventory.html";
    } catch (error) {
      EduShelf.showBanner(
        banner,
        error.message || "Unable to delete the item.",
        "error"
      );
      EduShelf.setButtonLoading(deleteButton, false);
    }
  });

  function renderItem(item, logs) {
    if (loadingState) loadingState.classList.add("hidden");
    notFoundState.classList.add("hidden");
    detailsContent.classList.remove("hidden");
    headerActions.classList.remove("hidden");

    document.title = `${item.product_name} - EduShelf`;
    headerTitle.textContent = item.product_name;
    headerCode.textContent = item.product_code;
    headerBadge.textContent = item.status;
    headerBadge.className = `inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${EduShelf.statusBadgeClass(item.status)}`;

    editButton.href = `edit.html?code=${encodeURIComponent(item.product_code)}`;

    const totalValue = Number(item.quantity) * Number(item.unit_price);
    setText("kpiStockQty", `${EduShelf.formatNumber(item.quantity)} units`);
    setText("kpiUnitPrice", EduShelf.formatCurrency(item.unit_price));
    setText("kpiTotalValue", EduShelf.formatCurrency(totalValue));
    setText("kpiThreshold", `${EduShelf.formatNumber(item.threshold)} units`);

    setText("specCode", item.product_code);
    setText("specCategory", item.category);
    setText("specLocation", item.location);
    setText("specThreshold", `≤ ${EduShelf.formatNumber(item.threshold)} units`);
    setText("specUpdatedAt", EduShelf.formatDateTime(item.updated_at));

    renderHistory(logs);
  }

  function renderHistory(logs) {
    historyBody.replaceChildren();
    if (logs.length === 0) {
      historyBody.append(
        EduShelf.createEmptyRow(4, "No recorded history yet.")
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    logs.forEach((log) => {
      const clone = historyTemplate.content.cloneNode(true);
      EduShelf.setField(clone, "timestamp", EduShelf.formatDateTime(log.created_at));
      EduShelf.setField(clone, "action", log.action);
      EduShelf.setField(clone, "details", log.details);
      EduShelf.setField(clone, "user", log.full_name || "System");
      fragment.append(clone);
    });
    historyBody.append(fragment);
  }

  function showNotFound() {
    if (loadingState) loadingState.classList.add("hidden");
    detailsContent.classList.add("hidden");
    headerActions.classList.add("hidden");
    notFoundState.classList.remove("hidden");
    headerBadge.classList.add("hidden");
    headerCode.textContent = "";
    document.title = "Item Not Found - EduShelf";
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
});
