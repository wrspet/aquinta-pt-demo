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

---

## 1. Configuração e autenticação

```
Base URL:  https://stg.meajudamaia.com
API Key:   sk_Kqb65HTIDXaHc2TlNmvWugo4qRHjDo9fgFVWJRkWveU
```

**Todas as chamadas usam este header:**

```http
Authorization: Bearer sk_Kqb65HTIDXaHc2TlNmvWugo4qRHjDo9fgFVWJRkWveU
Content-Type: application/json
```

A API key determina automaticamente:
- Empresa PT (Aquinta Portugal, company_id=9)
- Moeda EUR
- Gateway de pagamento: Stripe
- Pricelist EUR

> **Segurança:** Em produção a API key deve viver no servidor, nunca exposta no frontend.

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
| `nif` | text | NIF português — 9 dígitos (ex: `234567891`) |
| `cep` | text | código postal — formato `XXXX-XXX` (ex: `1000-001`) |

> **Crítico — lê com atenção:**  
> `tutor_name`, `phone` e `nif` **têm de ir no payload do `/calc`**.  
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
  "nif":           "234567891",
  "cep":           "1000-001",
  "package_sizes": [300],
  "periods":       [15],
  "mix_percentages": [100]
}
```

**Campos obrigatórios mínimos:** `birth_date`, `weight`, `size`, `fitness`, `activity`, `castrated`  
**Obrigatórios para criar pedido depois:** `tutor_name`, `phone`, `nif`, `tutor_email`

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
      },
      {
        "id": 13669,
        "title": "Chicken",
        "product_energy": 900.0,
        "variants": [ { "percentage": 100, "fortnight_packs": 7, "fortnight_price": 45.5, "..." : "..." } ]
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
state.calcId     = result.calc_id           // usado em todos os passos seguintes
state.calcResult = result                   // para renderizar os planos
state.selectedIds = new Set(
  result.plans["300"].map(p => p.id)        // seleccionar todas as dietas por defeito
)
```

---

## 5. Passo 3 — Mostrar resultados e ler a resposta

### Como ler preços e porções

Os dados estão em `plans["300"][i]` (indexado por tamanho de pacote, aqui sempre `"300"`).  
Cada produto tem `variants[]` com dados por período:

| Campo na variant | Período |
|---|---|
| `fortnight_packs` · `fortnight_price` | **15 dias** (quinzenal) |
| `monthly_packs` · `monthly_price` | **30 dias** (mensal) |
| `daily_grams` · `daily_measures` | diário (igual para ambos) |

Para **15 dias**, usa `distribution_summary.diets` — tem os valores mais precisos:

```js
// Para quinzenal (15 dias):
const dist = result.distribution_summary.diets.find(d => d.product_id === productId)
const packs    = dist?.packs             // número de packs
const subtotal = dist?.subtotal_discounted  // preço com desconto

// Para mensal (30 dias):
const variant = product.variants.find(v => v.percentage === mixPercentage)
const packs    = variant?.monthly_packs
const subtotal = variant?.monthly_price_discount
```

### Mix feeding

`mix_percentages` define a percentagem da dieta diária coberta pela Aquinta:

| Valor | Significado |
|---|---|
| `100` | Dieta completa Aquinta |
| `50` | 50% Aquinta + 50% ração do cliente |
| `25` | 25% Aquinta + 75% ração do cliente |

Afecta gramas diários e número de packs — não é uma mistura entre sabores.

---

## 6. Passo 4 — Recalcular (opcional) `POST /api/v1/calc/recalculate`

Usado quando o utilizador altera as dietas seleccionadas ou o mix feeding.

### Payload

```json
{
  "calc_id":         115,
  "products_id":     [13670],
  "mix_percentages": [100]
}
```

> ⚠️ O campo chama-se **`products_id`** (com `s` antes de `_id`), não `product_ids`.

### Resposta — atenção ao wrapper

A resposta tem uma estrutura diferente do `/calc`:

```json
{
  "calc_id": 116,
  "result": {
    "calories": 225.0,
    "plans": { "300": [...] },
    "distribution_summary": { "..." : "..." }
  }
}
```

Os dados estão em `raw.result`, não na raiz. O `calc_id` foi actualizado:

