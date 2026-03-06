const SESSION_COOKIE_NAME = "__session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_NOTES_LENGTH = 1000;
const MONEY_TOLERANCE = 1;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const CASH_KEYWORDS = [
  "cash",
  "numerar",
  "incasare cash",
  "cash ron",
  "plata cash",
  "lei cash",
];

const CARD_KEYWORDS = [
  "card",
  "pos",
  "visa",
  "mastercard",
  "contactless",
  "plata card",
];

const TOTAL_KEYWORDS = [
  "total",
  "total de plata",
  "total plata",
  "de plata",
  "grand total",
  "suma totala",
];

const NON_FINAL_TOTAL_KEYWORDS = [
  "subtotal",
  "tva",
  "taxa",
  "reducere",
  "discount",
  "rest",
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }
      return await handlePageRoutes(request, env, url);
    } catch (error) {
      console.error("Unhandled error:", error);
      return json({ error: "Internal server error" }, 500);
    }
  },
};

async function handlePageRoutes(request, env, url) {
  const path = normalizePath(url.pathname);
  const authenticated = await isAuthenticated(request, env);

  if (path === "/login" || path === "/login.html") {
    if (authenticated) {
      return redirect("/");
    }
    return serveAsset(request, env, "/login.html");
  }

  if (path === "/" || path === "/index.html") {
    if (!authenticated) {
      return redirect("/login");
    }
    return serveAsset(request, env, "/index.html");
  }

  if (path === "/app.js" && !authenticated) {
    return new Response("Unauthorized", { status: 401 });
  }

  return serveAsset(request, env, path);
}

async function handleApi(request, env, url) {
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path === "/api/login" && method === "POST") {
    if (!isSameOriginRequest(request, url.origin)) {
      return json({ error: "Forbidden" }, 403);
    }
    return handleLogin(request, env);
  }

  if (path === "/api/logout" && method === "POST") {
    if (!isSameOriginRequest(request, url.origin)) {
      return json({ error: "Forbidden" }, 403);
    }
    return handleLogout(request);
  }

  if (path === "/api/me" && method === "GET") {
    return handleMe(request, env);
  }

  const auth = await requireAuth(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    !isSameOriginRequest(request, url.origin)
  ) {
    return json({ error: "Forbidden" }, 403);
  }

  if (path === "/api/analyze" && method === "POST") {
    return handleAnalyze(request, env);
  }

  if (path === "/api/save" && method === "POST") {
    return handleSave(request, env);
  }

  if (path === "/api/history" && method === "GET") {
    return handleHistory(url, env);
  }

  if (path === "/api/month-summary" && method === "GET") {
    return handleMonthSummary(url, env);
  }

  if (path === "/api/settings" && method === "GET") {
    return handleGetSettings(env);
  }

  if (path === "/api/settings" && method === "POST") {
    return handleUpdateSettings(request, env);
  }

  return json({ error: "Not found" }, 404);
}

async function handleLogin(request, env) {
  if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: "Missing APP_PASSWORD or SESSION_SECRET secret" }, 500);
  }

  const body = await safeReadJson(request);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) {
    return json({ error: "Password is required" }, 400);
  }

  if (!timingSafeEqualString(password, env.APP_PASSWORD)) {
    return json({ ok: false, error: "Invalid credentials" }, 401);
  }

  const token = await createSessionToken(env.SESSION_SECRET);
  const headers = new Headers();
  headers.set("Set-Cookie", setSessionCookie(token, request));

  return json({ ok: true }, 200, headers);
}

function handleLogout(request) {
  const headers = new Headers();
  headers.set("Set-Cookie", clearSessionCookie(request));
  return json({ ok: true }, 200, headers);
}

async function handleMe(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) {
    return json({ authenticated: false });
  }
  return json({
    authenticated: true,
    expires_at: new Date(session.exp * 1000).toISOString(),
  });
}

