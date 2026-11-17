const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const nowIso = () => new Date().toISOString();
const validDeviceId = (value) => typeof value === "string" && /^[A-F0-9]{24}$/.test(value);

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.SITE_ORIGIN || "https://www.l30.tec.br").split(",").map(v => v.trim());
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function response(data, request, env, status = 200) {
  const headers = corsHeaders(request, env);
  headers["content-type"] = "application/json; charset=utf-8";
  headers["cache-control"] = "no-store";
  return new Response(JSON.stringify(data), { status, headers });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function canonicalLicensePayload({ deviceId, customer, issuedOn, expiresOn, serial }) {
  // Property order deliberately matches Python json.dumps(sort_keys=True, separators=(",", ":"))
  return {
    customer,
    device_id: deviceId,
    expires_on: expiresOn,
    issued_on: issuedOn,
    plan: "annual",
    product: "FloatingCamera",
    serial
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signLicense(payload, env) {
  if (!env.LICENSE_PRIVATE_KEY_PKCS8_B64) throw new Error("License signing key is not configured");
  const binary = atob(env.LICENSE_PRIVATE_KEY_PKCS8_B64);
  const keyBytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8", keyBytes, { name: "Ed25519" }, false, ["sign"]
  );
  const message = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, message);
  return { payload, signature: bytesToBase64(signature) };
}

async function verifyWebhookSignature(request, env) {
  if (!env.MERCADOPAGO_WEBHOOK_SECRET) return false;
  const signatureHeader = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const dataId = new URL(request.url).searchParams.get("data.id") || "";
  const parts = Object.fromEntries(signatureHeader.split(",").map(part => {
    const index = part.indexOf("=");
    return index > -1 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ["", ""];
  }).filter(([key]) => key));
  if (!parts.ts || !parts.v1 || !requestId || !dataId) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.MERCADOPAGO_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== parts.v1.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return mismatch === 0;
}

async function startTrial(request, env) {
  const body = await readJson(request);
  const deviceId = String(body?.device_id || "").toUpperCase();
  if (!validDeviceId(deviceId)) return response({ error: "invalid_device_id" }, request, env, 400);

  const now = new Date();
  const existing = await env.DB.prepare(
    "SELECT started_at FROM trials WHERE device_id = ?"
  ).bind(deviceId).first();

  if (!existing) {
    await env.DB.prepare(
      "INSERT INTO trials (device_id, started_at, last_seen_at) VALUES (?, ?, ?)"
    ).bind(deviceId, nowIso(), nowIso()).run();
  } else {
    await env.DB.prepare(
      "UPDATE trials SET last_seen_at = ? WHERE device_id = ?"
    ).bind(nowIso(), deviceId).run();
  }

  const trial = existing?.started_at ? new Date(existing.started_at) : now;
  const expires = addDays(trial, 7);
  const remainingMs = Math.max(0, expires.getTime() - now.getTime());
  const daysLeft = Math.ceil(remainingMs / 86400000);
  return response({
    status: remainingMs > 0 ? "trial" : "expired",
    started_at: trial.toISOString(),
    expires_at: expires.toISOString(),
    days_left: daysLeft
  }, request, env);
}

async function createCheckout(request, env) {
  const body = await readJson(request);
  const name = String(body?.name || "").trim().slice(0, 120);
  const email = String(body?.email || "").trim().toLowerCase().slice(0, 254);
  const deviceId = String(body?.device_id || "").toUpperCase();
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validDeviceId(deviceId)) {
    return response({ error: "invalid_customer_or_device" }, request, env, 400);
  }
  if (!env.MERCADOPAGO_ACCESS_TOKEN) return response({ error: "payment_provider_not_configured" }, request, env, 503);
  if (!env.ANNUAL_PRICE_BRL || !/^\d+\.\d{2}$/.test(env.ANNUAL_PRICE_BRL)) {
    return response({ error: "annual_price_not_configured" }, request, env, 503);
  }

  const existingLicense = await env.DB.prepare(
    "SELECT id FROM licenses WHERE device_id = ? AND status = 'active'"
  ).bind(deviceId).first();
  if (existingLicense) return response({ error: "device_already_licensed" }, request, env, 409);

  let customer = await env.DB.prepare(
    "SELECT id FROM customers WHERE email = ?"
  ).bind(email).first();
  if (!customer) {
    const customerId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO customers (id, name, email, created_at) VALUES (?, ?, ?, ?)"
    ).bind(customerId, name, email, nowIso()).run();
    customer = { id: customerId };
  } else {
    await env.DB.prepare(
      "UPDATE customers SET name = ? WHERE id = ?"
    ).bind(name, customer.id).run();
  }

  const localOrderId = crypto.randomUUID();
  const amount = env.ANNUAL_PRICE_BRL;
  await env.DB.prepare(
    "INSERT INTO orders (id, customer_id, device_id, external_reference, amount_brl, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'creating', ?, ?)"
  ).bind(localOrderId, customer.id, deviceId, localOrderId, amount, nowIso(), nowIso()).run();

  const mpResponse = await fetch("https://api.mercadopago.com/v1/orders", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": crypto.randomUUID()
    },
    body: JSON.stringify({
      type: "online",
      processing_mode: "manual",
      capture_mode: "automatic_async",
      total_amount: amount,
      external_reference: localOrderId,
      description: "Floating Camera — licença anual (1 dispositivo)",
      payer: { email },
      items: [{ title: "Floating Camera — licença anual", quantity: 1, unit_price: amount }]
    })
  });
  const mpOrder = await mpResponse.json().catch(() => ({}));
  if (!mpResponse.ok || !mpOrder.id || !mpOrder.checkout_url) {
    await env.DB.prepare(
      "UPDATE orders SET status = 'provider_error', updated_at = ? WHERE id = ?"
    ).bind(nowIso(), localOrderId).run();
    return response({ error: "checkout_creation_failed", provider_status: mpResponse.status }, request, env, 502);
  }

  await env.DB.prepare(
    "UPDATE orders SET provider_order_id = ?, status = ?, updated_at = ? WHERE id = ?"
  ).bind(mpOrder.id, mpOrder.status || "created", nowIso(), localOrderId).run();

  return response({ checkout_url: mpOrder.checkout_url, order_reference: localOrderId }, request, env, 201);
}

