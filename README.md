# Plan de Arquitectura: Laboratorio

Este repositorio contiene un laboratorio de ingeniería de software backend implementado en **Node.js (TypeScript)**. Su propósito es diseñar, validar y auditar patrones avanzados de tolerancia a fallas, control de tráfico y resiliencia en sistemas distribuidos de alta concurrencia, utilizando un enfoque de **Monolito Modular** guiado por la **Arquitectura Hexagonal (Ports & Adapters)**.

No es un producto: el objetivo es entender por qué existe cada patrón, dibujarlo, implementarlo a mano y poder defender cada decisión. Librerías como Polly, opossum o `rate-limiter-flexible` resuelven casi todo esto; el punto es no delegarlo todavía.

---

## 1. Filosofía de Diseño y Justificación Arquitectónica

El sistema rechaza la sobreingeniería de infraestructura (como la configuración prematura de monorrepos con herramientas tipo Turborepo/Lerna) y se enfoca en resolver el desacoplamiento mediante límites lógicos estrictos de código.

### Decisiones de Diseño Clave para la Defensa Técnica:

1. **Desacoplamiento de la Lógica de Negocio:** El núcleo (`domain` y `application`) es agnóstico a los detalles técnicos de red o almacenamiento. Se comunica con el exterior únicamente a través de abstracciones (`ports`), permitiendo intercambiar Express, Redis o los proveedores externos de APIs sin alterar una sola línea de código del negocio.
2. **Inyección de Dependencias Manual:** El ensamblado de componentes en `main.ts` se realiza manualmente sin frameworks de inversión de control masivos. Esto garantiza un entorno predecible, de bajo acoplamiento y altamente testeable mediante stubs puros de software en memoria.
3. **Control Perimetral vs. Control Egress:** Se delimita de forma precisa el tráfico entrante (Ingress) mediante barreras perimetrales (`rate-limiter`) de los mecanismos de protección y consumo de recursos externos (Egress) como el `timeout`, el `circuit-breaker` y el `BackoffMath`.
4. **Construcción incremental:** Ninguna pieza arranca en su versión distribuida. El Lua atómico y la sincronización por Pub/Sub son el destino, no el punto de partida.

### La regla del laboratorio

Para cada patrón, sin excepción:

1. **Versión ingenua primero**, en memoria, aunque esté mal.
2. **Rompela vos mismo**: encontrá el caso que la hace fallar.
3. **Arreglala**, y que el arreglo sea consecuencia del paso 2 y no de haberlo leído.
4. **Escribí el ADR**: _"elegí X en vez de Y porque Z, y me costó W"_. Si no podés escribir esa frase, no lo tenés.

---

## 2. Estructura de Directorios

