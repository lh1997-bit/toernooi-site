const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROGRAM_TABLE = process.env.SUPABASE_PROGRAM_TABLE || "program_state";
const ADMIN_TABLE = process.env.SUPABASE_ADMIN_TABLE || "admin_users";
const PROGRAM_ROW_ID = process.env.SUPABASE_PROGRAM_ROW_ID || "main";

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase environment variables are missing.");
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (!chunks.length) return null;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

async function getAuthedUser(accessToken) {
  requireConfig();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function isAdminUser(accessToken) {
  const user = await getAuthedUser(accessToken);
  if (!user?.id) return { user: null, isAdmin: false };

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${ADMIN_TABLE}?select=user_id,active,email&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );

  if (!response.ok) {
    return { user, isAdmin: false };
  }

  const rows = await response.json();
  return {
    user,
    isAdmin: Array.isArray(rows) && rows.length > 0,
  };
}

async function readProgramRow() {
  requireConfig();
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${PROGRAM_TABLE}?select=id,payload,updated_at,updated_by&id=eq.${encodeURIComponent(PROGRAM_ROW_ID)}&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Could not read program row (${response.status}).`);
  }

  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function writeProgramRow(program, user) {
  requireConfig();
  const payload = {
    id: PROGRAM_ROW_ID,
    payload: {
      ...program,
      updatedAt: Date.now(),
    },
    updated_by: user?.id || null,
  };

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${PROGRAM_TABLE}?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([payload]),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Could not save program row (${response.status}).`);
  }

  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

module.exports = {
  json,
  readJsonBody,
  isAdminUser,
  readProgramRow,
  writeProgramRow,
  PROGRAM_ROW_ID,
  PROGRAM_TABLE,
};
