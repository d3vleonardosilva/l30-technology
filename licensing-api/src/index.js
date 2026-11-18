const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

const nowIso = () => new Date().toISOString();
const validDeviceId = (value) => typeof value === "string" && /^[A-F0-9]{24}$/.test(value);
const validEmail = (value) => typeof value === "string" && value.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.SITE_ORIGIN || "https://www.l30.tec.br").split(",").map(v => v.trim());
  const permitted = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": permitted ? origin : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };
}

function response(data, request, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
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

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = sortJson(value[key]);
      return out;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function isApprovedOneTimePrice(price, expectedPriceId) {
  return Boolean(
    price &&
    price.id === expectedPriceId &&
    price.status === "active" &&
    price.type === "standard" &&
    price.billing_cycle === null &&
    price.trial_period === null &&
    String(price.unit_price?.amount) === "1999" &&
    price.unit_price?.currency_code === "USD" &&
    Array.isArray(price.unit_price_overrides) &&
    price.unit_price_overrides.length === 0
  );
}

function canonicalLicensePayload({ deviceId, customer, issuedOn, expiresOn, serial }) {
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

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function hexToBytes(value) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g), byte => parseInt(byte, 16));
}

function safeEqualText(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

async function signLicenseV2(payload, env) {
  if (!env.LICENSE_SIGNING_KEY_PKCS8_B64 || !env.LICENSE_SIGNING_KEY_ID) {
    throw new Error("License signing key is not configured");
  }

  const envelope = {
    version: 2,
    key_id: String(env.LICENSE_SIGNING_KEY_ID),
    payload
  };
  const message = new TextEncoder().encode(canonicalJson(envelope));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(env.LICENSE_SIGNING_KEY_PKCS8_B64),
    { name: "Ed25519" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, message);
  return { ...envelope, signature: bytesToBase64(signature) };
}

async function verifyWebhookSignature(request, env, rawBody) {
  if (!env.PADDLE_WEBHOOK_SECRET) return false;

  const header = request.headers.get("Paddle-Signature") || "";
  const fields = header.split(";").map(part => part.trim());
  const timestampField = fields.find(part => part.startsWith("ts="));
  const signatures = fields
    .filter(part => part.startsWith("h1="))
    .map(part => part.slice(3));

  if (!timestampField || signatures.length === 0) return false;

  const timestamp = Number(timestampField.slice(3));
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return false;

  // Match Paddle SDK's documented default timestamp tolerance to mitigate replay.
  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > 5) return false;

  const signedPayload = new TextEncoder().encode(String(timestamp) + ":" + rawBody);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.PADDLE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  for (const signatureHex of signatures) {
    const signatureBytes = hexToBytes(signatureHex);
    if (!signatureBytes) continue;
    try {
      if (await crypto.subtle.verify("HMAC", key, signatureBytes, signedPayload)) return true;
    } catch {
      // Ignore malformed signature candidates and test any remaining h1 values.
    }
  }
  return false;
}

async function startTrial(request, env) {
  const body = await readJson(request);
  const deviceId = String(body?.device_id || "").toUpperCase();
  if (!validDeviceId(deviceId)) return response({ error: "invalid_device_id" }, request, env, 400);

  const now = new Date();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO trials (device_id, started_at, last_seen_at) VALUES (?, ?, ?)"
  ).bind(deviceId, nowIso(), nowIso()).run();

  const trial = await env.DB.prepare(
    "SELECT started_at FROM trials WHERE device_id = ?"
  ).bind(deviceId).first();

  if (!trial?.started_at) return response({ error: "trial_unavailable" }, request, env, 503);

  await env.DB.prepare(
    "UPDATE trials SET last_seen_at = ? WHERE device_id = ?"
  ).bind(nowIso(), deviceId).run();

  const started = new Date(trial.started_at);
  const expires = addDays(started, 7);
  const remainingMs = Math.max(0, expires.getTime() - now.getTime());
  let token;
  try {
    token = await signLicenseV2({
      type: "trial",
      product: "FloatingCamera",
      device_id: deviceId,
      started_at: started.toISOString(),
      expires_at: expires.toISOString()
    }, env);
  } catch {
    return response({ error: "trial_signing_not_configured" }, request, env, 503);
  }
  return response({
    status: remainingMs > 0 ? "trial" : "expired",
    started_at: started.toISOString(),
    expires_at: expires.toISOString(),
    days_left: Math.ceil(remainingMs / 86400000),
    server_time: now.toISOString(),
    token
  }, request, env);
}

