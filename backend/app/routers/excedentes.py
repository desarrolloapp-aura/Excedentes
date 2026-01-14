from fastapi import APIRouter, Depends, Query, HTTPException, Request
from typing import Optional
from app.routers.auth import get_user
from app.services.jde_service import jde_service

router = APIRouter()

@router.get("/existencias/unidades-negocio")
async def get_unidades_negocio(
    user: dict = Depends(get_user)
):
    """Obtiene la lista de unidades de negocio (centros) disponibles"""
    try:
        from app.config import settings
        import asyncpg
        
        # Conectar directamente para esta consulta
        conn = await asyncpg.connect(
            host=settings.JDE_PG_HOST,
            port=settings.JDE_PG_PORT,
            database=settings.JDE_PG_DATABASE,
            user=settings.JDE_PG_USER,
            password=settings.JDE_PG_PASSWORD,
            ssl=settings.JDE_PG_SSL
        )
        
        schema = settings.JDE_PG_SCHEMA
        centro_col = jde_service._get_column("f41021", "centro")
        
        query = f"""
            SELECT DISTINCT {centro_col} as unidad_negocio
            FROM {schema}.f41021
            WHERE {centro_col} IS NOT NULL 
              AND {centro_col} != ''
            ORDER BY {centro_col}
            LIMIT 100
        """
        
        rows = await conn.fetch(query)
        await conn.close()
        
        unidades = [row["unidad_negocio"] for row in rows]
        
        return {
            "unidades_negocio": unidades,
            "total": len(unidades)
        }
    except Exception as e:
        import traceback
        error_detail = str(e)
        traceback_str = traceback.format_exc()
        print(f"Error en get_unidades_negocio: {error_detail}")
        print(f"Traceback: {traceback_str}")
        raise HTTPException(status_code=500, detail=f"Error al consultar unidades de negocio: {error_detail}")

@router.get("/existencias")
async def get_existencias(
    search: Optional[str] = Query(None),
    centro: Optional[str] = Query(None),
    ubicacion: Optional[str] = Query(None),
    min_stock: Optional[float] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    request: Request = None,
    user: dict = Depends(get_user)
):
    """Consulta existencias con filtros y paginación"""
    from app.config import settings
    import logging
    
    logger = logging.getLogger(__name__)
    
    # Siempre usar la unidad de negocio fija configurada
    centro_final = settings.FIXED_BUSINESS_UNIT
    logger.info(f"Usando unidad de negocio fija: '{centro_final}'")
    
    try:
        result = await jde_service.get_existencias(
            search=search,
            centro=centro_final,
            ubicacion=ubicacion,
            min_stock=min_stock,
            page=page,
            page_size=page_size
        )
        total_found = result.get('total', 0)
        client_ip = request.client.host if request and request.client else "unknown"
        
        # Log success to debug file con más detalle
        with open("debug_api.txt", "a") as f:
            from datetime import datetime
            now = datetime.now().strftime("%H:%M:%S")
            data_items = result.get('items', [])
            item_count = len(data_items)
            f.write(f"[{now}] IP: {client_ip} | OK: p={page}, total={total_found}, items={item_count}, s='{search}'\n")
            if item_count > 0:
                f.write(f"   RES_HEAD: {data_items[0].get('dsci', 'NO_DESC')[:20]}...\n")
            else:
                f.write(f"   RES_EMPTY!\n")
            
        return result
    except Exception as e:
        import traceback
        error_detail = str(e)
        traceback_str = traceback.format_exc()
        
        # Log error to debug file
        with open("debug_api.txt", "a") as f:
            f.write(f"ERROR: {error_detail}\n{traceback_str}\n")
            
        print(f"Error en get_existencias: {error_detail}")
        print(f"Traceback: {traceback_str}")
        raise HTTPException(status_code=500, detail=f"Error al consultar existencias: {error_detail}")

@router.get("/debug-logs")
async def get_debug_logs():
    try:
        import os
        if os.path.exists("debug_api.txt"):
            with open("debug_api.txt", "r") as f:
                return {"logs": f.readlines()[-100:]}
        return {"logs": ["No logs found"]}
    except:
        return {"error": "Could not read logs"}

