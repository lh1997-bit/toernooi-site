const {
  json,
  readJsonBody,
  readProgramRow,
  writeProgramRow,
} = require("./_supabase");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const row = await readProgramRow();
      json(res, 200, {
        program: row?.payload || null,
        updated_at: row?.updated_at || null,
      });
      return;
    }

    if (req.method !== "PUT" && req.method !== "POST") {
      json(res, 405, { error: "Method not allowed" });
      return;
    }

    const body = await readJsonBody(req);
    const program = body?.program || body?.state || null;
    if (!program || typeof program !== "object") {
      json(res, 400, { error: "Missing program payload." });
      return;
    }

    const row = await writeProgramRow(program, null);
    json(res, 200, {
      program: row?.payload || program,
      updated_at: row?.updated_at || new Date().toISOString(),
    });
  } catch (error) {
    json(res, 500, { error: error?.message || "Unexpected server error." });
  }
};
