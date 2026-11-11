# Backend de Carris FC

API Express para la web de Netlify, con estado persistido en MongoDB Atlas y acceso administrativo mediante sesión segura.

## Configuración local

1. Copia `.env.example` como `.env` y rellena las variables.
2. Ejecuta `npm ci` y después `npm run dev`.
3. Comprueba `http://localhost:10000/api/health`.

Configura `MONGODB_URI`, `FRONTEND_ORIGINS`, `SESSION_SECRET`, `ADMIN_EMAIL` y `ADMIN_PASSWORD_HASH`. `FRONTEND_ORIGINS` es una lista separada por comas de orígenes exactos, sin rutas ni `*`. Genera un secreto localmente con `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. Para obtener el hash bcrypt, ejecuta `npm run hash-admin-password` en una terminal interactiva; la contraseña no se muestra mientras se escribe.

No subas `.env` ni pegues secretos en el código. En Render, configura las variables como secretos del servicio. Si la contraseña de Atlas compartida anteriormente sigue activa, cámbiala y actualiza `MONGODB_URI`.

## Render y Netlify

`render.yaml` configura Render para ejecutar `npm ci` y `npm start` desde esta carpeta. `GET /api/health` indica si la API y MongoDB están disponibles. Netlify reenvía `/api/*` a la API de Render mediante el proxy de `netlify.toml`.

## Rutas

- `GET /api/health`: estado de la API y MongoDB.
- `GET /api/auth/csrf`: token CSRF para la sesión actual.
- `GET /api/auth/session`: estado de autenticación.
- `POST /api/auth/login` y `POST /api/auth/logout`: inicio y cierre de sesión.
- `GET /api/state`: estado público del club; crea el estado inicial vacío si todavía no existe.
- `PUT /api/state`: escritura autenticada y validada del estado completo.

Las fechas de partidos se envían como `YYYY-MM-DD` y las horas en un campo separado (`HH:mm`). La web convierte automáticamente las fechas antiguas reconocibles al nuevo formato.
