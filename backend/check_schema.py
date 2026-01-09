import asyncio
import asyncpg
from app.config import settings

async def main():
    print(f"Connecting to {settings.JDE_PG_HOST}...")
    try:
        conn = await asyncpg.connect(
            host=settings.JDE_PG_HOST,
            port=settings.JDE_PG_PORT,
            database=settings.JDE_PG_DATABASE,
            user=settings.JDE_PG_USER,
            password=settings.JDE_PG_PASSWORD,
            ssl=settings.JDE_PG_SSL
        )
        print("Connected!")
        
        tables = ["f41021", "f4101"]
        schema = settings.JDE_PG_SCHEMA
        
        for table in tables:
            print(f"\n--- Columns for {schema}.{table} ---")
            query = f"""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_schema = '{schema}' AND table_name = '{table}'
            """
            rows = await conn.fetch(query)
            for row in rows:
                print(f"{row['column_name']} ({row['data_type']})")
                
        await conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
