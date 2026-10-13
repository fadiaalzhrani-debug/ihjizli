-- العملاء المحتملين: قائمة أنشطة من البحث (انستقرام وتيك توك وسناب والخرائط) ترسل لهم فادية من لوحتها،
-- مع رسالة لكل مجال. للمدير بس، والقائمة نفسها ما تنحط في ملفات الموقع لأن المستودع عام.

create table if not exists public.prospects (
  id text primary key,
  name text not null,
  segment text not null default '',
  seg_key text not null default 'general',
  city text not null default '',
  district text not null default '',
  instagram text not null default '',
  tiktok text not null default '',
  snapchat text not null default '',
  website text not null default '',
  maps_url text not null default '',
  phone text not null default '',
  whatsapp_signal boolean not null default false,
  how_they_take_orders text not null default '',
  followers text not null default '',
  why_fit text not null default '',
  source_url text not null default '',
  fit int not null default 3 check (fit between 0 and 5),
  checked boolean not null default true,
  status text not null default 'new' check (status in ('new', 'sent', 'replied', 'hot', 'no')),
  note text not null default '' check (char_length(note) <= 500),
  status_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists prospects_seg on public.prospects (seg_key);

create table if not exists public.prospect_msgs (
  key text primary key,
  segment text not null default '',
  demo text not null default '',
  message text not null default '',
  followup text not null default '',
  pains jsonb not null default '[]'::jsonb,
  opener_tip text not null default '',
  sort int not null default 0
);

alter table public.prospects enable row level security;
alter table public.prospect_msgs enable row level security;
revoke all on public.prospects, public.prospect_msgs from anon;
grant select, insert, update, delete on public.prospects, public.prospect_msgs to authenticated;
drop policy if exists p_prospects_admin on public.prospects;
create policy p_prospects_admin on public.prospects for all to authenticated using (public.ihj_is_admin()) with check (public.ihj_is_admin());
drop policy if exists p_prospect_msgs_admin on public.prospect_msgs;
create policy p_prospect_msgs_admin on public.prospect_msgs for all to authenticated using (public.ihj_is_admin()) with check (public.ihj_is_admin());
