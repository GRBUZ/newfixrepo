/* Netlify Functions – Minimal status (returns sold cells) */
const { getStore } = require('@netlify/blobs');
const STORE = 'reservations';
const STATE_KEY = 'state';

function headers() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
}
function res(statusCode, obj){ return { statusCode, headers: headers(), body: JSON.stringify(obj) }; }

exports.handler = async (event) => {
  try {
    const method = String(event.httpMethod || '').toUpperCase();
    if (method === 'OPTIONS') return res(204, {});
    if (method !== 'GET') return res(405, { ok:false, error:'METHOD_NOT_ALLOWED' });
    const { getStore } = require('@netlify/blobs');
    const store = getStore(STORE, { consistency: 'strong' });
    const state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {} };
    return res(200, { ok:true, artCells: state.sold });
  } catch (e) {
    console.error('status error', e);
    return res(500, { ok:false, error:'SERVER_ERROR', message: e && e.message ? e.message : String(e) });
  }
};
