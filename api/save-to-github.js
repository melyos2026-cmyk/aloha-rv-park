export default async function handler(req, res) {
  if (req.method === 'GET') {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/src/App.jsx`, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" }
    });
    const data = await getRes.json();
    res.status(getRes.status).json(data);
  } else if (req.method === 'PUT') {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    const body = req.body;
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/src/App.jsx`, {
      method: 'PUT',
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await putRes.json();
    res.status(putRes.status).json(data);
  } else {
    res.status(405).end();
  }
}