async function createCheckout(request, env) {
  const body = await readJson(request);
  const name = String(body?.name || "").trim().slice(0, 120);
  const email = String(body?.email || "").trim().toLowerCase();
  const deviceId = String(body?.device_id || "").toUpperCase();

  if (name.length < 2 || !validEmail(email) || !validDeviceId(deviceId)) {
    return response({ error: "invalid_customer_or_device" }, request, env, 400);
  }
  if (!env.PADDLE_API_KEY || !env.PADDLE_PRICE_ID) {
    return response({ error: "paddle_not_configured" }, request, env, 503);
  }
  if (!/^pri_[a-z0-9]{26}$/.test(env.PADDLE_PRICE_ID)) {
    return response({ error: "invalid_paddle_price_configuration" }, request, env, 503);
  }

  // Enforce the commercial policy server-side: one-time USD 19.99 only.
  const priceResponse = await fetch(
    "https://api.paddle.com/prices/" + encodeURIComponent(env.PADDLE_PRICE_ID),
    { headers: { "Authorization": "Bearer " + env.PADDLE_API_KEY } }
  );
  const priceResult = await priceResponse.json().catch(() => ({}));
  const price = priceResult.data;
  if (!priceResponse.ok || !price) {
    return response({ error: "paddle_price_lookup_failed", provider_status: priceResponse.status }, request, env, 502);
  }
  if (!isApprovedOneTimePrice(price, env.PADDLE_PRICE_ID)) {
    return response({ error: "paddle_price_policy_mismatch" }, request, env, 503);
  }

  await env.DB.prepare(
    "UPDATE licenses SET status = 'expired' WHERE device_id = ? AND status = 'active' AND expires_on < ?"
  ).bind(deviceId, dateOnly(new Date())).run();

  const existingLicense = await env.DB.prepare(
    "SELECT id FROM licenses WHERE device_id = ? AND status = 'active' AND expires_on >= ? LIMIT 1"
  ).bind(deviceId, dateOnly(new Date())).first();
  if (existingLicense) {
    return response({ error: "device_already_licensed" }, request, env, 409);
  }

  let customer = await env.DB.prepare(
    "SELECT id, provider_customer_id FROM customers WHERE email = ?"
  ).bind(email).first();

  if (!customer) {
    const customerId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO customers (id, name, email, provider_customer_id, created_at) VALUES (?, ?, ?, NULL, ?)"
    ).bind(customerId, name, email, nowIso()).run();
    customer = { id: customerId, provider_customer_id: null };
  } else {
    await env.DB.prepare(
      "UPDATE customers SET name = ? WHERE id = ?"
    ).bind(name, customer.id).run();
  }

  // Bind the local customer record to the provider customer before creating
  // a transaction. This prevents the app's email and Paddle's payer from drifting.
  let providerCustomerId = customer.provider_customer_id;
  if (!providerCustomerId) {
    const lookupUrl = new URL("https://api.paddle.com/customers");
    lookupUrl.searchParams.set("email", email);
    lookupUrl.searchParams.set("per_page", "1");
    const lookupResponse = await fetch(lookupUrl.toString(), {
      headers: { "Authorization": "Bearer " + env.PADDLE_API_KEY }
    });
    const lookupResult = await lookupResponse.json().catch(() => ({}));
    if (!lookupResponse.ok) {
      return response({ error: "paddle_customer_lookup_failed", provider_status: lookupResponse.status }, request, env, 502);
    }

    const existingProviderCustomer = (lookupResult.data || []).find(
      item => String(item.email || "").toLowerCase() === email && item.status === "active"
    );

    if (existingProviderCustomer?.id) {
      providerCustomerId = existingProviderCustomer.id;
    } else {
      const createCustomerResponse = await fetch("https://api.paddle.com/customers", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.PADDLE_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          email,
          locale: "en",
          custom_data: { l30_customer_id: customer.id }
        })
      });
      const createCustomerResult = await createCustomerResponse.json().catch(() => ({}));
      if (!createCustomerResponse.ok || !createCustomerResult.data?.id) {
        return response({
          error: "paddle_customer_creation_failed",
          provider_status: createCustomerResponse.status
        }, request, env, 502);
      }
      providerCustomerId = createCustomerResult.data.id;
    }

    await env.DB.prepare(
      "UPDATE customers SET provider_customer_id = ? WHERE id = ?"
    ).bind(providerCustomerId, customer.id).run();
  }

  const localOrderId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO orders (id, customer_id, device_id, provider, provider_price_id, external_reference, amount_minor, currency_code, status, created_at, updated_at) VALUES (?, ?, ?, 'paddle', ?, ?, 1999, 'USD', 'creating', ?, ?)"
  ).bind(localOrderId, customer.id, deviceId, env.PADDLE_PRICE_ID, localOrderId, nowIso(), nowIso()).run();

  const paddleResponse = await fetch("https://api.paddle.com/transactions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.PADDLE_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items: [{ price_id: env.PADDLE_PRICE_ID, quantity: 1 }],
      customer_id: providerCustomerId,
      collection_mode: "automatic",
      custom_data: {
        l30_order_id: localOrderId,
        device_id: deviceId,
        product: "FloatingCamera",
        license_term: "annual"
      }
    })
  });

  const result = await paddleResponse.json().catch(() => ({}));
  const transaction = result.data;
  if (!paddleResponse.ok || !transaction?.id || !transaction?.checkout?.url) {
    await env.DB.prepare(
      "UPDATE orders SET status = 'provider_error', updated_at = ? WHERE id = ?"
    ).bind(nowIso(), localOrderId).run();
    return response({
      error: "checkout_creation_failed",
      provider_status: paddleResponse.status
    }, request, env, 502);
  }

  await env.DB.prepare(
    "UPDATE orders SET provider_order_id = ?, status = ?, updated_at = ? WHERE id = ?"
  ).bind(transaction.id, transaction.status || "ready", nowIso(), localOrderId).run();

  return response({
    checkout_url: transaction.checkout.url,
    order_reference: localOrderId
  }, request, env, 201);
}