async function handleAnalyze(request, env) {
  if (!env.GOOGLE_VISION_API_KEY) {
    return json({ error: "Missing GOOGLE_VISION_API_KEY secret" }, 500);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Invalid multipart form-data request" }, 400);
  }

  const image = formData.get("image");
  if (!(image instanceof File)) {
    return json({ error: "Image file is required in `image` field" }, 400);
  }

  if (image.size === 0) {
    return json({ error: "Uploaded image is empty" }, 400);
  }

  if (image.size > MAX_UPLOAD_BYTES) {
    return json({ error: `Image exceeds ${MAX_UPLOAD_BYTES} bytes limit` }, 413);
  }

  if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
    return json(
      {
        error:
          "Unsupported image type. Allowed: image/jpeg, image/png, image/webp",
      },
      400,
    );
  }

  try {
    const imageBuffer = await image.arrayBuffer();
    const imageBase64 = arrayBufferToBase64(imageBuffer);
    const ocrText = await requestVisionOcr(imageBase64, env.GOOGLE_VISION_API_KEY);
    const inferred = inferReceiptValues(ocrText);

    const responsePayload = {
      ok: true,
      image_filename: sanitizeFileName(image.name),
      cash_detected: inferred.cash_detected,
      card_detected: inferred.card_detected,
      total_detected: inferred.total_detected,
      confidence: inferred.confidence,
      warnings: inferred.warnings,
      parse_notes: inferred.parse_notes,
    };

    if (isDevelopment(env)) {
      responsePayload.ocr_text = ocrText;
    }

    return json(responsePayload);
  } catch (error) {
    console.error("Analyze OCR error:", error);
    return json(
      { error: "OCR processing failed. Try another clearer image." },
      502,
    );
  }
}

