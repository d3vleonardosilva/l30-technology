(function () {
  "use strict";
  const prices = { annual: null, monthly: null };
  let annualAmountMinor = null;
  let generation = 0;

  function language() {
    const value = (document.documentElement.lang || "en").toLowerCase();
    return value.startsWith("pt") ? "pt" : value.startsWith("es") ? "es" : "en";
  }

  function currencyCode() {
    return language() === "pt" ? "BRL" : "USD";
  }

  function formatMonthlyEquivalent(minorUnits, lang) {
    // USD and BRL both use two decimal places. The amount comes from Paddle,
    // so the monthly equivalent follows the selected currency's annual price.
    if (!Number.isFinite(minorUnits)) return null;
    const locale = lang === "pt" ? "pt-BR" : lang === "es" ? "es-ES" : "en-US";
    const formatted = new Intl.NumberFormat(locale, {
      style: "currency", currency: currencyCode(),
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(minorUnits / 1200);
    const suffix = { en: " / month", pt: " / mês", es: " / mes" }[lang];
    return formatted + suffix;
  }

  function renderLocalizedPrices() {
    const lang = language();
    const suffix = {
      en: { monthly: "/ month", billed: "billed yearly" },
      pt: { monthly: "/ mês", billed: "cobrados por ano" },
      es: { monthly: "/ mes", billed: "cobrados al año" }
    }[lang];
    const equivalent = formatMonthlyEquivalent(annualAmountMinor, lang);

    document.querySelectorAll("[data-annual-monthly-equivalent]").forEach((element) => {
      if (equivalent) element.textContent = equivalent;
    });

    document.querySelectorAll("[data-localized-price-plan]").forEach((element) => {
      const plan = element.dataset.localizedPricePlan;
      if (!prices[plan]) return;
      element.textContent = plan === "annual"
        ? prices.annual + " " + suffix.billed
        : prices.monthly + " " + suffix.monthly;
    });

    const optionLabels = {
      en: {
        annual: (value) => "Annual · " + (equivalent || "monthly equivalent") + " equivalent · " + value + " billed yearly · 7-day free trial",
        monthly: (value) => "Monthly · " + value + "/month · 7-day free trial"
      },
      pt: {
        annual: (value) => "Anual · " + (equivalent || "equivalente mensal") + " (equivalente) · " + value + " cobrados por ano · 7 dias grátis",
        monthly: (value) => "Mensal · " + value + "/mês · 7 dias grátis"
      },
      es: {
        annual: (value) => "Anual · " + (equivalent || "equivalente mensual") + " (equivalente) · " + value + " cobrados al año · 7 días gratis",
        monthly: (value) => "Mensual · " + value + "/mes · 7 días gratis"
      }
    }[lang];

    document.querySelectorAll("[data-localized-price-option]").forEach((option) => {
      const plan = option.dataset.localizedPriceOption;
      if (prices[plan]) option.textContent = optionLabels[plan](prices[plan]);
    });
  }

  async function loadPrices() {
    const currentGeneration = ++generation;
    const requestedCurrency = currencyCode();
    const token = window.L30_PADDLE_CLIENT_TOKEN;
    const supabaseUrl = window.L30_SUPABASE_URL;
    const publishableKey = window.L30_SUPABASE_PUBLISHABLE_KEY;

    if (!window.Paddle || !token || !supabaseUrl || !publishableKey) {
      throw new Error("Localized pricing is not configured.");
    }

    if (token.startsWith("test_")) window.Paddle.Environment.set("sandbox");
    if (!window.__l30PaddlePricingInitialized) {
      window.Paddle.Initialize({ token });
      window.__l30PaddlePricingInitialized = true;
    }

    const response = await fetch(supabaseUrl.replace(/\/$/, "") + "/functions/v1/pricing-catalog", {
      method: "GET",
      headers: { apikey: publishableKey }
    });
    if (!response.ok) throw new Error("Unable to load Paddle price identifiers.");
    const catalog = await response.json();

    if (!catalog.annualPriceId || !catalog.monthlyPriceId) {
      throw new Error("Paddle price identifiers are missing.");
    }

    const preview = await window.Paddle.PricePreview({
      currencyCode: requestedCurrency,
      items: [
        { priceId: catalog.annualPriceId, quantity: 1 },
        { priceId: catalog.monthlyPriceId, quantity: 1 }
      ]
    });

    if (currentGeneration !== generation || requestedCurrency !== currencyCode()) return;
    const lineItems = preview && preview.data && preview.data.details ? preview.data.details.lineItems : null;
    if (!Array.isArray(lineItems)) throw new Error("Paddle did not return localized price details.");

    for (const item of lineItems) {
      const id = item && item.price ? item.price.id : null;
      const displayValue = item && item.formattedTotals ? item.formattedTotals.subtotal : null;
      if (id === catalog.annualPriceId && displayValue) {
        prices.annual = displayValue;
        const minor = Number(item && item.totals ? item.totals.subtotal : NaN);
        annualAmountMinor = Number.isFinite(minor) ? minor : null;
      }
      if (id === catalog.monthlyPriceId && displayValue) prices.monthly = displayValue;
    }

    if (!prices.annual || !prices.monthly) throw new Error("Paddle returned an incomplete localized price preview.");
    renderLocalizedPrices();
  }

  window.addEventListener("fc-language-changed", () => {
    loadPrices().catch((error) => console.warn("Floating Camera localized pricing:", error));
  });

  loadPrices().catch((error) => {
    // Keep the base USD fallback visible if Paddle preview is unavailable.
    console.warn("Floating Camera localized pricing:", error);
  });
})();
