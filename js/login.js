document.addEventListener("DOMContentLoaded", () => {
  EduShelf.initPublicPage();

  const form = document.getElementById("loginForm");
  const banner = document.getElementById("loginBanner");
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  const submitButton = form.querySelector('button[type="submit"]');

  [emailInput, passwordInput].forEach((input) => {
    input.addEventListener("input", () => EduShelf.hideBanner(banner));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    EduShelf.hideBanner(banner);
    EduShelf.setButtonLoading(submitButton, true, "Signing in...");

    try {
      await EduShelf.api.post(
        "/auth/login",
        {
          email: emailInput.value.trim(),
          password: passwordInput.value,
        },
        { skipAuthRedirect: true }
      );
      window.location.replace("dashboard.html");
    } catch (error) {
      EduShelf.showBanner(
        banner,
        error.message || "Unable to sign in. Please try again.",
        "error"
      );
      EduShelf.setButtonLoading(submitButton, false);
      passwordInput.focus();
      passwordInput.select();
    }
  });
});
