from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # JDE Database
    JDE_PG_HOST: str = ""
    JDE_PG_PORT: int = 0
    JDE_PG_DATABASE: str = ""
    JDE_PG_USER: str = ""
    JDE_PG_PASSWORD: str = ""
    JDE_PG_SSL: bool = False
    JDE_PG_SCHEMA: str = ""
    
    # Supabase
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    ALLOWED_EMAIL_DOMAIN: str = ""
    
    # Storage
    SUPABASE_BUCKET: str = ""
    PRESIGNED_URL_EXPIRES_SECONDS: int = 0
    
    # App
    BASE_URL: str = ""
    API_PORT: int = 0
    
    # Filtros por defecto
    FIXED_BUSINESS_UNIT: str = "9301000050"  # Unidad de negocio fija
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"

settings = Settings()

