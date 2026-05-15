# Aquinta PT — Demo Site

App de exemplo que demonstra o fluxo completo da API Aquinta Portugal:

1. **Calc** — formulário com dados do pet → `POST /api/v1/calc`
2. **Recalc** — seleção de dieta e mix feeding → `POST /api/v1/calc/recalculate`
3. **Freight** — frete automático por CEP → `POST /api/v1/calc/freight`
4. **Order** — cria pedido e obtém link Stripe → `POST /api/v1/orders`
5. **Redirect** → `payment_link` (Stripe Checkout)

## Como usar

Abre `index.html` directamente no browser (não precisa de servidor).

Ou serve localmente:
```bash
npx serve .
# ou
python3 -m http.server 3000
```

## Configuração

Edita as constantes no topo de `app.js`:

```js
const API_BASE = "https://stg.meajudamaia.com";
const API_KEY  = "sk_...";  // API key PT do tenant-registry
```

## API Reference

Documentação completa: https://stg.meajudamaia.com/gw/docs

Setup guide: https://stg.meajudamaia.com/docs/guide/SETUP_GUIDE
