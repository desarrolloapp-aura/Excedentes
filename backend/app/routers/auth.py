from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

async def get_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Mock de autenticación.
    En producción esto validaría el token con Supabase.
    Para recuperación, retornamos un usuario dummy si hay token.
    """
    token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Token no proporcionado")
    
    # Simular usuario decodificado
    return {
        "id": "mock-user-id",
        "email": "usuario@aura.cl",
        "app_metadata": {"provider": "google"}
    }
