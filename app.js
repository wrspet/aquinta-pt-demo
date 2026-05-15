// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — ajustar para o ambiente
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = "https://stg.meajudamaia.com";
const API_KEY  = "sk_Kqb65HTIDXaHc2TlNmvWugo4qRHjDo9fgFVWJRkWveU"; // PT key

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  petData: {},
  calcResult: null,
  calcId: null,
  selectedProductId: null,
  selectedProductName: null,
  mixPercentage: 100,
  period: "fortnight",   // "fortnight" | "monthly"
  freight: null,
  orderResult: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
function showStep(id) {
  document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goBack(step) {
  showStep(step);
}

function showLoading(msg = "A processar...") {
  document.getElementById("loading-msg").textContent = msg;
  showStep("step-loading");
}

function showError(msg) {
  document.getElementById("error-msg").textContent = msg;
  showStep("step-error");
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTION BUTTONS (toggle single select)
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
const selections = { size: null, fitness: "normal", activity: "normal", castrated: "false" };

bindOptions("size-options",     v => selections.size = v);
bindOptions("fitness-options",  v => selections.fitness = v);
bindOptions("activity-options", v => selections.activity = v);
bindOptions("castrated-options",v => selections.castrated = v);

document.getElementById("form-pet").addEventListener("submit", async e => {
  e.preventDefault();

  if (!selections.size) {
    alert("Selecciona o porte do pet.");
    return;
  }

  const pet = {
    birth_date:    document.getElementById("birth_date").value,
    weight:        parseFloat(document.getElementById("weight").value),
    size:          selections.size,
    fitness:       selections.fitness,
    activity:      selections.activity,
    castrated:     selections.castrated === "true",
    pet_name:      document.getElementById("pet_name").value.trim(),
    tutor_email:   document.getElementById("partner_email").value.trim(),
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
    renderPlans();
    showStep("step-plans");
  } catch (err) {
    showError("Erro ao calcular o plano: " + err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — RENDER PLANS + RECALC
// ─────────────────────────────────────────────────────────────────────────────
function getPriceAndPacks(variant, period) {
  if (period === "monthly") return { price: variant.monthly_price, packs: variant.monthly_packs };
  return { price: variant.fortnight_price, packs: variant.fortnight_packs };
}

function renderPlans() {
  const result = state.calcResult;
  document.getElementById("result-pet-name").textContent = state.petData.pet_name || "o teu pet";
  document.getElementById("result-calories").textContent =
    `${Math.round(result.calories || 0)} kcal/dia · Escolhe a dieta ideal`;

  const grid = document.getElementById("plans-grid");
  grid.innerHTML = "";

  const plans300 = result.plans?.["300"] || [];

  if (!plans300.length) {
    grid.innerHTML = "<p>Nenhum plano disponível.</p>";
    return;
  }

  plans300.forEach(product => {
    const variant = (product.variants || []).find(v => v.percentage === state.mixPercentage)
                 || product.variants?.[0];
    if (!variant) return;

    const { price, packs } = getPriceAndPacks(variant, state.period);
    const card = document.createElement("div");
    card.className = "plan-card" + (state.selectedProductId === product.id ? " selected" : "");
    card.dataset.productId = product.id;
    card.dataset.productName = product.title || product.name;
    card.innerHTML = `
      <div class="check">✓</div>
      <div class="diet-name">${product.title || product.name}</div>
      <div class="diet-packs">${packs} pack${packs > 1 ? "s" : ""} × 300g</div>
      <div class="diet-price">${price?.toFixed(2) ?? "—"} <span>€</span></div>
    `;
    card.addEventListener("click", () => selectPlan(product.id, product.title || product.name));
    grid.appendChild(card);
  });

  updateSummaryBar();
}

function selectPlan(productId, productName) {
  state.selectedProductId = productId;
  state.selectedProductName = productName;
  document.querySelectorAll(".plan-card").forEach(c => {
    c.classList.toggle("selected", parseInt(c.dataset.productId) === productId);
  });
  document.getElementById("mix-section").style.display = "block";
  updateSummaryBar();
  recalculate();
}

async function recalculate() {
  if (!state.selectedProductId || !state.calcId) return;
  try {
    const result = await api("POST", "/api/v1/calc/recalculate", {
      calc_id: state.calcId,
      product_ids: [state.selectedProductId],
      mix_percentages: [state.mixPercentage],
    });
    // update calc_id with the new one from recalc
    if (result.calc_id) state.calcId = result.calc_id;
    state.calcResult = result;
    renderPlans();
    loadFreight();
  } catch (err) {
    console.warn("Recalc error:", err.message);
  }
}

async function loadFreight() {
  const cep = state.petData.cep;
  if (!cep || !state.calcId) return;
  try {
    const f = await api("POST", "/api/v1/calc/freight", { cep, calc_id: state.calcId });
    state.freight = f;
    const box = document.getElementById("freight-info");
    box.style.display = "block";
    box.textContent = `🚚 Envio para ${cep}: ${f.value?.toFixed(2) ?? "—"} € · ${f.carrier_name || ""} · ${f.prazo || "—"} dias úteis`;
    updateSummaryBar();
  } catch (err) {
    console.warn("Freight error:", err.message);
  }
}

// TABS
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.period = tab.dataset.period;
    renderPlans();
  });
});

// MIX options
bindOptions("mix-options", async v => {
  state.mixPercentage = parseInt(v);
  await recalculate();
});

function getSelectedVariant() {
  if (!state.selectedProductId) return null;
  const plans300 = state.calcResult?.plans?.["300"] || [];
  const product = plans300.find(p => p.id === state.selectedProductId);
  if (!product) return null;
  return (product.variants || []).find(v => v.percentage === state.mixPercentage)
      || product.variants?.[0];
}

function updateSummaryBar() {
  const bar = document.getElementById("summary-bar");
  if (!state.selectedProductId) { bar.style.display = "none"; return; }
  const variant = getSelectedVariant();
  if (!variant) { bar.style.display = "none"; return; }

  const { price, packs } = getPriceAndPacks(variant, state.period);
  const periodLabel = state.period === "monthly" ? "30 dias" : "15 dias";

  let total = price || 0;
  let detail = `${packs} packs · ${periodLabel} · ${total.toFixed(2)} €`;
  if (state.freight?.value) {
    detail += ` + ${state.freight.value.toFixed(2)} € envio`;
    total += state.freight.value;
  }

  document.getElementById("summary-diet").textContent = state.selectedProductName;
  document.getElementById("summary-detail").textContent = detail;
  bar.style.display = "flex";
}

document.getElementById("btn-order").addEventListener("click", () => {
  buildOrderSummary();
  showStep("step-order");
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — ORDER SUMMARY + PAYMENT
// ─────────────────────────────────────────────────────────────────────────────
function buildOrderSummary() {
  const variant = getSelectedVariant();
  const { price, packs } = getPriceAndPacks(variant, state.period);
  const freight = state.freight?.value || 0;
  const periodLabel = state.period === "monthly" ? "30 dias" : "15 dias";
  const periodKey = state.period === "monthly" ? "monthly" : "fortnight";

  const rows = [
    ["Pet", state.petData.pet_name],
    ["Dieta", state.selectedProductName],
    ["Mix feeding", state.mixPercentage + "% Aquinta"],
    ["Período", periodLabel],
    ["Packs", packs + " × 300g"],
    ["Tutor", state.petData.partner_name],
    ["E-mail", state.petData.partner_email],
    freight ? ["Envio", freight.toFixed(2) + " €"] : null,
    ["Total", (price + freight).toFixed(2) + " €"],
  ].filter(Boolean);

  const box = document.getElementById("order-summary");
  box.innerHTML = rows.map(([k, v]) =>
    `<div class="row-info"><span>${k}</span><span>${v}</span></div>`
  ).join("");
}

document.getElementById("btn-pay").addEventListener("click", async () => {
  const variant = getSelectedVariant();
  const periodKey = state.period === "monthly" ? "monthly" : "fortnight";

  showLoading("A criar encomenda e gerar link de pagamento...");
  try {
    const payload = {
      calc_id:        state.calcId,
      product_ids:    [state.selectedProductId],
      mix_percentages:[state.mixPercentage],
      period:         state.period === "monthly" ? 30 : 15,
      partner_email:  state.petData.partner_email,
      partner_name:   state.petData.partner_name,
      partner_phone:  state.petData.partner_phone,
      pet_name:       state.petData.pet_name,
      order_type:     "trial",
      delivery_number: 1,
    };
    if (state.petData.cep) payload.cep = state.petData.cep;

    const order = await api("POST", "/api/v1/orders", payload);
    state.orderResult = order;

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
