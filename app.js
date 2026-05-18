// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
let API_BASE   = localStorage.getItem("admin_server") || "https://stg.meajudamaia.com";
const ADMIN_TOKEN = "supersecrettoken123";
const REFACTOR_BASE = "https://stg.meajudamaia.com/v2";

// Tokens por tenant — identificam o tenant no backend (sem header company_id)
const TENANT_TOKENS = {
  pt: "Oja6HPlX0mGrDIklMTAPxeogI1Hu95Y72U5G5ELbA18",
  br: "vfOAKN-kcHWKSO8N4b884gSZLvAWtJIScSaS9VAfKSk",
};

let activeTenantRegion = localStorage.getItem("admin_tenant") || "pt";
let activeTenant = null;
let adminTenantConfigs = [];

function activeToken() {
  return TENANT_TOKENS[activeTenantRegion] || TENANT_TOKENS.pt;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKOUT FIELDS CONFIG
// ─────────────────────────────────────────────────────────────────────────────

function fieldMode(name) {
  const cf = activeTenant?.checkout_fields || {};
  return cf[name] || "required";
}

function _applyCheckoutFieldConfig() {
  const idMap = {
    tax_id:      "nif",
    phone:       "partner_phone",
    pet_name:    "pet_name",
    tutor_name:  "partner_name",
    tutor_email: "partner_email",
  };
  Object.entries(idMap).forEach(([fieldName, elId]) => {
    const mode = fieldMode(fieldName);
    const el   = document.getElementById(elId);
    if (!el) return;
    const wrap = el.closest(".field");
    if (mode === "hidden") {
      if (wrap) wrap.style.display = "none";
      el.removeAttribute("required");
    } else {
      if (wrap) wrap.style.display = "";
      if (mode === "required") {
        el.setAttribute("required", "");
      } else {
        el.removeAttribute("required");
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  petData:       {},
  calcResult:    null,
  calcId:        null,
  period:        "fortnight",
  freight:       null,
  editing:       false,
  selectedIds:   new Set(),
  mixPercentage: 100,
  couponCode:    null,
};

// Mapa de paths: ops-gateway → refactor (quando API_BASE = REFACTOR_BASE)
const REFACTOR_PATH_MAP = {
  "/api/v1/calc":            "/calculate/json",
  "/api/v1/calc/recalculate": "/recalculate/from-products",
  "/api/v1/calc/freight":    "/cep/frete",
  "/api/v1/orders":          "/pet/orders",
};

function resolvePath(path) {
  if (API_BASE === REFACTOR_BASE && REFACTOR_PATH_MAP[path]) {
    return REFACTOR_PATH_MAP[path];
  }
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(API_BASE + resolvePath(path), {
    method,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + activeToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV
// ─────────────────────────────────────────────────────────────────────────────
function showStep(id) {
  document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function goBack(step) { showStep(step); }
function showLoading(msg) { document.getElementById("loading-msg").textContent = msg || "A processar..."; showStep("step-loading"); }
function showError(msg)   { document.getElementById("error-msg").textContent = msg; showStep("step-error"); }

// ─────────────────────────────────────────────────────────────────────────────
// OPTION BUTTONS
// ─────────────────────────────────────────────────────────────────────────────
function bindOptions(groupId, onSelect) {
  document.getElementById(groupId).addEventListener("click", e => {
    const btn = e.target.closest(".opt");
    if (!btn) return;
    document.querySelectorAll(`#${groupId} .opt`).forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    onSelect(btn.dataset.val);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — FORM + CALC
// ─────────────────────────────────────────────────────────────────────────────
const sel = { size: null, fitness: "normal", activity: "normal", castrated: "false" };
bindOptions("size-options",      v => sel.size = v);
bindOptions("fitness-options",   v => sel.fitness = v);
bindOptions("activity-options",  v => sel.activity = v);
bindOptions("castrated-options", v => sel.castrated = v);

document.getElementById("form-pet").addEventListener("submit", async e => {
  e.preventDefault();
  if (!sel.size) { alert("Selecciona o porte do pet."); return; }

  const pet = {
    birth_date:  document.getElementById("birth_date").value,
    weight:      parseFloat(document.getElementById("weight").value),
    size:        sel.size,
    fitness:     sel.fitness,
    activity:    sel.activity,
    castrated:   sel.castrated === "true",
    pet_name:    document.getElementById("pet_name").value.trim(),
    tutor_name:  document.getElementById("partner_name").value.trim(),
    tutor_email: document.getElementById("partner_email").value.trim(),
    phone:       document.getElementById("partner_phone").value.trim(),
  };
  const nif = document.getElementById("nif").value.trim();
  if (nif && fieldMode("tax_id") !== "hidden") pet.cpf = nif;
  const cep = document.getElementById("cep").value.trim();
  if (cep) pet.cep = cep;

  state.petData = {
    ...pet,
    partner_email: document.getElementById("partner_email").value.trim(),
    partner_name:  document.getElementById("partner_name").value.trim(),
    partner_phone: document.getElementById("partner_phone").value.trim(),
    cep,
  };

  showLoading("A calcular o plano nutricional...");
  try {
    const result = await api("POST", "/api/v1/calc", pet);
    state.calcResult = result;
    state.calcId = result.calc_id;
    state.period = "fortnight";
    state.editing = false;
    state.mixPercentage = 100;
    state.selectedIds = new Set((result.plans?.["300"] || []).map(p => p.id));
    renderResults();
    showStep("step-plans");
    if (cep) loadFreight();
  } catch (err) {
    showError("Erro ao calcular o plano: " + err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — RENDER RESULTS
// ─────────────────────────────────────────────────────────────────────────────

function getDietData(productId) {
  const result = state.calcResult;
  const plans300 = result?.plans?.["300"] || [];
  const product  = plans300.find(p => p.id === productId);
  if (!product) return null;

  const variant  = (product.variants || []).find(v => v.percentage === state.mixPercentage)
                || product.variants?.[0];

  const distDiets = result?.distribution_summary?.diets || [];
  const distDiet  = distDiets.find(d => d.product_id === productId);

  const fortnightDays = activeTenant?.fortnight_days ?? 15;
  const monthlyDays   = activeTenant?.monthly_days   ?? 30;

  if (state.period === "monthly") {
    return {
      title:          product.title || product.name,
      daily_grams:    variant?.daily_grams,
      daily_measures: variant?.daily_measures,
      packs:          variant?.monthly_packs,
      estimated_days: variant?.monthly_days_amount,
      subtotal:       variant?.monthly_price_discount ?? variant?.monthly_price,
      kcal_per_kg:    product.product_energy,
      period_label:   `${monthlyDays} dias`,
    };
  }

  return {
    title:          product.title || product.name,
    daily_grams:    distDiet?.grams_per_day    ?? variant?.daily_grams,
    daily_measures: distDiet?.measures_per_day ?? variant?.daily_measures,
    packs:          distDiet?.packs            ?? variant?.fortnight_packs,
    estimated_days: distDiet?.estimated_days   ?? variant?.fortnight_days_amount,
    subtotal:       distDiet?.subtotal_discounted ?? variant?.fortnight_price_discount ?? variant?.fortnight_price,
    kcal_per_kg:    product.product_energy,
    period_label:   `${fortnightDays} dias`,
  };
}

function renderResults() {
  const result   = state.calcResult;
  const plans300 = result?.plans?.["300"] || [];
  const totals   = result?.distribution_summary?.totals || {};
  const summary  = result?.summary?.distribution_totals || {};

  document.getElementById("result-pet-name").textContent = state.petData.pet_name || "o teu pet";
  document.getElementById("result-calories").textContent =
    `${Math.round(result?.calories || 0)} kcal/dia necessárias`;

  const grid = document.getElementById("plans-grid");
  grid.innerHTML = "";

  plans300.forEach(product => {
    const d = getDietData(product.id);
    if (!d) return;
    const isSelected = state.selectedIds.has(product.id);

    const card = document.createElement("div");
    card.className = "plan-card"
      + (state.editing ? " editable" : "")
      + (isSelected ? " selected" : " deselected");
    card.dataset.productId = product.id;

    card.innerHTML = `
      <div class="check">✓</div>
      <div class="diet-header">
        <div class="diet-name">${d.title}</div>
        ${d.kcal_per_kg ? `<div class="diet-kcal">${d.kcal_per_kg} kcal/kg</div>` : ""}
      </div>
      <div class="diet-stats">
        <div class="stat">
          <span class="stat-val">${d.daily_grams != null ? Math.round(d.daily_grams) + "g" : "—"}</span>
          <span class="stat-label">por dia</span>
        </div>
        <div class="stat">
          <span class="stat-val">${d.daily_measures != null ? d.daily_measures : "—"}</span>
          <span class="stat-label">medidas/dia</span>
        </div>
        <div class="stat">
          <span class="stat-val">${d.packs != null ? Math.ceil(d.packs) : "—"}</span>
          <span class="stat-label">packs 300g</span>
        </div>
        ${d.estimated_days != null ? `<div class="stat"><span class="stat-val">${Math.round(d.estimated_days)}d</span><span class="stat-label">duração</span></div>` : ""}
      </div>
      <div class="diet-price">
        ${d.subtotal != null ? d.subtotal.toFixed(2) + " €" : "—"}
        <span>/ ${d.period_label}</span>
      </div>
    `;

    if (state.editing) {
      card.addEventListener("click", () => toggleDiet(product.id));
    }

    grid.appendChild(card);
  });

  const totalPacks = state.period === "monthly"
    ? plans300.filter(p => state.selectedIds.has(p.id)).reduce((s, p) => {
        const v = (p.variants || []).find(vv => vv.percentage === state.mixPercentage) || p.variants?.[0];
        return s + (v?.monthly_packs || 0);
      }, 0)
    : (totals.packs ?? summary.packs ?? 0);

  document.getElementById("total-packs").textContent = totalPacks ? Math.ceil(totalPacks) + " packs no total" : "";
  document.getElementById("edit-controls").style.display     = state.editing ? "block" : "none";
  document.getElementById("btn-edit").style.display          = state.editing ? "none" : "inline-block";
  document.getElementById("btn-confirm-edit").style.display  = state.editing ? "inline-block" : "none";
  document.getElementById("btn-cancel-edit").style.display   = state.editing ? "inline-block" : "none";

  updateTotal();
}

function toggleDiet(productId) {
  if (state.selectedIds.has(productId)) {
    if (state.selectedIds.size <= 1) return;
    state.selectedIds.delete(productId);
  } else {
    state.selectedIds.add(productId);
  }
  renderResults();
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.period = tab.dataset.period;
    renderResults();
  });
});

document.getElementById("btn-edit").addEventListener("click", () => {
  state.editing = true;
  renderResults();
});

document.getElementById("btn-cancel-edit").addEventListener("click", () => {
  state.editing = false;
  state.selectedIds = new Set((state.calcResult?.plans?.["300"] || []).map(p => p.id));
  state.mixPercentage = 100;
  document.querySelectorAll("#mix-options .opt").forEach(b => {
    b.classList.toggle("selected", b.dataset.val === "100");
  });
  renderResults();
});

document.getElementById("btn-confirm-edit").addEventListener("click", async () => {
  showLoading("A recalcular o plano...");
  try {
    const raw = await api("POST", "/api/v1/calc/recalculate", {
      calc_id:         state.calcId,
      products_id:     [...state.selectedIds],
      mix_percentages: [state.mixPercentage],
    });
    const result = raw.result || raw;
    const newCalcId = raw.calc_id || result.calc_id;
    if (newCalcId) state.calcId = newCalcId;
    state.calcResult = result;
    state.editing = false;
    renderResults();
    showStep("step-plans");
    if (state.petData.cep) loadFreight();
  } catch (err) {
    showError("Erro ao recalcular: " + err.message);
  }
});

bindOptions("mix-options", v => {
  state.mixPercentage = parseInt(v);
  renderResults();
});

// ─────────────────────────────────────────────────────────────────────────────
// FREIGHT
// ─────────────────────────────────────────────────────────────────────────────
async function loadFreight() {
  const cep = state.petData.cep;
  if (!cep || !state.calcId) return;
  try {
    const f = await api("POST", "/api/v1/calc/freight", { cep, calc_id: state.calcId });
    state.freight = f;
    const box = document.getElementById("freight-info");
    box.style.display = "block";
    box.innerHTML = `🚚 <strong>${f.carrier_name || "Envio"}</strong> para ${cep} — <strong>${f.value?.toFixed(2) ?? "—"} €</strong> · prazo ${f.prazo ?? "—"} dias úteis`;
    updateTotal();
  } catch (err) {
    console.warn("Freight:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOTAL
// ─────────────────────────────────────────────────────────────────────────────
function updateTotal() {
  const plans300 = state.calcResult?.plans?.["300"] || [];
  let total = 0;
  plans300.forEach(p => {
    if (!state.selectedIds.has(p.id)) return;
    const d = getDietData(p.id);
    if (d?.subtotal) total += d.subtotal;
  });
  if (state.freight?.value) total += state.freight.value;

  const fortnightDays = activeTenant?.fortnight_days ?? 15;
  const monthlyDays   = activeTenant?.monthly_days   ?? 30;
  const periodLabel = state.period === "monthly" ? `${monthlyDays} dias` : `${fortnightDays} dias`;
  document.getElementById("total-label").textContent = `${total.toFixed(2)} € · ${periodLabel}`;
}

document.getElementById("btn-order").addEventListener("click", () => {
  state.couponCode = null;
  document.getElementById("coupon-input").value = "";
  document.getElementById("coupon-feedback").style.display = "none";
  buildOrderSummary();
  showStep("step-order");
});

// ─────────────────────────────────────────────────────────────────────────────
// CUPÃO
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById("btn-apply-coupon").addEventListener("click", async () => {
  const code = document.getElementById("coupon-input").value.trim().toUpperCase();
  const fb   = document.getElementById("coupon-feedback");
  if (!code) return;

  fb.className = "coupon-feedback";
  fb.style.display = "block";
  fb.textContent = "A verificar cupão...";

  try {
    const raw = await api("POST", "/api/v1/calc/recalculate", {
      calc_id:         state.calcId,
      products_id:     [...state.selectedIds],
      mix_percentages: [state.mixPercentage],
      coupon_code:     code,
    });
    const result = raw.result || raw;
    const newCalcId = raw.calc_id || result.calc_id;
    if (newCalcId) state.calcId = newCalcId;
    state.calcResult = result;
    state.couponCode = code;
    fb.className = "coupon-feedback ok";
    fb.textContent = `Cupão "${code}" aplicado com sucesso!`;
    buildOrderSummary();
  } catch (err) {
    state.couponCode = null;
    fb.className = "coupon-feedback err";
    fb.textContent = "Cupão inválido ou expirado.";
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — CONFIRM + PAY
// ─────────────────────────────────────────────────────────────────────────────
function buildOrderSummary() {
  const plans300 = state.calcResult?.plans?.["300"] || [];
  const selected = plans300.filter(p => state.selectedIds.has(p.id));
  const fortnightDays = activeTenant?.fortnight_days ?? 15;
  const monthlyDays   = activeTenant?.monthly_days   ?? 30;
  const periodLabel = state.period === "monthly" ? `${monthlyDays} dias` : `${fortnightDays} dias`;

  let subtotal = 0;
  const dietRows = selected.map(p => {
    const d = getDietData(p.id);
    subtotal += d?.subtotal || 0;
    return `<div class="row-info">
      <span>${d.title}</span>
      <span>${d.daily_grams != null ? Math.round(d.daily_grams) + "g/dia · " : ""}${Math.ceil(d.packs)} packs · ${d.subtotal?.toFixed(2) ?? "—"} €</span>
    </div>`;
  }).join("");

  const freight = state.freight?.value || 0;
  const total   = subtotal + freight;

  document.getElementById("order-summary").innerHTML = `
    <div class="row-info"><span>Pet</span><span>${state.petData.pet_name}</span></div>
    <div class="row-info"><span>Tutor</span><span>${state.petData.partner_name}</span></div>
    <div class="row-info"><span>E-mail</span><span>${state.petData.partner_email}</span></div>
    <div class="row-info"><span>Período</span><span>${periodLabel}</span></div>
    <div class="row-info"><span>Mix feeding</span><span>${state.mixPercentage}% Aquinta</span></div>
    ${dietRows}
    ${freight ? `<div class="row-info"><span>Envio</span><span>${freight.toFixed(2)} €</span></div>` : ""}
    <div class="row-info total"><span>Total</span><span>${total.toFixed(2)} €</span></div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE PAYMENT ELEMENT
// ─────────────────────────────────────────────────────────────────────────────

let _stripe = null;
let _stripeElements = null;

function closeStripeModal() {
  document.getElementById("stripe-modal-overlay").style.display = "none";
  _stripeElements = null;
}

async function openStripeCheckout({ clientSecret, publishableKey, amountLabel }) {
  if (!window.Stripe) {
    showError("Stripe.js não carregou. Verifica a ligação à internet e recarrega.");
    return;
  }
  _stripe = Stripe(publishableKey);

  document.getElementById("stripe-amount-label").textContent = amountLabel;
  document.getElementById("stripe-error-msg").style.display = "none";
  document.getElementById("stripe-payment-element").innerHTML = "";
  document.getElementById("stripe-modal-overlay").style.display = "flex";

  const appearance = {
    theme: "stripe",
    variables: {
      colorPrimary: "#2d6a4f",
      borderRadius: "8px",
      fontFamily: "system-ui, -apple-system, sans-serif",
    },
  };
  _stripeElements = _stripe.elements({ clientSecret, appearance });
  const paymentEl = _stripeElements.create("payment", { layout: "tabs" });
  paymentEl.mount("#stripe-payment-element");
}

document.getElementById("stripe-submit-btn").addEventListener("click", async () => {
  if (!_stripe || !_stripeElements) return;
  const btn   = document.getElementById("stripe-submit-btn");
  const label = document.getElementById("stripe-submit-label");
  const spin  = document.getElementById("stripe-submit-spinner");
  const errEl = document.getElementById("stripe-error-msg");

  btn.disabled = true;
  label.textContent = "A processar...";
  spin.style.display = "inline-block";
  errEl.style.display = "none";

  const { error } = await _stripe.confirmPayment({
    elements: _stripeElements,
    confirmParams: { return_url: window.location.href },
    redirect: "if_required",
  });

  if (error) {
    errEl.textContent = error.message || "Erro no pagamento. Tenta novamente.";
    errEl.style.display = "block";
    btn.disabled = false;
    label.textContent = "Pagar agora";
    spin.style.display = "none";
  } else {
    // Pagamento confirmado — o webhook tratará a confirmação no Odoo
    closeStripeModal();
    showStep("step-success");
  }
});

document.getElementById("btn-pay").addEventListener("click", async () => {
  showLoading("A criar encomenda...");
  try {
    const payload = {
      calc_id:         state.calcId,
      products_id:     [...state.selectedIds],
      mix_percentages: [state.mixPercentage],
      period:          state.period === "monthly" ? (activeTenant?.monthly_days ?? 30) : (activeTenant?.fortnight_days ?? 15),
      partner_email:   state.petData.partner_email,
      partner_name:    state.petData.partner_name,
      partner_phone:   state.petData.partner_phone,
      tutor_email:     state.petData.partner_email,
      tutor_name:      state.petData.partner_name,
      tutor_phone:     state.petData.partner_phone,
      pet_name:        state.petData.pet_name,
      order_type:      "trial",
      delivery_number: 1,
    };
    if (state.petData.cep)  payload.cep        = state.petData.cep;
    if (state.petData.cpf && fieldMode("tax_id") !== "hidden") payload.cpf = state.petData.cpf;
    if (state.couponCode)   payload.coupon_code = state.couponCode;

    const raw = await api("POST", "/api/v1/orders", payload);
    const o   = raw.order || raw.orders?.[0]?.order || raw.orders?.[0] || raw;

    const clientSecret   = raw.stripe_client_secret || o.stripe_client_secret;
    const publishableKey = raw.stripe_publishable_key;

    if (clientSecret && publishableKey) {
      // PT/Stripe — modal de pagamento inline
      showStep("step-confirm");
      const totalEur = (o.totals?.discounted || o.totals?.total || 0);
      const amountLabel = totalEur
        ? `${Number(totalEur).toLocaleString("pt-PT", { style: "currency", currency: "EUR" })}`
        : "";
      await openStripeCheckout({ clientSecret, publishableKey, amountLabel });
    } else {
      // BR/Malga — redirect para link de pagamento
      const link = raw.payment_link || o.payment_link || o.link_malga;
      if (link) {
        window.location.href = link;
      } else {
        showError("Encomenda criada mas sem link de pagamento. Contacta o suporte.");
      }
    }
  } catch (err) {
    showError("Erro ao criar encomenda: " + err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL — TOGGLE + TABS
// ─────────────────────────────────────────────────────────────────────────────
let _activeAdminTab = localStorage.getItem("admin_tab") || "simular";

function toggleAdmin() {
  const panel = document.getElementById("admin-panel");
  const open  = panel.style.display === "none";
  panel.style.display = open ? "flex" : "none";
  if (open) initAdmin();
}

function switchAdminTab(tab) {
  _activeAdminTab = tab;
  localStorage.setItem("admin_tab", tab);

  document.querySelectorAll(".admin-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".admin-tab-pane").forEach(p =>
    p.classList.toggle("active", p.id === "tab-" + tab));

  if (tab === "admin" && adminTenantConfigs.length === 0) loadAdminTenants();
  if (tab === "catalog") loadCatalog();
}

function goToSimulator() {
  toggleAdmin();
  showStep("step-pet");
}

function initAdmin() {
  // Tenant radio buttons
  document.querySelectorAll('input[name="tenant"]').forEach(r => {
    r.checked = r.value === activeTenantRegion;
    r.addEventListener("change", () => {
      activeTenantRegion = r.value;
      localStorage.setItem("admin_tenant", r.value);
      activeTenant = adminTenantConfigs.find(t => t.region === activeTenantRegion) || null;
      _applyCheckoutFieldConfig();
      renderAdminTenants();
      showAdminFeedback(`Tenant ${r.value.toUpperCase()} activo`, "ok");
    });
  });

  // Server radio buttons
  const savedServer = localStorage.getItem("admin_server") || "https://stg.meajudamaia.com";
  document.querySelectorAll('input[name="server"]').forEach(r => {
    r.checked = r.value === savedServer;
    r.addEventListener("change", () => {
      API_BASE = r.value;
      localStorage.setItem("admin_server", r.value);
      showAdminFeedback(`Servidor: ${r.value}`, "ok");
    });
  });

  // Restore last active tab
  switchAdminTab(_activeAdminTab);
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL — TENANT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

async function loadAdminTenants() {
  const loadingEl = document.getElementById("admin-tenants-loading");
  const tenantsEl = document.getElementById("admin-tenants");
  loadingEl.style.display = "block";
  tenantsEl.innerHTML = "";

  try {
    const res = await fetch(REFACTOR_BASE + "/admin/tenants", {
      headers: { "Authorization": "Bearer " + ADMIN_TOKEN }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    adminTenantConfigs = await res.json();
    activeTenant = adminTenantConfigs.find(t => t.region === activeTenantRegion) || null;
    _applyCheckoutFieldConfig();
    loadingEl.style.display = "none";
    renderAdminTenants();
  } catch (err) {
    loadingEl.textContent = "Erro a carregar tenants: " + err.message;
  }
}

const CF_FIELDS = [
  { key: "tax_id",      label: "NIF / CPF" },
  { key: "phone",       label: "Telefone" },
  { key: "pet_name",    label: "Nome do pet" },
  { key: "tutor_name",  label: "Nome do tutor" },
  { key: "tutor_email", label: "Email do tutor" },
];

function renderAdminTenants() {
  const el = document.getElementById("admin-tenants");
  el.innerHTML = "";

  adminTenantConfigs.forEach(tenant => {
    const regionLabel = tenant.region === "pt" ? "🇵🇹 Portugal" : "🇧🇷 Brasil";
    const isActive = activeTenant?.company_id === tenant.company_id;
    const cf = tenant.checkout_fields || {};
    const gw = tenant.payment_gw || "malga";

    const cfRows = CF_FIELDS.map(f => {
      const cur = cf[f.key] || "required";
      const opts = ["required", "optional", "hidden"].map(v =>
        `<option value="${v}"${cur === v ? " selected" : ""}>${v}</option>`
      ).join("");
      return `<div class="cf-row">
        <span class="cf-label">${f.label}</span>
        <select class="cf-select" data-cf-field="${f.key}">${opts}</select>
      </div>`;
    }).join("");

    const card = document.createElement("div");
    card.className = "admin-tenant-card" + (isActive ? " is-active" : "");
    card.id = `tenant-card-${tenant.company_id}`;
    card.innerHTML = `
      <div class="admin-tenant-header">
        <strong>${regionLabel}</strong>
        <div style="display:flex;align-items:center;gap:6px">
          ${isActive ? '<span class="admin-active-badge">✓ Activo</span>' : ""}
          <span class="admin-company-id">id ${tenant.company_id}</span>
        </div>
      </div>

      <div class="tenant-section-title">Plano</div>
      <div class="admin-fields">
        <div class="admin-field-row">
          <div class="admin-field">
            <label>Períodos (dias)</label>
            <input type="text" data-field="periods" value="${tenant.periods.join(",")}" placeholder="14,28" />
          </div>
          <div class="admin-field">
            <label>Tamanhos pack (g)</label>
            <input type="text" data-field="package_sizes" value="${tenant.package_sizes.join(",")}" placeholder="300,500" />
          </div>
        </div>
        <div class="admin-field-row">
          <div class="admin-field">
            <label>Moeda</label>
            <input type="text" data-field="currency" value="${tenant.currency}" maxlength="3" />
          </div>
          <div class="admin-field">
            <label>Pricelist ID (Odoo)</label>
            <input type="number" data-field="pricelist_id" value="${tenant.pricelist_id}" min="1" />
          </div>
        </div>
      </div>

      <div class="tenant-section-title">Pagamento</div>
      <div class="admin-fields">
        <div class="admin-field">
          <label>Gateway</label>
          <select data-field="payment_gw">
            <option value="malga"${gw === "malga" ? " selected" : ""}>Malga</option>
            <option value="stripe"${gw === "stripe" ? " selected" : ""}>Stripe</option>
          </select>
        </div>
        <div class="admin-field">
          <label>Stripe — URL sucesso</label>
          <input type="text" data-field="stripe_success_url" value="${tenant.stripe_success_url || ""}" placeholder="https://..." />
        </div>
        <div class="admin-field">
          <label>Stripe — URL cancelamento</label>
          <input type="text" data-field="stripe_cancel_url" value="${tenant.stripe_cancel_url || ""}" placeholder="https://..." />
        </div>
      </div>

      <div class="tenant-section-title">Campos de checkout</div>
      <div class="cf-table">${cfRows}</div>

      <div class="admin-tenant-actions">
        <button class="btn-admin-save" onclick="saveTenant(${tenant.company_id}, this)">Guardar</button>
      </div>
    `;
    el.appendChild(card);
  });
}

async function saveTenant(companyId, btn) {
  const card = btn.closest(".admin-tenant-card");
  const get  = field => {
    const el = card.querySelector(`[data-field="${field}"]`);
    return el ? el.value.trim() : "";
  };

  const periods      = get("periods").split(",").map(v => parseInt(v.trim())).filter(Boolean);
  const packageSizes = get("package_sizes").split(",").map(v => parseInt(v.trim())).filter(Boolean);
  const currency     = get("currency").toUpperCase();
  const pricelistId  = parseInt(get("pricelist_id"));
  const paymentGw    = get("payment_gw") || "malga";
  const stripeOk     = get("stripe_success_url");
  const stripeCancel = get("stripe_cancel_url");

  const nonWeekly = periods.filter(p => p > 7).sort((a, b) => a - b);

  // Checkout fields — ler directamente dos selects no card
  const checkoutFields = {};
  card.querySelectorAll(".cf-select").forEach(s => {
    checkoutFields[s.dataset.cfField] = s.value;
  });

  if (periods.some(isNaN) || packageSizes.some(isNaN) || isNaN(pricelistId)) {
    showAdminFeedback("Valores inválidos — verifica os campos numéricos.", "err");
    return;
  }

  btn.disabled = true;
  btn.textContent = "A guardar...";

  try {
    const res = await fetch(`${REFACTOR_BASE}/admin/tenants/${companyId}`, {
      method: "PUT",
      headers: {
        "Authorization": "Bearer " + ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        periods,
        package_sizes:      packageSizes,
        currency,
        pricelist_id:       pricelistId,
        fortnight_days:     nonWeekly[0] ?? periods[0],
        monthly_days:       nonWeekly[nonWeekly.length - 1] ?? periods[periods.length - 1],
        payment_gw:         paymentGw,
        stripe_success_url: stripeOk   || null,
        stripe_cancel_url:  stripeCancel || null,
        checkout_fields:    checkoutFields,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "HTTP " + res.status);
    }
    const updated = await res.json();
    const idx = adminTenantConfigs.findIndex(t => t.company_id === companyId);
    if (idx >= 0) adminTenantConfigs[idx] = updated;
    if (activeTenant?.company_id === companyId) {
      activeTenant = updated;
      _applyCheckoutFieldConfig();
    }
    showAdminFeedback(`Tenant ${updated.region.toUpperCase()} guardado e sincronizado.`, "ok");
  } catch (err) {
    showAdminFeedback("Erro ao guardar: " + err.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG TAB
// ─────────────────────────────────────────────────────────────────────────────

async function loadCatalog() {
  const q       = (document.getElementById("catalog-q")?.value || "").trim();
  const loading = document.getElementById("catalog-loading");
  const results = document.getElementById("catalog-results");

  loading.style.display = "block";
  results.innerHTML = "";

  try {
    const url = REFACTOR_BASE + "/web/products?limit=100" + (q ? "&q=" + encodeURIComponent(q) : "");
    const res = await fetch(url, {
      headers: { "Authorization": "Bearer " + activeToken() }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    loading.style.display = "none";
    renderCatalog(data.products || []);
  } catch (err) {
    loading.style.display = "none";
    results.innerHTML = `<p class="catalog-error">Erro: ${err.message}</p>`;
  }
}

function renderCatalog(products) {
  const el = document.getElementById("catalog-results");
  if (!products.length) {
    el.innerHTML = '<p class="catalog-empty">Nenhum produto encontrado.</p>';
    return;
  }

  const rows = products.map(p => `
    <tr>
      <td class="cat-sku">${p.sku || "—"}</td>
      <td class="cat-name">${p.name || p.title || "—"}</td>
      <td class="cat-kcal">${p.energy_kcal ? p.energy_kcal + " kcal/kg" : "—"}</td>
      <td class="cat-price">${p.price != null ? p.price.toFixed(2) + " €" : "—"}</td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div class="catalog-count">${products.length} produto${products.length !== 1 ? "s" : ""}</div>
    <table class="catalog-table">
      <thead>
        <tr>
          <th>SKU</th><th>Nome</th><th>Energia</th><th>Preço/pack</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// FEEDBACK
// ─────────────────────────────────────────────────────────────────────────────

function showAdminFeedback(msg, type) {
  const el = document.getElementById("admin-feedback");
  el.textContent = msg;
  el.className = "admin-feedback " + (type || "");
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

// activeTenantRegion já restaurado do localStorage no topo do ficheiro.
// activeTenant é definido por loadAdminTenants() quando o painel admin abre.
