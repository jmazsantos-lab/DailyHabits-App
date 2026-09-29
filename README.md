# Hábitos v4

App web instalable (PWA) para registrar hábitos en iPhone y iPad, sincronizada entre José y Blanca mediante Supabase.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura de la app |
| `styles.css` | Diseño (claro, oscuro, iPhone e iPad) |
| `app.js` | Lógica: registros, estadísticas, metas, sincronización y cola sin conexión |
| `config.js` | URL y clave de Supabase, personas y categorías |
| `supabase.js` | Librería de Supabase (incluida, sin depender de internet) |
| `service-worker.js` | Funcionamiento sin conexión y actualizaciones |
| `manifest.json` + iconos | Instalación en la pantalla de inicio |
| `supabase-v4.sql` | Script que se ejecuta una vez en Supabase → SQL Editor |

## Instalación

Sigue la guía «Hábitos v4 · Guía de instalación y widget». Resumen:

1. Ejecuta `supabase-v4.sql` en Supabase → SQL Editor (crea las tablas nuevas y copia los registros de la versión anterior).
2. Sube todos los archivos a la raíz del repositorio de GitHub (Add file → Upload files, todos a la vez).
3. Espera 2 minutos, abre la app en Safari y añádela a la pantalla de inicio.
4. Crea el atajo «Registrar hábito» en la app Atajos y ponlo como widget (datos en la app: Ajustes → Atajos y widget).

## Datos

- Las actividades se gestionan desde la app (Ajustes → Gestionar actividades), no desde `config.js`.
- La tabla antigua `activity_logs` no se borra: queda como copia de seguridad.
- Registro por enlace: `?log=agua&p=jose` registra «Beber agua» para José.