async function handleSave(request, env) {
  const body = await safeReadJson(request);
  if (!body) {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  const workDate = typeof body.work_date === "string" ? body.work_date : "";
  if (!isValidDate(workDate)) {
    return json({ error: "work_date must have YYYY-MM-DD format" }, 400);
  }

  const cashConfirmed = parseMoneyValue(body.cash_confirmed);
  const cardConfirmed = parseMoneyValue(body.card_confirmed);
  const totalConfirmed = parseMoneyValue(body.total_confirmed);

  if (
    cashConfirmed === null ||
    cardConfirmed === null ||
    totalConfirmed === null
  ) {
    return json({ error: "cash_confirmed, card_confirmed, total_confirmed are required" }, 400);
  }

  if (cashConfirmed < 0 || cardConfirmed < 0 || totalConfirmed < 0) {
    return json({ error: "Confirmed values must be non-negative" }, 400);
  }

  const cashDetected = parseOptionalMoney(body.cash_detected);
  const cardDetected = parseOptionalMoney(body.card_detected);
  const totalDetected = parseOptionalMoney(body.total_detected);
  const notes = sanitizeNotes(body.notes);
  const imageFilename = sanitizeFileName(body.image_filename);

  try {
    const result = await env.DB.prepare(
      `
      INSERT INTO reports (
        work_date,
        cash_detected,
        card_detected,
        total_detected,
        cash_confirmed,
        card_confirmed,
        total_confirmed,
        notes,
        image_filename
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
      .bind(
        workDate,
        cashDetected,
        cardDetected,
        totalDetected,
        cashConfirmed,
        cardConfirmed,
        totalConfirmed,
        notes,
        imageFilename,
      )
      .run();

    return json({
      ok: true,
      id: result?.meta?.last_row_id ?? null,
      warning:
        Math.abs(cashConfirmed + cardConfirmed - totalConfirmed) > MONEY_TOLERANCE
          ? "cash + card differs from total"
          : null,
    });
  } catch (error) {
    console.error("Save report error:", error);
    return json({ error: "Failed to save report" }, 500);
  }
}

async function handleHistory(url, env) {
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 100;

  try {
    const result = await env.DB.prepare(
      `
      SELECT
        id,
        work_date,
        cash_detected,
        card_detected,
        total_detected,
        cash_confirmed,
        card_confirmed,
        total_confirmed,
        notes,
        image_filename,
        created_at
      FROM reports
      ORDER BY work_date DESC, id DESC
      LIMIT ?
      `,
    )
      .bind(limit)
      .all();

    return json({
      ok: true,
      reports: result?.results || [],
    });
  } catch (error) {
    console.error("History fetch error:", error);
    return json({ error: "Failed to load history" }, 500);
  }
}

async function handleMonthSummary(url, env) {
  const month = url.searchParams.get("month") || "";
  if (!isValidMonth(month)) {
    return json({ error: "month must be in YYYY-MM format" }, 400);
  }

  try {
    const summary = await getMonthSummary(env, month);
    return json({ ok: true, ...summary });
  } catch (error) {
    console.error("Month summary error:", error);
    return json({ error: "Failed to compute month summary" }, 500);
  }
}

async function handleGetSettings(env) {
  try {
    const commissionPercent = await getCommissionPercent(env);
    return json({ ok: true, commission_percent: commissionPercent });
  } catch (error) {
    console.error("Get settings error:", error);
    return json({ error: "Failed to load settings" }, 500);
  }
}

async function handleUpdateSettings(request, env) {
  const body = await safeReadJson(request);
  if (!body) {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  const commissionPercent = parseMoneyValue(body.commission_percent);
  if (commissionPercent === null) {
    return json({ error: "commission_percent is required" }, 400);
  }

  if (commissionPercent <= 0 || commissionPercent > 100) {
    return json({ error: "commission_percent must be in range (0, 100]" }, 400);
  }

  try {
    await updateCommissionPercent(env, commissionPercent);
    return json({ ok: true, commission_percent: roundMoney(commissionPercent) });
  } catch (error) {
    console.error("Update settings error:", error);
    return json({ error: "Failed to update settings" }, 500);
  }
}

async function requestVisionOcr(imageBase64, apiKey) {
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBase64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: {
              languageHints: ["ro", "en"],
            },
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Vision API HTTP ${response.status}`);
  }

  const payload = await response.json();
  const firstResult = payload?.responses?.[0];

  if (payload?.error?.message) {
    throw new Error(payload.error.message);
  }

  if (!firstResult) {
    throw new Error("Vision API returned no response blocks");
  }

  if (firstResult.error?.message) {
    throw new Error(firstResult.error.message);
  }

  return (
    firstResult.fullTextAnnotation?.text ||
    firstResult.textAnnotations?.[0]?.description ||
    ""
  );
}

function inferReceiptValues(ocrText) {
  const lines = String(ocrText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const cashCandidates = [];
  const cardCandidates = [];
  const totalCandidates = [];
  const allNumbers = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();
    const amounts = extractMoneyCandidates(line);
    if (!amounts.length) {
      continue;
    }

    for (const amount of amounts) {
      allNumbers.push({ amount, line, index });

      const cashScore = scoreCandidate(lower, amount, index, lines.length, "cash");
      if (cashScore > 0) {
        cashCandidates.push({ amount, line, index, score: cashScore });
      }

      const cardScore = scoreCandidate(lower, amount, index, lines.length, "card");
      if (cardScore > 0) {
        cardCandidates.push({ amount, line, index, score: cardScore });
      }

      const totalScore = scoreCandidate(lower, amount, index, lines.length, "total");
      if (totalScore > 0) {
        totalCandidates.push({ amount, line, index, score: totalScore });
      }
    }
  }

  const bestCash = pickBestCandidate(cashCandidates);
  const bestCard = pickBestCandidate(cardCandidates);
  const bestTotal = pickBestCandidate(totalCandidates);

  const cashDetected = resolveDetectedValue(bestCash, 7);
  const cardDetected = resolveDetectedValue(bestCard, 7);
  const totalDetected = resolveDetectedValue(bestTotal, 8);

  const warnings = [];
  const parseNotes = [];

  if (cashDetected === null) {
    warnings.push("Cash not confidently detected. Please fill manually.");
  }
  if (cardDetected === null) {
    warnings.push("Card not confidently detected. Please fill manually.");
  }
  if (totalDetected === null) {
    warnings.push("Total not confidently detected. Please fill manually.");
  }

  if (bestTotal && totalDetected === null) {
    parseNotes.push("Total-like value found but confidence was low.");
  }

  if (cashDetected !== null && cardDetected !== null && totalDetected !== null) {
    const delta = Math.abs(cashDetected + cardDetected - totalDetected);
    if (delta > MONEY_TOLERANCE) {
      warnings.push("Detected values do not match (cash + card != total).");
    }
  }

  if (!allNumbers.length) {
    warnings.push("No money-like values found by OCR.");
  }

  return {
    cash_detected: cashDetected,
    card_detected: cardDetected,
    total_detected: totalDetected,
    confidence: {
      cash: confidenceLabel(bestCash?.score || 0),
      card: confidenceLabel(bestCard?.score || 0),
      total: confidenceLabel(bestTotal?.score || 0),
    },
    warnings,
    parse_notes: parseNotes,
  };
}

function scoreCandidate(line, amount, index, lineCount, type) {
  let score = 0;

  if (containsAny(line, ["ron", "lei", "leu"])) {
    score += 1;
  }

  if (type === "cash") {
    if (containsAny(line, CASH_KEYWORDS)) {
      score += 9;
    }
    if (containsAny(line, CARD_KEYWORDS)) {
      score -= 3;
    }
    if (containsAny(line, TOTAL_KEYWORDS)) {
      score += 1;
    }
  }

  if (type === "card") {
    if (containsAny(line, CARD_KEYWORDS)) {
      score += 9;
    }
    if (containsAny(line, CASH_KEYWORDS)) {
      score -= 3;
    }
    if (containsAny(line, TOTAL_KEYWORDS)) {
      score += 1;
    }
  }

  if (type === "total") {
    if (containsAny(line, TOTAL_KEYWORDS)) {
      score += 10;
    }
    if (containsAny(line, NON_FINAL_TOTAL_KEYWORDS)) {
      score -= 6;
    }
    if (index >= lineCount - 4) {
      score += 2;
    }
  }

  if (amount <= 0) {
    score -= 10;
  }
  if (amount > 100000) {
    score -= 3;
  }

  return score;
}

function pickBestCandidate(candidates) {
  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.index !== left.index) {
      return right.index - left.index;
    }
    return right.amount - left.amount;
  })[0];
}

