from typing import Optional, Dict, Any, List
import asyncpg
from app.config import settings

class JDEService:
    async def get_existencias(
        self,
        search: Optional[str] = None,
        centro: Optional[str] = None,
        ubicacion: Optional[str] = None,
        min_stock: Optional[float] = None,
        page: int = 1,
        page_size: int = 20
    ) -> Dict[str, Any]:
        
        # Usar la unidad de negocio configurada si no viene una específica
        # (Aunque el router ya fuerza settings.FIXED_BUSINESS_UNIT)
        target_mcu = centro if centro else settings.FIXED_BUSINESS_UNIT
        schema = settings.JDE_PG_SCHEMA
        
        # Padding si es necesario (JDE a veces usa espacios a la derecha)
        # Probaremos TRIM en la query para ser seguros.
        
        conn = await asyncpg.connect(
            host=settings.JDE_PG_HOST,
            port=settings.JDE_PG_PORT,
            database=settings.JDE_PG_DATABASE,
            user=settings.JDE_PG_USER,
            password=settings.JDE_PG_PASSWORD,
            ssl=settings.JDE_PG_SSL
        )
        
        try:
            # Query base
            # Unimos F41021 (Existencias) con F4101 (Maestro Items)
            # Filtramos por Unidad de Negocio (LIMCU)
            
            where_clauses = [f"TRIM(l.limcu) = '{target_mcu}'"]
            params = []
            param_idx = 1
            
            if search:
                # Búsqueda por descripción, código legacy (imlitm) o ID nuevo (liitm)
                where_clauses.append(f"(m.imdsc1 ILIKE ${param_idx} OR m.imlitm ILIKE ${param_idx} OR CAST(l.liitm AS TEXT) ILIKE ${param_idx})")
                params.append(f"%{search}%")
                param_idx += 1
                
            if min_stock is not None:
                where_clauses.append(f"l.lipqoh >= {min_stock * 100}")
                
            where_str = " AND ".join(where_clauses)
            
            offset = (page - 1) * page_size
            
            # Count Query
            count_query = f"""
                SELECT COUNT(*)
                FROM {schema}.f41021 l
                JOIN {schema}.f4101 m ON l.liitm = m.imitm
                WHERE {where_str}
            """
            
            total = await conn.fetchval(count_query, *params)
            
            # Data Query
            # Obtenemos: SKU (liitm cast a texto), Desc (imdsc1), Lote (lilotn), ...
            # El usuario indicó que 'liitm' (numérico) es el item correcto.
            data_query = f"""
                SELECT 
                    CAST(CAST(l.liitm AS BIGINT) AS TEXT) as itm,
                    TRIM(m.imlitm) as litm,
                    TRIM(m.imdsc1) as dsci,
                    TRIM(l.lilotn) as lotn,
                    TRIM(l.lilocn) as secu,
                    TRIM(l.limcu) as primary_uom,
                    TRIM(m.imuom1) as un,
                    (l.lipqoh / 100.0) as pqoh
                FROM {schema}.f41021 l
                JOIN {schema}.f4101 m ON l.liitm = m.imitm
                WHERE {where_str}
                ORDER BY l.liitm ASC
                LIMIT {page_size} OFFSET {offset}
            """
            
            rows = await conn.fetch(data_query, *params)
            
            items = [dict(row) for row in rows]
            
            return {
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size
            }
            
        finally:
            await conn.close()

    def _get_column(self, table: str, field: str) -> str:
        # Helper legacy, no se usa mucho en esta impl pero lo dejamos por si acaso
        mapping = {
            "f41021": {
                "centro": "limcu",
                "item": "liitm",
                "stock": "lipqoh"
            }
        }
        return mapping.get(table, {}).get(field, field)

jde_service = JDEService()
