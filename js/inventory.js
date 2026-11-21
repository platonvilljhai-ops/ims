document.addEventListener("DOMContentLoaded", async () => {
  const user = await EduShelf.initPage();
  if (!user) return;

  const banner = document.getElementById("pageBanner");
  const searchInput = document.getElementById("searchInput");
  const categoryFilter = document.getElementById("categoryFilter");
  const statusFilter = document.getElementById("statusFilter");
  const locationFilter = document.getElementById("locationFilter");
  const clearButton = document.getElementById("clearFilters");
  const resultCount = document.getElementById("resultCount");
  const tableBody = document.getElementById("inventoryTableBody");
  const template = document.getElementById("inventoryRowTemplate");
  const loadingRow = document.getElementById("inventoryLoadingRow");

  const state = {
    items: [],
    search: "",
    category: "all",
    status: "all",
    location: "all",
  };

  try {
    state.items = await EduShelf.api.get("/items");
    populateFilters(state.items);
    applyFilters();
  } catch (error) {
    EduShelf.showBanner(
      banner,
      error.message || "Unable to load inventory.",
      "error"
    );
    if (loadingRow) loadingRow.remove();
    if (resultCount) resultCount.textContent = "Unable to load inventory.";
    tableBody.replaceChildren(
      EduShelf.createEmptyRow(
        8,
        "Unable to load inventory. Please refresh the page."
      )
    );
    return;
  }

  searchInput.addEventListener("input", () => {
    state.search = searchInput.value;
    applyFilters();
  });

  categoryFilter.addEventListener("change", () => {
    state.category = categoryFilter.value;
    applyFilters();
  });

  statusFilter.addEventListener("change", () => {
    state.status = statusFilter.value;
    applyFilters();
  });

  locationFilter.addEventListener("change", () => {
    state.location = locationFilter.value;
    applyFilters();
  });

  clearButton.addEventListener("click", () => {
    state.search = "";
    state.category = "all";
    state.status = "all";
    state.location = "all";
    searchInput.value = "";
    categoryFilter.value = "all";
    statusFilter.value = "all";
    locationFilter.value = "all";
    applyFilters();
  });

  function populateFilters(items) {
    const categories = [...new Set(items.map((item) => item.category))].sort(
      (first, second) => first.localeCompare(second)
    );
    const locations = [...new Set(items.map((item) => item.location))].sort(
      (first, second) => first.localeCompare(second)
    );

    fillSelect(categoryFilter, categories, "All Categories");
    fillSelect(locationFilter, locations, "All Locations");
  }

  function fillSelect(select, values, allLabel) {
    select.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = allLabel;
    select.append(allOption);

    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
  }

  function applyFilters() {
    const query = state.search.trim().toLowerCase();
    const filtered = state.items.filter((item) => {
      const matchesQuery =
        !query ||
        [item.product_code, item.product_name, item.category, item.location].some(
          (value) => String(value).toLowerCase().includes(query)
        );
      const matchesCategory =
        state.category === "all" || item.category === state.category;
      const matchesStatus =
        state.status === "all" || item.status === state.status;
      const matchesLocation =
        state.location === "all" || item.location === state.location;
      return (
        matchesQuery && matchesCategory && matchesStatus && matchesLocation
      );
    });

    renderTable(filtered);
    if (resultCount) {
      resultCount.textContent = `Showing ${EduShelf.formatNumber(filtered.length)} of ${EduShelf.formatNumber(state.items.length)} items`;
    }
  }

  function renderTable(items) {
    tableBody.replaceChildren();
    if (items.length === 0) {
      tableBody.append(
        EduShelf.createEmptyRow(8, "No items match the current filters.")
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      fragment.append(createRow(item));
    });
    tableBody.append(fragment);
  }

  function createRow(item) {
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
});
