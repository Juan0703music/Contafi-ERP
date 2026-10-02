-- Los precios son públicos: el sitio web los lee sin sesión (una sola fuente: la misma tabla que aplica
-- los límites). Solo lectura; nadie los cambia desde fuera.
create policy planes_publicos on public.planes for select to anon using (true);
grant select on public.planes to anon;
