-- Nov 21 (per Mely): Sunset Ridge demo map = the 21 Palms layout (aerial map, lots, amenities).
-- Sunset keeps its own lot names (B1 etc.), so residents, bookings and prices stay connected.
-- A backup of Sunset's old map is saved first in map_elements_backup_sunset_20261121.
create table if not exists map_elements_backup_sunset_20261121 as
  select * from map_elements where park_id = 'sunset-ridge';

do $$
declare
  cid uuid;
  geo_src jsonb := '[[8.56, 5.11, 6.63, 1.56], [8.56, 7.61, 6.63, 1.75], [8.56, 10.41, 6.63, 1.75], [8.56, 13.22, 6.63, 1.75], [8.56, 16.02, 6.63, 1.75], [19.57, 5.55, 2.85, 3.55], [24.46, 5.55, 2.75, 3.55], [29.26, 5.55, 2.85, 3.55], [34.25, 5.55, 2.85, 3.55], [39.25, 5.55, 2.75, 3.55], [44.04, 5.55, 2.85, 3.55], [48.93, 5.55, 2.75, 3.55], [53.72, 5.55, 2.85, 3.55], [20.39, 9.6, 2.75, 3.62], [25.38, 9.6, 2.75, 3.62], [30.28, 9.6, 2.85, 3.62], [35.27, 9.6, 2.85, 3.62], [40.16, 9.6, 2.75, 3.62], [45.06, 9.6, 2.85, 3.62], [50.05, 9.6, 2.75, 3.62], [54.74, 9.6, 2.85, 3.62], [20.49, 15.09, 2.85, 3.31], [25.38, 15.09, 2.75, 3.31], [30.17, 15.09, 2.85, 3.31], [35.17, 15.09, 2.75, 3.31], [39.96, 15.09, 2.85, 3.31], [44.75, 15.09, 2.75, 3.31], [50.15, 16.27, 7.95, 1.68], [50.15, 19.02, 7.95, 1.68], [50.15, 21.82, 7.95, 1.68], [50.15, 24.63, 7.95, 1.75], [50.15, 27.56, 7.95, 1.68], [50.15, 30.36, 7.95, 1.68], [50.15, 33.17, 7.95, 1.62], [50.15, 35.85, 7.95, 1.68], [50.15, 38.59, 7.95, 1.75], [50.15, 41.46, 7.95, 1.68], [50.15, 44.2, 7.95, 1.62], [50.15, 46.82, 7.95, 1.68], [50.15, 49.5, 7.95, 1.68], [50.15, 52.24, 7.95, 1.68], [50.15, 54.99, 7.95, 1.68], [50.15, 57.73, 7.95, 1.68], [50.15, 60.54, 7.95, 1.68], [50.15, 63.34, 7.95, 1.62], [50.15, 66.09, 7.95, 1.62], [50.15, 68.77, 7.95, 1.68], [50.15, 71.45, 7.95, 1.68], [50.15, 74.31, 7.95, 1.62], [50.15, 77.06, 7.95, 1.75], [60.51, 26.4, 9.46, 2.63], [60.51, 29.03, 9.46, 2.63], [60.51, 31.67, 9.46, 2.63], [60.51, 34.3, 9.46, 2.63], [60.51, 36.94, 9.46, 2.63], [60.51, 39.57, 9.46, 2.63], [60.51, 42.2, 9.46, 2.63], [60.51, 44.84, 9.46, 2.63], [60.51, 47.47, 9.46, 2.63], [60.51, 50.11, 9.46, 2.63], [60.51, 52.74, 9.46, 2.63], [60.51, 55.37, 9.46, 2.63], [60.51, 58.01, 9.46, 2.63], [71.92, 26.51, 9.57, 2.62], [71.92, 29.13, 9.57, 2.62], [71.92, 31.75, 9.57, 2.62], [71.92, 34.36, 9.57, 2.62], [71.92, 36.98, 9.57, 2.62], [71.92, 39.6, 9.57, 2.62], [71.92, 42.22, 9.57, 2.62], [71.92, 44.84, 9.57, 2.62], [71.92, 47.46, 9.57, 2.62], [71.92, 50.08, 9.57, 2.62], [71.92, 52.69, 9.57, 2.62], [71.92, 55.31, 9.57, 2.62], [71.92, 57.93, 9.57, 2.62], [83.49, 26.16, 7.85, 2.6], [83.49, 28.76, 7.85, 2.6], [83.49, 31.36, 7.85, 2.6], [83.49, 33.97, 7.85, 2.6], [83.49, 36.57, 7.85, 2.6], [83.49, 39.17, 7.85, 2.6], [83.49, 41.77, 7.85, 2.6], [83.49, 44.38, 7.85, 2.6], [83.49, 46.98, 7.85, 2.6], [83.49, 49.58, 7.85, 2.6], [83.49, 52.19, 7.85, 2.6], [83.49, 54.79, 7.85, 2.6], [83.49, 57.39, 7.85, 2.6], [23.65, 82.29, 2.75, 3.24], [28.44, 82.29, 2.65, 3.24], [33.13, 82.29, 2.65, 3.24], [37.72, 82.29, 2.65, 3.24], [42.3, 82.29, 2.65, 3.24], [46.99, 82.29, 2.55, 3.24], [23.45, 87.53, 2.75, 3.55], [28.24, 87.53, 2.75, 3.55], [33.03, 87.53, 2.75, 3.55], [37.72, 87.53, 2.65, 3.55], [42.41, 87.53, 2.65, 3.55], [47.1, 87.53, 2.55, 3.55], [10.26, 80.49, 6.73, 1.75], [6.8, 82.36, 6.73, 1.75], [5.57, 85.27, 6.73, 1.75], [7.2, 88.01, 6.73, 1.75], [10.66, 89.63, 6.73, 1.75]]'::jsonb;
  rot_src jsonb := '[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 25.2, 22.8, 22.8, 22.8, 22.8, 22.8, 22.8, 22.8, 22.8, 22.8, 22.8, 22.8, 22.8, 22.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 65.0, 32.0, -3.0, -37.0, -68.0]'::jsonb;
  geo jsonb := '{}'::jsonb;
  rot jsonb := '{}'::jsonb;
  r record;
