// Tiny fetch wrapper around the local API. All endpoints are same-origin.

async function asJson(res) {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error ?? message; } catch { /* ignore */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  getState: () => fetch('/api/state').then(asJson),

  decide: (key, decision) =>
    fetch('/api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, decision }),
    }).then(asJson),

  validateImport: (key, file) =>
    fetch(`/api/import/${encodeURIComponent(key)}/validate?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    }).then(asJson),

  confirmImport: (key) =>
    fetch(`/api/import/${encodeURIComponent(key)}/confirm`, { method: 'POST' }).then(asJson),

  // Image URL helper — cache-busted so an updated baseline reloads.
  imageUrl: (key, kind, v = '') =>
    `/api/image/${encodeURIComponent(key)}/${kind}${v ? `?v=${v}` : ''}`,
};
