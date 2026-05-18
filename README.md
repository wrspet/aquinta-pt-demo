# Aquinta PT — Guia de Integração: Do Formulário ao Link de Pagamento

Guia passo a passo para integrar o fluxo completo da API Aquinta Portugal:  
**Formulário → Cálculo → (Recálculo) → (Frete) → Pedido → Link Stripe Checkout**

---

## Índice

1. [Configuração e autenticação](#1-configuração-e-autenticação)
2. [Arquitectura do fluxo](#2-arquitectura-do-fluxo)
3. [Passo 1 — Recolher dados no formulário](#3-passo-1--recolher-dados-no-formulário)
4. [Passo 2 — Calcular o plano (`POST /api/v1/calc`)](#4-passo-2--calcular-o-plano-post-apiv1calc)
5. [Passo 3 — Mostrar resultados e ler a resposta](#5-passo-3--mostrar-resultados-e-ler-a-resposta)
6. [Passo 4 — Recalcular (opcional)](#6-passo-4--recalcular-opcional-post-apiv1calcrecalculate)
7. [Passo 5 — Calcular frete (opcional)](#7-passo-5--calcular-frete-opcional-post-apiv1calcfreight)
8. [Passo 6 — Criar pedido (`POST /api/v1/orders`)](#8-passo-6--criar-pedido-post-apiv1orders)
9. [Passo 7 — Redirecionar para o Stripe](#9-passo-7--redirecionar-para-o-stripe)
10. [Estado mínimo da aplicação](#10-estado-mínimo-da-aplicação)
11. [Exemplos de backend completo](#11-exemplos-de-backend-completo)
12. [Erros comuns e como resolver](#12-erros-comuns-e-como-resolver)
13. [Configuração de campos de checkout por tenant](#13-configuração-de-campos-de-checkout-por-tenant-checkout_fields)
14. [Endpoints adicionais](#14-endpoints-adicionais)

---

## 1. Configuração e autenticação

```
Base URL:  https://stg.meajudamaia.com
```

**Todas as chamadas usam este header:**

```http
Authorization: Bearer SUA_API_KEY_AQUI
Content-Type: application/json
```

### Tipos de token suportados

| Tipo | Formato | Uso |
|---|---|---|
| **App token** (recomendado) | string opaca (ex: `Oja6HPlX...`) | Integração frontend/backend de tenant fixo |
| **API key** | começa com `sk_` | Acesso multi-tenant via `X-Company-Id` |
| **JWT** | começa com `eyJ` | Utilizadores do dashboard (login via `/api/v1/auth/login`) |

O token determina automaticamente:
- Empresa PT (Aquinta Portugal, `company_id=9`) ou BR (`company_id=1`)
- Moeda (EUR / BRL)
- Gateway de pagamento (Stripe para PT / Malga para BR)
- Pricelist correta por tenant

> **Segurança:** Em produção a API key/token deve viver no servidor, nunca exposta no frontend.

---

## 2. Arquitectura do fluxo

```
[Formulário HTML]
        │
        ▼ POST /api/v1/calc   ← envia dados do pet + tutor + NIF
[Cálculo do Plano]
        │
        ├──► (opcional) POST /api/v1/calc/recalculate  ← utilizador edita dietas/mix
        │
        ├──► (opcional) POST /api/v1/calc/freight      ← calcular custo de envio
        │
        ▼ POST /api/v1/orders  ← cria pedido no Odoo
[Pedido criado]
        │
        ▼ redirect → payment_link
[Stripe Checkout]
        │
        ▼ Stripe webhook → Odoo confirma pedido automaticamente
[Pago ✓]
```

> **Multi-tenant:** O tenant (PT ou BR) é determinado exclusivamente pelo token Bearer. O gateway injeta automaticamente o `company_id` em todos os passos do fluxo — cálculo, recálculo e criação de pedido usam sempre a empresa correta sem qualquer configuração extra.

---

## 3. Passo 1 — Recolher dados no formulário

O formulário recolhe **dois grupos de dados**. É crítico que os dados do tutor sejam enviados **no cálculo** (não apenas no pedido) — o plan-builder valida-os a partir do cálculo armazenado.

### Dados do pet

| Campo HTML | Tipo | Valores válidos |
|---|---|---|
| `birth_date` | date → string `YYYY-MM-DD` | data de nascimento |
| `weight` | number (kg) | ex: `4.2` |
| `size` | botões | `mini` (<5 kg) · `small` (5–10) · `medium` (11–25) · `big` (26–45) · `giant` (>45) |
| `fitness` | botões | `skinny` · `normal` · `fat` |
| `activity` | botões | `inactive` · `normal` · `active` |
| `castrated` | botões | `true` · `false` |
| `pet_name` | text | nome do pet |

### Dados do tutor (obrigatórios mesmo no cálculo)

| Campo HTML | Tipo | Notas |
|---|---|---|
| `partner_name` | text | nome completo |
| `partner_email` | email | e-mail do tutor |
| `partner_phone` | tel | formato `+351912345678` |
| `cpf` | text | NIF / CPF — mínimo 9 dígitos (ex: `234567891`) |
| `cep` | text | código postal — formato `XXXX-XXX` (ex: `1000-001`) |

> **Crítico — lê com atenção:**  
> `tutor_name`, `phone` e `cpf` **têm de ir no payload do `/calc`**.  
> O plan-builder guarda o `request_json` do cálculo e valida esses campos ao criar o pedido.  
> Se chegarem apenas no `/orders` e não no `/calc`, o pedido falha com `MISSING_REQUIRED_ORDER_FIELDS`.

---

## 4. Passo 2 — Calcular o plano `POST /api/v1/calc`

### Payload

```json
{
  "birth_date":    "2021-04-10",
  "weight":        4.2,
  "size":          "mini",
  "fitness":       "normal",
  "activity":      "normal",
  "castrated":     true,
  "pet_name":      "Bolinha",
  "tutor_name":    "Ana Ferreira",
  "tutor_email":   "ana@email.pt",
  "phone":         "+351912345678",
  "cpf":           "234567891",
  "cep":           "1000-001",
  "package_sizes": [300],
  "periods":       [15],
  "mix_percentages": [100]
}
```

**Campos obrigatórios mínimos:** `birth_date`, `weight`, `size`, `fitness`, `activity`, `castrated`  
**Obrigatórios para criar pedido depois:** `tutor_name`, `phone`, `cpf`, `tutor_email`

### Resposta

```json
{
  "calc_id": 115,
  "calories": 225.0,
  "plans": {
    "300": [
      {
        "id": 13670,
        "title": "Turkey",
        "product_energy": 1010.0,
        "variants": [
          {
            "percentage": 100,
            "daily_grams": 225.0,
            "daily_measures": 4.5,
            "fortnight_packs": 7,
            "fortnight_price": 45.5,
            "fortnight_price_discount": 45.5,
            "monthly_packs": 13,
            "monthly_price": 84.5,
            "monthly_price_discount": 84.5
          }
        ]
      }
    ]
  },
  "distribution_summary": {
    "totals": { "packs": 7, "estimated_days": 15.2 },
    "diets": [
      {
        "product_id": 13670,
        "grams_per_day": 225.0,
        "measures_per_day": 4.5,
        "packs": 7,
        "subtotal_discounted": 45.5
      }
    ]
  }
}
```

### O que guardar no estado

```js
state.calcId     = result.calc_id
state.calcResult = result
state.selectedIds = new Set(result.plans["300"].map(p => p.id))
```

---

## 5. Passo 3 — Mostrar resultados e ler a resposta

### Como ler preços e porções

Os dados estão em `plans["300"][i]`. Cada produto tem `variants[]` com dados por período:

| Campo na variant | Descrição |
|---|---|
| `fortnight_packs` · `fortnight_price` | Packs e preço deste produto para **15 dias** |
| `fortnight_days_amount` | Dias cobertos por este produto no período de 15 dias |
| `monthly_packs` · `monthly_price` | Packs e preço deste produto para **30 dias** |
| `monthly_days_amount` | Dias cobertos por este produto no período de 30 dias |
| `daily_grams` · `daily_measures` | Grama e medidas diárias |
| `variant_price` | Preço por pack (ex: 6.5 EUR) — **usar este, não `price` que é sempre 0** |

> **Atenção:** Com **N produtos seleccionados**, `fortnight_packs` de cada produto representa a sua **quota proporcional** dos 15 dias — não o total. O total de packs está em `distribution_summary.totals.packs`. Com **1 produto** sozinho, `fortnight_packs` já é o total do período completo.

Para **15 dias**, usa `distribution_summary.diets` — tem os valores mais precisos por produto:

```js
// Para quinzenal (15 dias):
const dist = result.distribution_summary.diets.find(d => d.product_id === productId)
const packs    = dist?.packs               // packs deste produto
const subtotal = dist?.subtotal_discounted // preço deste produto

// Total do pedido (todos os produtos):
const totalPacks = result.distribution_summary.totals.packs
const totalPrice = result.distribution_summary.totals.discounted

// Para mensal (30 dias):
const variant = product.variants.find(v => v.percentage === mixPercentage)
const packs    = variant?.monthly_packs
const subtotal = variant?.monthly_price_discount ?? variant?.monthly_price
```

### Mix feeding

`mix_percentages` define a percentagem da dieta diária coberta pela Aquinta:

| Valor | Significado |
|---|---|
| `100` | Dieta completa Aquinta |
| `50` | 50% Aquinta + 50% ração do cliente |
| `25` | 25% Aquinta + 75% ração do cliente |

---

## 6. Passo 4 — Recalcular (opcional) `POST /api/v1/calc/recalculate`

Usado quando o utilizador altera as dietas seleccionadas ou o mix feeding.

> **Multi-tenant:** O recálculo respeita automaticamente o tenant do token — os produtos e preços carregados são sempre os do tenant PT ou BR, conforme o token Bearer utilizado. O `company_id` é propagado pelo gateway via header interno ao plan-builder.

### Payload

```json
{
  "calc_id":         115,
  "products_id":     [13670],
  "mix_percentages": [100]
}
```

> ⚠️ O campo chama-se **`products_id`** (com `s` antes de `_id`), não `product_ids`.

### Resposta — estrutura real

```json
{
  "calc_id": 656,
  "status":  "pending",
  "request": { "birth_date": "...", "size": "mini", "..." : "..." },
  "summary": { "final_total": { "15": 84.5 }, "..." : "..." },
  "result": {
    "calc_id":          656,
    "previous_calc_id": 655,
    "calories": 258.2,
    "plans": {
      "300": [
        {
          "id": 13670,
          "title": "Turkey",
          "variant_price": 6.5,
          "variants": [
            {
              "percentage": 100,
              "daily_grams": 250.0,
              "daily_measures": 5.0,
              "fortnight_days_amount": 15,
              "fortnight_packs": 13,
              "fortnight_price": 84.5,
              "fortnight_price_discount": 84.5,
              "monthly_days_amount": 30,
              "monthly_packs": 25,
              "monthly_price": 162.5,
              "monthly_price_discount": 162.5
            }
          ]
        }
      ]
    },
    "distribution_summary": {
      "period_days": 15,
      "diets": [
        {
          "product_id": 13670,
          "title": "Turkey",
          "grams_per_day": 250.0,
          "estimated_days": 15.0,
          "packs": 13.0,
          "subtotal_discounted": 84.5
        }
      ],
      "totals": { "gross": 84.5, "discounted": 84.5, "packs": 13.0, "estimated_days": 15.0 }
    }
  }
}
```

**Notas críticas:**

- Os dados do plano estão em **`raw.result`**, não na raiz. O `calc_id` novo está na raiz E em `result.calc_id`.
- `result.previous_calc_id` → ID do cálculo de origem (útil para rastreabilidade).
- **`variant_price`** (6.5 EUR/pack) é o preço por pack. O campo `price` é sempre `0.0` — **nunca usar `price`**.
- **`fortnight_packs` é a quota do produto no período**, não o total do pedido. Com N produtos seleccionados, cada um cobre uma fracção dos 15 dias:
  - Turkey + Chicken: Turkey=7 packs (8 dias), Chicken=7 packs (7 dias) → total 14 packs
  - Turkey sozinho: Turkey=13 packs (15 dias) → total 13 packs
  - Para o total use sempre `distribution_summary.totals.packs`.
- **`fortnight_days_amount`** e **`monthly_days_amount`** indicam quantos dias do período aquele produto cobre. Com produto único = período completo (15 ou 30). Com vários produtos = quota proporcional.
- O campo `order["300"]` contém dados agregados do pedido (útil para resumo). Para preços por produto use `plans["300"]`.

```js
const raw       = await api("POST", "/api/v1/calc/recalculate", payload)
const result    = raw.result || raw
const newCalcId = raw.calc_id || result.calc_id
if (newCalcId) state.calcId = newCalcId   // IMPORTANTE: actualizar calc_id
state.calcResult = result
```

---

## 7. Passo 5 — Calcular frete (opcional) `POST /api/v1/calc/freight`

### Payload

```json
{ "cep": "1000-001", "calc_id": 116 }
```

### Resposta

```json
{
  "value":        5.99,
  "prazo":        4,
  "carrier_name": "Portugal Continental"
}
```

### Frete multi-pet `POST /api/v1/calc/cart/freight`

Para cenários com múltiplos pets (usando `cart_id`):

```json
{ "cep": "1000-001", "cart_id": "cart-abc123" }
```

---

## 8. Passo 6 — Criar pedido `POST /api/v1/orders`

### Payload

```json
{
  "calc_id":         116,
  "product_ids":     [13670],
  "mix_percentages": [100],
  "period":          15,

  "partner_email":   "ana@email.pt",
  "partner_name":    "Ana Ferreira",
  "partner_phone":   "+351912345678",

  "tutor_email":     "ana@email.pt",
  "tutor_name":      "Ana Ferreira",
  "tutor_phone":     "+351912345678",

  "pet_name":        "Bolinha",
  "order_type":      "trial",
  "delivery_number": 1,
  "cep":             "1000-001"
}
```

**Campos obrigatórios:** `calc_id`, `partner_email`, `partner_name`, `partner_phone`, `period`, `order_type`

> **Nota:** `partner_*` e `tutor_*` podem ter os mesmos valores — são campos redundantes por compatibilidade.

### Resposta

```json
{
  "payment_link": "https://checkout.stripe.com/c/pay/cs_test_...",
  "link_stripe":  "https://checkout.stripe.com/c/pay/cs_test_...",
  "stripe_session_id": "cs_test_...",
  "order": {
    "id":           6535,
    "payment_link": "https://checkout.stripe.com/c/pay/cs_test_...",
    "confirmed":    false,
    "totals": { "total": 91.0, "discounted": 91.0 }
  }
}
```

### Como extrair os dados de pagamento

A resposta varia por tenant (`payment_gw`):

**PT (Stripe — Payment Element inline):**
```json
{
  "stripe_client_secret":    "pi_3R..._secret_...",
  "stripe_publishable_key":  "pk_live_...",
  "stripe_payment_intent_id": "pi_3R...",
  "payment_link": "",
  "orders": [{ "order": { "id": 1082, "stripe_client_secret": "pi_..." } }]
}
```

**BR (Malga — redirect):**
```json
{
  "payment_link": "https://stg.meajudamaia.com/checkout/payment?session_id=...",
  "link_malga":   "https://stg.meajudamaia.com/checkout/payment?session_id=...",
  "orders": [{ "order": { "id": 1081, "payment_link": "..." } }]
}
```

```js
const raw            = await api("POST", "/api/v1/orders", payload)
const o              = raw.order || raw.orders?.[0]?.order || raw
const clientSecret   = raw.stripe_client_secret || o.stripe_client_secret
const publishableKey = raw.stripe_publishable_key
```

---

## 9. Passo 7 — Checkout (Stripe Payment Element ou Malga redirect)

O fluxo é diferente por gateway:

### PT — Stripe Payment Element (checkout inline, sem sair do site)

Requer `stripe.js` carregado (`<script src="https://js.stripe.com/v3/">`).

```js
if (clientSecret && publishableKey) {
  const stripe   = Stripe(publishableKey)
  const elements = stripe.elements({ clientSecret, appearance: { theme: "stripe" } })

  // Montar o Payment Element num div vazio
  const paymentEl = elements.create("payment", { layout: "tabs" })
  paymentEl.mount("#payment-element")

  // No submit do formulário:
  const { error } = await stripe.confirmPayment({
    elements,
    confirmParams: { return_url: window.location.href },
    redirect: "if_required",   // fica na página se não precisar de redirect
  })

  if (error) {
    // Mostrar erro ao utilizador
    console.error(error.message)
  } else {
    // Pagamento concluído — mostrar ecrã de sucesso
    // O webhook Stripe (payment_intent.succeeded) confirma o pedido no Odoo
  }
}
```

> **Webhook Stripe:** regista `https://stg.meajudamaia.com/api/stripe_event` no Stripe Dashboard
> (Developers → Webhooks → Add endpoint) com os eventos `payment_intent.succeeded` e
> `payment_intent.payment_failed`. O `whsec_...` gerado vai para `STRIPE_WEBHOOK_SECRET` no `.env`
> do plan_builder_refactor. O webhook confirma o pedido no Odoo automaticamente.

### BR — Malga (redirect)

```js
const link = raw.payment_link || o.payment_link || o.link_malga
if (link) {
  window.location.href = link
}
```

---

## 10. Estado mínimo da aplicação

```js
const state = {
  calcId:        null,      // actualizar após recalculate!
  calcResult:    null,      // já em raw.result após recalculate
  selectedIds:   new Set(),
  mixPercentage: 100,       // 100 | 50 | 25
  period:        "fortnight",
  freight:       null,
  petData: {
    pet_name:      "",
    partner_name:  "",
    partner_email: "",
    partner_phone: "",
    cpf:           "",
    cep:           "",
  },
}
```

---

## 11. Exemplos de backend completo

### JavaScript / Node.js (fetch)

```js
const API_BASE = "https://stg.meajudamaia.com"
const API_KEY  = "SUA_API_KEY_AQUI"

const headers = {
  "Authorization": `Bearer ${API_KEY}`,
  "Content-Type":  "application/json",
}

async function calcularPlano(dadosPet) {
  const res = await fetch(`${API_BASE}/api/v1/calc`, {
    method: "POST", headers, body: JSON.stringify(dadosPet),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function recalcular({ calcId, productIds, mixPercentage = 100 }) {
  const res = await fetch(`${API_BASE}/api/v1/calc/recalculate`, {
    method: "POST", headers,
    body: JSON.stringify({
      calc_id:         calcId,
      products_id:     productIds,   // atenção: products_id, não product_ids
      mix_percentages: [mixPercentage],
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  const raw = await res.json()
  return {
    calcId: raw.calc_id || raw.result?.calc_id || calcId,
    result: raw.result  || raw,
  }
}

async function calcularFrete({ cep, calcId }) {
  const res = await fetch(`${API_BASE}/api/v1/calc/freight`, {
    method: "POST", headers, body: JSON.stringify({ cep, calc_id: calcId }),
  })
  if (!res.ok) return null
  return res.json()
}

async function criarPedido({ calcId, productIds, mixPercentage, period, tutor, cep }) {
  const res = await fetch(`${API_BASE}/api/v1/orders`, {
    method: "POST", headers,
    body: JSON.stringify({
      calc_id:         calcId,
      product_ids:     productIds,
      mix_percentages: [mixPercentage],
      period,
      partner_email:   tutor.email,
      partner_name:    tutor.name,
      partner_phone:   tutor.phone,
      tutor_email:     tutor.email,
      tutor_name:      tutor.name,
      tutor_phone:     tutor.phone,
      pet_name:        tutor.petName,
      order_type:      "trial",
      delivery_number: 1,
      cep,
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  const raw = await res.json()
  const o   = raw.order || raw
  return { orderId: o.id, paymentLink: o.payment_link || o.link_stripe }
}

// Fluxo completo
async function fluxoCompleto() {
  const calc = await calcularPlano({
    birth_date: "2021-04-10", weight: 4.2, size: "mini",
    fitness: "normal", activity: "normal", castrated: true,
    pet_name: "Bolinha", tutor_name: "Ana Ferreira",
    tutor_email: "ana@email.pt", phone: "+351912345678",
    cpf: "234567891", cep: "1000-001",
    package_sizes: [300], periods: [15], mix_percentages: [100],
  })

  const recalc = await recalcular({ calcId: calc.calc_id, productIds: [13670] })
  const frete  = await calcularFrete({ cep: "1000-001", calcId: recalc.calcId })
  const pedido = await criarPedido({
    calcId: recalc.calcId, productIds: [13670], mixPercentage: 100, period: 15,
    tutor: { name: "Ana Ferreira", email: "ana@email.pt",
             phone: "+351912345678", petName: "Bolinha" },
    cep: "1000-001",
  })
  // window.location.href = pedido.paymentLink
}
```

---

### Python

```python
import httpx

API_BASE = "https://stg.meajudamaia.com"
API_KEY  = "SUA_API_KEY_AQUI"
HEADERS  = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def calcular(dados_pet: dict) -> dict:
    r = httpx.post(f"{API_BASE}/api/v1/calc", json=dados_pet, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def recalcular(calc_id: int, product_ids: list, mix_percentage: int = 100) -> dict:
    r = httpx.post(f"{API_BASE}/api/v1/calc/recalculate", headers=HEADERS, timeout=30, json={
        "calc_id":         calc_id,
        "products_id":     product_ids,   # products_id — com 's'
        "mix_percentages": [mix_percentage],
    })
    r.raise_for_status()
    raw = r.json()
    return {
        "calc_id": raw.get("calc_id") or raw.get("result", {}).get("calc_id") or calc_id,
        "result":  raw.get("result")  or raw,
    }


def frete(cep: str, calc_id: int) -> dict | None:
    r = httpx.post(f"{API_BASE}/api/v1/calc/freight", headers=HEADERS, timeout=30,
                   json={"cep": cep, "calc_id": calc_id})
    return r.json() if r.is_success else None


def criar_pedido(calc_id, product_ids, mix_percentage, period,
                 tutor_name, tutor_email, tutor_phone, pet_name, cep=None) -> dict:
    payload = {
        "calc_id": calc_id, "product_ids": product_ids,
        "mix_percentages": [mix_percentage], "period": period,
        "partner_email": tutor_email, "partner_name": tutor_name,
        "partner_phone": tutor_phone, "tutor_email": tutor_email,
        "tutor_name": tutor_name, "tutor_phone": tutor_phone,
        "pet_name": pet_name, "order_type": "trial", "delivery_number": 1,
    }
    if cep:
        payload["cep"] = cep
    r = httpx.post(f"{API_BASE}/api/v1/orders", json=payload, headers=HEADERS, timeout=60)
    r.raise_for_status()
    raw = r.json()
    o   = raw.get("order") or raw
    return {"order_id": o.get("id"), "payment_link": o.get("payment_link") or o.get("link_stripe")}
```

---

### cURL (passo a passo)

```bash
API_KEY="SUA_API_KEY_AQUI"
BASE="https://stg.meajudamaia.com"

# 1. Calcular
CALC_ID=$(curl -s -X POST "$BASE/api/v1/calc" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"birth_date":"2021-04-10","weight":4.2,"size":"mini","fitness":"normal",
       "activity":"normal","castrated":true,"pet_name":"Bolinha",
       "tutor_name":"Ana Ferreira","tutor_email":"ana@email.pt",
       "phone":"+351912345678","cpf":"234567891","cep":"1000-001",
       "package_sizes":[300],"periods":[15],"mix_percentages":[100]}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['calc_id'])")
echo "calc_id: $CALC_ID"

# 2. Recalcular (opcional)
NEW_CALC_ID=$(curl -s -X POST "$BASE/api/v1/calc/recalculate" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d "{\"calc_id\":$CALC_ID,\"products_id\":[13670],\"mix_percentages\":[100]}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('calc_id') or d.get('result',{}).get('calc_id'))")
echo "new_calc_id: $NEW_CALC_ID"

# 3. Criar pedido
curl -s -X POST "$BASE/api/v1/orders" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d "{\"calc_id\":$NEW_CALC_ID,\"product_ids\":[13670],\"mix_percentages\":[100],
       \"period\":15,\"partner_email\":\"ana@email.pt\",\"partner_name\":\"Ana Ferreira\",
       \"partner_phone\":\"+351912345678\",\"tutor_email\":\"ana@email.pt\",
       \"tutor_name\":\"Ana Ferreira\",\"tutor_phone\":\"+351912345678\",
       \"pet_name\":\"Bolinha\",\"order_type\":\"trial\",\"delivery_number\":1,
       \"cep\":\"1000-001\"}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); o=d.get('order',d); print('payment_link:', o.get('payment_link') or o.get('link_stripe'))"
```

---

## 12. Erros comuns e como resolver

| Erro | Causa | Solução |
|---|---|---|
| `422 MISSING_REQUIRED_ORDER_FIELDS ["tutor_phone","cpf","tutor_name"]` | Campos não enviados no `/calc` | Incluir `tutor_name`, `phone`, `cpf` no payload do `POST /api/v1/calc` |
| `422 VALIDATION_ERROR "Informe calc_id + products_id"` | Campo errado no recalculate | `/recalculate` usa `products_id` (com `s`); `/orders` usa `product_ids` (sem `s`) |
| `502 company inconsistencies pricelist` | Pricelist de empresa errada | Automático via tenant — verificar se token corresponde ao tenant certo |
| Recalculate devolve valores zerados | Bug antigo (corrigido): `company_id` não propagado | Garantir versão do plan-builder ≥ fix de Maio/2026 |
| Resposta do recalculate sem `plans` | Leitura da raiz em vez de `raw.result` | Usar `raw.result \|\| raw` |
| `payment_link` nulo na resposta de orders | `stripe_secret_key` não configurado no tenant | Configurar chave Stripe no tenant registry |
| `401 Token inválido` | Token errado ou inactivo | Verificar `Authorization: Bearer <TOKEN>` |

---

## 13. Configuração de campos de checkout por tenant (`checkout_fields`)

Cada tenant pode configurar quais campos do formulário são obrigatórios, opcionais ou ocultados.

### Campos configuráveis

| Chave | Campo de API | Descrição |
|---|---|---|
| `tax_id` | `cpf` | NIF / CPF do tutor |
| `phone` | `phone` | Telefone do tutor |
| `pet_name` | `pet_name` | Nome do pet |
| `tutor_name` | `tutor_name` | Nome do tutor |
| `tutor_email` | `tutor_email` | Email do tutor |

### Modos disponíveis

| Modo | Frontend | Backend |
|---|---|---|
| `required` | Campo visível com `required` | Validado — pedido falha se ausente |
| `optional` | Campo visível sem `required` | Não validado |
| `hidden` | Campo ocultado | Ignorado |

Default: `required` se não configurado.

```json
{
  "checkout_fields": {
    "tax_id":      "optional",
    "phone":       "required",
    "pet_name":    "required",
    "tutor_name":  "required",
    "tutor_email": "required"
  }
}
```

---

## 14. Endpoints adicionais

### Carrinho multi-pet

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/v1/calc/cart/{cart_id}` | Recuperar todos os cálculos de um carrinho |
| `POST` | `/api/v1/calc/cart/freight` | Calcular frete para carrinho multi-pet (`{ cart_id, cep }`) |

### Pagamento

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/api/v1/payment/session` | Criar sessão de pagamento (Stripe ou Malga) |
| `GET` | `/api/v1/payment/session/{session_id}` | Consultar estado de sessão de pagamento |
| `GET` | `/api/v1/payment/config` | Configuração pública do gateway do tenant |
| `GET` | `/api/v1/payment/checkout` | Dados para montar página de checkout (Stripe: `publishable_key`, URLs) |

### Pedidos

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/v1/orders` | Listar pedidos do tenant (paginado: `?limit=50&offset=0`) |
| `GET` | `/api/v1/orders/{order_id}` | Detalhe de um pedido |
| `PATCH` | `/api/v1/orders/{order_id}/status` | Atualizar status (`draft→sale→done→cancel`) |

### Produtos

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/v1/products` | Listar produtos do tenant |
| `GET` | `/api/v1/products/{product_id}` | Detalhe de um produto |

### Autenticação (JWT para dashboard)

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Login com credenciais Odoo → JWT |
| `POST` | `/api/v1/auth/refresh` | Renovar token JWT |

---

## Referências

- **Demo ao vivo:** https://stg.meajudamaia.com/demo/
- **Swagger UI:** https://stg.meajudamaia.com/gw/docs
- **Swagger spec (JSON):** https://stg.meajudamaia.com/gw/openapi.json
- **Repositório demo:** https://github.com/wrspet/aquinta-pt-demo
