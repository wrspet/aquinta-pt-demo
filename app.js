// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
let API_BASE   = localStorage.getItem("admin_server") || "https://stg.meajudamaia.com";
const ADMIN_TOKEN = "supersecrettoken123";
const REFACTOR_BASE = "https://stg.meajudamaia.com/v2";

// Tokens por tenant — identificam o tenant no backend (sem header company_id)
const TENANT_TOKENS = {
  pt: "demo_aquinta_pt_9",
  br: "demo_aquinta_br_1",
};

// Tenant activo — definido pelo selector PT/BR no admin
let activeTenantRegion = localStorage.getItem("admin_tenant") || "pt";
let activeTenant = null;       // TenantConfig carregado do servidor
let adminTenantConfigs = [];   // lista completa

function activeToken() {
  return TENANT_TOKENS[activeTenantRegion] || TENANT_TOKENS.pt;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  petData:       {},
  calcResult:    null,
  calcId:        null,
  period:        "fortnight",   // "fortnight" | "monthly"
  freight:       null,
  editing:       false,
  selectedIds:   new Set(),
  mixPercentage: 100,
  couponCode:    null,          // código de cupão aplicado
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
  if (nif) pet.nif = nif;
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

// Retorna os dados de uma dieta para o período seleccionado
// Usa distribution_summary (15d default) ou variants para mensal
function getDietData(productId) {
  const result = state.calcResult;
  const plans300 = result?.plans?.["300"] || [];
  const product  = plans300.find(p => p.id === productId);
  if (!product) return null;

  const variant  = (product.variants || []).find(v => v.percentage === state.mixPercentage)
                || product.variants?.[0];

  // distribution_summary.diets tem os dados mais completos (para 15d/período actual do calc)
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

  // fortnight — usa distribution_summary se disponível (mais preciso)
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

  // resumo total
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

// TABS
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.period = tab.dataset.period;
    renderResults();
  });
});

// Editar
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
    // recalculate envolve resposta em { request, result, calc_id, ... }
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
    // Faz um recálculo rápido só para validar o cupão e ver o desconto
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
    fb.textContent = `Cupão inválido ou expirado.`;
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

document.getElementById("btn-pay").addEventListener("click", async () => {
  showLoading("A criar encomenda e gerar link de pagamento...");
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
    if (state.petData.cep)  payload.cep         = state.petData.cep;
    if (state.couponCode)   payload.coupon_code  = state.couponCode;

    const raw   = await api("POST", "/api/v1/orders", payload);
    // gateway retorna { order: { payment_link, link_stripe, ... }, calc: {...} }
    const o     = raw.order || raw;
    const link  = o.payment_link || o.link_stripe;
    if (link) {
      window.location.href = link;
    } else {
      showError("Encomenda criada mas sem link de pagamento. Contacta o suporte.");
    }
  } catch (err) {
    showError("Erro ao criar encomenda: " + err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────────────────────

function toggleAdmin() {
  const panel = document.getElementById("admin-panel");
  const open  = panel.style.display === "none";
  panel.style.display = open ? "flex" : "none";
  if (open) initAdmin();
}

function initAdmin() {
  // Selector de tenant (PT/BR) — define o token activo
  document.querySelectorAll('input[name="tenant"]').forEach(r => {
    r.checked = r.value === activeTenantRegion;
    r.addEventListener("change", () => {
      activeTenantRegion = r.value;
      localStorage.setItem("admin_tenant", r.value);
      // Actualiza activeTenant com o config correspondente
      activeTenant = adminTenantConfigs.find(t => t.region === activeTenantRegion) || null;
      renderAdminTenants();
      showAdminFeedback(`Tenant ${r.value.toUpperCase()} activo — token: ${activeToken()}`, "ok");
    });
  });

  // Sync server radio buttons
  const savedServer = localStorage.getItem("admin_server") || "https://stg.meajudamaia.com";
  document.querySelectorAll('input[name="server"]').forEach(r => {
    r.checked = r.value === savedServer;
    r.addEventListener("change", () => {
      API_BASE = r.value;
      localStorage.setItem("admin_server", r.value);
      showAdminFeedback(`Servidor activo: ${r.value}`, "ok");
    });
  });

  loadAdminTenants();
}

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
    loadingEl.style.display = "none";
    renderAdminTenants();
  } catch (err) {
    loadingEl.textContent = "Erro a carregar tenants: " + err.message;
  }
}

function renderAdminTenants() {
  const el = document.getElementById("admin-tenants");
  el.innerHTML = "";

  adminTenantConfigs.forEach(tenant => {
    const regionLabel = tenant.region === "pt" ? "🇵🇹 Portugal" : "🇧🇷 Brasil";
    const card = document.createElement("div");
    card.className = "admin-tenant-card";
    card.innerHTML = `
      <div class="admin-tenant-header">
        <strong>${regionLabel}</strong>
        <span class="admin-company-id">company_id: ${tenant.company_id}</span>
      </div>
      <div class="admin-fields">
        <div class="admin-field">
          <label>Períodos (dias, separados por vírgula)</label>
          <input type="text" data-field="periods" value="${tenant.periods.join(",")}" />
        </div>
        <div class="admin-field">
          <label>Tamanhos de pack (g, separados por vírgula)</label>
          <input type="text" data-field="package_sizes" value="${tenant.package_sizes.join(",")}" />
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
      <div class="admin-tenant-actions">
        <button class="btn-admin-save" onclick="saveTenant(${tenant.company_id}, this)">Guardar</button>
        ${activeTenant?.company_id === tenant.company_id ? '<span class="admin-active-badge">✓ Activo</span>' : ""}
      </div>
    `;
    el.appendChild(card);
  });
}

async function saveTenant(companyId, btn) {
  const card = btn.closest(".admin-tenant-card");
  const get  = field => card.querySelector(`[data-field="${field}"]`).value.trim();

  const body = {
    periods:       get("periods").split(",").map(v => parseInt(v.trim())).filter(Boolean),
    package_sizes: get("package_sizes").split(",").map(v => parseInt(v.trim())).filter(Boolean),
    currency:      get("currency").toUpperCase(),
    pricelist_id:  parseInt(get("pricelist_id")),
  };

  // Deriva fortnight/monthly automaticamente dos períodos (ordenados, excluindo 7)
  const nonWeekly = body.periods.filter(p => p > 7).sort((a, b) => a - b);
  body.fortnight_days = nonWeekly[0] ?? 15;
  body.monthly_days   = nonWeekly[nonWeekly.length - 1] ?? 30;

  if (body.periods.some(isNaN) || body.package_sizes.some(isNaN) || isNaN(body.pricelist_id)) {
    showAdminFeedback("Valores inválidos — verifica os campos.", "err");
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
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "HTTP " + res.status);
    }
    const updated = await res.json();
    // Actualiza lista local
    const idx = adminTenantConfigs.findIndex(t => t.company_id === companyId);
    if (idx >= 0) adminTenantConfigs[idx] = updated;
    // Se for o tenant activo, actualiza também
    if (activeTenant?.company_id === companyId) activeTenant = updated;
    showAdminFeedback(`Tenant ${updated.region.toUpperCase()} guardado com sucesso.`, "ok");
  } catch (err) {
    showAdminFeedback("Erro ao guardar: " + err.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
}


function showAdminFeedback(msg, type) {
  const el = document.getElementById("admin-feedback");
  el.textContent = msg;
  el.className = "admin-feedback " + (type || "");
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

// activeTenantRegion já restaurado do localStorage no topo do ficheiro.
// activeTenant é definido por loadAdminTenants() quando o painel admin abre.
