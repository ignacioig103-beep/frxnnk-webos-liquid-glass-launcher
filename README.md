# Liquid Glass Launcher para LG webOS

Pantalla de menú estilo *liquid glass* para TVs LG con webOS, pensada para ir fluida
incluso en modelos con poca GPU (webOS 3.x en adelante).

## Uso con el mando

| Tecla | Acción |
|---|---|
| Flechas | Mover el foco entre apps y filas |
| OK | Abrir la app |
| Amarilla | Fijar / quitar de **Favoritas** |
| Azul | Activar / desactivar el desenfoque real (Cristal HQ) |
| Atrás | Salir |

El Magic Remote también funciona: el puntero enfoca y el clic abre.

## Optimizaciones de rendimiento

- **Sin `backdrop-filter` por defecto.** El efecto cristal se consigue con degradados,
  brillos y bordes. El blur real es opcional (tecla azul) y solo se aplica a superficies
  pequeñas y estáticas.
- **Solo se animan `transform` y `opacity`**, que el compositor maneja sin recalcular
  layout ni repintar.
- **Un solo anillo de foco por fila** que se desplaza con `translate3d`; las filas se
  desplazan igual, nunca con `scrollLeft`.
- **Sin lecturas de layout:** las posiciones se calculan en JS (índice × paso).
- **DOM construido una vez** con `DocumentFragment`; eventos del puntero con delegación.
- **Hero y tinte de fondo con debounce:** solo se actualizan cuando dejas de moverte.
- **Tecla mantenida limitada** a un movimiento por frame.
- **Fondo estático** (sin animaciones continuas) y reloj que se actualiza una vez por minuto
  y se pausa cuando la app está oculta.
- ES5 puro, sin dependencias: carga rápida en los Chromium antiguos de webOS.

## Instalación

Requiere el [modo desarrollador](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)
o Homebrew Channel y las herramientas `ares-cli`:

```sh
npm install -g @webos-tools/cli
ares-package .
ares-install --device <tu-tv> com.frxnnk.liquidglass.launcher_1.0.0_all.ipk
ares-launch  --device <tu-tv> com.frxnnk.liquidglass.launcher
```

La lista de apps se obtiene de `com.webos.applicationManager/listLaunchPoints`. Si la TV no
concede ese permiso (o abres `index.html` en un navegador de escritorio), se muestra una
lista de apps habituales como reserva.
