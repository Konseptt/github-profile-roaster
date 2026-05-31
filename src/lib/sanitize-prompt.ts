const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/gi,
  /disregard\s+(all\s+)?(previous|prior|system)\s+/gi,
  /you\s+are\s+now\s+/gi,
  /new\s+instructions?\s*:/gi,
  /system\s*prompt/gi,
  /reveal\s+(the\s+)?(api\s*key|secret|password)/gi,
  /<\s*\/?\s*system\s*>/gi,
  /\[INST\]/gi,
  /###\s*instruction/gi,
];

export function sanitizeUntrustedText(text: string, maxLen = 2000): string {
  let out = text.slice(0, maxLen);
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

export function capAnalysisText(text: string, max = 24_000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated for safety]`;
}
