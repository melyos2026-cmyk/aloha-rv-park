import { createClient } from "@supabase/supabase-js";
import { checkEditToken } from "./_editTokenAuth.js";

// Aug 12 (per Mely — "coordinates keep reverting after refresh"): the
// browser was writing to map_elements directly with the public anon key
// (VITE_SUPABASE_KEY). If this table's RLS silently blocks anon-key
// DELETE/INSERT (the exact same pattern that caused silent failures on
// many other tables throughout this whole project), saves could appear
// to succeed in the browser (fetch resolves, no thrown error) while
// actually doing nothing or leaving duplicate rows behind — matching
// exactly what was observed. Routes through the Service Role Key
// instead, which bypasses RLS entirely, same fix pattern already used
// for lot-data/set-lot-pricing/etc.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { parkId, type } = req.query;
    if (!parkId || !type) {
      return res.status(400).json({ error: "parkId and type are required." });
    }
    const { data, error } = await supabaseAdmin
      .from("map_elements")
      .select("*")
      .eq("park_id", parkId)
      .eq("element_type", type)
      .order("id", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  if (req.method === "POST") {
    // Aug 19 (public-site audit): had ZERO auth check on writes — anyone
    // who found this URL could overwrite any park's lot statuses OR
    // emojis with no login at all. GET (reading the current map state,
    // including emojis) stays fully public/unauthenticated on purpose —
    // the map itself is meant to be publicly viewable. Only writing now
    // requires a valid edit token, same fix pattern as set-lot-pricing.js.
    const { parkId, companyId, type, key, data, token } = req.body;
    if (!parkId || !type || !key) {
      return res.status(400).json({ error: "parkId, type, and key are required." });
    }

    const auth = await checkEditToken(token, parkId, supabaseAdmin);
    if (!auth.valid) {
      return res.status(403).json({ error: "Not authorized to edit this map." });
    }

    // Delete-then-insert: guarantees exactly one row always exists for
    // this park/type/key, regardless of whether an on_conflict unique
    // constraint actually exists in the database.
    const { error: delError } = await supabaseAdmin
      .from("map_elements")
      .delete()
      .eq("park_id", parkId)
      .eq("element_type", type)
      .eq("element_key", key);
    if (delError) return res.status(500).json({ error: "Delete step failed: " + delError.message });

    const { error: insError } = await supabaseAdmin
      .from("map_elements")
      .insert({ park_id: parkId, company_id: companyId || null, element_type: type, element_key: key, data });
    if (insError) return res.status(500).json({ error: "Insert step failed: " + insError.message });

    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}
