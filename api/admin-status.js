const { json, isAdminUser } = require("./_supabase");

module.exports = async function handler(req, res) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      json(res, 200, { isAdmin: false });
      return;
    }

    const access = await isAdminUser(token);
    json(res, 200, {
      isAdmin: Boolean(access.isAdmin),
      user: access.user
        ? {
            id: access.user.id,
            email: access.user.email || null,
          }
        : null,
    });
  } catch (error) {
    json(res, 500, { error: error?.message || "Unexpected server error." });
  }
};