async function handleMercadoPagoWebhook(request, env) {
  if (!(await verifyWebhookSignature(request, env))) return json({ error: "invalid_signature" }, 401);
  const dataId = new URL(request.url).searchParams.get("data.id");
  if (!dataId) return json({ received: true });

  const providerResponse = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`, {
    headers: { "Authorization": `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}` }
  });
  if (!providerResponse.ok) return json({ error: "provider_order_lookup_failed" }, 502);
  const order = await providerResponse.json();
  if (!order.external_reference) return json({ received: true, ignored: true });

  const local = await env.DB.prepare(
    "SELECT * FROM orders WHERE id = ? AND provider_order_id = ?"
  ).bind(order.external_reference, dataId).first();
  if (!local) return json({ received: true, ignored: true });

  const paid = Number(order.total_paid_amount || 0);
  const expected = Number(local.amount_brl);
  const isPaid = order.status === "processed" && order.status_detail === "accredited" &&
    order.currency === "BRL" && Number.isFinite(paid) && paid >= expected;

  if (!isPaid) {
    await env.DB.prepare(
      "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?"
    ).bind(String(order.status || "pending"), nowIso(), local.id).run();
    return json({ received: true, status: order.status || "pending" });
  }

  const existing = await env.DB.prepare(
    "SELECT token_json FROM licenses WHERE order_id = ?"
  ).bind(local.id).first();
  if (existing) return json({ received: true, license_issued: true });

  const customer = await env.DB.prepare(
    "SELECT name FROM customers WHERE id = ?"
  ).bind(local.customer_id).first();
  const issued = new Date();
  const expires = new Date(issued);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const serial = crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  const payload = canonicalLicensePayload({
    deviceId: local.device_id,
    customer: customer?.name || "Floating Camera Customer",
    issuedOn: dateOnly(issued),
    expiresOn: dateOnly(expires),
    serial
  });

  let token;
  try {
    token = await signLicense(payload, env);
  } catch {
    return json({ error: "license_signing_not_configured" }, 503);
  }

  const licenseId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO licenses (id, order_id, customer_id, device_id, issued_on, expires_on, serial, token_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)"
    ).bind(licenseId, local.id, local.customer_id, local.device_id, payload.issued_on,
      payload.expires_on, serial, JSON.stringify(token), nowIso()).run();
  } catch {
    return json({ error: "license_device_conflict" }, 409);
  }

  await env.DB.prepare(
    "UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ?"
  ).bind(nowIso(), local.id).run();

  return json({ received: true, license_issued: true });
}

async function getLicense(request, env) {
  const deviceId = (new URL(request.url).searchParams.get("device_id") || "").toUpperCase();
  if (!validDeviceId(deviceId)) return json({ error: "invalid_device_id" }, 400);
  const license = await env.DB.prepare(
    "SELECT token_json, expires_on FROM licenses WHERE device_id = ? AND status = 'active'"
  ).bind(deviceId).first();
  if (!license) return json({ status: "not_licensed" });
  if (dateOnly(new Date()) > license.expires_on) return json({ status: "expired" });
  return new Response(license.token_json, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }
    if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok" });
    if (url.pathname === "/api/trial/start" && request.method === "POST") return startTrial(request, env);
    if (url.pathname === "/api/checkout/create" && request.method === "POST") return createCheckout(request, env);
    if (url.pathname === "/api/webhooks/mercadopago" && request.method === "POST") return handleMercadoPagoWebhook(request, env);
    if (url.pathname === "/api/license" && request.method === "GET") return getLicense(request, env);
    return response({ error: "not_found" }, request, env, 404);
  }
};
