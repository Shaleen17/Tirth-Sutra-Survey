const http = require("http");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, ".env");

loadEnvFile(ENV_PATH);

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB = process.env.MONGODB_DB || "tirth_sutra_feedback";
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || "responses";

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI. Add it to .env before starting the server.");
  process.exit(1);
}

const assetMap = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/BrandLogo.jpg", { file: "BrandLogo.jpg", type: "image/jpeg" }],
  ["/Background_image.jpg", { file: "Background_image.jpg", type: "image/jpeg" }],
  ["/tirth-sutra-validation-survey.html", { file: "index.html", type: "text/html; charset=utf-8" }]
]);

let mongoClient;
let collectionPromise;
const sseClients = new Set();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function getCollection() {
  if (!collectionPromise) {
    mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 10 });
    collectionPromise = mongoClient.connect().then(async (client) => {
      const collection = client.db(MONGODB_DB).collection(MONGODB_COLLECTION);
      await collection.createIndex({ createdAt: -1 });
      return collection;
    });
  }
  return collectionPromise;
}

function sanitizeString(value, maxLength = 240) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function sanitizeArray(value, maxItems = 12, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => sanitizeString(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function clampNps(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.min(10, Math.max(0, Math.round(score)));
}

function sanitizeResponse(input, request) {
  return {
    age: sanitizeString(input.age, 80),
    loc: sanitizeString(input.loc, 80),
    dev: sanitizeString(input.dev, 120),
    platform: sanitizeArray(input.platform, 10, 120),
    freq_curr: sanitizeString(input.freq_curr, 80),
    pain: sanitizeString(input.pain, 120),
    appeal: sanitizeString(input.appeal, 160),
    appeal_feat: sanitizeArray(input.appeal_feat, 6, 160),
    usage_intent: sanitizeString(input.usage_intent, 120),
    retention: sanitizeArray(input.retention, 8, 160),
    switch: sanitizeString(input.switch, 160),
    barrier: sanitizeArray(input.barrier, 10, 160),
    trust: sanitizeArray(input.trust, 8, 160),
    pay: sanitizeString(input.pay, 120),
    nps: clampNps(input.nps),
    open: sanitizeString(input.open, 1200),
    name: sanitizeString(input.name, 80),
    email: sanitizeString(input.email, 160),
    phone: sanitizeString(input.phone, 40),
    extraContext: sanitizeString(input.extraContext, 120),
    betaInterest: Boolean(input.betaInterest),
    contactConsent: Boolean(input.contactConsent),
    source: "web-survey",
    userAgent: sanitizeString(request.headers["user-agent"] || "", 240),
    ipAddress: sanitizeString(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "", 120),
    createdAt: new Date()
  };
}

function tallySingle(docs, key) {
  const counts = new Map();
  for (const doc of docs) {
    const value = doc[key];
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function tallyMulti(docs, key) {
  const counts = new Map();
  for (const doc of docs) {
    const values = Array.isArray(doc[key]) ? doc[key] : [];
    for (const value of values) {
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return counts;
}

function sortCountMap(countMap, totalResponses) {
  return [...countMap.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .map(([label, count]) => ({
      label,
      count,
      pct: totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0
    }));
}

async function buildInsights() {
  const collection = await getCollection();
  const docs = await collection.find({}, {
    projection: {
      age: 1,
      loc: 1,
      dev: 1,
      appeal: 1,
      appeal_feat: 1,
      usage_intent: 1,
      retention: 1,
      barrier: 1,
      trust: 1,
      pay: 1,
      switch: 1,
      nps: 1,
      open: 1,
      betaInterest: 1,
      createdAt: 1
    }
  }).sort({ createdAt: -1 }).limit(1000).toArray();

  const totalResponses = docs.length;
  const npsValues = docs.map((doc) => clampNps(doc.nps)).filter((score) => score > 0);
  const promoters = npsValues.filter((score) => score >= 9).length;
  const passives = npsValues.filter((score) => score === 7 || score === 8).length;
  const detractors = npsValues.filter((score) => score <= 6).length;
  const npsScore = npsValues.length ? Math.round(((promoters - detractors) / npsValues.length) * 100) : null;

  return {
    totalResponses,
    updatedAt: new Date().toISOString(),
    metrics: {
      npsScore,
      promoterPct: npsValues.length ? Math.round((promoters / npsValues.length) * 100) : 0,
      passivePct: npsValues.length ? Math.round((passives / npsValues.length) * 100) : 0,
      detractorPct: npsValues.length ? Math.round((detractors / npsValues.length) * 100) : 0,
      dailyUsagePct: totalResponses ? Math.round((docs.filter((doc) => ["Multiple times a day", "Once a day"].includes(doc.usage_intent)).length / totalResponses) * 100) : 0,
      strongAppealPct: totalResponses ? Math.round((docs.filter((doc) => ["Yes, I was waiting for this", "Mostly yes, but it must prove itself"].includes(doc.appeal)).length / totalResponses) * 100) : 0,
      betaInterestPct: totalResponses ? Math.round((docs.filter((doc) => doc.betaInterest).length / totalResponses) * 100) : 0
    },
    sections: {
      usageIntent: sortCountMap(tallySingle(docs, "usage_intent"), totalResponses),
      appeal: sortCountMap(tallySingle(docs, "appeal"), totalResponses),
      appealFeatures: sortCountMap(tallyMulti(docs, "appeal_feat"), totalResponses),
      retention: sortCountMap(tallyMulti(docs, "retention"), totalResponses),
      barrier: sortCountMap(tallyMulti(docs, "barrier"), totalResponses),
      trust: sortCountMap(tallyMulti(docs, "trust"), totalResponses),
      switchIntent: sortCountMap(tallySingle(docs, "switch"), totalResponses),
      paymentIntent: sortCountMap(tallySingle(docs, "pay"), totalResponses),
      age: sortCountMap(tallySingle(docs, "age"), totalResponses),
      devotion: sortCountMap(tallySingle(docs, "dev"), totalResponses)
    },
    comments: docs.filter((doc) => doc.open).slice(0, 10).map((doc) => ({
      text: doc.open,
      usageIntent: doc.usage_intent || "",
      location: doc.loc || "",
      createdAt: doc.createdAt
    }))
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Payload too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(message);
}

function serveStatic(pathname, response) {
  const asset = assetMap.get(pathname);
  if (!asset) return false;
  try {
    const content = fs.readFileSync(path.join(ROOT, asset.file));
    response.writeHead(200, {
      "Content-Type": asset.type,
      "Cache-Control": pathname.includes(".jpg") ? "public, max-age=86400" : "no-store"
    });
    response.end(content);
  } catch (error) {
    sendText(response, 500, "Could not load the requested file.");
  }
  return true;
}

function writeSse(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function broadcastInsights() {
  if (!sseClients.size) return;
  try {
    const insights = await buildInsights();
    for (const client of sseClients) {
      writeSse(client, "insights", insights);
    }
  } catch (error) {
    for (const client of sseClients) {
      writeSse(client, "error", { message: "Unable to refresh insights." });
    }
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/api/insights") {
    try {
      sendJson(response, 200, await buildInsights());
    } catch (error) {
      sendText(response, 500, "Unable to load dashboard insights.");
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/responses") {
    try {
      const body = await readBody(request);
      const collection = await getCollection();
      await collection.insertOne(sanitizeResponse(body, request));
      const insights = await buildInsights();
      sendJson(response, 201, { ok: true, insights });
      broadcastInsights().catch(() => {});
    } catch (error) {
      sendText(response, 500, "Unable to save this survey response.");
    }
    return;
  }

  if (request.method === "GET" && pathname === "/api/stream") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    response.write("retry: 5000\n\n");
    sseClients.add(response);
    try {
      writeSse(response, "insights", await buildInsights());
    } catch (error) {
      writeSse(response, "error", { message: "Unable to fetch initial insights." });
    }
    const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 25000);
    request.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(response);
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && serveStatic(pathname, response)) {
    return;
  }

  sendText(response, 404, "Not found");
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    sendText(response, 500, "Unexpected server error.");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Tirth Sutra survey running at http://0.0.0.0:${PORT}`);
});

async function shutdown() {
  server.close();
  if (mongoClient) await mongoClient.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
