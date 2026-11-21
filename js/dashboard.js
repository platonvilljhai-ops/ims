document.addEventListener("DOMContentLoaded", async () => {
  const user = await EduShelf.initPage();
  if (!user) return;

  const banner = document.getElementById("pageBanner");
  const tableBody = document.getElementById("dashboardTableBody");
  const template = document.getElementById("dashboardRowTemplate");
  const loadingRow = document.getElementById("dashboardLoadingRow");

  try {
    const [itemsResult, requestsResult] = await Promise.allSettled([
      EduShelf.api.get("/items"),
      EduShelf.api.get("/requests"),
    ]);

    if (itemsResult.status === "rejected") {
      throw itemsResult.reason;
    }

    const items = itemsResult.value;
    const requests =
      requestsResult.status === "fulfilled" ? requestsResult.value : [];

    if (requestsResult.status === "rejected") {
      EduShelf.showBanner(
        banner,
        "Inventory loaded, but pending requests could not be retrieved.",
        "info"
      );
    }

    updateKpis(items, requests);
    renderAlerts(items, tableBody, template);
  } catch (error) {
    EduShelf.showBanner(
      banner,
      error.message || "Unable to load the dashboard.",
      "error"
    );
    if (loadingRow) loadingRow.remove();
    tableBody.replaceChildren(
      EduShelf.createEmptyRow(
        8,
        "Unable to load inventory. Please refresh the page."
      )
    );
  }
});

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function updateKpis(items, requests) {
  const alertCount = items.filter(
    (item) => item.status === "Low Stock" || item.status === "Out of Stock"
  ).length;
  const pendingCount = requests.filter(
    (request) => request.status === "Pending"
  ).length;
  const categoryCount = new Set(items.map((item) => item.category)).size;

  setText("kpiTotal", EduShelf.formatNumber(items.length));
  setText("kpiLow", EduShelf.formatNumber(alertCount));
  setText("kpiPending", EduShelf.formatNumber(pendingCount));
  setText("kpiCategories", EduShelf.formatNumber(categoryCount));
}

function renderAlerts(items, tableBody, template) {
  const alertItems = items
    .filter(
      (item) => item.status === "Low Stock" || item.status === "Out of Stock"
    )
    .sort((first, second) => {
      const priority = { "Out of Stock": 0, "Low Stock": 1 };
      return (
        (priority[first.status] ?? 2) - (priority[second.status] ?? 2) ||
        Number(first.quantity) - Number(second.quantity) ||
        first.product_code.localeCompare(second.product_code)
      );
    });

  tableBody.replaceChildren();
  if (alertItems.length === 0) {
    tableBody.append(
      EduShelf.createEmptyRow(8, "All items are sufficiently stocked.")
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  alertItems.forEach((item) => {
    fragment.append(createAlertRow(item, template));
  });
  tableBody.append(fragment);
}

function createAlertRow(item, template) {
  const clone = template.content.cloneNode(true);
  const row = clone.querySelector("tr");
  const detailsUrl = `details.html?code=${encodeURIComponent(item.product_code)}`;

  row.addEventListener("click", () => {
    window.location.href = detailsUrl;
  });

  EduShelf.setField(clone, "code", item.product_code);
  EduShelf.setField(clone, "name", item.product_name);
  EduShelf.setField(clone, "category", item.category);
  EduShelf.setField(clone, "quantity", EduShelf.formatNumber(item.quantity));
  EduShelf.setField(clone, "price", EduShelf.formatCurrency(item.unit_price));
  EduShelf.setField(clone, "location", item.location);

  const quantityCell = clone.querySelector("[data-field='quantity']");
  if (quantityCell) {
    quantityCell.classList.add(
      item.status === "Out of Stock"
        ? "text-rose-600"
        : item.status === "Low Stock"
          ? "text-amber-600"
          : "text-slate-900"
    );
  }

  const statusBadge = clone.querySelector("[data-field='status']");
  if (statusBadge) {
    statusBadge.textContent = item.status;
    statusBadge.className = `inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${EduShelf.statusBadgeClass(item.status)}`;
  }

  const viewLink = clone.querySelector("[data-action='view']");
  if (viewLink) {
    viewLink.href = detailsUrl;
    viewLink.addEventListener("click", (event) => event.stopPropagation());
  }

  return clone;
}
