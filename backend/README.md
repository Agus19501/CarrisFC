# Backend de Carris FC

API Node.js/Express preparada para ejecutarse en Render y conectar con MongoDB Atlas.

## Configuración local

1. Copia `.env.example` como `.env`.
2. Sustituye `MONGODB_URI` por la cadena del usuario de base de datos de Atlas. No compartas ni subas `.env`.
3. En `FRONTEND_ORIGINS`, deja los orígenes locales separados por comas. Añade el dominio de Netlify al desplegar.
4. Ejecuta `npm install` y después `npm run dev`.
5. Comprueba `http://localhost:10000/api/health`.

El servidor falla con un mensaje explícito si falta la configuración o si Atlas no está accesible. La ruta de salud devuelve el estado de la conexión a la base de datos.

## Render

`render.yaml` configura el servicio web a partir de esta carpeta. Render debe recibir `MONGODB_URI` y `FRONTEND_ORIGINS` como variables de entorno. Añádelas en Render; no las pongas en los archivos del frontend.

## Alcance actual

Esto prepara el servidor y la conexión. Todavía no expone operaciones para jugadores, partidos o convocatorias, y el frontend sigue guardando sus datos en el navegador. La API deberá integrarse con la web y proteger las operaciones de administración antes de usarla con datos reales.