```text
resilience-lab/
├── docker-compose.yml              # Infraestructura local (Redis, stub de Stripe)
├── Dockerfile
├── package.json
├── tsconfig.json
│
├── docs/
│   ├── adr/                        # Una decisión por archivo
│   │   └── NEXT_STEPS.md           # Backlog de mejoras. No empezar por acá.
│   ├── diagramas/                  # Mermaid
│   └── estimaciones.md             # Back-of-envelope previo a configurar el rate limiter
│
├── stubs/                          # Fuera de src/: no se compila con la app
│   └── stripe-api.mock.ts          # Servidor Express mínimo que emula a Stripe
│
├── tests/
│   ├── unit/
│   │   ├── job-processor.test.ts   # Caso de uso con fakes, sin levantar infraestructura
│   │   ├── circuit-breaker.test.ts # Máquina de estados con reloj falso
│   │   └── backoff.math.test.ts    # Curvas de tiempo y dispersión del jitter
│   └── integration/
│       ├── rate-limiter.test.ts    # Test de inundación (HTTP 429)
│       └── distributed-state.test.ts # Dos procesos compartiendo estado en Redis
│
└── src/
    ├── domain/                     # CAPA DE DOMINIO PURA (contratos y entidades)
    │   ├── models/
    │   │   ├── job.model.ts
    │   │   └── response.model.ts
    │   └── ports/                  # CONTRATOS (interfaces de salida)
    │       ├── out-payment.port.ts
    │       ├── out-queue.port.ts
    │       └── out-clock.port.ts   # El tiempo es una dependencia, no un global
    │
    ├── application/                # CAPA DE APLICACIÓN (casos de uso)
    │   └── services/
    │       └── job-processor.ts    # Caso de uso puro: recibe un job, devuelve resultado
    │
    ├── infrastructure/
    │   ├── ingress/                # Entrada (driving adapters)
    │   │   ├── http/
    │   │   │   ├── controllers/
    │   │   │   └── middlewares/    # Trace ID y adaptador del rate limiter
    │   │   ├── worker/
    │   │   │   └── job-consumer.ts # El loop es adapter de entrada, no application
    │   │   └── rate-limiter/
    │   │       ├── strategy.interface.ts   # IRateLimiterStrategy (Pattern: Strategy)
    │   │       ├── token-bucket.memory.ts
    │   │       └── token-bucket.redis.ts   # Token bucket atómico con script de Lua
    │   │
    │   ├── egress/                 # Salida (driven adapters y escudos de red)
    │   │   ├── adapters/
    │   │   │   ├── in-memory-payment.adapter.ts
    │   │   │   ├── in-memory-queue.adapter.ts
    │   │   │   ├── http-payment.adapter.ts  # Adapter puro: solo traduce el puerto a HTTP
    │   │   │   └── redis-dlq.adapter.ts
    │   │   ├── resilience/
    │   │   │   ├── resilient-payment.decorator.ts # Compone los escudos (Pattern: Decorator)
    │   │   │   ├── timeout.ts               # Sin esto el breaker no dispara nunca
    │   │   │   ├── retry.ts
    │   │   │   └── backoff/
    │   │   │       ├── backoff.math.ts      # Utilidad de curvas de tiempo
    │   │   │       └── strategies/          # Full, equal y decorrelated jitter
    │   │   └── circuit-breaker/
    │   │       ├── breaker.memory.ts        # Máquina de estados pura
    │   │       ├── breaker.redis.ts         # Estado compartido entre procesos
    │   │       └── sync-channel.pubsub.ts   # Canal de sincronización (Pattern: Observer)
    │   │
    │   └── drivers/redis/
    │       ├── command.client.ts   # Pool de comandos
    │       └── subscriber.client.ts # Conexión aparte: en modo subscriber no acepta comandos
    │
    ├── lifecycle/
    │   └── graceful-shutdown.ts    # Controla el apagado del servidor (SIGTERM/SIGINT)
    │
    └── main.ts                     # PUNTO DE ARRANQUE (Inyección de Dependencias Manual)
```

---

## 3. Ciclo de Vida y Flujo Cronológico de una Petición

El recorrido de un proceso (Job) dentro del sistema se ejecuta de manera secuencial a través de las siguientes estaciones:

1. **Trace ID:** el middleware genera o propaga el identificador que acompaña cada log del recorrido.
2. **Rate limiter (Ingress):** se consume un token del bucket. Sin tokens, la petición muere acá con un **HTTP 429**.
3. **Controller:** traduce HTTP a un caso de uso. De acá para adentro no existe Express.
4. **JobProcessor:** pide `pagar(job)` contra `out-payment.port`. No sabe qué hay del otro lado.
5. **Circuit breaker (Egress):** si está OPEN, falla rápido sin tocar la red. Si está CLOSED o HALF_OPEN, deja pasar.
6. **Retry con backoff y jitter:** cada intento va envuelto en un **timeout**. Los errores reintentables esperan `base * 2^intento` con dispersión; los no reintentables cortan de una.
7. **Adapter HTTP:** la llamada real al stub de Stripe.
8. **Registro en el breaker:** éxito o fallo actualizan el contador. Al cruzar el umbral, el breaker abre y publica la transición por Pub/Sub para que el otro proceso se entere.
9. **DLQ:** agotados los reintentos, el job se despacha por `out-queue.port` en vez de perderse o reintentarse infinito.
10. **Graceful shutdown:** ante SIGTERM se deja de aceptar tráfico nuevo, se drenan los jobs en vuelo y recién ahí se cierran las conexiones.

---

## 4. Hoja de Ruta

Cada fase es entregable por sí sola y cierra con su diagrama y su ADR. No se pasa a la siguiente sin eso.

### Fase 0 — El hexágono en frío

Sin red, sin Redis, sin Express. Modelos, puertos, el caso de uso y adapters en memoria. `main.ts` cablea todo a mano.