```js
const raw       = await api("POST", "/api/v1/calc/recalculate", payload)
const result    = raw.result || raw          // dados do plano
const newCalcId = raw.calc_id || result.calc_id
if (newCalcId) state.calcId = newCalcId      // IMPORTANTE: actualizar calc_id
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

Somar `freight.value` ao total mostrado ao utilizador.

---

## 8. Passo 6 — Criar pedido `POST /api/v1/orders`

### Payload

```json
{
  "calc_id":         116,
  "products_id":     [13670],
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

**Campos obrigatórios:**
- `calc_id` — ID do cálculo (ou do último recálculo)
- `partner_email` / `partner_name` / `partner_phone` — identificação do cliente no Odoo
- `tutor_email` / `tutor_name` / `tutor_phone` — duplicar os dados do parceiro
- `period` — `15` (quinzenal) ou `30` (mensal)
- `order_type` — `"trial"` para primeira entrega

> **Nota:** `partner_*` e `tutor_*` podem ter os mesmos valores — são campos redundantes por compatibilidade.

### Resposta

```json
{
  "order": {
    "id":           6535,
    "payment_link": "https://checkout.stripe.com/c/pay/cs_test_...",
    "link_stripe":  "https://checkout.stripe.com/c/pay/cs_test_...",
    "confirmed":    false,
    "totals": {
      "total":      91.0,
      "discounted": 91.0
    },
    "items": [
      { "product_id": 13670, "title": "Turkey", "packages": 7, "subtotal": 45.5 }
    ]
  },
  "calc": {
    "id":         116,
    "cart_id":    "cart-abc123",
    "pet_name":   "Bolinha"
  }
}
```

### Como extrair o link

```js
const raw  = await api("POST", "/api/v1/orders", payload)
const o    = raw.order || raw                    // gateway devolve { order: {...}, calc: {...} }
const link = o.payment_link || o.link_stripe     // link Stripe Checkout
```

---

## 9. Passo 7 — Redirecionar para o Stripe

```js
if (link) {
  window.location.href = link   // redireciona para checkout.stripe.com
} else {
  // pedido criado mas sem link — contactar suporte
}
```

Após pagamento, o Stripe notifica via webhook e o pedido no Odoo é confirmado automaticamente.

As URLs de retorno configuradas:
- **Sucesso:** `https://stg.meajudamaia.com/demo/?payment=success`
- **Cancelar:** `https://stg.meajudamaia.com/demo/?payment=cancel`

---

## 10. Estado mínimo da aplicação

```js
const state = {
  calcId:        null,    // ID do cálculo actual (actualizar após recalculate!)
  calcResult:    null,    // resposta completa do /calc ou /recalculate (já em raw.result)
  selectedIds:   new Set(), // IDs das dietas seleccionadas
  mixPercentage: 100,     // 100 | 50 | 25
  period:        "fortnight", // "fortnight" | "monthly"
  freight:       null,    // resposta do /freight ou null
  petData: {              // dados do formulário
    pet_name:      "",
    partner_name:  "",
    partner_email: "",
    partner_phone: "",
    nif:           "",
    cep:           "",
  },
}
```

---

## 11. Exemplos de backend completo

### JavaScript / Node.js (fetch)

```js
const API_BASE = "https://stg.meajudamaia.com"
const API_KEY  = "sk_Kqb65HTIDXaHc2TlNmvWugo4qRHjDo9fgFVWJRkWveU"

const headers = {
  "Authorization": `Bearer ${API_KEY}`,
  "Content-Type":  "application/json",
}

async function calcularPlano(dadosPet) {
  const res = await fetch(`${API_BASE}/api/v1/calc`, {
    method:  "POST",
    headers,
    body:    JSON.stringify(dadosPet),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function recalcular({ calcId, productIds, mixPercentage = 100 }) {
  const res = await fetch(`${API_BASE}/api/v1/calc/recalculate`, {
    method:  "POST",
    headers,
    body:    JSON.stringify({
      calc_id:         calcId,
      products_id:     productIds,   // atenção: products_id, não product_ids
      mix_percentages: [mixPercentage],
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  const raw = await res.json()
  return {
    calcId:  raw.calc_id || raw.result?.calc_id || calcId,
    result:  raw.result  || raw,
  }
}

async function calcularFrete({ cep, calcId }) {
  const res = await fetch(`${API_BASE}/api/v1/calc/freight`, {
    method:  "POST",
    headers,
    body:    JSON.stringify({ cep, calc_id: calcId }),
  })
  if (!res.ok) return null
  return res.json()   // { value, prazo, carrier_name }
}

async function criarPedido({ calcId, productIds, mixPercentage, period, tutor, cep }) {
  const res = await fetch(`${API_BASE}/api/v1/orders`, {
    method:  "POST",
    headers,
    body:    JSON.stringify({
      calc_id:         calcId,
      products_id:     productIds,
      mix_percentages: [mixPercentage],
      period:          period,        // 15 ou 30
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
  return {
    orderId:     o.id,
    paymentLink: o.payment_link || o.link_stripe,
  }
}

// ── Fluxo completo ────────────────────────────────────────────────────────────
async function fluxoCompleto() {
  // 1. Calcular
  const calc = await calcularPlano({
    birth_date:    "2021-04-10",
    weight:        4.2,
    size:          "mini",
    fitness:       "normal",
    activity:      "normal",
    castrated:     true,
    pet_name:      "Bolinha",
    tutor_name:    "Ana Ferreira",
    tutor_email:   "ana@email.pt",
    phone:         "+351912345678",
    nif:           "234567891",
    cep:           "1000-001",
    package_sizes: [300],
    periods:       [15],
    mix_percentages: [100],
  })
  console.log("calc_id:", calc.calc_id)

  // 2. (Opcional) Recalcular só com Turkey
  const recalc = await recalcular({
    calcId:       calc.calc_id,
    productIds:   [13670],
    mixPercentage: 100,
  })
  console.log("novo calc_id:", recalc.calcId)

  // 3. (Opcional) Frete
  const frete = await calcularFrete({ cep: "1000-001", calcId: recalc.calcId })
  console.log("frete:", frete?.value, "EUR")

  // 4. Criar pedido
  const pedido = await criarPedido({
    calcId:       recalc.calcId,
    productIds:   [13670],
    mixPercentage: 100,
    period:       15,
    tutor: {
      name:    "Ana Ferreira",
      email:   "ana@email.pt",
      phone:   "+351912345678",
      petName: "Bolinha",
    },
    cep: "1000-001",
  })
  console.log("order_id:", pedido.orderId)
  console.log("payment_link:", pedido.paymentLink)

  // 5. Redirecionar
  // window.location.href = pedido.paymentLink
}
```

---

### Python

```python
import httpx

API_BASE = "https://stg.meajudamaia.com"
API_KEY  = "sk_Kqb65HTIDXaHc2TlNmvWugo4qRHjDo9fgFVWJRkWveU"
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


def criar_pedido(
    calc_id: int,
    product_ids: list,
    mix_percentage: int,
    period: int,
    tutor_name: str,
    tutor_email: str,
    tutor_phone: str,
    pet_name: str,
    cep: str | None = None,
) -> dict:
    payload = {
        "calc_id":         calc_id,
        "products_id":     product_ids,
        "mix_percentages": [mix_percentage],
        "period":          period,
        "partner_email":   tutor_email,
        "partner_name":    tutor_name,
        "partner_phone":   tutor_phone,
        "tutor_email":     tutor_email,
        "tutor_name":      tutor_name,
        "tutor_phone":     tutor_phone,
        "pet_name":        pet_name,
        "order_type":      "trial",
        "delivery_number": 1,
    }
    if cep:
        payload["cep"] = cep

    r = httpx.post(f"{API_BASE}/api/v1/orders", json=payload, headers=HEADERS, timeout=60)
    r.raise_for_status()
    raw = r.json()
    o   = raw.get("order") or raw
    return {
        "order_id":     o.get("id"),
        "payment_link": o.get("payment_link") or o.get("link_stripe"),
    }


# ── Fluxo completo ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # 1. Calcular
    calc = calcular({
        "birth_date":      "2021-04-10",
        "weight":          4.2,
        "size":            "mini",
        "fitness":         "normal",
        "activity":        "normal",
        "castrated":       True,
        "pet_name":        "Bolinha",
        "tutor_name":      "Ana Ferreira",
        "tutor_email":     "ana@email.pt",
        "phone":           "+351912345678",
        "nif":             "234567891",
        "cep":             "1000-001",
        "package_sizes":   [300],
        "periods":         [15],
        "mix_percentages": [100],
    })
    print("calc_id:", calc["calc_id"])
    dietas = calc["plans"]["300"]
    print("dietas:", [d["title"] for d in dietas])

    # 2. (Opcional) Recalcular — só primeira dieta
    recalc = recalcular(calc["calc_id"], [dietas[0]["id"]])
    print("recalc calc_id:", recalc["calc_id"])

    # 3. (Opcional) Frete
    envio = frete("1000-001", recalc["calc_id"])
    print("frete:", envio)

    # 4. Criar pedido
    pedido = criar_pedido(
        calc_id=recalc["calc_id"],
        product_ids=[dietas[0]["id"]],
        mix_percentage=100,
        period=15,
        tutor_name="Ana Ferreira",
        tutor_email="ana@email.pt",
        tutor_phone="+351912345678",
        pet_name="Bolinha",
        cep="1000-001",
    )
    print("order_id:", pedido["order_id"])
    print("payment_link:", pedido["payment_link"])

    # 5. Redirecionar o utilizador para pedido["payment_link"]
```

---

### cURL (passo a passo)

```bash
API_KEY="sk_Kqb65HTIDXaHc2TlNmvWugo4qRHjDo9fgFVWJRkWveU"
BASE="https://stg.meajudamaia.com"

# ── 1. Calcular ───────────────────────────────────────────────────────────────
curl -s -X POST "$BASE/api/v1/calc" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
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
    "nif":           "234567891",
    "cep":           "1000-001",
    "package_sizes": [300],
    "periods":       [15],
    "mix_percentages": [100]
  }' | python3 -m json.tool
# → guarda calc_id da resposta

CALC_ID=115   # substituir pelo valor real

# ── 2. (Opcional) Recalcular ──────────────────────────────────────────────────
curl -s -X POST "$BASE/api/v1/calc/recalculate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"calc_id\":         $CALC_ID,
    \"products_id\":     [13670],
    \"mix_percentages\": [100]
  }" | python3 -m json.tool
# → guarda o novo calc_id de raw.calc_id

NEW_CALC_ID=116   # substituir pelo valor real

# ── 3. (Opcional) Frete ───────────────────────────────────────────────────────
curl -s -X POST "$BASE/api/v1/calc/freight" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"cep\": \"1000-001\", \"calc_id\": $NEW_CALC_ID}" | python3 -m json.tool

# ── 4. Criar pedido ───────────────────────────────────────────────────────────
curl -s -X POST "$BASE/api/v1/orders" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"calc_id\":         $NEW_CALC_ID,
    \"products_id\":     [13670],
    \"mix_percentages\": [100],
    \"period\":          15,
    \"partner_email\":   \"ana@email.pt\",
    \"partner_name\":    \"Ana Ferreira\",
    \"partner_phone\":   \"+351912345678\",
    \"tutor_email\":     \"ana@email.pt\",
    \"tutor_name\":      \"Ana Ferreira\",
    \"tutor_phone\":     \"+351912345678\",
    \"pet_name\":        \"Bolinha\",
    \"order_type\":      \"trial\",
    \"delivery_number\": 1,
    \"cep\":             \"1000-001\"
  }" | python3 -c "
import sys, json
d = json.load(sys.stdin)
o = d.get('order', d)
print('order_id:    ', o.get('id'))
print('payment_link:', o.get('payment_link') or o.get('link_stripe'))
"
# → redirecionar o utilizador para payment_link
```

---

## 12. Erros comuns e como resolver

| Erro | Causa | Solução |
|---|---|---|
| `422 MISSING_REQUIRED_ORDER_FIELDS ["tutor_phone","cpf","tutor_name"]` | `tutor_name`, `phone` ou `nif` **não foram enviados no `/calc`** | Incluir esses campos no payload do `POST /api/v1/calc` |
| `422 VALIDATION_ERROR "Informe calc_id + products_id"` | Campo enviado como `product_ids` em vez de `products_id` | Usar `products_id` (com `s`) no recalculate e no orders |
| `502 company inconsistencies pricelist` | Pricelist de empresa errada | Configurado automaticamente pelo gateway via tenant config |
| Resposta do recalculate sem `plans` | Leitura da raiz em vez de `raw.result` | Usar `raw.result \|\| raw` |
| `payment_link` vazio ou nulo | `raw.order.payment_link` em vez de `raw.payment_link` | Usar `(raw.order \|\| raw).payment_link` |
| `401 API key inválida ou revogada` | API key errada ou inactiva | Verificar o header `Authorization: Bearer sk_...` |

---

## Referências

- **Demo ao vivo:** https://stg.meajudamaia.com/demo/
- **Swagger UI:** https://stg.meajudamaia.com/gw/docs
- **Swagger spec (JSON):** https://stg.meajudamaia.com/gw/openapi.json
