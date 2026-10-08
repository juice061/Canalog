-- ============================================================================
-- CanaLog — estrutura do banco no Supabase
-- Como usar: supabase.com → seu projeto → SQL Editor → New query →
--            cole TUDO isto → Run. Pode rodar mais de uma vez sem problema.
-- ============================================================================

-- ---------- Tabelas ----------
create table if not exists public.motoristas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  telefone       text,
  placa          text,
  numero         text,          -- nº do motorista no extrato da usina (ex: 00500152)
  numero_veiculo text,          -- nº do veículo no extrato da usina (ex: 00025567)
  ativo          boolean not null default true,
  foto_path      text,          -- caminho da foto de perfil no Storage
  created_at     timestamptz not null default now()
);

create table if not exists public.viagens (
  id             uuid primary key default gen_random_uuid(),
  produtor       text not null,
  motorista_id   uuid references public.motoristas(id) on delete set null,
  motorista_nome text,          -- guardado também aqui pra o histórico não sumir se o motorista for excluído
  placa          text,
  destino        text,
  toneladas      numeric not null,
  valor_bruto    numeric not null default 0,
  valor          numeric not null default 0,
  status         text not null default 'em_rota' check (status in ('em_rota', 'pendente', 'pago')),
  data           date not null default current_date,
  created_at     timestamptz not null default now()
);

create table if not exists public.fotos (
  id          uuid primary key default gen_random_uuid(),
  viagem_id   uuid not null references public.viagens(id) on delete cascade,
  path        text not null,    -- caminho da imagem no Storage
  observacao  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.config (
  chave  text primary key,
  valor  jsonb not null
);

insert into public.config (chave, valor) values ('valor_por_tonelada', '10')
on conflict (chave) do nothing;

create index if not exists viagens_data_idx       on public.viagens (data desc);
create index if not exists viagens_motorista_idx  on public.viagens (motorista_id);
create index if not exists fotos_viagem_idx       on public.fotos (viagem_id);

-- ---------- Segurança (RLS): só usuários logados acessam ----------
alter table public.motoristas enable row level security;
alter table public.viagens    enable row level security;
alter table public.fotos      enable row level security;
alter table public.config     enable row level security;

drop policy if exists "logados acessam motoristas" on public.motoristas;
drop policy if exists "logados acessam viagens"    on public.viagens;
drop policy if exists "logados acessam fotos"      on public.fotos;
drop policy if exists "logados acessam config"     on public.config;

create policy "logados acessam motoristas" on public.motoristas for all to authenticated using (true) with check (true);
create policy "logados acessam viagens"    on public.viagens    for all to authenticated using (true) with check (true);
create policy "logados acessam fotos"      on public.fotos      for all to authenticated using (true) with check (true);
create policy "logados acessam config"     on public.config     for all to authenticated using (true) with check (true);

-- ---------- Storage: bucket PRIVADO pras fotos ----------
insert into storage.buckets (id, name, public)
values ('canalog', 'canalog', false)
on conflict (id) do nothing;

drop policy if exists "logados leem fotos canalog"    on storage.objects;
drop policy if exists "logados enviam fotos canalog"  on storage.objects;
drop policy if exists "logados alteram fotos canalog" on storage.objects;
drop policy if exists "logados apagam fotos canalog"  on storage.objects;

create policy "logados leem fotos canalog"    on storage.objects for select to authenticated using (bucket_id = 'canalog');
create policy "logados enviam fotos canalog"  on storage.objects for insert to authenticated with check (bucket_id = 'canalog');
create policy "logados alteram fotos canalog" on storage.objects for update to authenticated using (bucket_id = 'canalog');
create policy "logados apagam fotos canalog"  on storage.objects for delete to authenticated using (bucket_id = 'canalog');

-- ---------- Tempo real (sincroniza entre aparelhos) ----------
do $$
declare t text;
begin
  foreach t in array array['motoristas', 'viagens', 'fotos', 'config'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
