# Probar `/charge` desde Postman

## Antes de empezar

```
npm run dev
```

La consola tiene que mostrar el breaker activo y el puerto:

```
[circuit breaker]: active, initial state: { payments: 'CLOSED' }
[stripe]: stub server listening on port: 3000
```

El host y el puerto salen de tu `.env` (`hostname` y `port`). Los ejemplos de acá usan `127.0.0.1:3000`.

## La request

| | |
|---|---|
| **Método** | `POST` |
| **URL** | `http://127.0.0.1:3000/charge` |
| **Headers** | `Content-Type: application/json` |
| **Body** | pestaña **raw**, tipo **JSON** |

Dos cosas que conviene saber antes de pelearte con Postman:

- **El header es obligatorio.** Sin `Content-Type: application/json`, Express no parsea el body y la respuesta es `400 body must be an object`. En Postman se agrega solo al elegir raw + JSON, pero si venís de copiar una request vieja, revisalo.
- **No hay autenticación.** Ningún endpoint valida API key ni token, así que no hace falta tocar la pestaña Authorization.

## Body de ejemplo

```json
{
  "idempotency_key": "req-001",
  "customer_id": "cus_123",
  "amount": "19.99",
  "currency": "USD",
  "method": {
    "type": "card",
    "brand": "visa",
    "last4": "4242",
    "exp_month": 12,
    "exp_year": 2030,
    "holder": "Agustin Tisera"
  },
  "description": "order 55",
  "metadata": { "order_id": "55" }
}
```

## Los campos

| Campo | Formato |
|---|---|
| `idempotency_key` | string, no vacío |
| `customer_id` | string, no vacío |
| `amount` | **string** decimal, hasta 2 decimales, mayor a cero |
| `currency` | `USD`, `EUR` o `ARS` |
| `method.type` | `card` |
| `method.brand` | `visa`, `mastercard` o `amex` |
| `method.last4` | string de 4 dígitos |
| `method.exp_month` | número entero, 1 a 12 |
| `method.exp_year` | número entero, 2000 a 2099 |
| `method.holder` | string, no vacío |
| `description` | opcional: string, o directamente no lo mandes |
| `metadata` | opcional: objeto con todos sus valores string |

El error más común es mandar `"amount": 19.99` sin comillas. Va como string.

## Qué vas a recibir

| Si mandás | Respuesta |
|---|---|
| El body de ejemplo tal cual | `200` con el charge completo — ver abajo |
| `"amount": 19.99` (número) | `400` `{"error":"amount must be a string"}` |
| `"currency": "BRL"` | `400` `{"error":"currency must be one of: USD, EUR, ARS"}` |
| `"brand": "diners"` | `400` `{"error":"method.brand must be one of: visa, mastercard, amex"}` |
| `"last4": "42"` | `400` `{"error":"method.last4 must be 4 digits"}` |
| Sin el header `Content-Type` | `400` `{"error":"body must be an object"}` |
| JSON roto (una llave de más) | `400` con una **página HTML** de Express, no JSON |
| Otra URL, ej. `/nope` | `404` `{"error":"Bad request"}` |

Los mensajes apuntan siempre al campo exacto, con el path anidado en los de la tarjeta. Un body con varios errores devuelve solo el primero que se encuentra.

## La respuesta de un cobro exitoso

```json
{
  "id": "ch_8ef2xghg9p",
  "object": "charge",
  "amount": 1999,
  "currency": "usd",
  "customer": "cus_123",
  "status": "succeeded",
  "paid": true,
  "balance_transaction": {
    "id": "txn_gfh6mgs8lp",
    "amount": 1999,
    "fee": 88,
    "net": 1911
  }
}
```

Recortado: la respuesta real trae también `captured`, `created`, `livemode`, `payment_method_details` y `metadata`.

Dos cosas que confunden al leerla:

- **Los montos vienen en unidades menores.** Mandaste `"19.99"` y te vuelve `1999`. El procesador trabaja en centavos.
- **El `fee` y el `net` no son tuyos.** Los calcula el procesador (2.9% + 30) y los reporta en `balance_transaction`: `1999 - 88 = 1911` es lo que realmente cobrás.

## Forzar los caminos de error

| Cambio en el body | Respuesta |
|---|---|
| `last4` a `"0002"` | `402` `{"error":"Card declined"}` — tarjeta rechazada, imita las de prueba de Stripe |
| `exp_year` a `2020` | `422` — tarjeta vencida, la corta tu validación de negocio |
| `amount` a `"50"` con `currency` `"ARS"` | `422` — abajo del mínimo de 100 ARS |

Los dos `422` hoy devuelven `{"error":"undefined"}`: el mensaje se arma con un `forEach` en `chargePayment` y `forEach` no devuelve nada. El status sí es correcto.
