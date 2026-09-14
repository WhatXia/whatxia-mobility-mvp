-- Alinea el CMS publicado del flujo conductor con src/lib/bot-cms/catalog.ts.
-- Runtime del bot: cms() lee bot_messages (status=PUBLISHED, is_active=true).
--
-- NO ejecutar en remoto automáticamente. Aplicar a mano en el SQL editor de
-- Supabase (proyecto vquuizixlkqflmyiwvmy) cuando se quiera el copy nuevo en
-- producción. Los botones que envía WhatsApp salen del código (dispatch.ts);
-- el body publicado sí sobrescribe el catálogo de inmediato.

begin;

update public.bot_messages
set
  body = E'🚕 Nuevo servicio\n\n📍 Origen: {{pickup}}\n🏁 Destino: {{dropoff}}\n💰 Tarifa estimada: {{min}} - {{max}}\n{{passenger_line}}',
  content_type = 'interactive',
  interactive_payload = jsonb_build_object(
    'kind', 'buttons',
    'buttons', jsonb_build_array(
      jsonb_build_object('id', 'aceptar:{{tripId}}', 'title', '↩️ Aceptar', 'sort_order', 0),
      jsonb_build_object('id', 'rechazar:{{tripId}}', 'title', '❌ Rechazar', 'sort_order', 1)
    )
  ),
  updated_at = now()
where code = 'D_TRIP_OFFER';

update public.bot_messages
set
  body = E'✅ Servicio asignado\n\n👤 Pasajero: {{passenger_full_name}}\n📍 Dirígete al punto de recogida.',
  content_type = 'interactive',
  interactive_payload = jsonb_build_object(
    'kind', 'buttons',
    'buttons', jsonb_build_array(
      jsonb_build_object('id', 'ver_ubicacion:{{tripId}}', 'title', '📍 Ver ubicación', 'sort_order', 0),
      jsonb_build_object('id', 'llegue:{{tripId}}', 'title', '🚕 Llegué', 'sort_order', 1),
      jsonb_build_object('id', 'cancel_servicio:{{tripId}}', 'title', '❌ Cancelar servicio', 'sort_order', 2)
    )
  ),
  updated_at = now()
where code = 'D_SERVICE_ASSIGNED';

update public.bot_messages
set
  body = E'🚕 Llegaste al punto de recogida.\n\n💰 Recuerda cobrar el valor indicado por el taxímetro + $800 por solicitud del servicio.\n\nCuando el pasajero aborde, inicia el viaje.',
  content_type = 'interactive',
  interactive_payload = jsonb_build_object(
    'kind', 'buttons',
    'buttons', jsonb_build_array(
      jsonb_build_object('id', 'iniciar:{{tripId}}', 'title', '▶️ Iniciar viaje', 'sort_order', 0)
    )
  ),
  updated_at = now()
where code = 'D_START_TRIP_PROMPT';

update public.bot_messages
set
  body = E'🚕 Viaje iniciado\n\n🏁 Destino: {{dropoff_label}}',
  content_type = 'interactive',
  interactive_payload = jsonb_build_object(
    'kind', 'buttons',
    'buttons', jsonb_build_array(
      jsonb_build_object('id', 'navegar:{{tripId}}', 'title', '🧭 Navegar al destino', 'sort_order', 0),
      jsonb_build_object('id', 'finalizar:{{tripId}}', 'title', '🏁 Terminar viaje', 'sort_order', 1)
    )
  ),
  updated_at = now()
where code = 'D_IN_PROGRESS_SCREEN';

update public.bot_messages
set
  body = E'🏁 Viaje finalizado\n\n⭐ ¿Cómo fue tu experiencia con este pasajero?',
  content_type = 'interactive',
  interactive_payload = jsonb_build_object(
    'kind', 'buttons',
    'buttons', jsonb_build_array(
      jsonb_build_object('id', 'pax_rating:5:{{tripId}}', 'title', '⭐⭐⭐⭐⭐ Excelente', 'sort_order', 0),
      jsonb_build_object('id', 'pax_rating:4:{{tripId}}', 'title', '⭐⭐⭐⭐ Buena', 'sort_order', 1),
      jsonb_build_object('id', 'pax_rating:2:{{tripId}}', 'title', '⭐⭐⭐ Regular', 'sort_order', 2)
    )
  ),
  updated_at = now()
where code = 'D_RATE_PASSENGER_PROMPT';

-- Legacy: ya no se envían en el flujo feliz del código nuevo.
-- Se desactivan para que cms() no los sirva como PUBLISHED.
update public.bot_messages
set
  is_active = false,
  updated_at = now()
where code in (
  'D_ARRIVED_LEGACY_PROMPT',
  'D_RATE_PAX_THANKS',
  'D_RATE_PAX_THANKS_5'
);

-- Árbol conversacional (panel CMS). El bot de viaje no lo usa; se alinea
-- para que el copy del árbol no quede desfasado del publicado.
do $$
begin
  if to_regclass('public.bot_conversation_nodes') is null then
    return;
  end if;

  update public.bot_conversation_nodes
  set body = E'🚕 Nuevo servicio\n\n📍 Origen: {{pickup}}\n🏁 Destino: {{dropoff}}\n💰 Tarifa estimada: {{min}} - {{max}}\n{{passenger_line}}'
  where coalesce(message_code, code) = 'D_TRIP_OFFER';

  update public.bot_conversation_nodes
  set body = E'✅ Servicio asignado\n\n👤 Pasajero: {{passenger_full_name}}\n📍 Dirígete al punto de recogida.'
  where coalesce(message_code, code) = 'D_SERVICE_ASSIGNED';

  update public.bot_conversation_nodes
  set body = E'🚕 Llegaste al punto de recogida.\n\n💰 Recuerda cobrar el valor indicado por el taxímetro + $800 por solicitud del servicio.\n\nCuando el pasajero aborde, inicia el viaje.'
  where coalesce(message_code, code) = 'D_START_TRIP_PROMPT';

  update public.bot_conversation_nodes
  set body = E'🚕 Viaje iniciado\n\n🏁 Destino: {{dropoff_label}}'
  where coalesce(message_code, code) = 'D_IN_PROGRESS_SCREEN';

  update public.bot_conversation_nodes
  set body = E'🏁 Viaje finalizado\n\n⭐ ¿Cómo fue tu experiencia con este pasajero?'
  where coalesce(message_code, code) = 'D_RATE_PASSENGER_PROMPT';
end $$;

commit;
