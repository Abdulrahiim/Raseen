/** Fetch wrappers. A response without the provenance envelope is treated as an error. */
function checkEnvelope(body, url) {
  if (!body || typeof body.classification !== "string" || typeof body.disclaimer !== "string") {
    throw new Error(`Response from ${url} carries no classification/disclaimer envelope`);
  }
  return body;
}

export async function getJSON(url) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ? JSON.stringify(body.detail) : `${response.status} ${response.statusText}`);
  return checkEnvelope(body, url);
}

export async function postJSON(url, payload) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ? JSON.stringify(body.detail) : `${response.status} ${response.statusText}`);
  return checkEnvelope(body, url);
}
