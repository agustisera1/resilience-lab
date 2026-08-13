# Probar `/refund` desde Postman

## Antes de empezar

```
npm run dev
```

Igual que en [charge.md](./charge.md): host y puerto salen del `.env`, los ejemplos usan `127.0.0.1:3000`, el header `Content-Type: application/json` es obligatorio y no hay autenticación.

**Un refund necesita un cobro previo.** El stub guarda en memoria los charges que crea, así que primero mandá un `/charge`, copiate el `processor_payment_id` de la respuesta y usalo acá. Si reiniciás `npm run dev`, esos charges se pierden y cualquier id viejo pasa a ser `resource_missing`.

## La request

| | |
|---|---|
| **Método** | `POST` |
| **URL** | `http://127.0.0.1:3000/refund` |
| **Headers** | `Content-Type: application/json` |
| **Body** | pestaña **raw**, tipo **JSON** |

## Body de ejemplo

```json
{
  "idempotency_key": "ref-001",
  "payment_id": "ch_2s4edizoiq",
  "amount": "5.00",
  "reason": "requested_by_customer",
  "metadata": { "order_id": "55" }
}
```

## Los campos

| Campo | Formato |
|---|---|
| `idempotency_key` | string, no vacío |
| `payment_id` | string, no vacío: el `processor_payment_id` que te devolvió `/charge` |
| `amount` | opcional: **string** decimal, hasta 2 decimales, mayor a cero. Si no lo mandás, se devuelve todo lo que quede |
| `reason` | opcional: string, o directamente no lo mandes |
| `metadata` | opcional: objeto con todos sus valores string |

Dos diferencias con `/charge` que conviene tener a mano:

- **`amount` es opcional acá.** No mandarlo no es un error: es un refund total. Mandarlo en `null` hace lo mismo.
- **No se manda `currency` ni el método de pago.** Los dos salen del cobro original, no los podés cambiar en el refund.

Sobre `payment_id`: todavía no hay un repositorio de pagos, así que el id que tenés en la mano es el del procesador. Cuando exista el store, esto va a pasar a ser el id propio y el adapter lo va a traducir.

## Qué vas a recibir

Sobre un cobro de `"19.99"` USD, refund parcial de `"5.00"`:

```json
{
  "status": "refunded",
  "processor_refund_id": "re_8hbnx7lf70",
  "processor_payment_id": "ch_2s4edizoiq",
  "currency": "USD",
  "amount": "5.00",
  "created_at": "2026-08-12T19:30:19.000Z"
}
```

Como en el cobro, esto es un `RefundResult` del dominio y no la respuesta del procesador: montos en unidades mayores como string, `currency` en mayúscula, fecha ISO. El `balance_transaction` en negativo que devuelve el stub muere en el adapter.

**No viene cuánto queda por devolver.** El procesador no lo reporta en el refund, y el dominio todavía no guarda el pago, así que ese saldo hoy no lo ve nadie de este lado. Lo lleva el stub, y lo vas a notar en el segundo refund.

## La secuencia que conviene probar

Con el mismo `payment_id` de un cobro de `"19.99"`:

| Request | Respuesta |
|---|---|
| 1. `amount: "5.00"` | `200` refund parcial |
| 2. sin `amount` | `200` con `"amount": "14.99"` — devuelve lo que quedaba, no los 19.99 |
| 3. otra vez sin `amount` | `402` `charge_already_refunded` |

```json
{
  "status": "failed",
  "processor_refund_id": null,
  "failure": {
    "code": "charge_already_refunded",
    "message": "Charge ch_2s4edizoiq has already been refunded.",
    "retryable": false
  }
}
```

`processor_refund_id` siempre viene en `null` cuando falla: el procesador no le pone id a un movimiento que no hizo.

## Forzar los caminos de error

| Cambio en el body | Respuesta |
|---|---|
| `payment_id` a `"ch_nope"` | `402` `resource_missing` — `"No such charge: 'ch_nope'"` |
| `amount` mayor a lo que queda | `402` `amount_too_large` |
| `"amount": 5` (número) | `400` `{"error":"amount must be a string"}` |
| `"amount": "0"` | `400` `{"error":"amount must be greater than zero"}` |
| Sin `idempotency_key` | `400` `{"error":"idempotency_key must be a string"}` |
| Sin `payment_id` | `400` `{"error":"payment_id must be a string"}` |
| Otra URL, ej. `/nope` | `404` `{"error":"Bad request"}` |

El `amount_too_large` habla en unidades menores, porque el mensaje lo escribe el procesador y el adapter lo pasa tal cual:

```json
{
  "status": "failed",
  "processor_refund_id": null,
  "failure": {
    "code": "amount_too_large",
    "message": "Refund amount (99900) is greater than the 20000 left on charge ch_pib6y3vvbu.",
    "retryable": false
  }
}
```

Ojo con la diferencia de estatus respecto de `/charge`: acá un `402` no es solo "te rechazaron la tarjeta". Es todo lo que el procesador contestó que no, incluido un id que no existe. La request llegó y hubo respuesta, así que es un resultado y no un error.

## El 422 que hoy no vas a ver

`/charge` tiene reglas de negocio propias (tarjeta vencida, mínimos y máximos por moneda) y por eso su `422` se alcanza fácil. El refund tiene una sola regla, que el monto sea mayor a cero, y el parseo ya la corta antes con un `400`. Así que el `422` está cableado en el handler pero es inalcanzable hasta que haya reglas que el parser no pueda ver — devolver más de lo cobrado, un pago ya cerrado, una ventana de tiempo.

## Los dos 503

Los mismos que en [charge.md](./charge.md#los-dos-503): el procesador que no contesta y el breaker cortando el paso. Pero se alcanzan distinto.

**El procesador caído no lo podés forzar desde acá.** Las tarjetas mágicas viven en el `last4`, y un refund no manda tarjeta: el procesador resuelve todo desde el cobro original. `/refund` no tiene hoy ningún body que lo haga contestar 5xx.

**El breaker en `OPEN`, en cambio, sí lo vas a ver** — y es el caso más interesante de los dos:

1. Abrí el circuito desde `/charge`, mandando cinco veces con `"last4": "0500"` ([paso a paso](./charge.md#probar-el-circuit-breaker)).
2. Sin tocar nada más, mandá un `/refund` **perfectamente válido**, con un `payment_id` que exista.

Te vuelve `503` instantáneo:

```
[circuit breaker]: fast-fail. Circuit OPEN, retry in 12044ms
```

Nunca se intentó el refund. Lo tumbaron los cobros.

Eso pasa porque **hay un solo breaker para todo el proceso**: `CircuitBreaker.execute` es estático sobre una única instancia en `globalThis`, así que `/charge` y `/refund` comparten estado. Con un solo procesador detrás es hasta razonable — si Stripe se cayó, se cayó para los dos. Deja de serlo apenas haya un segundo proveedor: los fallos de uno te van a cortar el tráfico del otro. El día que pase, esto se resuelve con una instancia por dependencia en vez de una global.

Los 15 segundos de cooldown corren igual, así que después de esperarlos el refund vuelve a pasar sin que tengas que tocar `/charge` de nuevo.