begin
  select id into cid from companies where park_id = 'sunset-ridge' limit 1;
  if cid is null then raise exception 'Sunset Ridge not found'; end if;
  for r in
    select lot_name, row_number() over (
      order by regexp_replace(lot_name, '[0-9]+', '', 'g'),
               coalesce(nullif(regexp_replace(lot_name, '[^0-9]', '', 'g'), '')::int, 0), lot_name) as n
    from rv_lots where company_id = cid
  loop
    exit when r.n > jsonb_array_length(geo_src);
    geo := geo || jsonb_build_object(r.lot_name, geo_src -> (r.n::int - 1));
    rot := rot || jsonb_build_object(r.lot_name, rot_src -> (r.n::int - 1));
  end loop;

  delete from map_elements where park_id = 'sunset-ridge'
    and element_type in ('mapImage','lotGeometry','rotations','emojis','texts','shapes','emojiRotations','textRotations');
  insert into map_elements (park_id, company_id, element_type, element_key, data) values
    ('sunset-ridge', cid, 'mapImage',    'all', '{"url":"https://aloha-rv-park-lilac.vercel.app/sunset-ridge-map.jpg","width":981,"height":1604}'::jsonb),
    ('sunset-ridge', cid, 'lotGeometry', 'all', geo),
    ('sunset-ridge', cid, 'rotations',   'all', rot),
    ('sunset-ridge', cid, 'emojis',      'all', '[{"id": "s1", "emoji": "🏠", "x": 66.34, "y": 69.84, "size": 22, "label": "Clubhouse", "info": "Office: check-in, payments and activities. Mon–Sat 9am–5pm"}, {"id": "s2", "emoji": "🏋️", "x": 73.54, "y": 71.77, "size": 16, "label": "Fitness room", "info": "Residents and registered guests · Daily 6am–10pm"}, {"id": "s3", "emoji": "🏊", "x": 81.86, "y": 71.7, "size": 24, "label": "Pool", "info": "No lifeguard — swim at your own risk · Daily 9am–9pm"}, {"id": "s4", "emoji": "♿", "x": 70.53, "y": 67.8, "size": 14, "label": "Accessible parking", "info": ""}, {"id": "s5", "emoji": "🔥", "x": 66.16, "y": 72.51, "size": 16, "label": "Propane", "info": "Tanks filled on site · Pay online with the QR code or charge it to your account · Mon–Sat 9am–4pm"}, {"id": "s6", "emoji": "🧺", "x": 73.39, "y": 69.75, "size": 18, "label": "Laundry", "info": "Inside the clubhouse · Daily 7am–10pm"}, {"id": "s7", "emoji": "🎣", "x": 78.89, "y": 77.94, "size": 24, "label": "Fishing Lake", "info": "Residents and registered guests · Sunrise to sunset"}, {"id": "s8", "emoji": "🥌", "x": 78.0, "y": 22.0, "size": 22, "label": "Shuffleboard", "info": "Residents and registered guests"}]'::jsonb),
    ('sunset-ridge', cid, 'texts',       'all', '[]'::jsonb),
    ('sunset-ridge', cid, 'shapes',      'all', '{}'::jsonb);
end $$;

select (select count(*) from rv_lots l join companies c on c.id = l.company_id where c.park_id = 'sunset-ridge') as sunset_lots,
       (select count(*) from jsonb_object_keys((select data from map_elements where park_id='sunset-ridge' and element_type='lotGeometry'))) as lots_on_new_map;
