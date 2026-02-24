import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Scan, Finding, SeverityCounts } from "../types/index";

// ── DESIGN TOKENS ──

type RGB = [number, number, number];

const BRAND_DARK: RGB = [25, 25, 24];
const TEXT_BODY: RGB = [50, 50, 48];
const TEXT_SECONDARY: RGB = [107, 106, 102];
const TEXT_TERTIARY: RGB = [168, 167, 162];
const BG: RGB = [247, 246, 243];
const SURFACE_2: RGB = [241, 240, 236];
const OK_GREEN: RGB = [39, 98, 69];
const CODE_BG: RGB = [15, 15, 14];
const CODE_TEXT: RGB = [232, 230, 225];

const SEV_RGB: Record<string, RGB> = {
  critical: [192, 57, 43],
  high: [184, 76, 0],
  medium: [138, 105, 0],
  low: [26, 100, 144],
  info: [168, 167, 162],
};

const SEV_BG: Record<string, RGB> = {
  critical: [251, 243, 242],
  high: [252, 245, 237],
  medium: [251, 248, 237],
  low: [238, 246, 250],
  info: [248, 248, 247],
};

const MARGIN = 20;
const CONTENT_W = 170;
const PAGE_W = 210;
const PAGE_H = 297;
const FOOTER_Y = PAGE_H - 12;
const USABLE_BOTTOM = PAGE_H - 18;
const ACCENT_W = 3;

// ── UTILITIES ──

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
  } catch { return dateStr; }
}

function riskRgb(score: number | null): RGB {
  if (score === null) return TEXT_TERTIARY;
  if (score >= 8) return SEV_RGB["critical"]!;
  if (score >= 6) return SEV_RGB["high"]!;
  if (score >= 4) return SEV_RGB["medium"]!;
  return OK_GREEN;
}