**Terminaste cuando:** el test del caso de uso corre sin levantar nada, cambiar el adapter en memoria por otro no toca una línea de `domain/` ni de `application/`, y podés defender por qué la dependencia apunta hacia adentro y cuándo esto es sobreingeniería.

### Fase 1 — Escudos de egress, en memoria

Timeout, retry con backoff exponencial y jitter, circuit breaker en memoria, y el decorator que los compone. El stub de pagos es un objeto en proceso que falla y tarda a pedido.

**Rompela vos:** sacá el timeout y hacé que el stub cuelgue la conexión sin responder. El breaker no abre nunca, porque nunca llega a contar un fallo. Ese experimento justifica el timeout y explica por qué va adentro del retry.

**Terminaste cuando:** explicás la diferencia entre breaker y retry, por qué se usan juntos, por qué importa el jitter, y qué errores no se deben reintentar.

### Fase 2 — Ingress y ciclo de vida

Express, controllers, trace ID, token bucket en memoria, DLQ en memoria, graceful shutdown, y el worker como adapter de entrada. Antes de configurar el limiter va `docs/estimaciones.md`: los números salen de ahí, no de la intuición.

**Rompela vos:** levantá dos procesos en puertos distintos y tirales carga. Cada uno tiene su propio bucket, así que el límite efectivo se duplica. Ese es el momento exacto que justifica mover el estado a Redis.

**Terminaste cuando:** explicás por qué el token bucket permite ráfagas y el sliding window es más estricto, y qué hacés con los mensajes de la DLQ más allá de descartarlos.

### Fase 3 — Estado distribuido

El bucket pasa a Lua atómico, el breaker a estado compartido con sincronización por Pub/Sub, y la DLQ a Redis. Dos procesos locales en puertos distintos, sin balanceador.

**La decisión obligatoria:** qué pasa cuando Redis no responde. **Fail-open** deja pasar todo y arriesga martillar una dependencia muerta; **fail-closed** rechaza todo y convierte un Redis caído en una caída total. Hay que elegir, y el ADR es la entrega.

**Terminaste cuando:** explicás por qué `GET` + `SET` desde Node no es atómico y el script Lua sí, y por qué el bucket necesita consistencia fuerte mientras el breaker tolera ser eventualmente consistente (Pub/Sub es best-effort: un proceso que estaba caído se pierde el mensaje y queda con estado viejo).

### Fase 4 — Verlo funcionar

Logs estructurados con el trace ID, transiciones del breaker logueadas, y una prueba de carga que haga abrir el breaker con los dos procesos corriendo.

**Terminaste cuando:** podés narrar con el trace ID el recorrido completo de un job que terminó en la DLQ, y explicar componente por componente por qué nada de este sistema sobrevive en un entorno de ejecución efímero.

> Todo lo que no está en estas cinco fases vive en [`docs/adr/NEXT_STEPS.md`](docs/adr/NEXT_STEPS.md), a propósito.

---

## 5. Decisiones Abiertas

Planteadas como pregunta y no como respuesta: derivarlas es el ejercicio. Una por ADR.

| #   | Decisión                                                                                | Fase |
| --- | --------------------------------------------------------------------------------------- | ---- |
| 01  | ¿En qué orden se anidan timeout, retry y breaker, y por qué ese y no otro?              | 1    |
| 02  | ¿Qué errores son reintentables y cuáles no? ¿Dónde vive ese criterio?                   | 1    |
| 03  | ¿Qué variante de jitter (full, equal, decorrelated) y a cambio de qué?                  | 1    |
| 04  | ¿Token bucket o sliding window para el ingress?                                         | 2    |
| 05  | ¿Qué garantía de entrega ofrece el procesador y dónde queda la ventana de duplicado?    | 2    |
| 06  | ¿Fail-open o fail-closed cuando Redis no responde?                                      | 3    |
| 07  | ¿Por qué el estado del breaker tolera ser eventualmente consistente y el del bucket no? | 3    |
| 08  | ¿Qué umbral abre el breaker, y de qué objetivo de latencia sale ese número?             | 3    |

---

## 6. Fuera de Alcance

- **Outbox e idempotencia:** ya implementados en otro proyecto. Este laboratorio no los repite.
- **Repository y Unit of Work:** requieren escrituras transaccionales a una base relacional, que acá no existen.
- **Autenticación y autorización:** solo agregarían ruido al patrón que se está estudiando.
