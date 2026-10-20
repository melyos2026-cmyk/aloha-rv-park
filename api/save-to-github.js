import { checkEditToken } from './_editTokenAuth.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Aug 19 (public-site audit): had ZERO auth check of any kind — anyone
// who found this URL could overwrite the map app's own live source code
// (src/App.jsx) on GitHub with arbitrary content, with no login at all.
// This was, along with the other 5 map write endpoints found the same
// day, the most severe finding of the whole audit. Now requires a valid
// edit token on BOTH the GET (reads the file's current SHA — a
// prerequisite for a legitimate edit, no reason to leave it open) and
// the PUT (the actual commit).
export default async function handler(req, res) {
  const parkId = req.method === 'GET' ? req.query.parkId : req.body?.parkId;
  const token = req.method === 'GET' ? req.query.token : req.body?.token;
  // Oct 20 (security review): ANY park's edit token (including a
  // restricted park_admin token for a different tenant) could commit
  // src/App.jsx — the single shared source file for EVERY park's map.
  // Now requires a master_admin token (role is embedded in the signed
  // token and only issued by melyos-builder to real master_admin
  // sessions — see generate-map-edit-token/route.ts). Nothing in this
  // repo's frontend calls this endpoint, so no working feature changes.
  const auth = await checkEditToken(token, parkId || 'aloha', supabase, 'master_admin');
  if (!auth.valid) {
    return res.status(403).json({ error: 'Not authorized to edit this map.' });
  }

  if (req.method === 'GET') {
    const ghToken = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/src/App.jsx`, {
      headers: { Authorization: `token ${ghToken}`, Accept: "application/vnd.github.v3+json" }
    });
    const data = await getRes.json();
    res.status(getRes.status).json(data);
  } else if (req.method === 'PUT') {
    const ghToken = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    // Oct 20 (security review): previously forwarded req.body verbatim to
    // GitHub — including our own parkId/token, and any extra GitHub API
    // fields the caller chose (branch, committer, author...). Now only the
    // three fields a content update needs are forwarded, and the path stays
    // fixed to src/App.jsx.
    const { message, content, sha } = req.body || {};
    if (typeof message !== 'string' || typeof content !== 'string' || !message || !content) {
      return res.status(400).json({ error: 'message and content are required.' });
    }
    const body = { message, content };
    if (typeof sha === 'string' && sha) body.sha = sha;
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/src/App.jsx`, {
      method: 'PUT',
      headers: { Authorization: `token ${ghToken}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await putRes.json();
    res.status(putRes.status).json(data);
  } else {
    res.status(405).end();
  }
}
