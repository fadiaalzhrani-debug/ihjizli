-- احجزلي · دفع وصل بعد انتهاء مهلة الحجز: نرجّع الموعد لو لسا فاضي (والا يتحوّل للمنشأة)
begin;
create or replace function public.ihj_reinstate(p_order uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.orders; v_buf int; v_mode text; v_busy int; v_cap int; v_staff uuid;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.status <> 'cancelled' or o.cancel_reason <> 'unpaid' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('ihj_book:' || o.business_id::text, 0));
  if o.slot_start < now() then return false; end if;
  select capacity_mode, capacity_per_slot, buffer_minutes into v_mode, v_cap, v_buf from public.settings where business_id = o.business_id;
  if v_mode = 'staff' and o.staff_id is not null then
    if exists (select 1 from public.orders x where x.staff_id = o.staff_id and x.id <> o.id and x.status <> 'cancelled'
                 and x.slot_start < o.slot_end + make_interval(mins => v_buf) and x.slot_end + make_interval(mins => v_buf) > o.slot_start) then
      v_staff := public.ihj_pick_staff(o.business_id, o.city_id, o.slot_start, o.slot_end, o.id);
      if v_staff is null then return false; end if;
      update public.orders set staff_id = v_staff where id = o.id;
    end if;
  else
    select count(*) into v_busy from public.orders x
     where x.business_id = o.business_id and x.id <> o.id and x.status <> 'cancelled'
       and x.slot_start < o.slot_end and x.slot_end > o.slot_start;
    if v_busy >= coalesce(v_cap, 1) then return false; end if;
  end if;
  update public.orders set status = 'pending_payment', cancelled_at = null, cancelled_by = '', cancel_reason = '',
         hold_until = now() + interval '5 minutes' where id = o.id;
  insert into public.order_events (business_id, order_id, kind, data, by_who) values (o.business_id, o.id, 'reinstated', '{}'::jsonb, 'system');
  return true;
end $$;
revoke all on function public.ihj_reinstate(uuid) from public, anon, authenticated;
grant execute on function public.ihj_reinstate(uuid) to service_role;
commit;
