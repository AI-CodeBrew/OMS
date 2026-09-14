"""Corrective migration.

0017 was already applied against this database with an earlier version of
the Ticket/TicketMessage models (before number/priority/assignment/
is_internal existed) - editing that migration file afterward doesn't
retroactively change what already ran, and Django's migration bookkeeping
matches by (app, name), not by content, so it silently skips 0017 now
regardless of what the file currently contains.

This migration brings the real table in line with the model state 0017
already claims to have created, using `if not exists`/idempotent guards
throughout so it's safe to run whether the earlier columns are fully,
partially, or not at all present. No state_operations needed - the app's
migration-state graph (what makemigrations diffs against) already has
these fields from 0017's CreateModel; only the database itself is behind.
"""

from django.db import migrations

FIX_SQL = """
create sequence if not exists oms.tickets_number_seq;

alter table oms.tickets add column if not exists number bigint;
alter table oms.tickets alter column number set default nextval('oms.tickets_number_seq');
update oms.tickets set number = nextval('oms.tickets_number_seq') where number is null;
alter table oms.tickets alter column number set not null;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'tickets_number_key') then
        alter table oms.tickets add constraint tickets_number_key unique (number);
    end if;
end $$;

alter sequence oms.tickets_number_seq owned by oms.tickets.number;

alter table oms.tickets add column if not exists priority varchar(10) not null default 'medium';
alter table oms.tickets add column if not exists assigned_to_user_id uuid;
alter table oms.tickets add column if not exists assigned_to_email varchar(255) not null default '';

alter table oms.ticket_messages add column if not exists is_internal boolean not null default false;

create index if not exists oms_ticket_org_priority_idx on oms.tickets (organization_id, priority);
"""

REVERSE_SQL = """
drop index if exists oms.oms_ticket_org_priority_idx;
alter table oms.ticket_messages drop column if exists is_internal;
alter table oms.tickets drop column if exists assigned_to_email;
alter table oms.tickets drop column if exists assigned_to_user_id;
alter table oms.tickets drop column if exists priority;
alter table oms.tickets drop constraint if exists tickets_number_key;
alter table oms.tickets drop column if exists number;
drop sequence if exists oms.tickets_number_seq;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0017_ticket_ticketmessage"),
    ]

    operations = [
        migrations.RunSQL(sql=FIX_SQL, reverse_sql=REVERSE_SQL),
    ]
