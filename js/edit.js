document.addEventListener("DOMContentLoaded", async () => {
  const user = await EduShelf.initPage();
  if (!user) return;

  const form = document.getElementById("editItemForm");
  const banner = document.getElementById("formBanner");
  const codeInput = document.getElementById("inputCode");
  const nameInput = document.getElementById("inputName");
  const categoryInput = document.getElementById("inputCategory");
  const locationInput = document.getElementById("inputLocation");
  const quantityInput = document.getElementById("inputQty");
  const priceInput = document.getElementById("inputPrice");
  const thresholdInput = document.getElementById("inputThreshold");
  const submitButton = form.querySelector('button[type="submit"]');
  const deleteButton = document.getElementById("deleteItemBtn");
  const backLink = document.getElementById("backToDetailsLink");
  const cancelLink = document.getElementById("cancelEditBtn");
  const originalCode = EduShelf.getQueryParam("code");

  let currentItem = null;

  if (!originalCode) {
    disableForm();
    EduShelf.showBanner(
      banner,
      "No item selected. Return to inventory and choose an item to edit.",
      "error"
    );
    return;
  }

  try {
    const data = await EduShelf.api.get(
      `/items/${encodeURIComponent(originalCode)}`
    );
    currentItem = data.item;
    populateForm(currentItem);
  } catch (error) {
    disableForm();
    EduShelf.showBanner(
      banner,
      error.status === 404
        ? "Item not found. It may have been removed."
        : error.message || "Unable to load the item.",
      "error"
    );
    return;
  }

  form.addEventListener("input", () => EduShelf.hideBanner(banner));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentItem) return;

    EduShelf.hideBanner(banner);
    EduShelf.setButtonLoading(submitButton, true, "Saving...");

    try {
      const updated = await EduShelf.api.put(
        `/items/${encodeURIComponent(currentItem.product_code)}`,
        {
          product_code: codeInput.value.trim(),
          product_name: nameInput.value.trim(),
          category: categoryInput.value,
          location: locationInput.value.trim(),
          quantity: Number(quantityInput.value),
          unit_price: Number(priceInput.value),
          threshold: Number(thresholdInput.value),
        }
      );

      EduShelf.setButtonLoading(submitButton, false);
      EduShelf.showBanner(banner, "Item updated successfully.", "success");
      window.setTimeout(() => {
        window.location.href = `details.html?code=${encodeURIComponent(updated.product_code)}`;
      }, 500);
    } catch (error) {
      EduShelf.showBanner(
        banner,
        error.message || "Unable to update the item.",
        "error"
      );
      EduShelf.setButtonLoading(submitButton, false);
    }
  });

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

  function populateForm(item) {
    const detailsUrl = `details.html?code=${encodeURIComponent(item.product_code)}`;
    backLink.href = detailsUrl;
    cancelLink.href = detailsUrl;

    codeInput.value = item.product_code;
    nameInput.value = item.product_name;
    locationInput.value = item.location;
    quantityInput.value = item.quantity;
    priceInput.value = Number(item.unit_price).toFixed(2);
    thresholdInput.value = item.threshold;

    const hasCategory = [...categoryInput.options].some(
      (option) => option.value === item.category
    );
    if (!hasCategory) {
      const option = document.createElement("option");
      option.value = item.category;
      option.textContent = item.category;
      categoryInput.append(option);
    }
    categoryInput.value = item.category;
  }

  function disableForm() {
    [...form.elements].forEach((element) => {
      element.disabled = true;
    });
    deleteButton.disabled = true;
    deleteButton.classList.add("hidden");
  }
});
