document.addEventListener("DOMContentLoaded", () => {
  EduShelf.initPublicPage();

  const form = document.getElementById("registerForm");
  const banner = document.getElementById("registerBanner");
  const nameInput = document.getElementById("regName");
  const emailInput = document.getElementById("regEmail");
  const passwordInput = document.getElementById("regPassword");
  const submitButton = form.querySelector('button[type="submit"]');

  [nameInput, emailInput, passwordInput].forEach((input) => {
    input.addEventListener("input", () => EduShelf.hideBanner(banner));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    EduShelf.hideBanner(banner);
    EduShelf.setButtonLoading(submitButton, true, "Creating account...");

    try {
      await EduShelf.api.post(
        "/auth/register",
        {
          full_name: nameInput.value.trim(),
          email: emailInput.value.trim(),
          password: passwordInput.value,
        },
        { skipAuthRedirect: true }
      );
      EduShelf.setButtonLoading(submitButton, false);
      EduShelf.showBanner(
        banner,
        "Account created successfully. Redirecting to sign in...",
        "success"
      );
      form.reset();
      window.setTimeout(() => {
        window.location.replace("index.html");
      }, 1400);
    } catch (error) {
      EduShelf.showBanner(
        banner,
        error.message || "Unable to create the account. Please try again.",
        "error"
      );
      EduShelf.setButtonLoading(submitButton, false);
    }
  });
});
