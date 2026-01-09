-- Trigger de Seguridad para Supabase Auth
-- Objetivo: Impedir que se crea cualquier usuario cuyo email no termine en @aura.cl
-- Instrucciones: Ejecuta este script en el SQL Editor de tu proyecto en Supabase.

-- 1. Crear la función que valida el dominio
create or replace function public.validate_aura_domain()
returns trigger as $$
begin
  -- Verifica si el email del nuevo usuario termina en @aura.cl
  -- split_part no es tan robusto como regex, asi que usamos ILIKE que es case-insensitive
  if new.email not ilike '%@aura.cl' then
    raise exception 'Acceso Denegado: Solo se permiten cuentas del dominio @aura.cl';
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- 2. Crear el trigger que se dispara ANTES de insertar en la tabla auth.users
-- NOTA: Si ya existe un trigger similar, deberás borrarlo primero.
drop trigger if exists check_user_domain_aura on auth.users;

create trigger check_user_domain_aura
  before insert on auth.users
  for each row execute procedure public.validate_aura_domain();

-- Opcional: Si quieres impedir también que CAMBIEN su email a uno no-aura
drop trigger if exists check_user_email_update_aura on auth.users;

create trigger check_user_email_update_aura
  before update on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute procedure public.validate_aura_domain();
