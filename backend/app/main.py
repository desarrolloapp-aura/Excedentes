from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import excedentes

app = FastAPI(title="Sistema Compra JDE - Backend")

# Configurar CORS para permitir peticiones desde el frontend (puerto 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir routers
app.include_router(excedentes.router, prefix="/excedentes", tags=["Excedentes"])

@app.get("/")
async def root():
    return {"message": "API Sistema Compra JDE funcionando"}
