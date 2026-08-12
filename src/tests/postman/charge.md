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
| El body de ejemplo tal cual | `200` con el `ChargeResult` — ver abajo |
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
  "status": "charged",
  "processor_payment_id": "ch_8ef2xghg9p",
  "currency": "USD",
  "amount": "19.99",
  "fee": "0.88",
  "net": "19.11",
  "created_at": "2026-08-12T14:31:07.000Z"
}
```

Esto ya **no** es la respuesta de Stripe: es un `ChargeResult`, un modelo del dominio. El adapter traduce y nada del formato del procesador sobrevive a ese cruce.

Si venís de la versión anterior de este doc, cambió todo lo que se veía raro:

- **Los montos vuelven en unidades mayores**, como strings decimales. Mandaste `"19.99"` y te vuelve `"19.99"`, no `1999`. Los centavos mueren en el adapter.
- **`currency` vuelve en mayúscula** (`USD`), aunque el procesador la devuelva en minúscula.
- **`fee` y `net` están al mismo nivel**, ya no anidados en `balance_transaction`. Los sigue calculando el procesador (2.9% + 30): `19.99 - 0.88 = 19.11` es lo que realmente cobrás.
- **No hay `id`, `object`, `paid`, `captured` ni `livemode`.** El id del procesador viaja como `processor_payment_id`, el resto no le interesa a tu dominio.

## Forzar los caminos de error

| Cambio en el body | Respuesta |
|---|---|
| `last4` a `"0002"` | `402` con un `ChargeResult` `failed` — ver abajo |
| `exp_year` a `2020` | `422` — tarjeta vencida, la corta tu validación de negocio |
| `amount` a `"50"` con `currency` `"ARS"` | `422` — abajo del mínimo de 100 ARS |

**La tarjeta rechazada** ya no devuelve un `{"error": ...}`. Devuelve el resultado completo, porque un rechazo es un resultado y no un error:

```json
{
  "status": "failed",
  "processor_payment_id": "ch_2k9xmqv1ab",
  "failure": {
    "code": "card_declined",
    "message": "Your card was declined.",
    "retryable": false
  }
}
```

**Los `422` ya devuelven el detalle.** El `{"error":"undefined"}` era un `forEach` que no retornaba nada; ahora las violaciones viajan como array y salen todas juntas, no solo la primera:

```json
{
  "error": [
    { "rule": "card_expired", "message": "card expired on 12/2020" }
  ]
}
```

Mandá `exp_year: 2020` **y** `amount: "50"` con `ARS` en la misma request y vas a ver las dos reglas en el array. Ojo con la diferencia: el `400` de parseo corta en el primer campo malo, el `422` de negocio evalúa todas las reglas.

## Los dos 503

| Caso | Cómo se dispara |
|---|---|
| El procesador no contesta (5xx o timeout) | El gateway tira, el handler responde `503`. El detalle queda en la consola, no en la respuesta |
| El breaker corta el paso | Requiere estado `OPEN` en `payments` |

Ninguno de los dos es alcanzable desde Postman todavía: el stub siempre contesta y el breaker arranca en `CLOSED` y nunca transiciona. Para verlos hay que forzar el stub a devolver 503 a mano.