async function issuePaidOrderLicense(env, localOrder, eventId, eventType) {
  const existing = await env.DB.prepare(
    "SELECT token_json FROM licenses WHERE order_id = ?"
  ).bind(localOrder.id).first();

  if (existing) {
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ?")
        .bind(nowIso(), localOrder.id),
      env.DB.prepare(
        "INSERT OR IGNORE INTO webhook_events (event_id, event_type, processed_at) VALUES (?, ?, ?)"
      ).bind(eventId, eventType, nowIso())
    ]);
    return { received: true, license_issued: true, duplicate: true };
  }

  const customer = await env.DB.prepare(
    "SELECT name FROM customers WHERE id = ?"
  ).bind(localOrder.customer_id).first();

  const issued = new Date();
  const expires = new Date(issued);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const serial = crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();

  const payload = canonicalLicensePayload({
    deviceId: localOrder.device_id,
    customer: localOrder.customer_id,
    issuedOn: dateOnly(issued),
    expiresOn: dateOnly(expires),
    serial
  });
  const token = await signLicenseV2(payload, env);

  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO licenses (id, order_id, customer_id, device_id, issued_on, expires_on, serial, key_id, token_version, token_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, ?, 'active', ?)"
      ).bind(
        crypto.randomUUID(), localOrder.id, localOrder.customer_id, localOrder.device_id,
        payload.issued_on, payload.expires_on, serial, token.key_id, JSON.stringify(token), nowIso()
      ),
      env.DB.prepare(
        "UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ?"
      ).bind(nowIso(), localOrder.id),
      env.DB.prepare(
        "INSERT OR IGNORE INTO webhook_events (event_id, event_type, processed_at) VALUES (?, ?, ?)"
      ).bind(eventId, eventType, nowIso())
    ]);
    return { received: true, license_issued: true };
  } catch (error) {
    // A concurrent duplicate delivery may have won the unique order/license race.
    const raced = await env.DB.prepare(
      "SELECT token_json FROM licenses WHERE order_id = ?"
    ).bind(localOrder.id).first();
    if (raced) {
      await env.DB.batch([
        env.DB.prepare("UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ?")
          .bind(nowIso(), localOrder.id),
        env.DB.prepare(
          "INSERT OR IGNORE INTO webhook_events (event_id, event_type, processed_at) VALUES (?, ?, ?)"
        ).bind(eventId, eventType, nowIso())
      ]);
      return { received: true, license_issued: true, duplicate: true };
    }
    throw error;
  }
}