function riskLabel(score: number): string {
  if (score >= 8) return "Critical";
  if (score >= 6) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

function tintColor(color: RGB, amount: number): RGB {
  return [
    Math.round(color[0] + (255 - color[0]) * amount),
    Math.round(color[1] + (255 - color[1]) * amount),
    Math.round(color[2] + (255 - color[2]) * amount),
  ];
}

// ── DRAWING HELPERS ──

function drawShield(doc: jsPDF, cx: number, cy: number, size: number, fill: RGB) {
  // Shield from Nav.tsx: M7 1L2 3.5V7.5C2 10.2 4.2 12.7 7 13.5C9.8 12.7 12 10.2 12 7.5V3.5L7 1Z
  // Viewbox 14x14, path spans y=1..13.5 (12.5 units)
  const s = size / 12.5;
  const ox = cx - 7 * s;
  const oy = cy - 7.25 * s;
  const px = (x: number) => ox + x * s;
  const py = (y: number) => oy + y * s;

  const points: [number, number][] = [
    [7, 1], [2, 3.5], [2, 7.5],
    [2.3, 8.8], [3.0, 10.0], [4.0, 11.2], [5.2, 12.1], [6.1, 12.8], [7, 13.5],
    [7.9, 12.8], [8.8, 12.1], [10.0, 11.2], [11.0, 10.0], [11.7, 8.8],
    [12, 7.5], [12, 3.5],
  ];

  const deltas: [number, number][] = [];
  for (let i = 1; i < points.length; i++) {
    const curr = points[i]!;
    const prev = points[i - 1]!;
    deltas.push([(curr[0] - prev[0]) * s, (curr[1] - prev[1]) * s]);
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  deltas.push([(first[0] - last[0]) * s, (first[1] - last[1]) * s]);

  doc.setFillColor(...fill);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).lines(deltas, px(7), py(1), [1, 1], "F", true);
}

function measureFindingHeight(doc: jsPDF, finding: Finding, innerW: number): number {
  let h = 8; // top padding + badge row
  const titleLines = doc.splitTextToSize(finding.title, innerW - 30) as string[];
  h += titleLines.length * 6 + 4;
  h += 10; // metadata strip
  if (finding.description) {
    const descLines = doc.splitTextToSize(finding.description, innerW) as string[];
    h += descLines.length * 5 + 4;
  }
  if (finding.ai_commentary) {
    const aiLines = doc.splitTextToSize(finding.ai_commentary, innerW - 12) as string[];
    h += aiLines.length * 4.5 + 16;
  }
  h += 6; // bottom padding
  return h;
}

// ── MAIN EXPORT ──

export function downloadPdfReport(
  scan: Scan,
  findings: Finding[],
  severityCounts: SeverityCounts,
): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = MARGIN;
  let sectionNum = 0;

  const checkPage = (needed: number) => {
    if (y + needed > USABLE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const sectionHeader = (title: string) => {
    sectionNum++;
    checkPage(18);
    // Accent bar with section number
    doc.setFillColor(...BRAND_DARK);
    doc.roundedRect(MARGIN, y - 5, ACCENT_W, 10, 0.5, 0.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text(String(sectionNum), MARGIN + ACCENT_W / 2, y + 0.5, { align: "center" });
    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...BRAND_DARK);
    doc.text(title, MARGIN + ACCENT_W + 4, y);
    y += 10;
  };

  const sevKeys: (keyof SeverityCounts)[] = ["critical", "high", "medium", "low", "info"];
  const sortedFindings = [...findings].sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0));
  const exploitedCount = findings.filter(f => f.exploited).length;
  const scanTypeLabel = scan.scan_type === "whitebox" ? "White-box" : "Black-box";

  // ═══════════════════════════════════════════════════════════
  // COVER PAGE
  // ═══════════════════════════════════════════════════════════

  // Dark header band
  doc.setFillColor(...BRAND_DARK);
  doc.rect(0, 0, PAGE_W, 42, "F");

  // Shield logo
  drawShield(doc, PAGE_W / 2 - 32, 21, 14, [255, 255, 255]);

  // "MAGNUS"
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(255, 255, 255);
  doc.text("MAGNUS", PAGE_W / 2 - 18, 20);

  // Subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_TERTIARY);
  doc.text("Security Scan Report", PAGE_W / 2 - 16, 29);

  // Target hostname
  y = 56;
  doc.setFont("courier", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...BRAND_DARK);
  doc.text(hostname(scan.url), PAGE_W / 2, y, { align: "center" });
  y += 10;

  // Scan metadata
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_SECONDARY);
  doc.text(`${scanTypeLabel} Assessment · ${scan.model}`, PAGE_W / 2, y, { align: "center" });
  y += 7;
  doc.setTextColor(...TEXT_TERTIARY);
  if (scan.completed_at) {
    const completed = new Date(scan.completed_at);
    doc.text(
      `Completed ${completed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} at ${completed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
      PAGE_W / 2, y, { align: "center" },
    );
  } else {
    doc.text(formatDate(scan.started_at), PAGE_W / 2, y, { align: "center" });
  }

  // Risk score circle
  y = 104;
  if (scan.risk_score !== null) {
    const rc = riskRgb(scan.risk_score);

    // Tinted background circle
    doc.setFillColor(...tintColor(rc, 0.88));
    doc.circle(PAGE_W / 2, y, 20, "F");

    // Colored ring
    doc.setDrawColor(...rc);
    doc.setLineWidth(1.2);
    doc.circle(PAGE_W / 2, y, 20, "S");
    doc.setLineWidth(0.2);

    // Score number
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.setTextColor(...rc);
    doc.text(scan.risk_score.toFixed(1), PAGE_W / 2, y + 1, { align: "center" });

    // "/ 10"
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...TEXT_TERTIARY);
    doc.text("/ 10", PAGE_W / 2, y + 9, { align: "center" });

    // Risk label
    y += 28;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...rc);
    doc.text(`${riskLabel(scan.risk_score).toUpperCase()} RISK`, PAGE_W / 2, y, { align: "center" });
  }

  // Severity stat-bento boxes
  y = 148;
  const boxW = CONTENT_W / 5;
  const boxH = 28;

  for (let i = 0; i < sevKeys.length; i++) {
    const key = sevKeys[i]!;
    const count = severityCounts[key];
    const color: RGB = SEV_RGB[key] ?? TEXT_TERTIARY;
    const x = MARGIN + i * boxW;

    doc.setFillColor(BG[0], BG[1], BG[2]);
    doc.roundedRect(x + 0.5, y, boxW - 1, boxH, 2, 2, "F");

    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(x + 0.5, y, boxW - 1, 2.5, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(String(count), x + boxW / 2, y + 16, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(TEXT_TERTIARY[0], TEXT_TERTIARY[1], TEXT_TERTIARY[2]);
    doc.text(key.toUpperCase(), x + boxW / 2, y + 23, { align: "center" });
  }

  // Total + exploited line
  y += boxH + 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_SECONDARY);
  doc.text(
    `${findings.length} total findings · ${exploitedCount} exploited`,
    PAGE_W / 2, y, { align: "center" },
  );

  // Footer timestamp
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_TERTIARY);
  doc.text(
    `Generated ${new Date().toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`,
    PAGE_W / 2, PAGE_H - 20, { align: "center" },
  );

  // ═══════════════════════════════════════════════════════════
  // EXECUTIVE SUMMARY
  // ═══════════════════════════════════════════════════════════

  const execSummary = scan.metadata?.executive_summary as string | undefined;
  const attackNarrative = scan.metadata?.attack_narrative as string | undefined;

  if (execSummary) {
    doc.addPage();
    y = MARGIN;
    sectionHeader("EXECUTIVE SUMMARY");

    // Summary in a light panel
    const summaryLines = doc.splitTextToSize(execSummary, CONTENT_W - 16) as string[];
    const panelH = summaryLines.length * 6 + 14;

    doc.setFillColor(...BG);
    doc.roundedRect(MARGIN, y, CONTENT_W, panelH, 2, 2, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...TEXT_BODY);
    let textY = y + 8;
    for (const line of summaryLines) {
      doc.text(line, MARGIN + 8, textY);
      textY += 6;
    }
    y += panelH + 8;

    // Attack narrative callout
    if (attackNarrative) {
      checkPage(30);
      const narrativeLines = doc.splitTextToSize(attackNarrative, CONTENT_W - 16) as string[];
      const narrH = narrativeLines.length * 5.5 + 20;

      doc.setFillColor(...SURFACE_2);
      doc.roundedRect(MARGIN, y, CONTENT_W, narrH, 2, 2, "F");

      // Left accent
      doc.setFillColor(...BRAND_DARK);
      doc.rect(MARGIN, y, 2.5, narrH, "F");

      // Label
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...TEXT_TERTIARY);
      doc.text("ATTACK NARRATIVE", MARGIN + 8, y + 8);

      // Narrative text
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(...TEXT_BODY);
      let narrY = y + 15;
      for (const line of narrativeLines) {
        doc.text(line, MARGIN + 8, narrY);
        narrY += 5.5;
      }
      y += narrH + 8;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SEVERITY SUMMARY
  // ═══════════════════════════════════════════════════════════

  if (!execSummary) {
    doc.addPage();
    y = MARGIN;
  } else {
    y += 4;
  }
  sectionHeader("SEVERITY SUMMARY");

  // Horizontal bar chart
  const maxCount = Math.max(
    severityCounts.critical, severityCounts.high,
    severityCounts.medium, severityCounts.low, severityCounts.info, 1,
  );
  const barMaxW = 105;
  const barH = 7;
  const barGap = 10;
  const labelW = 24;

  for (const key of sevKeys) {
    const count = severityCounts[key];
    const color: RGB = SEV_RGB[key] ?? TEXT_TERTIARY;
    const barW = maxCount > 0 ? (count / maxCount) * barMaxW : 0;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(key.toUpperCase(), MARGIN, y + 5);

    doc.setFillColor(SURFACE_2[0], SURFACE_2[1], SURFACE_2[2]);
    doc.roundedRect(MARGIN + labelW, y, barMaxW, barH, 2, 2, "F");

    if (barW > 0) {
      doc.setFillColor(color[0], color[1], color[2]);
      doc.roundedRect(MARGIN + labelW, y, Math.max(barW, 4), barH, 2, 2, "F");
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(BRAND_DARK[0], BRAND_DARK[1], BRAND_DARK[2]);
    doc.text(String(count), MARGIN + labelW + barMaxW + 5, y + 5);

    y += barGap;
  }
  y += 6;

  // Summary table with colored left borders
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Severity", "Count", "Exploited"]],
    body: [
      ["Critical", String(severityCounts.critical), String(findings.filter(f => f.severity === "critical" && f.exploited).length)],
      ["High", String(severityCounts.high), String(findings.filter(f => f.severity === "high" && f.exploited).length)],
      ["Medium", String(severityCounts.medium), String(findings.filter(f => f.severity === "medium" && f.exploited).length)],
      ["Low", String(severityCounts.low), "—"],
      ["Info", String(severityCounts.info), "—"],
    ],
    styles: { fontSize: 10, cellPadding: { top: 4, right: 6, bottom: 4, left: 8 }, font: "helvetica" },
    headStyles: { fillColor: [BRAND_DARK[0], BRAND_DARK[1], BRAND_DARK[2]], textColor: [255, 255, 255], fontStyle: "bold" },
    bodyStyles: { textColor: [TEXT_BODY[0], TEXT_BODY[1], TEXT_BODY[2]] },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 0) {
        const label = String(data.cell.raw).toLowerCase();
        const color = SEV_RGB[label];
        if (color) {
          data.cell.styles.textColor = [color[0], color[1], color[2]];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 0) {
        const label = String(data.cell.raw).toLowerCase();
        const color = SEV_RGB[label];
        if (color) {
          doc.setFillColor(...color);
          doc.rect(data.cell.x, data.cell.y, 1.5, data.cell.height, "F");
        }
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // Total line
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_DARK);
  doc.text(`Total: ${findings.length} findings · ${exploitedCount} exploited`, MARGIN + 2, y + 4);

  // ═══════════════════════════════════════════════════════════
  // FINDINGS
  // ═══════════════════════════════════════════════════════════

  doc.addPage();
  y = MARGIN;
  sectionHeader("FINDINGS");

  for (const finding of sortedFindings) {
    const sevColor = SEV_RGB[finding.severity] ?? TEXT_TERTIARY;
    const sevBg = SEV_BG[finding.severity] ?? BG;
    const cardInnerX = MARGIN + ACCENT_W + 4;
    const cardInnerW = CONTENT_W - ACCENT_W - 8;

    const cardH = measureFindingHeight(doc, finding, cardInnerW);
    checkPage(Math.min(cardH, USABLE_BOTTOM - MARGIN));

    const cardStartY = y;

    // Background panel
    doc.setFillColor(...sevBg);
    doc.roundedRect(MARGIN, y, CONTENT_W, cardH, 2, 2, "F");

    // Left accent bar (full height)
    doc.setFillColor(...sevColor);
    doc.rect(MARGIN, y, ACCENT_W, cardH, "F");

    y += 6;

    // Severity badge
    const badgeText = finding.severity.toUpperCase();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    const badgeW = Math.max(doc.getTextWidth(badgeText) + 6, 18);
    doc.setFillColor(...sevColor);
    doc.roundedRect(cardInnerX, y - 4, badgeW, 6, 1.5, 1.5, "F");
    doc.setTextColor(255, 255, 255);
    doc.text(badgeText, cardInnerX + badgeW / 2, y, { align: "center" });

    // CVSS score (right side)
    if (finding.cvss_score !== null) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(...sevColor);
      doc.text(finding.cvss_score.toFixed(1), MARGIN + CONTENT_W - 4, y + 1, { align: "right" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...TEXT_TERTIARY);
      doc.text("CVSS", MARGIN + CONTENT_W - 4, y + 6, { align: "right" });
    }

    y += 6;

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...BRAND_DARK);
    const titleLines = doc.splitTextToSize(finding.title, cardInnerW - 30) as string[];
    for (const line of titleLines) {
      doc.text(line, cardInnerX, y);
      y += 6;
    }
    y += 2;

    // Metadata strip
    const metaParts: string[] = [];
    if (finding.endpoint) metaParts.push(finding.endpoint);
    if (finding.cwe) metaParts.push(finding.cwe);
    if (finding.owasp) metaParts.push(finding.owasp);
    if (finding.exploited) metaParts.push("Exploited");

    if (metaParts.length > 0) {
      doc.setFillColor(...tintColor(sevColor, 0.92));
      doc.roundedRect(cardInnerX, y - 2.5, cardInnerW, 7, 1, 1, "F");

      doc.setFont("courier", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...TEXT_SECONDARY);
      const metaText = metaParts.join("  ·  ");
      const truncated = metaText.length > 120 ? metaText.slice(0, 117) + "..." : metaText;
      doc.text(truncated, cardInnerX + 3, y + 1.5);
      y += 8;
    }

    // Description
    if (finding.description) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...TEXT_BODY);
      const descLines = doc.splitTextToSize(finding.description, cardInnerW) as string[];
      for (const line of descLines) {
        if (y + 5 > USABLE_BOTTOM) {
          doc.addPage();
          y = MARGIN;
        }
        doc.text(line, cardInnerX, y);
        y += 5;
      }
      y += 2;
    }

    // AI Commentary callout
    if (finding.ai_commentary) {
      const aiLines = doc.splitTextToSize(finding.ai_commentary, cardInnerW - 12) as string[];
      const aiH = aiLines.length * 4.5 + 14;

      if (y + aiH > USABLE_BOTTOM) {
        doc.addPage();
        y = MARGIN;
      }

      // Callout background
      doc.setFillColor(...SURFACE_2);
      doc.roundedRect(cardInnerX, y, cardInnerW, aiH, 1.5, 1.5, "F");

      // Left accent
      doc.setFillColor(...TEXT_TERTIARY);
      doc.rect(cardInnerX, y, 1.5, aiH, "F");

      // Label
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...TEXT_TERTIARY);
      doc.text("AI ANALYSIS", cardInnerX + 6, y + 5.5);

      // Commentary text
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(...TEXT_BODY);
      let aiY = y + 11;
      for (const line of aiLines) {
        doc.text(line, cardInnerX + 6, aiY);
        aiY += 4.5;
      }
      y += aiH + 2;
    }

    // Ensure y lands past the card
    y = Math.max(y, cardStartY + cardH) + 6;
  }

  // ═══════════════════════════════════════════════════════════
  // REMEDIATION
  // ═══════════════════════════════════════════════════════════

  const withFixes = sortedFindings.filter(
    f => f.fix_guide_json && f.fix_guide_json.steps.length > 0,
  );

  if (withFixes.length > 0) {
    doc.addPage();
    y = MARGIN;
    sectionHeader("REMEDIATION");

    for (const finding of withFixes) {
      const sevColor = SEV_RGB[finding.severity] ?? TEXT_TERTIARY;
      checkPage(30);

      // Severity badge + title
      const badgeText = finding.severity.toUpperCase();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      const badgeW = Math.max(doc.getTextWidth(badgeText) + 6, 16);
      doc.setFillColor(...sevColor);
      doc.roundedRect(MARGIN, y - 3.5, badgeW, 5.5, 1, 1, "F");
      doc.setTextColor(255, 255, 255);
      doc.text(badgeText, MARGIN + badgeW / 2, y, { align: "center" });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...BRAND_DARK);
      const titleLines = doc.splitTextToSize(finding.title, CONTENT_W - badgeW - 6) as string[];
      doc.text(titleLines[0] ?? finding.title, MARGIN + badgeW + 4, y);
      y += 8;

      // Numbered steps with green circles
      const steps = finding.fix_guide_json!.steps;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue;
        checkPage(12);

        // Step number circle
        doc.setFillColor(...OK_GREEN);
        doc.circle(MARGIN + 4, y + 0.5, 2.5, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(255, 255, 255);
        doc.text(String(i + 1), MARGIN + 4, y + 1.5, { align: "center" });

        // Step text
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...TEXT_BODY);
        const stepLines = doc.splitTextToSize(step, CONTENT_W - 16) as string[];
        let stepY = y;
        for (const line of stepLines) {
          checkPage(5);
          doc.text(line, MARGIN + 12, stepY);
          stepY += 5;
        }
        y = stepY + 3;
      }

      // Code diff in dark box
      const diff = finding.fix_guide_json!.diff;
      if (diff) {
        checkPage(16);

        doc.setFont("courier", "normal");
        doc.setFontSize(7.5);
        const diffLines = doc.splitTextToSize(diff, CONTENT_W - 12) as string[];
        const diffH = diffLines.length * 4 + 8;

        // Dark background
        doc.setFillColor(...CODE_BG);
        doc.roundedRect(MARGIN, y, CONTENT_W, diffH, 2, 2, "F");

        // Diff text with coloring
        let diffY = y + 5;
        for (const line of diffLines) {
          if (line.startsWith("+")) {
            doc.setTextColor(85, 239, 196);
          } else if (line.startsWith("-")) {
            doc.setTextColor(255, 118, 117);
          } else {
            doc.setTextColor(...CODE_TEXT);
          }
          doc.text(line, MARGIN + 4, diffY);
          diffY += 4;
        }
        y += diffH + 4;
      }

      // Verify / install commands
      const cmds = [finding.fix_guide_json!.install_cmd, finding.fix_guide_json!.verify_cmd].filter(Boolean);
      for (const cmd of cmds) {
        if (!cmd) continue;
        checkPage(10);
        doc.setFont("courier", "normal");
        doc.setFontSize(7.5);
        const cmdW = Math.min(doc.getTextWidth(cmd) + 10, CONTENT_W);

        doc.setFillColor(...CODE_BG);
        doc.roundedRect(MARGIN, y, cmdW, 7, 1.5, 1.5, "F");
        doc.setTextColor(...CODE_TEXT);
        doc.text(cmd, MARGIN + 4, y + 4.5);
        y += 10;
      }

      // Separator
      y += 2;
      doc.setDrawColor(...SURFACE_2);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      y += 8;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PAGE FOOTERS
  // ═══════════════════════════════════════════════════════════

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Skip cover page footer
    if (i === 1) continue;

    // Thin rule line
    doc.setDrawColor(...SURFACE_2);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, FOOTER_Y - 3, MARGIN + CONTENT_W, FOOTER_Y - 3);
    doc.setLineWidth(0.2);

    // Footer text
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_TERTIARY);
    doc.text(
      `Magnus · ${hostname(scan.url)} · Page ${i} of ${totalPages}`,
      PAGE_W / 2, FOOTER_Y, { align: "center" },
    );
  }

  // ═══════════════════════════════════════════════════════════
  // DOWNLOAD
  // ═══════════════════════════════════════════════════════════

  const dateStr = new Date().toISOString().slice(0, 10);
  doc.save(`magnus-report-${hostname(scan.url)}-${dateStr}.pdf`);
}
