# Aquinta PT — Demo Site (Guia de Implementação Frontend)

Aplicação de exemplo que demonstra o fluxo completo da API Aquinta Portugal:
**Formulário → Cálculo → Recálculo → Frete → Criação de pedido → Link Stripe**

---

## Configuração

```js
// app.js — topo do ficheiro
const API_BASE = "https://stg.meajudamaia.com";
const API_KEY  = "sk_Kqb65HTIDXaHc2TlNmvWugo4qRHjDo9fgFVWJRkWveU";
```

O token é uma **API key** (não JWT). Determina automaticamente a empresa PT (EUR, Stripe, produtos Chicken + Turkey). Nunca expira. Deve viver no servidor — neste demo está no frontend por ser um site de demonstração.

Todas as chamadas usam o header:
```
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

---

## Fluxo de ecrãs

```
[STEP 1 — Formulário]
       ↓  POST /api/v1/calc
[STEP 2 — Resultados / Plano]
       ↓  (opcional) POST /api/v1/calc/freight
       ↓  (opcional) POST /api/v1/calc/recalculate  ← edição de dieta / mix
       ↓  click "Encomendar"
[STEP 3 — Confirmação]
       ↓  POST /api/v1/orders
       ↓  redirect → payment_link (Stripe Checkout)
```

---

## Passo 1 — Formulário e dados a recolher

O formulário recolhe dois grupos de dados:

### Dados do pet (enviados no cálculo)

| Campo HTML | Variável JS | Enviado em | Tipo |
|---|---|---|---|
| `birth_date` | `pet.birth_date` | calc | string YYYY-MM-DD |
| `weight` | `pet.weight` | calc | float (kg) |
| `size` (botões) | `pet.size` | calc | `mini`\|`small`\|`medium`\|`big`\|`giant` |
| `fitness` (botões) | `pet.fitness` | calc | `skinny`\|`normal`\|`fat` |
| `activity` (botões) | `pet.activity` | calc | `inactive`\|`normal`\|`active` |
| `castrated` (botões) | `pet.castrated` | calc | boolean |
| `pet_name` | `pet.pet_name` | calc | string |

### Dados do tutor (enviados no cálculo e no pedido)

| Campo HTML | Variável JS | Enviado em | Tipo |
|---|---|---|---|
| `partner_name` | `pet.tutor_name` | **calc + pedido** | string |
| `partner_email` | `pet.tutor_email` | **calc + pedido** | string (email) |
| `partner_phone` | `pet.phone` | **calc + pedido** | string (ex: +351912345678) |
| `nif` | `pet.nif` | **calc** | string 9 dígitos |
| `cep` | `petData.cep` | pedido + frete | string (ex: 1000-001) |

> **Crítico:** `tutor_name`, `phone` e `nif` devem ir no **cálculo** (`POST /api/v1/calc`).
> O plan-builder armazena o `request_json` e valida esses campos ao criar o pedido.
> Se chegarem apenas no `POST /api/v1/orders` e não no calc, o pedido falha com
> `MISSING_REQUIRED_ORDER_FIELDS`.

---

## Passo 2 — `POST /api/v1/calc`

```json
{
  "birth_date": "2024-01-01",
  "size": "mini",
  "weight": 3.0,
  "fitness": "normal",
  "activity": "normal",
  "castrated": true,
  "pet_name": "Buddy",
  "tutor_name": "João Silva",
  "tutor_email": "tutor@email.com",
  "phone": "+351912345678",
  "nif": "123456789"
}
```

### Resposta

```json
{
  "calc_id": 33,
  "calories": 200.6,
  "plans": {
    "300": [
      {
        "id": 13670,
        "title": "Turkey",
        "product_energy": 1010,
        "variants": [
          {
            "percentage": 100,
            "daily_grams": 222.0,
            "daily_measures": 1.5,
            "fortnight_packs": 6,
            "fortnight_price": 39.0,
            "fortnight_price_discount": 39.0,
            "monthly_packs": 11,
            "monthly_price": 71.5,
            "monthly_price_discount": 71.5
          }
        ]
      },
      { "id": 13669, "title": "Chicken", ... }
    ]
  },
  "distribution_summary": {
    "totals": { "packs": 6, "estimated_days": 16.2 },
    "diets": [
      {
        "product_id": 13670,
        "grams_per_day": 222.0,
        "measures_per_day": 1.5,
        "packs": 6,
        "subtotal_discounted": 39.0
      }
    ]
  }
}
```

### Como ler a resposta

- `calc_id` → guardar em estado para chamadas seguintes
- `plans["300"]` → lista de dietas para pacote de 300g
- Cada dieta tem `variants[]` com dados por `percentage` (mix feeding)
- **Para mostrar no ecrã:** usar `distribution_summary.diets` para quinzenal (mais preciso) ou `variants[].fortnight_*` / `monthly_*` para mensal
- Seleccionar por defeito **todas** as dietas disponíveis (`selectedIds = new Set(plans["300"].map(p => p.id))`)

---

## Passo 2b — `POST /api/v1/calc/recalculate` (opcional — edição de plano)

Usado quando o utilizador altera as dietas ou o mix feeding.

```json
{
  "calc_id": 33,
  "products_id": [13669],
  "mix_percentages": [50]
}
```

> **Atenção ao alias:** o campo chama-se `products_id` (com `s` antes de `_id`), não `product_ids`.

### Resposta

A resposta tem um wrapper — os dados estão em `result`, não na raiz:

```json
{
  "calc_id": 34,
  "result": {
    "calories": 200.6,
    "plans": { "300": [...] },
    "distribution_summary": { ... }
  }
}
```

Código de leitura:
```js
const result   = raw.result || raw;
const newCalcId = raw.calc_id || result.calc_id;
if (newCalcId) state.calcId = newCalcId;
state.calcResult = result;
```

### Mix feeding

`mix_percentages` define a **percentagem da dieta diária** coberta pelo produto Aquinta. O restante é ração do cliente.

| Valor | Significado |
|---|---|
| `[100]` | Dieta completa Aquinta (1 sabor) |
| `[50]` | 50% Aquinta + 50% ração (2 sabores) |
| `[25]` | 25% Aquinta + 75% ração (4 sabores) |

Afecta directamente os gramas diários e o número de pacotes — **não é uma mistura entre dietas**.

---

## Passo 3 — `POST /api/v1/calc/freight` (opcional)

```json
{ "cep": "1000-001", "calc_id": 33 }
```

Resposta:
```json
{
  "value": 5.99,
  "prazo": 4,
  "carrier_name": "Portugal Continental"
}
```

O frete deve ser somado ao total mostrado no ecrã.

---

## Passo 4 — `POST /api/v1/orders`

```json
{
  "calc_id": 33,
  "products_id": [13669, 13670],
  "mix_percentages": [100],
  "period": 15,
  "partner_email": "tutor@email.com",
  "partner_name": "João Silva",
  "partner_phone": "+351912345678",
  "tutor_email": "tutor@email.com",
  "tutor_name": "João Silva",
  "tutor_phone": "+351912345678",
  "pet_name": "Buddy",
  "order_type": "trial",
  "delivery_number": 1,
  "cep": "1000-001"
}
```

### Resposta PT (Stripe)

```json
{
  "payment_link": "https://checkout.stripe.com/pay/cs_live_...",
  "link_stripe": "https://checkout.stripe.com/pay/cs_live_...",
  "stripe_session_id": "cs_live_...",
  "orders": [{ "order": { "id": 1082, "payment_link": "..." } }]
}
```

Redirecionar o utilizador para `payment_link`. Após pagamento, o Stripe notifica via webhook e o pedido no Odoo é confirmado automaticamente.

### Erros comuns

| Código / Erro | Causa | Solução |
|---|---|---|
| `422 MISSING_REQUIRED_ORDER_FIELDS` | `tutor_name`, `phone` ou `nif` não foram enviados no cálculo original | Incluir estes campos em `POST /api/v1/calc` |
| `422 VALIDATION_ERROR "Informe calc_id + products_id"` | Campo enviado como `product_ids` em vez de `products_id` | Usar o alias `products_id` no recalculate |

---

## Estado da aplicação

```js
const state = {
  petData:       {},    // dados do formulário (partner_name, partner_email, partner_phone, pet_name, cep)
  calcResult:    null,  // resposta do /calc ou /recalculate (já extraída de raw.result)
  calcId:        null,  // ID do cálculo actual (actualizado após recalculate)
  period:        "fortnight",  // "fortnight" | "monthly"
  freight:       null,  // resposta do /freight
  editing:       false, // modo edição de plano activo
  selectedIds:   new Set(), // IDs das dietas seleccionadas
  mixPercentage: 100,   // mix feeding actual
};
```

---

## Como correr localmente

```bash
cd aquinta-pt-demo
python3 -m http.server 3000
# ou
npx serve .
```

O site está também disponível em:
```
https://stg.meajudamaia.com/demo/
```

---

## Referência completa da API

- **Swagger UI:** https://stg.meajudamaia.com/gw/docs
- **Guia completo:** https://stg.meajudamaia.com/docs/guide/SETUP_GUIDE *(requer autenticação Odoo)*
