// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = "https://stg.meajudamaia.com";
const API_KEY  = "sk_Kqb65HTIDXaHc2TlNmvWugo4qRHjDo9fgFVWJRkWveU";

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  petData:         {},
  calcResult:      null,
  calcId:          null,
  period:          "fortnight",   // "fortnight" | "monthly"
  freight:         null,
  // editing
  editing:         false,
  selectedIds:     new Set(),     // diets toggled on during edit
  mixPercentage:   100,
};

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + API_KEY },
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
    tutor_email: document.getElementById("partner_email").value.trim(),
  };
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
    // pre-select all diets from calc
    state.selectedIds = new Set((result.plans?.["300"] || []).map(p => p.id));
    state.mixPercentage = 100;
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
function getVariant(product) {
  return (product.variants || []).find(v => v.percentage === state.mixPercentage)
      || product.variants?.[0];
}

function getPriceAndPacks(variant) {
  if (state.period === "monthly") return { price: variant?.monthly_price, packs: variant?.monthly_packs };
  return { price: variant?.fortnight_price, packs: variant?.fortnight_packs };
}

function renderResults() {
  const result = state.calcResult;
  const plans300 = result?.plans?.["300"] || [];

  document.getElementById("result-pet-name").textContent = state.petData.pet_name || "o teu pet";
  document.getElementById("result-calories").textContent =
    `${Math.round(result?.calories || 0)} kcal/dia`;

  const grid = document.getElementById("plans-grid");
  grid.innerHTML = "";

  plans300.forEach(product => {
    const variant = getVariant(product);
    const { price, packs } = getPriceAndPacks(variant);
    const isSelected = state.selectedIds.has(product.id);

    const card = document.createElement("div");
    card.className = "plan-card" + (state.editing ? " editable" : "") + (isSelected ? " selected" : " deselected");
    card.dataset.productId = product.id;

    card.innerHTML = `
      <div class="check">✓</div>
      <div class="diet-name">${product.title || product.name}</div>
      <div class="diet-grams">${variant?.daily_grams ? Math.round(variant.daily_grams) + "g/dia" : ""}</div>
      <div class="diet-packs">${packs ?? "—"} pack${packs !== 1 ? "s" : ""} × 300g</div>
      <div class="diet-price">${price != null ? price.toFixed(2) : "—"} <span>€</span></div>
    `;

    if (state.editing) {
      card.addEventListener("click", () => toggleDiet(product.id));
    }

    grid.appendChild(card);
  });

  // edit controls visibility
  document.getElementById("edit-controls").style.display = state.editing ? "block" : "none";
  document.getElementById("btn-edit").style.display = state.editing ? "none" : "inline-block";
  document.getElementById("btn-confirm-edit").style.display = state.editing ? "inline-block" : "none";
  document.getElementById("btn-cancel-edit").style.display = state.editing ? "inline-block" : "none";

  updateTotal();
}

function toggleDiet(productId) {
  if (state.selectedIds.has(productId)) {
    if (state.selectedIds.size <= 1) return; // pelo menos 1 dieta
    state.selectedIds.delete(productId);
  } else {
    state.selectedIds.add(productId);
  }
  renderResults();
}

// TABS período
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.period = tab.dataset.period;
    renderResults();
  });
});

// Botão EDITAR
document.getElementById("btn-edit").addEventListener("click", () => {
  state.editing = true;
  renderResults();
});

// Cancelar edição
document.getElementById("btn-cancel-edit").addEventListener("click", () => {
  state.editing = false;
  // repõe seleção original
  state.selectedIds = new Set((state.calcResult?.plans?.["300"] || []).map(p => p.id));
  state.mixPercentage = 100;
  document.querySelectorAll("#mix-options .opt").forEach(b => {
    b.classList.toggle("selected", b.dataset.val === "100");
  });
  renderResults();
});

