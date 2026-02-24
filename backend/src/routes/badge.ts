import { Router } from "express";
import type { Request, Response } from "express";
import { scans } from "../lib/db.js";

const router = Router();

function scoreColor(score: number | null): string {
  if (score === null) return "#999";
  if (score >= 8) return "#eb5757";
  if (score >= 6) return "#f2994a";
  if (score >= 4) return "#f2c94c";
  return "#27ae60";
}

function makeBadge(label: string, value: string, color: string): string {
  const labelWidth = label.length * 6.5 + 12;
  const valueWidth = value.length * 6.5 + 12;
  const totalWidth = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-rendering="geometricPrecision">
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;
}

// GET /:url — Return SVG badge for latest completed scan
router.get("/:url", (req: Request<{ url: string }>, res: Response): void => {
  const rawUrl = decodeURIComponent(req.params.url);

  // Try exact match first, then with https:// prefix
  let scan = scans.latestCompleted(rawUrl);
  if (!scan && !/^https?:\/\//i.test(rawUrl)) {
    scan = scans.latestCompleted(`https://${rawUrl}`);
  }

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

  if (!scan) {
    res.send(makeBadge("magnus", "no data", "#999"));
    return;
  }

  const score = scan.risk_score;
  const value = score !== null ? `${score.toFixed(1)} / 10` : "scanned";
  res.send(makeBadge("magnus", value, scoreColor(score)));
});

export default router;
