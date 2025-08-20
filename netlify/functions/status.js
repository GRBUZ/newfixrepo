// netlify/functions/status.js — returns sold, locks, regions (CommonJS style)
const STATE_PATH = process.env.STATE_PATH || "data/state.json";
const GH_REPO = process.env.GH_REPO;
const GH_TOKEN = process.env.GH_TOKEN;
const GH_BRANCH = process.env.GH_BRANCH || "main";

function jres(status, obj) {
  return {
    statusCode: status,
    body: JSON.stringify(obj),
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  };
}

async function ghGetFile(path) {
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(GH_BRANCH)}`;
  const r = await fetch(url, {
    headers: { "Authorization": `Bearer ${GH_TOKEN}`, "Accept": "application/vnd.github+json" }
  });
  if (r.status === 404) return { sha: null, content: null, status: 404 };
  if (!r.ok) throw new Error(`GITHUB_GET_FAILED ${r.status}`);
  const data = await r.json();
  const content = Buffer.from(data.content || "", "base64").toString("utf-8");
  return { sha: data.sha, content, status: 200 };
}

function safeParse(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch (e) {
    return {};
  }
}

exports.handler = async (event) => {
  try {
    if (!GH_REPO || !GH_TOKEN) {
      return jres(500, { ok: false, error: "GITHUB_CONFIG_MISSING" });
    }

    const got = await ghGetFile(STATE_PATH);
    if (got.status === 404) {
      return jres(200, { ok: true, sold: {}, locks: {}, regions: {} });
    }

    const state = safeParse(got.content);
    const sold = state.sold || {};
    const locks = state.locks || {};
    const regions = state.regions || {};
    return jres(200, { ok: true, sold, locks, regions });
  } catch (e) {
    console.error('[status] Error:', e);
    return jres(500, { ok: false, error: 'SERVER_ERROR', message: String(e) });
  }
};