async function handlePaddleWebhook(request, env) {
  const rawBody = await request.text();
  if (!(await verifyWebhookSignature(request, env, rawBody))) {
    return json({ error: "invalid_signature" }, 401);
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch { return json({ error: "invalid_json" }, 400); }

  if (event.event_type !== "transaction.completed") {
    return json({ received: true, ignored: true });
  }

  const eventId = String(event.event_id || "");
  if (!eventId || eventId.length > 200) {
    return json({ error: "missing_event_id" }, 400);
  }

  const seen = await env.DB.prepare(
    "SELECT event_id FROM webhook_events WHERE event_id = ?"
  ).bind(eventId).first();
  if (seen) return json({ received: true, duplicate: true });

  const transaction = event.data || {};
  const orderId = transaction.custom_data?.l30_order_id;
  const deviceId = String(transaction.custom_data?.device_id || "").toUpperCase();

  if (!orderId || !validDeviceId(deviceId) || transaction.status !== "completed") {
    return json({ received: true, ignored: true });
  }

  const localOrder = await env.DB.prepare(
    "SELECT orders.*, customers.provider_customer_id FROM orders JOIN customers ON customers.id = orders.customer_id WHERE orders.id = ? AND orders.device_id = ? AND orders.provider = 'paddle'"
  ).bind(orderId, deviceId).first();

  if (!localOrder) return json({ received: true, ignored: true });
  if (!localOrder.provider_order_id || transaction.id !== localOrder.provider_order_id) {
    return json({ error: "transaction_order_mismatch" }, 409);
  }
  if (!localOrder.provider_customer_id || transaction.customer_id !== localOrder.provider_customer_id) {
    return json({ error: "transaction_customer_mismatch" }, 409);
  }
  const items = Array.isArray(transaction.items) ? transaction.items : [];
  if (items.length !== 1 ||
      items[0]?.price_id !== localOrder.provider_price_id ||
      Number(items[0]?.quantity) !== 1 ||
      transaction.custom_data?.product !== "FloatingCamera" ||
      transaction.custom_data?.license_term !== "annual" ||
      transaction.currency_code !== localOrder.currency_code ||
      Number(transaction.details?.totals?.grand_total || 0) < localOrder.amount_minor) {
    return json({ error: "payment_amount_currency_price_or_product_mismatch" }, 409);
  }

  try {
    const result = await issuePaidOrderLicense(env, localOrder, eventId, event.event_type);
    return json(result);
  } catch {
    // Non-2xx makes Paddle retry; never acknowledge an event before durable issuance.
    return json({ error: "license_issuance_failed" }, 503);
  }
}

async function getLicense(request, env) {
  const deviceId = (new URL(request.url).searchParams.get("device_id") || "").toUpperCase();
  if (!validDeviceId(deviceId)) return json({ error: "invalid_device_id" }, 400);

  const license = await env.DB.prepare(
    "SELECT token_json, expires_on, status FROM licenses WHERE device_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(deviceId).first();

  if (!license) return json({ status: "not_licensed" });
  if (license.status !== "active") return json({ status: "revoked" });
  if (dateOnly(new Date()) > license.expires_on) return json({ status: "expired" });

  let annualToken;
  let offlineLease;
  const issuedAt = new Date();
  const leaseExpires = addDays(issuedAt, 7);
  try {
    annualToken = JSON.parse(license.token_json);
    offlineLease = await signLicenseV2({
      type: "offline_lease",
      product: "FloatingCamera",
      device_id: deviceId,
      license_serial: annualToken.payload.serial,
      issued_at: issuedAt.toISOString(),
      expires_at: leaseExpires.toISOString()
    }, env);
  } catch {
    return json({ error: "offline_lease_signing_not_configured" }, 503);
  }

  return json({
    status: "active",
    license: annualToken,
    offline_lease: offlineLease,
    server_time: issuedAt.toISOString()
  });
}

function adminAuthorized(request, env) {
  if (!env.LICENSE_ADMIN_TOKEN) return false;
  const header = request.headers.get("Authorization") || "";
  return safeEqualText(header, "Bearer " + env.LICENSE_ADMIN_TOKEN);
}

async function adminIssueLicense(request, env) {
  if (!adminAuthorized(request, env)) return json({ error: "unauthorized" }, 401);

  const body = await readJson(request);
  const name = String(body?.name || "").trim().slice(0, 120);
  const email = String(body?.email || "").trim().toLowerCase();
  const deviceId = String(body?.device_id || "").toUpperCase();

  if (name.length < 2 || !validEmail(email) || !validDeviceId(deviceId)) {
    return json({ error: "invalid_customer_or_device" }, 400);
  }

  await env.DB.prepare(
    "UPDATE licenses SET status = 'expired' WHERE device_id = ? AND status = 'active' AND expires_on < ?"
  ).bind(deviceId, dateOnly(new Date())).run();

  const existing = await env.DB.prepare(
    "SELECT id FROM licenses WHERE device_id = ? AND status = 'active' AND expires_on >= ? LIMIT 1"
  ).bind(deviceId, dateOnly(new Date())).first();
  if (existing) return json({ error: "device_already_licensed" }, 409);

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

  const orderId = crypto.randomUUID();
  const issued = new Date();
  const expires = new Date(issued);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const serial = crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  const payload = canonicalLicensePayload({
    deviceId,
    customer: customer.id,
    issuedOn: dateOnly(issued),
    expiresOn: dateOnly(expires),
    serial
  });

  let token;
  try { token = await signLicenseV2(payload, env); }
  catch { return json({ error: "license_signing_not_configured" }, 503); }

  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO orders (id, customer_id, device_id, provider, external_reference, amount_minor, currency_code, status, created_at, updated_at) VALUES (?, ?, ?, 'manual', ?, 0, 'USD', 'manual_issued', ?, ?)"
      ).bind(orderId, customer.id, deviceId, orderId, nowIso(), nowIso()),
      env.DB.prepare(
        "INSERT INTO licenses (id, order_id, customer_id, device_id, issued_on, expires_on, serial, key_id, token_version, token_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, ?, 'active', ?)"
      ).bind(
        crypto.randomUUID(), orderId, customer.id, deviceId, payload.issued_on,
        payload.expires_on, serial, token.key_id, JSON.stringify(token), nowIso()
      ),
      env.DB.prepare(
        "INSERT INTO admin_audit (id, actor, action, target_id, metadata_json, created_at) VALUES (?, 'admin-api-token', 'license.manual_issue', ?, ?, ?)"
      ).bind(crypto.randomUUID(), serial, JSON.stringify({ device_id: deviceId, customer_email: email }), nowIso())
    ]);
  } catch {
    return json({ error: "license_issue_conflict" }, 409);
  }

  return json({ license: token }, 201);
}

