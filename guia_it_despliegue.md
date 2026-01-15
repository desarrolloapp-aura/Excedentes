# Guía de Traspaso para el Equipo de TI

Este documento explica cómo desplegar el "Sistema de Compra JDE" en los servidores de la empresa.

> [!IMPORTANT]
> **NO ES NECESARIO MODIFICAR EL CÓDIGO FUENTE.**
> El sistema está diseñado siguiendo el principio de "12-factor app". Toda la configuración (credenciales, IPs, llaves) se gestiona exclusivamente a través de **Variables de Entorno** (archivos `.env`). El equipo de TI solo debe configurar estos archivos sin tocar los archivos `.py` o `.tsx`.

## 1. Requisitos Técnicos del Servidor

Para garantizar la estabilidad del sistema y de la infraestructura de base de datos local, se recomiendan las siguientes especificaciones:

### Especificaciones de Hardware
- **CPU**: 2 vCPUs (Mínimo).
- **RAM**: 4GB (Mínimo recomendado). 
  - *Nota: El Backend y Frontend son extremadamente ligeros (~300MB), el grueso de la RAM es para la infraestructura de contenedores de Supabase/PostgreSQL.*
- **Almacenamiento**: 40GB SSD (Mínimo).
  - Suficiente para el Sistema Operativo, las imágenes de Docker y el crecimiento de la base de datos histórica por varios años.

### Especificaciones de Software
- **SO**: Linux (Ubuntu 22.04 LTS recomendado) o Windows Server con Docker Desktop/WSL2.
- **Herramientas**: Docker Engine (20.10+) y Docker Compose V2.
- **Python**: No es necesario instalarlo en el servidor (ya viene dentro del contenedor Docker).

---

## 2. El Concepto Clave: Aplicación vs. Infraestructura
El repositorio contiene la **Aplicación** (Frontend en React y Backend en FastAPI), pero esta aplicación requiere de una **Infraestructura de Servicios** para funcionar (Base de datos y el sistema de Login con Google).

Actualmente, estos servicios corren en una cuenta personal de **Supabase**. TI debe elegir uno de los siguientes caminos para el traspaso:

---

## 3. Estrategia de Despliegue: Supabase Local con Docker

Para este proyecto, la empresa ha optado por un **despliegue 100% local**. Esto significa que se instalarán todos los servicios (Base de datos y Autenticación) dentro de los servidores de la empresa usando Docker.

- **Ventaja**: Privacidad total; los datos y usuarios nunca salen de la red corporativa.
- **Qué hacer**: El equipo de TI debe seguir la [guía oficial de Supabase Self-Hosting](https://supabase.com/docs/guides/self-hosting/docker) para levantar la infraestructura base. Una vez instalada, este repositorio se conectará a dicha instancia local.

---

## 4. Checklist de Credenciales (Qué debe poner TI)

Como los archivos `.env` no se suben al repositorio por seguridad, el equipo de TI debe crear los suyos propios con esta información:

1.  **Base de Datos JDE**: Host, Puerto, Usuario y Password de la base de datos PostgreSQL de JDE.
2.  **Supabase Local**: Ellos generarán sus propias llaves (`URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`) al levantar el contenedor de Supabase.
3.  **Google Auth**: Deben crear un "Client ID" y "Client Secret" en su consola de Google Cloud corporativa.

---

## 5. Configuración del Repositorio
TI encontrará estos archivos listos en la raíz para orquestar la aplicación:

- **`docker-compose.yml`**: Orquestación del Backend (FastAPI) y Frontend (Nginx).
- **`backend/Dockerfile`**: Configuración para el motor de lógica.
- **`frontend/Dockerfile`**: Configuración para compilar y servir la web.

### Pasos para TI:
1. **Configurar Variables**: Crear/Editar `/backend/.env` y `/frontend/.env.local` con el checklist del punto 3.
2. **Levantar**: Ejecutar `docker compose up -d --build`.

---

## 6. División de Responsabilidades (Recomendado)

Para evitar errores de compatibilidad, la mejor forma de trabajar el despliegue es:

1.  **TI (El Dueño de la Casa)**: Crea la base de datos vacía en su servidor y te entrega a ti las credenciales (Host, Usuario, Password).
2.  **TÚ / El Desarrollador (El Decorador)**: Te conectas a esa base de datos y ejecutas el archivo `database/schema.sql`. 

**¿Por qué es mejor así?**
Si TI intenta crear las tablas manualmente, podrían equivocarse en un nombre o en un tipo de dato (ej. poner texto donde va un número). Es mejor que el desarrollador use el script que ya está probado con el código.

---

## 7. Migración de Datos (Pasar el historial)
Si deseas que el historial de compras actual aparezca en el nuevo sistema:
1.  **TI**: Debe permitirte una conexión temporal para subir datos.
2.  **Usuario**: Exporta los datos de su Supabase actual e importa el contenido en las nuevas tablas creadas.

---

## 8. Configuración de Google Login (Manejado por el Desarrollador)

Para que el login con cuentas de la empresa funcione en el nuevo servidor:

1.  **Obtener IP**: TI debe proporcionar la IP pública o dominio del nuevo servidor.
2.  **Google Cloud Console**: El desarrollador (tú) debe crear un nuevo Proyecto o Cliente OAuth 2.0.
3.  **Redirect URI**: En la configuración de Google, se debe añadir el siguiente URI autorizado:
    - `http://[IP_DEL_SERVIDOR]:8000/auth/v1/callback`
4.  **Vincular**: El `Client ID` y `Client Secret` resultantes se deben pegar en la configuración de autenticación del Supabase local.

---

**Fin de la Guía.**
