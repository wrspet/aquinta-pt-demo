# Aquinta PT — Guia de Integração: Do Formulário ao Pagamento

Guia passo a passo para integrar o fluxo completo da API Aquinta Portugal:  
**Formulário → Cálculo → Mix Feeding → (Recálculo) → (Frete) → Pedido → Stripe Payment Element**

---

## Índice

1. [Configuração e autenticação](#1-configuração-e-autenticação)
2. [Arquitectura do fluxo](#2-arquitectura-do-fluxo)
3. [Passo 1 — Recolher dados no formulário](#3-passo-1--recolher-dados-no-formulário)
4. [Passo 2 — Calcular o plano (`POST /api/v1/calc`)](#4-passo-2--calcular-o-plano-post-apiv1calc)
5. [Passo 3 — Mix feeding: opções disponíveis](#5-passo-3--mix-feeding-opções-disponíveis)
6. [Passo 4 — Mostrar resultados](#6-passo-4--mostrar-resultados-e-ler-a-resposta)
7. [Passo 5 — Recalcular (opcional)](#7-passo-5--recalcular-opcional-post-apiv1calcrecalculate)
8. [Passo 6 — Calcular frete (opcional)](#8-passo-6--calcular-frete-opcional-post-apiv1calcfreight)
9. [Passo 7 — Criar pedido (`POST /api/v1/orders`)](#9-passo-7--criar-pedido-post-apiv1orders)
10. [Passo 8 — Checkout (Stripe ou Malga)](#10-passo-8--checkout-stripe-payment-element-ou-malga-redirect)
11. [Estado mínimo da aplicação](#11-estado-mínimo-da-aplicação)
12. [Exemplos de backend completo](#12-exemplos-de-backend-completo)
13. [Erros comuns e como resolver](#13-erros-comuns-e-como-resolver)
14. [Configuração de campos por tenant (`checkout_fields`)](#14-configuração-de-campos-de-checkout-por-tenant-checkout_fields)
15. [Endpoints adicionais](#15-endpoints-adicionais)

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
        │  birth_date, weight, size, fitness, activity, castrated
        │  phone (obrigatório) — name/email/nif opcionais por tenant
        │
        ▼ POST /api/v1/calc   ← sempre com mix_percentages:[100,50,25]
[Cálculo do Plano]
        │  O backend devolve APENAS as variantes de mix elegíveis
        │  O frontend mostra só os botões de mix que vieram na resposta
        │
        ├──► (utilizador muda mix/dietas) POST /api/v1/calc/recalculate
        │
        ├──► (opcional) POST /api/v1/calc/freight
        │
        ▼ POST /api/v1/orders  ← cria pedido no Odoo
[Pedido criado]
        │
        ├── PT: stripe_client_secret + stripe_publishable_key
        │        → Stripe Payment Element inline (sem sair do site)
        │
        └── BR: payment_link → redirect Malga
        
        ▼ Stripe webhook payment_intent.succeeded
[Odoo confirma pedido automaticamente ✓]
```

> **Multi-tenant:** O tenant (PT ou BR) é determinado exclusivamente pelo token Bearer. O gateway injeta automaticamente o `company_id` em todos os passos — cálculo, recálculo e criação de pedido usam sempre a empresa correta.

---

## 3. Passo 1 — Recolher dados no formulário

### Campos obrigatórios (sempre)

| Campo | Tipo | Notas |
|---|---|---|
| `birth_date` | date `YYYY-MM-DD` | Para calcular a idade |
| `weight` | number (kg) | Ex: `4.2` |
| `size` | botões | `mini` (<5kg) · `small` (5–10) · `medium` (11–25) · `big` (26–45) · `giant` (>45) |
| `fitness` | botões | `skinny` · `normal` · `fat` |
| `activity` | botões | `inactive` · `normal` · `active` |
| `castrated` | botões | `true` · `false` |
| `phone` | tel | Ex: `+351912345678` |

### Campos opcionais (configuráveis por tenant)

| Campo | Tipo | Default PT |
|---|---|---|
| `pet_name` | text | opcional |
| `tutor_name` | text | opcional |
| `tutor_email` | email | opcional |
| `cpf` | text | opcional (NIF/CPF, mín. 9 dígitos) |
| `cep` | text | opcional (código postal) |

> **Campos opcionais:** o backend aceita string vazia `""` ou `null` — converte automaticamente para `null` antes de validar. Apenas `phone` é sempre obrigatório (configurável por tenant via `checkout_fields`).

---

## 4. Passo 2 — Calcular o plano `POST /api/v1/calc`

### Regra crítica: enviar sempre `mix_percentages: [100, 50, 25]`

O backend usa este array para calcular **quais opções de mix são elegíveis** para aquele pet específico. Enviar sempre os três valores — o backend devolve apenas os que o pet pode usar.

### Payload mínimo

```json
{
  "birth_date":      "2021-04-10",
  "weight":          4.2,
  "size":            "mini",
  "fitness":         "normal",
  "activity":        "normal",
  "castrated":       true,
  "phone":           "+351912345678",
  "mix_percentages": [100, 50, 25]
}
```

### Payload completo

```json
{
  "birth_date":      "2021-04-10",
  "weight":          4.2,
  "size":            "mini",
  "fitness":         "normal",
  "activity":        "normal",
  "castrated":       true,
  "pet_name":        "Bolinha",
  "tutor_name":      "Ana Ferreira",
  "tutor_email":     "ana@email.pt",
  "phone":           "+351912345678",
  "cpf":             "234567891",
  "cep":             "1000-001",
  "mix_percentages": [100, 50, 25]
}
```

### Resposta

```json
{
  "calc_id": 115,
  "calories": 225.0,
  "cart_id": "cart-abc123",
  "plans": {
    "300": [
      {
        "id": 13670,
        "title": "Turkey",
        "variant_price": 6.5,
        "variants": [
          {
            "percentage": 100,
            "daily_grams": 225.0,
            "daily_measures": 4.5,
            "fortnight_packs": 14,
            "fortnight_price": 91.0,
            "fortnight_price_discount": 91.0,
            "monthly_packs": 28,
            "monthly_price": 182.0,
            "monthly_price_discount": 182.0
          },
          {
            "percentage": 50,
            "daily_grams": 112.5,
            "daily_measures": 2.25,
            "fortnight_packs": 7,
            "fortnight_price": 45.5,
            "fortnight_price_discount": 45.5,
            "monthly_packs": 14,
            "monthly_price": 91.0,
            "monthly_price_discount": 91.0
          }
        ]
      }
    ]
  },
  "distribution_summary": {
    "totals": { "packs": 14, "discounted": 91.0 },
    "diets": [{ "product_id": 13670, "packs": 14, "subtotal_discounted": 91.0 }]
  }
}
```

> **Nota:** se o pet não tiver packs suficientes para 50% ou 25%, essas variantes simplesmente não aparecem na resposta — o backend filtra automaticamente.

---

## 5. Passo 3 — Mix feeding: opções disponíveis

### Como funciona (regra do backend)

O backend determina quais opções de mix são elegíveis com base no número de packs que o pet precisa:

| Opção | Regra de elegibilidade |
|---|---|
| `100%` | Sempre disponível |
| `50%` | `fortnight_packs (100%) ≥ 12` (configurável via env `MIX_MIN_PACKS_50`) |
| `25%` | `fortnight_packs (100%) ≥ 20` (configurável via env `MIX_MIN_PACKS_25`) |

Thresholds podem ser sobrescritos por produto nos campos `mix_min_packs_50` / `mix_min_packs_25` do produto no Odoo.

### Como o frontend deve usar esta informação

**Nunca hardcode os botões de mix.** Após receber a resposta do calc, derive as opções disponíveis lendo os `percentage` das variantes:

```js
function updateAvailableMixOptions(result) {
  const available = new Set()
  const plans = result?.plans || {}

  // Recolher todos os percentages disponíveis em qualquer produto
  for (const size of Object.keys(plans)) {
    for (const product of (plans[size] || [])) {
      for (const variant of (product.variants || [])) {
        if (variant.percentage > 0) available.add(variant.percentage)
      }
    }
  }
  if (available.size === 0) available.add(100)

  // Mostrar/esconder botões conforme disponibilidade
  document.querySelectorAll("#mix-options .opt").forEach(btn => {
    btn.style.display = available.has(parseInt(btn.dataset.val)) ? "" : "none"
  })
}

// Chamar após calc inicial e após cada recalculate
const result = await api("POST", "/api/v1/calc", { ...pet, mix_percentages: [100, 50, 25] })
updateAvailableMixOptions(result)
```

### Significado dos valores

| Valor | Significado |
|---|---|
| `100%` | Dieta completa Aquinta |
| `50%` | 50% Aquinta + 50% ração do cliente |
| `25%` | 25% Aquinta + 75% ração do cliente |

### Fluxo de mix feeding

1. **Calc inicial** → envia `mix_percentages: [100, 50, 25]` → backend filtra e devolve apenas os elegíveis como variantes
2. **Frontend** → lê os `percentage` das variantes → mostra só os botões disponíveis
3. **Utilizador muda mix** → `POST /api/v1/calc/recalculate` com o novo mix → atualiza opções

---

## 6. Passo 4 — Mostrar resultados e ler a resposta

### Como ler preços e porções

Os dados estão em `plans["300"][i]`. Cada produto tem `variants[]` com dados por período e mix:

| Campo na variant | Descrição |
|---|---|
| `percentage` | Percentagem de mix (100 / 50 / 25) |
| `fortnight_packs` · `fortnight_price_discount` | Packs e preço para o período quinzenal |
| `monthly_packs` · `monthly_price_discount` | Packs e preço para o período mensal |
| `daily_grams` · `daily_measures` | Gramas e medidas diárias |
| `variant_price` | Preço por pack — **usar este, nunca `price` que é sempre 0** |

> **Atenção:** Com **N produtos seleccionados**, `fortnight_packs` de cada produto representa a sua quota proporcional — não o total. O total de packs está em `distribution_summary.totals.packs`.

```js
// Ler preço total do período quinzenal
const totalPacks = result.distribution_summary.totals.packs
const totalPrice = result.distribution_summary.totals.discounted

// Ler preço de um produto específico para o período mensal
const product = result.plans["300"].find(p => p.id === productId)
const variant = product.variants.find(v => v.percentage === mixPercentage)
const monthlyPacks = variant?.monthly_packs
const monthlyPrice = variant?.monthly_price_discount ?? variant?.monthly_price
```

---

## 7. Passo 5 — Recalcular (opcional) `POST /api/v1/calc/recalculate`

Usado quando o utilizador altera dietas seleccionadas ou mix feeding.

### Payload

```json
{
  "calc_id":         115,
  "products_id":     [13670, 13669],
  "mix_percentages": [50]
}
```

> ⚠️ O campo chama-se **`products_id`** (com `s` antes de `_id`), não `product_ids`.

### Resposta — estrutura real

```json
{
  "calc_id": 116,
  "result": {
    "calc_id":          116,
    "previous_calc_id": 115,
    "calories": 258.2,
    "plans": { "300": [ { "id": 13670, "variants": [ { "percentage": 50, "..." : "..." } ] } ] },
    "distribution_summary": { "totals": { "discounted": 45.5, "packs": 7.0 } }
  }
}
```

**Notas críticas:**
- Os dados do plano estão em **`raw.result`**, não na raiz
- `calc_id` novo está na raiz E em `result.calc_id` — **actualizar sempre o `state.calcId`**
- Após recalculate, chamar `updateAvailableMixOptions(result)` para actualizar os botões de mix

```js
const raw       = await api("POST", "/api/v1/calc/recalculate", payload)
const result    = raw.result || raw
const newCalcId = raw.calc_id || result.calc_id
if (newCalcId) state.calcId = newCalcId   // IMPORTANTE: actualizar calc_id
state.calcResult = result
updateAvailableMixOptions(result)         // actualizar opções de mix disponíveis
```

---

## 8. Passo 6 — Calcular frete (opcional) `POST /api/v1/calc/freight`

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

---

## 9. Passo 7 — Criar pedido `POST /api/v1/orders`

### Campos obrigatórios vs opcionais

| Campo | Obrigatório? | Notas |
|---|---|---|
| `calc_id` | **Sim** | ID do último calc/recalculate |
| `partner_phone` | **Sim** (default) | Configurável por tenant |
| `period` | **Sim** | Dias do plano (ex: `14` PT / `15` BR) |
| `order_type` | **Sim** | `"trial"` |
| `delivery_number` | **Sim** | `1` |
| `products_id` | Recomendado | IDs dos produtos seleccionados |
| `mix_percentages` | Recomendado | `[100]` se não mudado |
| `partner_email` | Opcional* | *Depende de `checkout_fields` do tenant |
| `partner_name` | Opcional* | *Depende de `checkout_fields` do tenant |
| `pet_name` | Opcional* | *Depende de `checkout_fields` do tenant |
| `cpf` | Opcional* | NIF/CPF |
| `cep` | Opcional | Para cálculo de frete |

> **Strings vazias são aceites** — o backend converte `""` para `null` automaticamente antes de validar. Campos opcionais não precisam ser enviados se não tiverem valor.

### Payload PT (exemplo completo)

```json
{
  "calc_id":         116,
  "products_id":     [13670],
  "mix_percentages": [100],
  "period":          14,
  "partner_phone":   "+351912345678",
  "order_type":      "trial",
  "delivery_number": 1
}
```

### Aliases aceites

Os campos `partner_*` e `tutor_*` são equivalentes — o backend aceita ambos:

```json
{
  "partner_email": "ana@email.pt",   "tutor_email": "ana@email.pt",
  "partner_name":  "Ana Ferreira",   "tutor_name":  "Ana Ferreira",
  "partner_phone": "+351912345678",  "tutor_phone": "+351912345678"
}
```

### Resposta PT (Stripe)

```json
{
  "stripe_client_secret":     "pi_3R..._secret_...",
  "stripe_publishable_key":   "pk_live_...",
  "stripe_payment_intent_id": "pi_3R...",
  "payment_link": "",
  "orders": [{ "order": { "id": 1082, "totals": { "discounted": 91.0 } } }]
}
```

### Resposta BR (Malga)

```json
{
  "payment_link": "https://stg.meajudamaia.com/checkout/payment?session_id=...",
  "link_malga":   "https://stg.meajudamaia.com/checkout/payment?session_id=...",
  "orders": [{ "order": { "id": 1081, "totals": { "discounted": 89.90 } } }]
}
```

```js
const raw            = await api("POST", "/api/v1/orders", payload)
const o              = raw.order || raw.orders?.[0]?.order || raw.orders?.[0] || raw
const clientSecret   = raw.stripe_client_secret || o.stripe_client_secret
const publishableKey = raw.stripe_publishable_key
```

---

## 10. Passo 8 — Checkout (Stripe Payment Element ou Malga redirect)

### PT — Stripe Payment Element (inline, sem sair do site)

Requer `stripe.js` no HTML: `<script src="https://js.stripe.com/v3/"></script>`

```js
if (clientSecret && publishableKey) {
  const stripe   = Stripe(publishableKey)
  const elements = stripe.elements({
    clientSecret,
    appearance: { theme: "stripe", variables: { colorPrimary: "#2d6a4f" } },
  })

  // Montar o Payment Element num div vazio
  const paymentEl = elements.create("payment", { layout: "tabs" })
  paymentEl.mount("#stripe-payment-element")

  // No submit do formulário de pagamento:
  const { error } = await stripe.confirmPayment({
    elements,
    confirmParams: { return_url: window.location.href },
    redirect: "if_required",   // fica na página se não precisar de redirect 3DS
  })

  if (error) {
    // Mostrar mensagem de erro ao utilizador
  } else {
    // Pagamento inline confirmado — mostrar ecrã de sucesso
    // O webhook Stripe confirma o pedido no Odoo automaticamente
  }
}
```

> **Webhook Stripe:** Regista `https://stg.meajudamaia.com/api/stripe_event` no Stripe Dashboard
> (Developers → Webhooks → Add endpoint) com os eventos `payment_intent.succeeded` e
> `payment_intent.payment_failed`.  
> O `whsec_...` gerado é guardado no tenant registry (campo `stripe_webhook_secret`).  
> O webhook confirma o pedido no Odoo automaticamente após pagamento bem-sucedido.

### BR — Malga (redirect)

```js
const link = raw.payment_link || o.payment_link || o.link_malga
if (link) window.location.href = link
```

---

## 11. Estado mínimo da aplicação

```js
const state = {
  calcId:        null,      // actualizar sempre após recalculate!
  calcResult:    null,      // para recalculate: usar raw.result || raw
  selectedIds:   new Set(), // IDs dos produtos seleccionados
  mixPercentage: 100,       // 100 | 50 | 25 — determinado pelo backend
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

## 12. Exemplos de backend completo

### JavaScript / Node.js (fetch)

```js
const API_BASE = "https://stg.meajudamaia.com"
const API_KEY  = "SUA_API_KEY_AQUI"
const headers  = { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" }

async function calcularPlano(dadosPet) {
  const res = await fetch(`${API_BASE}/api/v1/calc`, {
    method: "POST", headers,
    body: JSON.stringify({ ...dadosPet, mix_percentages: [100, 50, 25] }),
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
  return { calcId: raw.calc_id || raw.result?.calc_id || calcId, result: raw.result || raw }
}

async function criarPedido({ calcId, productIds, mixPercentage, period, phone, name, email, cep }) {
  const payload = {
    calc_id: calcId, products_id: productIds,
    mix_percentages: [mixPercentage], period,
    partner_phone: phone, tutor_phone: phone,
    order_type: "trial", delivery_number: 1,
  }
  if (name)  { payload.partner_name = name; payload.tutor_name = name }
  if (email) { payload.partner_email = email; payload.tutor_email = email }
  if (cep)   payload.cep = cep

  const res = await fetch(`${API_BASE}/api/v1/orders`, { method: "POST", headers, body: JSON.stringify(payload) })
  if (!res.ok) throw new Error(await res.text())
  const raw = await res.json()
  return raw
}
```

### Python

```python
import httpx

API_BASE = "https://stg.meajudamaia.com"
API_KEY  = "SUA_API_KEY_AQUI"
HEADERS  = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def calcular(dados_pet: dict) -> dict:
    payload = {**dados_pet, "mix_percentages": [100, 50, 25]}
    r = httpx.post(f"{API_BASE}/api/v1/calc", json=payload, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def recalcular(calc_id: int, product_ids: list, mix_percentage: int = 100) -> dict:
    r = httpx.post(f"{API_BASE}/api/v1/calc/recalculate", headers=HEADERS, timeout=30, json={
        "calc_id": calc_id, "products_id": product_ids,
        "mix_percentages": [mix_percentage],
    })
    r.raise_for_status()
    raw = r.json()
    return {"calc_id": raw.get("calc_id") or raw.get("result", {}).get("calc_id"), "result": raw.get("result") or raw}


def criar_pedido(calc_id, product_ids, mix_percentage, period, phone, name=None, email=None, cep=None) -> dict:
    payload = {
        "calc_id": calc_id, "products_id": product_ids,
        "mix_percentages": [mix_percentage], "period": period,
        "partner_phone": phone, "tutor_phone": phone,
        "order_type": "trial", "delivery_number": 1,
    }
    if name:  payload.update({"partner_name": name, "tutor_name": name})
    if email: payload.update({"partner_email": email, "tutor_email": email})
    if cep:   payload["cep"] = cep
    r = httpx.post(f"{API_BASE}/api/v1/orders", json=payload, headers=HEADERS, timeout=60)
    r.raise_for_status()
    return r.json()
```

### cURL (passo a passo)

```bash
API_KEY="SUA_API_KEY_AQUI"
BASE="https://stg.meajudamaia.com"

# 1. Calcular — sempre com mix_percentages:[100,50,25]
CALC=$(curl -s -X POST "$BASE/api/v1/calc" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"birth_date":"2021-04-10","weight":4.2,"size":"mini","fitness":"normal",
       "activity":"normal","castrated":true,"phone":"+351912345678",
       "mix_percentages":[100,50,25]}')
CALC_ID=$(echo "$CALC" | python3 -c "import sys,json; print(json.load(sys.stdin)['calc_id'])")
echo "calc_id: $CALC_ID"

# Ver mix disponíveis
echo "$CALC" | python3 -c "
import sys,json; d=json.load(sys.stdin)
for p in d['plans']['300']:
    print(p['title'], [v['percentage'] for v in p['variants']])
"

# 2. Criar pedido (só com phone obrigatório)
curl -s -X POST "$BASE/api/v1/orders" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d "{\"calc_id\":$CALC_ID,\"mix_percentages\":[100],\"period\":14,
       \"partner_phone\":\"+351912345678\",\"order_type\":\"trial\",\"delivery_number\":1}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('client_secret:', d.get('stripe_client_secret','')[:30])"
```

---

## 13. Erros comuns e como resolver

| Erro | Causa | Solução |
|---|---|---|
| `422 MISSING_REQUIRED_ORDER_FIELDS ["tutor_phone"]` | `phone` não enviado | Incluir `partner_phone` no `/orders` |
| `422 VALIDATION_ERROR partner_email "not a valid email"` | Email enviado como `""` | Enviar `null` ou omitir o campo se vazio |
| `422 VALIDATION_ERROR "Informe calc_id + products_id"` | Campo errado no recalculate | `/recalculate` usa `products_id` (com `s`); `/orders` usa `products_id` também |
| `502 company inconsistencies pricelist` | Pricelist de empresa errada | Automático via tenant — verificar se token corresponde ao tenant certo |
| Recalculate devolve valores zerados | Leitura da raiz em vez de `raw.result` | Usar `raw.result \|\| raw` |
| Mix 50%/25% não aparecem | calc enviado sem `mix_percentages:[100,50,25]` | Sempre incluir todos os valores no calc inicial |
| Mix 50% não disponível para o pet | Pet com poucos packs (fortnight_packs < 12) | Normal — backend filtra automaticamente; mostrar só o que veio na resposta |
| `payment_link` nulo | `stripe_client_secret` ausente — chave Stripe não configurada | Configurar `stripe_secret_key` no tenant registry |
| `401 Token inválido` | Token errado ou inactivo | Verificar `Authorization: Bearer <TOKEN>` |

---

## 14. Configuração de campos de checkout por tenant (`checkout_fields`)

Cada tenant define quais campos são obrigatórios, opcionais ou ocultados. Esta configuração é lida do tenant registry e aplica-se tanto à validação backend como ao frontend.

### Campos configuráveis

| Chave | Campo de API | Descrição |
|---|---|---|
| `phone` | `partner_phone` | Telefone do tutor |
| `tutor_name` | `partner_name` | Nome do tutor |
| `tutor_email` | `partner_email` | Email do tutor |
| `tax_id` | `cpf` | NIF / CPF |
| `pet_name` | `pet_name` | Nome do pet |

### Modos disponíveis

| Modo | Backend | Frontend |
|---|---|---|
| `required` | Validado — pedido falha se ausente | Campo visível com `required` |
| `optional` | Não validado — aceite ou ignorado | Campo visível sem `required` |
| `hidden` | Ignorado | Campo ocultado |

### Default quando não configurado

**`optional`** — qualquer campo não listado é tratado como opcional.  
Excepção: `phone` tem default `required` quando configurado como tal.

### Configuração actual PT

```json
{
  "phone":       "required",
  "tutor_name":  "optional",
  "tutor_email": "optional",
  "tax_id":      "optional",
  "pet_name":    "optional"
}
```

### Alterar configuração

Via tenant registry (admin):

```bash
curl -X PUT https://stg.meajudamaia.com/registry/tenant/9 \
  -H "X-Admin-Token: <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"checkout_fields": {"phone":"required","tutor_email":"required","tax_id":"optional"}}'
```

---

## 15. Endpoints adicionais

### Carrinho multi-pet

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/v1/calc/cart/{cart_id}` | Recuperar todos os cálculos de um carrinho |
| `POST` | `/api/v1/calc/cart/freight` | Calcular frete para carrinho multi-pet (`{ cart_id, cep }`) |

### Pedidos

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/v1/orders` | Listar pedidos do tenant |
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
