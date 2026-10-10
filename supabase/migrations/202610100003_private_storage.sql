-- Private storage for future notes/submissions. POC videos stay in Drive.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('uyym-private','uyym-private',false,5242880,array['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/x-c++src'])
on conflict(id) do update set public = false,file_size_limit = excluded.file_size_limit,allowed_mime_types = excluded.allowed_mime_types;

-- Restrictive policies defeat permissive policies somebody may later add.
-- Backend uses service-role Storage API AFTER all application checks.
-- Never issue a student a Storage signed URL or service-role credential.
create policy uyym_deny_browser_select on storage.objects as restrictive for select to anon,authenticated using(bucket_id <> 'uyym-private');
create policy uyym_deny_browser_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id <> 'uyym-private');
create policy uyym_deny_browser_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id <> 'uyym-private') with check(bucket_id <> 'uyym-private');
create policy uyym_deny_browser_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id <> 'uyym-private');
commit;
