-- Alinea el CMS publicado del flujo conductor con src/lib/bot-cms/catalog.ts.
-- Runtime: cms() lee bot_messages (status=PUBLISHED, is_active=true).
--
-- NO ejecutar en remoto automáticamente. Aplicar a mano en el SQL editor de
-- Supabase cuando se quiera el copy nuevo en producción.
--
-- Los botones de WhatsApp del viaje salen de dispatch.ts / driver-menu.ts.
-- El body publicado sí sobrescribe el catálogo de inmediato.
-- No toca bot_conversation_nodes (el flujo de viaje no los usa).

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
  body = E'✅ Servicio asignado\n\n👤 Pasajero: {{passenger_full_name}}\n\n📍 Punto de recogida:\n{{pickup_block}}',
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
  body = E'🚕 Llegaste al punto de recogida.\n\nCuando el pasajero aborde, inicia el viaje.',
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

update public.bot_messages
set
  body = E'🙏 ¡Gracias! Registramos tu calificación. ⭐',
  content_type = 'text',
  interactive_payload = '{}'::jsonb,
  is_active = true,
  status = 'PUBLISHED',
  updated_at = now()
where code in ('D_RATE_PAX_THANKS', 'D_RATE_PAX_THANKS_5');

-- Legacy: ya no se envía en el flujo feliz.
update public.bot_messages
set
  is_active = false,
  updated_at = now()
where code = 'D_ARRIVED_LEGACY_PROMPT';

commit;