function resolveDetectedValue(candidate, minScore) {
  if (!candidate || candidate.score < minScore) {
    return null;
  }
  return roundMoney(candidate.amount);
}

function confidenceLabel(score) {
  if (score >= 11) {
    return "high";
  }
  if (score >= 7) {
    return "medium";
  }
  return "low";
}

function extractMoneyCandidates(line) {
  const candidates = [];
  const pattern = /(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[.,]\d{1,2})?/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    const parsed = normalizeRomanianNumber(match[0]);
    if (parsed === null) {
      continue;
    }
    if (parsed > 0 && parsed < 1000000) {
      candidates.push(parsed);
    }
  }
  return candidates;
}

function parseMoneyValue(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }
  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue) ? roundMoney(rawValue) : null;
  }
  const value = String(rawValue).trim();
  if (!value) {
    return null;
  }
  return normalizeRomanianNumber(value);
}

function parseOptionalMoney(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }
  return parseMoneyValue(rawValue);
}

function normalizeRomanianNumber(value) {
  let normalized = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!normalized || !/\d/.test(normalized)) {
    return null;
  }

  const commaCount = (normalized.match(/,/g) || []).length;
  const dotCount = (normalized.match(/\./g) || []).length;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (commaCount > 0) {
    if (/,\d{1,2}$/.test(normalized)) {
      normalized = normalized.replace(/,/g, ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (dotCount > 1) {
    const chunks = normalized.split(".");
    const decimalChunk = chunks.pop();
    if (decimalChunk && decimalChunk.length <= 2) {
      normalized = `${chunks.join("")}.${decimalChunk}`;
    } else {
      normalized = chunks.join("") + (decimalChunk || "");
    }
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return roundMoney(parsed);
}

async function getMonthSummary(env, month) {
  const monthly = await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS count_of_days,
      COALESCE(SUM(total_confirmed), 0) AS monthly_total_confirmed
    FROM reports
    WHERE substr(work_date, 1, 7) = ?
    `,
  )
    .bind(month)
    .first();

  const monthlyTotalConfirmed = roundMoney(
    Number(monthly?.monthly_total_confirmed || 0),
  );
  const countOfDays = Number(monthly?.count_of_days || 0);
  const commissionPercent = await getCommissionPercent(env);
  const commissionAmount = roundMoney(
    (monthlyTotalConfirmed * commissionPercent) / 100,
  );

  return {
    month,
    monthly_total_confirmed: monthlyTotalConfirmed,
    commission_percent: commissionPercent,
    commission_amount: commissionAmount,
    count_of_days: countOfDays,
  };
}

async function getCommissionPercent(env) {
  const settings = await ensureSettingsRow(env);
  return roundMoney(Number(settings.commission_percent || 10));
}

async function updateCommissionPercent(env, percent) {
  const settings = await ensureSettingsRow(env);
  await env.DB.prepare(
    `
    UPDATE settings
    SET commission_percent = ?
    WHERE id = ?
    `,
  )
    .bind(roundMoney(percent), settings.id)
    .run();
}

async function ensureSettingsRow(env) {
  let row = await env.DB.prepare(
    `
    SELECT id, commission_percent
    FROM settings
    ORDER BY id ASC
    LIMIT 1
    `,
  ).first();

  if (row) {
    return row;
  }

  await env.DB.prepare(
    `
    INSERT INTO settings (commission_percent)
    VALUES (10)
    `,
  ).run();

  row = await env.DB.prepare(
    `
    SELECT id, commission_percent
    FROM settings
    ORDER BY id ASC
    LIMIT 1
    `,
  ).first();

  return row || { id: 1, commission_percent: 10 };
}

async function requireAuth(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  return { ok: true, session };
}

async function isAuthenticated(request, env) {
  const session = await getSessionFromRequest(request, env);
  return Boolean(session);
}

async function getSessionFromRequest(request, env) {
  if (!env.SESSION_SECRET) {
    return null;
  }
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }
  return verifySessionToken(token, env.SESSION_SECRET);
}

async function createSessionToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const payloadEncoded = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await signHmac(payloadEncoded, secret);
  const signatureEncoded = base64UrlEncodeBytes(signature);
  return `${payloadEncoded}.${signatureEncoded}`;
}

async function verifySessionToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payloadEncoded, signatureEncoded] = parts;
  let providedSignature;
  let payload;

  try {
    providedSignature = base64UrlDecodeToBytes(signatureEncoded);
    payload = JSON.parse(base64UrlDecodeToString(payloadEncoded));
  } catch {
    return null;
  }

  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  const expectedSignature = await signHmac(payloadEncoded, secret);
  if (!timingSafeEqualBytes(expectedSignature, providedSignature)) {
    return null;
  }

  return payload;
}

async function signHmac(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(signature);
}

function setSessionCookie(token, request) {
  const secure = new URL(request.url).protocol === "https:";
  let cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
  if (secure) {
    cookie += "; Secure";
  }
  return cookie;
}

function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:";
  let cookie = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  if (secure) {
    cookie += "; Secure";
  }
  return cookie;
}

function parseCookies(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const pairs = cookieHeader.split(";").map((item) => item.trim()).filter(Boolean);
  const cookies = {};

  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    cookies[name] = decodeURIComponent(value);
  }

  return cookies;
}

function timingSafeEqualBytes(left, right) {
  const size = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let i = 0; i < size; i += 1) {
    const leftByte = i < left.length ? left[i] : 0;
    const rightByte = i < right.length ? right[i] : 0;
    mismatch |= leftByte ^ rightByte;
  }
  return mismatch === 0;
}

function timingSafeEqualString(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  return timingSafeEqualBytes(leftBytes, rightBytes);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64UrlEncodeString(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeToBytes(value) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64UrlDecodeToString(value) {
  return new TextDecoder().decode(base64UrlDecodeToBytes(value));
}

function isSameOriginRequest(request, expectedOrigin) {
  const origin = request.headers.get("Origin");
  if (origin) {
    return origin === expectedOrigin;
  }

  const referer = request.headers.get("Referer");
  if (referer) {
    return referer.startsWith(expectedOrigin);
  }

  return false;
}

function sanitizeNotes(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = raw.trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.slice(0, MAX_NOTES_LENGTH);
}

function sanitizeFileName(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = raw.trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.slice(0, 120).replace(/[^\w.\- ]/g, "_");
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    return false;
  }
  const month = Number.parseInt(value.split("-")[1], 10);
  return month >= 1 && month <= 12;
}

function normalizePath(pathname) {
  if (!pathname) {
    return "/";
  }
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function containsAny(source, words) {
  return words.some((word) => source.includes(word));
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function safeReadJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isDevelopment(env) {
  const value = String(env.ENVIRONMENT || "").toLowerCase();
  return value === "development";
}

function json(data, status = 200, headers) {
  const responseHeaders = new Headers(headers || {});
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
}

function redirect(location, status = 302) {
  return new Response(null, {
    status,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
    },
  });
}

function serveAsset(request, env, assetPath) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return new Response("ASSETS binding missing", { status: 500 });
  }
  const assetUrl = new URL(assetPath, request.url).toString();
  return env.ASSETS.fetch(new Request(assetUrl, request));
}
