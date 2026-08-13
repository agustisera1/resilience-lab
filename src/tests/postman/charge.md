# Probar `/charge` desde Postman

## Antes de empezar

```
npm run dev
```

La consola tiene que mostrar el breaker activo y el puerto:

```
[circuit breaker]: active, initial state: CLOSED (threshold: 5, timeout: 10000ms, recovery: 15000ms)
[stripe]: stub server listening on port: 3000
```

Esos tres números mandan en todo lo de la sección del breaker, más abajo: cuántos fallos seguidos lo abren, cuánto espera una respuesta antes de darla por perdida, y cuánto se queda cortado antes de volver a probar.

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
| `last4` a `"0500"` | `503` — el procesador caído, ver [la sección del breaker](#probar-el-circuit-breaker) |
| `last4` a `"0001"` | `503` a los 10s — el procesador que tarda de más |
| `exp_year` a `2020` | `422` — tarjeta vencida, la corta tu validación de negocio |
| `amount` a `"50"` con `currency` `"ARS"` | `422` — abajo del mínimo de 100 ARS |

Las tres tarjetas mágicas (`0002`, `0500`, `0001`) las resuelve el stub, imitando los números de prueba de Stripe. La diferencia entre la primera y las otras dos es la que le importa al breaker: `0002` es **una respuesta** del procesador — te dijo que no, pero te contestó — y las otras dos son **la ausencia de respuesta**. Por eso el rechazo cuenta como llamada exitosa para el breaker y la caída no.

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
| El procesador no contesta (5xx o timeout) | `last4` en `"0500"` o `"0001"`. El gateway tira, el handler responde `503` |
| El breaker corta el paso | Cualquier body, con el breaker en `OPEN` o con un probe en vuelo |

**Los dos devuelven exactamente el mismo body**, así que desde Postman no los distinguís mirando la respuesta:

```json
{ "error": "Payments service is not available" }
```

Se distinguen mirando **la consola**, que es donde queda el detalle. El tiempo de respuesta no alcanza por sí solo: la tarjeta `0500` devuelve su `503` tan rápido como el fast-fail del breaker, porque el stub corta antes del delay. Donde el tiempo sí canta es mandando una tarjeta **buena** — 1500ms si la llamada sale de verdad, ~2ms si el breaker la frenó.

Que el detalle no viaje al cliente es deliberado: por qué se cayó tu proveedor no es asunto de quien te está pagando.

## Probar el circuit breaker

El breaker cuenta un fallo sólo cuando el gateway **tira**. Un `402` de tarjeta rechazada no tira — es un resultado — así que para él cuenta como llamada exitosa. Con `0002` no lo vas a abrir nunca: necesitás `0500`.

Ojo con una cosa mientras probás: **un éxito resetea el contador**. Si mandás cuatro `0500` y en el medio se te escapa un `4242`, el contador vuelve a cero (`failure count reset (was 4/5)` en la consola) y arrancás de nuevo.

### 1. Abrir el circuito

Mandá el body de ejemplo con `"last4": "0500"` **cinco veces seguidas**. Todas devuelven `503`. La consola va marcando la cuenta:

```
[circuit breaker]: call failed after 0ms (state: CLOSED) -> [stripe]: unavailable, 503 Service unavailable
[circuit breaker]: Request failed. Failure count: 1/5
```

Entre medio vas a ver también el stack trace que loguea el handler (`[charge]: Error: ...`). Es ruido esperable: el `catch` del route imprime el error entero antes de responder.

Y en la quinta se abre:

```
[circuit breaker]: Request failed. Failure count: 5/5
[circuit breaker]: CLOSED -> OPEN. Isolating traffic for 15000ms (next attempt at 2026-08-13T14:22:55.031Z)
```

### 2. Ver el fast-fail

Ahora mandá el body **con la tarjeta buena** (`"last4": "4242"`). Debería salir `200` en ~1500ms; en cambio te vuelve `503` casi instantáneo:

```
[circuit breaker]: fast-fail. Circuit OPEN, retry in 13872ms
```

Ésta es la prueba de que el breaker está haciendo su trabajo: la llamada al procesador **nunca se hizo**. Una tarjeta perfectamente válida rebota en tu propio proceso. Es el punto de todo el patrón — dejás de gastar conexiones y latencia contra algo que ya sabés que está caído, y le das aire para recuperarse.

En Postman la señal más clara es el tiempo: mirá el `Time` al lado del status. Pasa de ~1500ms a ~2ms.

### 3. La recuperación

Esperá los **15 segundos** y mandá de nuevo con `4242`:

```
[circuit breaker]: switching to HALF_OPEN. Testing service...
[circuit breaker]: call succeeded in 1504ms (state: HALF_OPEN)
[circuit breaker]: failure count reset (was 5/5)
[circuit breaker]: test successful. HALF_OPEN -> CLOSED. Circuit restored.
```

`200` y el circuito cerrado. Esa primera request después del cooldown es la que paga el costo de averiguar si el procesador volvió.

### 4. La recaída

Misma secuencia, pero en el paso 3 mandá `0500` en vez de `4242`. Un solo fallo alcanza:

```
[circuit breaker]: HALF_OPEN -> OPEN. Isolating traffic for 15000ms (next attempt at ...)
```

No espera a juntar cinco: en `HALF_OPEN` la request es una prueba, y si la prueba falla el circuito se vuelve a abrir con el cooldown reiniciado de cero. Comprobalo mandando otra request enseguida — te va a decir `retry in ~15000ms`, no lo que quedaba del cooldown anterior.

### 6. Bombardear durante el cooldown

Con el circuito abierto, mandale con el Runner de Postman todas las requests que quieras. Dos cosas que conviene tener claras:

**El bombardeo no alarga el cooldown.** El fast-fail tira antes de llegar a `onFailure`, así que el contador queda congelado en `5/5` y `next_attempt_time` no se toca. El `retry in Nms` baja parejo hacia cero, mandes 3 requests o 3000. Cada una cuesta una comparación de fechas y un log: no hay conexión, no hay timer, no hay nada del otro lado.

**Cuando vence el cooldown pasa una sola.** La primera hace la transición a `HALF_OPEN`; las que llegan detrás, mientras el probe sigue en vuelo, rebotan con:

```
[circuit breaker]: fast-fail. A probe is already in flight
```

Esto es lo que hace que el patrón sirva de algo. Sin ese candado, el instante en que vence el cooldown le mandás toda la cola junta a un servicio que recién se está levantando — y lo volvés a tirar abajo. El probe es **una** llamada preguntando cómo anda; el resto espera el veredicto.

Lo mismo pasa con los fallos que llegan tarde: si cinco requests estaban en vuelo cuando el circuito se abrió, sus fallos son noticia vieja y se ignoran. Si no, cada una correría el próximo intento 15s más adelante y bajo carga el cooldown no terminaría nunca.

### 5. El timeout

Aparte, con el circuito cerrado, mandá una sola request con `"last4": "0001"`. Postman se queda colgado **10 segundos** y vuelve `503`:

```
[circuit breaker]: call failed after 10001ms (state: CLOSED) -> [circuit breaker]: Request Timeout
[circuit breaker]: Request failed. Failure count: 1/5
```

El stub tarda 30s a propósito, pero el breaker no lo espera: a los 10s abandona y lo cuenta como fallo. Un servicio que contesta demasiado tarde es, para quien llama, un servicio caído. Cinco de estas también abren el circuito, pero tardás 50 segundos — para abrirlo rápido usá `0500`.
