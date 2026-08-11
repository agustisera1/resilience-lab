# Resilience Lab

Laboratorio de ingeniería de software backend implementado en **Node.js (TypeScript)**. Su propósito es diseñar y auditar patrones de tolerancia a fallas, control de tráfico y resiliencia en sistemas distribuidos de alta concurrencia, utilizando un enfoque de **Monolito Modular** guiado por la **Arquitectura Hexagonal (Ports & Adapters)**.

No es un producto: el objetivo es entender por qué existe cada patrón, dibujarlo e implementarlo a mano. Librerías como Polly, opossum o `rate-limiter-flexible` resuelven casi todo esto; el punto es no delegarlo todavía.

---

## 1. Filosofía de Diseño

El sistema rechaza la sobreingeniería de infraestructura (como la configuración prematura de monorrepos con herramientas tipo Turborepo/Lerna) y se enfoca en resolver el desacoplamiento mediante límites lógicos estrictos de código.

1. **Desacoplamiento de la lógica de negocio:** el núcleo (`domain` y `application`) es agnóstico a los detalles técnicos de red o almacenamiento. Se comunica con el exterior únicamente a través de abstracciones (`ports`), permitiendo intercambiar Express, Redis o los proveedores externos de APIs sin alterar una sola línea de código del negocio.
2. **Inyección de dependencias manual:** el ensamblado de componentes en `main.ts` se realiza manualmente sin frameworks de inversión de control masivos. Esto garantiza un entorno predecible, de bajo acoplamiento y altamente testeable mediante stubs puros de software en memoria.
3. **Control perimetral vs. control egress:** se delimita de forma precisa el tráfico entrante (Ingress) mediante barreras perimetrales (`rate-limiter`) de los mecanismos de protección y consumo de recursos externos (Egress) como el `timeout`, el `circuit-breaker` y el `BackoffMath`.
4. **Construcción incremental:** ninguna pieza arranca en su versión distribuida. El Lua atómico y la sincronización por Pub/Sub son el destino, no el punto de partida.

---

## 2. Patrones y Capacidades

### Ingress — tráfico entrante

- **Rate limiter con token bucket:** estrategia intercambiable (`IRateLimiterStrategy`, _Pattern: Strategy_), con una implementación en memoria y otra distribuida sobre Redis mediante script de Lua atómico. Sin tokens disponibles, la petición se rechaza con **HTTP 429**.
- **Trace ID:** middleware que genera o propaga el identificador que acompaña cada log del recorrido de un job.
- **Worker como adapter de entrada:** el loop que consume la cola entra por el mismo hexágono que HTTP, no vive en `application`.

### Egress — consumo de dependencias externas

- **Timeout:** envuelve cada intento de red. Sin él, una conexión colgada nunca llega a contarse como fallo.
- **Retry con backoff exponencial y jitter:** variantes _full_, _equal_ y _decorrelated_; los errores no reintentables cortan de una.
- **Circuit breaker:** máquina de estados (CLOSED / OPEN / HALF_OPEN) en memoria, y en su versión distribuida con estado compartido en Redis sincronizado por Pub/Sub (_Pattern: Observer_).
- **Composición por decorator:** los escudos se apilan sobre el adapter HTTP sin que el caso de uso se entere de que existen (_Pattern: Decorator_).
- **DLQ:** agotados los reintentos, el job se despacha por `out-queue.port` en vez de perderse o reintentarse infinito.

### Ciclo de vida

- **Graceful shutdown:** ante SIGTERM se deja de aceptar tráfico nuevo, se drenan los jobs en vuelo y recién ahí se cierran las conexiones.

---

## 3. Estructura de Directorios

```text
resilience-lab/
├── docs/
│   ├── adr/                        # Una decisión por archivo
│   └── diagramas/                  # Mermaid
│
├── stubs/                          # Dobles de dependencias externas. Fuera de src/: no se compilan con la app
│
├── tests/
│   ├── unit/                       # Lógica pura con fakes y reloj falso, sin levantar infraestructura
│   └── integration/                # Redis y HTTP reales: inundación del limiter y estado compartido
│
└── src/
    ├── domain/                     # CAPA DE DOMINIO PURA
    │   ├── models/                 # Entidades del negocio
    │   └── ports/                  # CONTRATOS (interfaces de salida)
    │
    ├── application/                # CAPA DE APLICACIÓN
    │   └── services/               # Casos de uso puros: reciben un job, devuelven resultado
    │
    ├── infrastructure/
    │   ├── ingress/                # Entrada (driving adapters)
    │   │   ├── http/
    │   │   │   ├── controllers/    # Traducen HTTP a caso de uso. De acá para adentro no existe Express
    │   │   │   └── middlewares/    # Trace ID y adaptador del rate limiter
    │   │   ├── worker/             # El loop de la cola es adapter de entrada, no application
    │   │   └── rate-limiter/       # Token bucket en memoria y su versión atómica en Lua (Pattern: Strategy)
    │   │
    │   ├── egress/                 # Salida (driven adapters y escudos de red)
    │   │   ├── adapters/           # Traducen los puertos a HTTP, Redis o memoria. Sin lógica de resiliencia
    │   │   ├── resilience/         # Timeout, retry y el decorator que los compone (Pattern: Decorator)
    │   │   │   └── backoff/        # Curvas de tiempo y estrategias de jitter
    │   │   └── circuit-breaker/    # Máquina de estados, estado compartido y canal de sync (Pattern: Observer)
    │   │
    │   └── drivers/
    │       └── redis/              # Conexiones de bajo nivel: comandos y subscriber van separados
    │
    └── lifecycle/                  # Apagado ordenado del proceso (SIGTERM/SIGINT)
```

---

## 4. Ciclo de Vida y Flujo Cronológico de una Petición

<!-- TODO: diagrama del recorrido de un job, estación por estación. -->