async function adminRevokeLicense(request, env) {
  if (!adminAuthorized(request, env)) return json({ error: "unauthorized" }, 401);

  const body = await readJson(request);
  const serial = String(body?.serial || "").toUpperCase();
  const reason = String(body?.reason || "administrative revocation").trim().slice(0, 300);
  if (!/^[A-F0-9]{16}$/.test(serial)) return json({ error: "invalid_serial" }, 400);

  const license = await env.DB.prepare(
    "SELECT id, device_id, status FROM licenses WHERE serial = ?"
  ).bind(serial).first();
  if (!license) return json({ error: "license_not_found" }, 404);
  if (license.status === "revoked") return json({ status: "already_revoked" });

  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET status = 'revoked' WHERE id = ?").bind(license.id),
    env.DB.prepare(
      "INSERT INTO admin_audit (id, actor, action, target_id, metadata_json, created_at) VALUES (?, 'admin-api-token', 'license.revoke', ?, ?, ?)"
    ).bind(
      crypto.randomUUID(), serial,
      JSON.stringify({ device_id: license.device_id, reason }), nowIso()
    )
  ]);
  return json({ status: "revoked", serial });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", service: "l30-floating-camera-licensing" });
    }
    if (url.pathname === "/api/trial/start" && request.method === "POST") {
      return startTrial(request, env);
    }
    if (url.pathname === "/api/checkout/create" && request.method === "POST") {
      return createCheckout(request, env);
    }
    if (url.pathname === "/api/webhooks/paddle" && request.method === "POST") {
      return handlePaddleWebhook(request, env);
    }
    if (url.pathname === "/api/license" && request.method === "GET") {
      return getLicense(request, env);
    }
    if (url.pathname === "/api/admin/licenses/issue" && request.method === "POST") {
      return adminIssueLicense(request, env);
    }
    if (url.pathname === "/api/admin/licenses/revoke" && request.method === "POST") {
      return adminRevokeLicense(request, env);
    }

    return response({ error: "not_found" }, request, env, 404);
  }
};
