import { PlatformParser, SourcePlatform } from "./types";
import { squareParser } from "./square";
import { chaseParser } from "./chase";
import { doordashParser } from "./doordash";
import { ubereatsParser } from "./ubereats";
import { grubhubParser } from "./grubhub";
import { rocketmoneyParser } from "./rocketmoney";

export type { ParseResult, SourcePlatform, PlatformParser } from "./types";
export { detectChasePdf, parseChasePdfText } from "./chase-pdf";
export type { PdfData } from "./chase-pdf";

/**
 * Registry of all available platform parsers.
 */
const parsers: PlatformParser[] = [
  squareParser,
  chaseParser,
  doordashParser,
  ubereatsParser,
  grubhubParser,
  rocketmoneyParser,
];

/**
 * Get a parser by its source platform name.
 */
export function getParser(source: SourcePlatform): PlatformParser | undefined {
  return parsers.find((p) => p.source === source);
}

/**
 * Auto-detect which parser to use based on file name and headers.
 * Returns the parser with the highest confidence score, or undefined
 * if no parser has confidence > 0.3.
 */
export function detectParser(
  fileName: string,
  headers: string[]
): { parser: PlatformParser; confidence: number } | undefined {
  let best: { parser: PlatformParser; confidence: number } | undefined;

  for (const parser of parsers) {
    const confidence = parser.detect(fileName, headers);
    if (confidence > (best?.confidence ?? 0.3)) {
      best = { parser, confidence };
    }
  }

  return best;
}

/**
 * List all available source platforms.
 */
export function listPlatforms(): SourcePlatform[] {
  return parsers.map((p) => p.source);
}
