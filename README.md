# Mi Rastreador de Hábitos — guía de instalación

App web instalable (PWA) para registrar actividades en 6 categorías
(Yo, Salud, Familia, Finanzas, Trabajo, Hobbies) con estadísticas
visuales por día/semana/mes. Sincroniza entre tu iPhone y tu iPad
mediante Supabase (gratis).

Tiempo estimado: 15-20 minutos, una sola vez.

## Paso 1 — Crear el backend en Supabase (gratis)

1. Ve a https://supabase.com y crea una cuenta (con GitHub o email).
2. Crea un nuevo proyecto (elige la región más cercana, ej. `eu-west`).
3. Cuando el proyecto esté listo, ve a **SQL Editor** (menú izquierdo).
4. Abre el archivo `supabase-schema.sql` de esta carpeta, copia todo
   su contenido, pégalo en el editor y pulsa **Run**.
5. Ve a **Project Settings → API**. Copia:
   - **Project URL**
   - **anon public key**
6. Abre `config.js` en esta carpeta y sustituye:
   ```js
   const SUPABASE_URL = 'PON_AQUI_TU_SUPABASE_URL';
   const SUPABASE_ANON_KEY = 'PON_AQUI_TU_SUPABASE_ANON_KEY';
   ```
   por los valores que copiaste.

## Paso 2 — Publicar la app (GitHub Pages, gratis)

1. Crea un repositorio nuevo en GitHub (puede ser privado), por
   ejemplo `habitos-app`.
2. Sube todos los archivos de esta carpeta (`index.html`, `app.js`,
   `config.js`, `styles.css`, `manifest.json`, `service-worker.js`,
   la carpeta `icons/`).
3. Ve a **Settings → Pages** del repositorio, y en "Build and
   deployment" elige **Deploy from a branch**, rama `main`, carpeta
   `/ (root)`. Guarda.
4. En 1-2 minutos tu app estará disponible en una URL como:
   `https://tu-usuario.github.io/habitos-app/`

Nota: si el repositorio es privado, GitHub Pages puede requerir un
plan de pago para publicarlo. Si prefieres mantenerlo 100% gratis y
privado, dímelo y te preparo la alternativa con Cloudflare Pages o
Netlify (ambos gratis y permiten mantener el repo privado).

## Paso 3 — Instalar en iPhone y iPad

1. Abre la URL de tu app en **Safari** (tiene que ser Safari, no
   Chrome, para que funcione la instalación).
2. Toca el icono de compartir (cuadrado con flecha hacia arriba).
3. Elige **"Añadir a pantalla de inicio"**.
4. Repite en el iPad.

A partir de ahí, el icono abre la app a pantalla completa, sin
barra de Safari, y funciona sin conexión para el registro (se
sincroniza solo al recuperar internet).

## Paso 4 — Registro ultra-rápido con Atajos (recomendado)

Como Apple no permite widgets nativos desde una PWA, esta es la vía
para tener un acceso de 1-2 toques desde la pantalla de bloqueo, el
Centro de Control o el Botón de Acción del iPhone 16 Pro Max:

1. Abre la app **Atajos** en tu iPhone.
2. Crea un atajo nuevo, añade la acción **"Abrir URLs"**.
3. Pon como URL, por ejemplo:
   `https://tu-usuario.github.io/habitos-app/?log=salud&activity=Beber%20agua`
   (`log` es el id de categoría — mira `config.js` para ver los ids:
   `yo`, `salud`, `familia`, `finanzas`, `trabajo`, `hobbies` — y
   `activity` es el nombre exacto de la actividad, con espacios
   como `%20`).
4. Nombra el atajo (ej. "Beber agua") y ponle un icono/color.
5. Repite un atajo por cada actividad que registres muy seguido.
6. Añade los atajos que quieras al widget de "Atajos" en tu pantalla
   de inicio, o al Centro de Control, o asígnalos al Botón de
   Acción (Ajustes → Botón de Acción → Atajo).

Al tocar el atajo, se abre la app un instante, registra la
actividad automáticamente y te muestra la confirmación — no hace
falta navegar por categorías.

## Cómo usar la app día a día

- **Pantalla "Registrar"**: toca una categoría (color), luego la
  actividad. Confirmación instantánea y vuelve al inicio solo.
- **"+ Actividad personalizada"**: para algo que no está en la
  lista predeterminada.
- **Pantalla "Estadísticas"**: pestañas Hoy / Semana / Mes, gráfico
  de distribución por categoría, totales con barras, y tendencia de
  los últimos 14 días.

## Personalizar categorías y actividades

Todo está en `config.js`. Añade, quita o reordena actividades
dentro de cada categoría, o cambia los colores (`color`) y el
emoji (`icon`). Después de editar, vuelve a subir el archivo a
GitHub (Pages se actualiza solo en 1-2 minutos).

Las categorías **Finanzas** y **Trabajo** están vacías de
actividades predeterminadas — de momento solo puedes usar
"+ Actividad personalizada" ahí. Dime qué actividades quieres y
te las añado.

## Notas de seguridad

- La app usa la clave pública ("anon") de Supabase con permisos
  abiertos de lectura/escritura sobre la tabla `activity_logs`. Es
  aceptable para uso privado familiar, pero no publiques la URL de
  tu app ni las claves de `config.js` en ningún sitio abierto.
- Los datos de ambos dispositivos van a la misma tabla (no hay
  usuarios separados); si más adelante quieres distinguir quién
  registró qué, puedo añadir un selector de persona.
