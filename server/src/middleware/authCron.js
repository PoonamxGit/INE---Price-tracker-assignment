import { timingSafeEqual } from "node:crypto";
export function authCron(secret) {
  return (req, res, next) => {
    const expected = Buffer.from(`Bearer ${secret}`),
      actual = Buffer.from(req.get("authorization") || "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return res.status(401).json({ error: "Unauthorized." });
    next();
  };
}