// Confirmar edição → recalculate
document.getElementById("btn-confirm-edit").addEventListener("click", async () => {
  showLoading("A recalcular o plano...");
  try {
    const result = await api("POST", "/api/v1/calc/recalculate", {
      calc_id:         state.calcId,
      product_ids:     [...state.selectedIds],
      mix_percentages: [state.mixPercentage],
    });
    if (result.calc_id) state.calcId = result.calc_id;
    state.calcResult = result;
    state.editing = false;
    renderResults();
    showStep("step-plans");
    if (state.petData.cep) loadFreight();
  } catch (err) {
    showError("Erro ao recalcular: " + err.message);
  }
});

// Mix feeding (só visível no modo edição)
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
    box.textContent = `🚚 ${cep}: ${f.value?.toFixed(2) ?? "—"} € · ${f.carrier_name || ""} · ${f.prazo ?? "—"} dias úteis`;
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
    const { price } = getPriceAndPacks(getVariant(p));
    if (price) total += price;
  });
  if (state.freight?.value) total += state.freight.value;

  const periodLabel = state.period === "monthly" ? "30 dias" : "15 dias";
  document.getElementById("total-label").textContent =
    `${total.toFixed(2)} € · ${periodLabel}` +
    (state.freight?.value ? ` (incl. envio ${state.freight.value.toFixed(2)} €)` : "");
}

// Encomendar
document.getElementById("btn-order").addEventListener("click", () => {
  buildOrderSummary();
  showStep("step-order");
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — CONFIRM + PAY
// ─────────────────────────────────────────────────────────────────────────────
function buildOrderSummary() {
  const plans300 = state.calcResult?.plans?.["300"] || [];
  const selected = plans300.filter(p => state.selectedIds.has(p.id));
  const periodLabel = state.period === "monthly" ? "30 dias" : "15 dias";

  let subtotal = 0;
  const dietRows = selected.map(p => {
    const { price, packs } = getPriceAndPacks(getVariant(p));
    subtotal += price || 0;
    return `<div class="row-info"><span>${p.title || p.name}</span><span>${packs} packs · ${price?.toFixed(2) ?? "—"} €</span></div>`;
  }).join("");

  const freight = state.freight?.value || 0;
  const total = subtotal + freight;

  document.getElementById("order-summary").innerHTML = `
    <div class="row-info"><span>Pet</span><span>${state.petData.pet_name}</span></div>
    <div class="row-info"><span>Tutor</span><span>${state.petData.partner_name}</span></div>
    <div class="row-info"><span>Período</span><span>${periodLabel}</span></div>
    <div class="row-info"><span>Mix feeding</span><span>${state.mixPercentage}% Aquinta</span></div>
    ${dietRows}
    ${freight ? `<div class="row-info"><span>Envio</span><span>${freight.toFixed(2)} €</span></div>` : ""}
    <div class="row-info total"><span>Total</span><span>${total.toFixed(2)} €</span></div>
  `;
}

document.getElementById("btn-pay").addEventListener("click", async () => {
  const plans300 = state.calcResult?.plans?.["300"] || [];
  const selected = plans300.filter(p => state.selectedIds.has(p.id));

  showLoading("A criar encomenda e gerar link de pagamento...");
  try {
    const payload = {
      calc_id:         state.calcId,
      product_ids:     [...state.selectedIds],
      mix_percentages: [state.mixPercentage],
      period:          state.period === "monthly" ? 30 : 15,
      partner_email:   state.petData.partner_email,
      partner_name:    state.petData.partner_name,
      partner_phone:   state.petData.partner_phone,
      pet_name:        state.petData.pet_name,
      order_type:      "trial",
      delivery_number: 1,
    };
    if (state.petData.cep) payload.cep = state.petData.cep;

    const order = await api("POST", "/api/v1/orders", payload);
    const link = order.payment_link || order.link_stripe;
    if (link) {
      window.location.href = link;
    } else {
      showError("Encomenda criada mas sem link de pagamento. Contacta o suporte.");
    }
  } catch (err) {
    showError("Erro ao criar encomenda: " + err.message);
  }
});
