-- MVP taxímetro: meter_value opcional (ya no se pide el valor del taxímetro físico).

alter table public.taximeter_test_runs
  alter column meter_value drop not null;

alter table public.taximeter_test_runs
  alter column difference_pesos drop not null;

alter table public.taximeter_test_runs
  alter column difference_percent drop not null;

comment on column public.taximeter_test_runs.meter_value is
  'Valor del taxímetro físico (opcional en MVP simplificado).';
