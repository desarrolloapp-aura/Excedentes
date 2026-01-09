# Migraciones de Base de Datos

## Migración 002: Agregar campos de sincronización

Esta migración agrega los campos necesarios para el sistema de sincronización de compras con JDE.

### Campos agregados:
- `procesada` (BOOLEAN): Indica si la compra ya fue procesada y reflejada en JDE
- `stock_jde_inicial` (NUMERIC): Stock que había en JDE al momento de crear la compra

### Cómo ejecutar:

1. **Opción 1: Desde Supabase Dashboard**
   - Ve a tu proyecto en Supabase
   - Abre el SQL Editor
   - Copia y pega el contenido de `002_add_procesada_fields.sql`
   - Ejecuta la consulta

2. **Opción 2: Desde psql**
   ```bash
   psql -h aws-1-us-east-1.pooler.supabase.com -p 6543 -U postgres.ypohmqzkhoewahqjystl -d postgres -f 002_add_procesada_fields.sql
   ```

### Verificación:
Después de ejecutar, verifica que los campos se agregaron correctamente:
```sql
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'purchase_items' 
AND column_name IN ('procesada', 'stock_jde_inicial');
```

