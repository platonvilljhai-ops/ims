document.addEventListener("DOMContentLoaded", async () => {
  const user = await EduShelf.initPage();
  if (!user) return;

  const form = document.getElementById("addItemForm");
  const banner = document.getElementById("formBanner");
  const codeInput = document.getElementById("inputCode");
  const nameInput = document.getElementById("inputName");
  const categoryInput = document.getElementById("inputCategory");
  const locationInput = document.getElementById("inputLocation");
  const quantityInput = document.getElementById("inputQty");
  const priceInput = document.getElementById("inputPrice");
  const thresholdInput = document.getElementById("inputThreshold");
  const submitButton = form.querySelector('button[type="submit"]');

  if (!codeInput.value) {
    const randomCode = Math.floor(100 + Math.random() * 900);
    codeInput.value = `OFF-${randomCode}`;
  }

  form.addEventListener("input", () => EduShelf.hideBanner(banner));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    EduShelf.hideBanner(banner);
    EduShelf.setButtonLoading(submitButton, true, "Saving...");

    try {
      const created = await EduShelf.api.post("/items", {
        product_code: codeInput.value.trim(),
        product_name: nameInput.value.trim(),
        category: categoryInput.value,
        location: locationInput.value.trim(),
        quantity: Number(quantityInput.value),
        unit_price: Number(priceInput.value),
        threshold: Number(thresholdInput.value),
      });

      EduShelf.showBanner(
        banner,
        "New item successfully recorded.",
        "success"
      );
      window.setTimeout(() => {
        window.location.href = `details.html?code=${encodeURIComponent(created.product_code)}`;
      }, 600);
    } catch (error) {
      EduShelf.showBanner(
        banner,
        error.message || "Unable to save the item.",
        "error"
      );
      EduShelf.setButtonLoading(submitButton, false);
    }
  });
});
