import type { RequestHandler } from "express";

export function requestPolicy(
  allowedOrigins = (process.env.APP_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
): RequestHandler {
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: "This origin is not allowed." });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function rateLimit(max = 120, windowMs = 15 * 60_000): RequestHandler {
  const requests = new Map<string, { count: number; expires: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    const previous = requests.get(key);
    const entry =
      previous && previous.expires > now
        ? previous
        : { count: 0, expires: now + windowMs };
    if (requests.size >= 10_000)
      for (const [ip, record] of requests)
        if (record.expires <= now) requests.delete(ip);
    if (!requests.has(key) && requests.size >= 10_000) {
      res.status(429).json({ error: "Please try again later." });
      return;
    }
    requests.set(key, entry);
    entry.count++;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.expires - now) / 1000));
      res
        .status(429)
        .json({ error: "Too many requests. Please try again later." });
      return;
    }
    next();
  };
}
