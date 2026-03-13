import { prisma } from "@/lib/db/prisma";

// ---- Default aliases seeded on first load ----

interface DefaultAlias {
  pattern: string;
  matchType: "contains" | "starts_with" | "exact";
  displayName: string;
}

const DEFAULT_ALIASES: DefaultAlias[] = [
  // Rent (1654 Third Ave — landlord ACH)
  { pattern: "ORIG CO NAME:1654 Third Avenu", matchType: "starts_with", displayName: "Rent (1654 Third Ave)" },
  // Rent (NY ORIG ID:9000327993 — second rent ACH)
  { pattern: "ORIG CO NAME:NY ORIG ID:9000327993", matchType: "starts_with", displayName: "Rent (1654 Third Ave)" },
  // Con Edison electricity
  { pattern: "ORIG CO NAME:CON ED OF NY", matchType: "starts_with", displayName: "Con Edison (Electricity)" },
  // NYS Sales Tax
  { pattern: "ORIG CO NAME:NYS DTF SALES", matchType: "starts_with", displayName: "NYS Sales Tax" },
  // NYS Tax Bill Payment
  { pattern: "ORIG CO NAME:NYS DTF BILL", matchType: "starts_with", displayName: "NYS Tax Payment" },
  // NYS Corporate Tax
  { pattern: "ORIG CO NAME:NYS DTF CT", matchType: "starts_with", displayName: "NYS Corporate Tax" },
  // NYC Property/Finance Tax
  { pattern: "ORIG CO NAME:NYC DEPT OF FINA", matchType: "starts_with", displayName: "NYC Property Tax" },
  // The Hartford Insurance
  { pattern: "ORIG CO NAME:THE HARTFORD", matchType: "starts_with", displayName: "The Hartford (Insurance)" },
  // Rocket Money subscription
  { pattern: "ORIG CO NAME:Rocket Money", matchType: "starts_with", displayName: "Rocket Money" },
  // Goldman Sachs bank verification
  { pattern: "ORIG CO NAME:GOLDMAN SACHS", matchType: "starts_with", displayName: "Goldman Sachs" },
  // JPMorgan Chase
  { pattern: "ORIG CO NAME:JPMorgan Chase", matchType: "starts_with", displayName: "JPMorgan Chase" },
  // Yardi rent system
  { pattern: "ORIG CO NAME:Yardi", matchType: "starts_with", displayName: "Yardi (Rent System)" },

  // Amazon — all variants
  { pattern: "AMAZON MKTPL*", matchType: "starts_with", displayName: "Amazon" },
  { pattern: "AMAZON MARK*", matchType: "starts_with", displayName: "Amazon" },
  { pattern: "AMAZON MKTPLACE", matchType: "starts_with", displayName: "Amazon" },
  { pattern: "Amazon.com*", matchType: "starts_with", displayName: "Amazon" },

  // Zelle payments — salary grouping
  { pattern: "Zelle payment to Raven Rivera", matchType: "starts_with", displayName: "Raven Rivera (Salary)" },
  { pattern: "Zelle payment to Julia", matchType: "starts_with", displayName: "Julia (Salary)" },
  { pattern: "Zelle payment from", matchType: "starts_with", displayName: "Zelle Incoming" },

  // Temu — all variants
  { pattern: "TEMU.COM", matchType: "starts_with", displayName: "Temu" },
  { pattern: "Temu.com", matchType: "starts_with", displayName: "Temu" },

  // Facebook Ads
  { pattern: "FACEBK *", matchType: "starts_with", displayName: "Facebook Ads" },

  // Yelp
  { pattern: "YELPCOM*", matchType: "starts_with", displayName: "Yelp (Advertising)" },
  { pattern: "YELPINC*", matchType: "starts_with", displayName: "Yelp (Advertising)" },

  // Squarespace
  { pattern: "SQSP*", matchType: "starts_with", displayName: "Squarespace" },

  // Ring security
  { pattern: "RING PREMIUM", matchType: "starts_with", displayName: "Ring (Security)" },
  { pattern: "RING PRO", matchType: "starts_with", displayName: "Ring (Security)" },
  { pattern: "SP RING USA", matchType: "starts_with", displayName: "Ring (Security)" },

  // NYC Health Dept permits
  { pattern: "NYC DOHMH", matchType: "starts_with", displayName: "NYC Health Dept (Permits)" },
  { pattern: "DOHMH LIC", matchType: "starts_with", displayName: "NYC Health Dept (Permits)" },

  // Verizon
  { pattern: "VERIZON*", matchType: "starts_with", displayName: "Verizon" },

  // Utica First Insurance
  { pattern: "UTICA FIRST", matchType: "starts_with", displayName: "Utica First Insurance" },

  // NEXT Insurance
  { pattern: "NEXT INSUR*", matchType: "starts_with", displayName: "Next Insurance" },

  // ADS (advertising)
  { pattern: "ADS1112473141", matchType: "exact", displayName: "ADS (Advertising)" },
];

/**
 * Ensure default aliases are in the database. Only inserts ones that don't already exist.
 */
export async function ensureDefaultAliases(): Promise<number> {
  const existing = await prisma.vendorAlias.findMany();
  const existingPatterns = new Set(existing.map((a) => `${a.matchType}::${a.pattern}`));

  let inserted = 0;
  for (const alias of DEFAULT_ALIASES) {
    const key = `${alias.matchType}::${alias.pattern}`;
    if (!existingPatterns.has(key)) {
      await prisma.vendorAlias.create({
        data: {
          pattern: alias.pattern,
          matchType: alias.matchType,
          displayName: alias.displayName,
          autoCreated: true,
        },
      });
      inserted++;
    }
  }
  return inserted;
}

/**
 * Match a vendor name against all aliases and return the display name if matched.
 */
export async function resolveVendorName(rawName: string): Promise<string | null> {
  const aliases = await getAllAliasesCached();
  return matchAgainstAliases(rawName, aliases);
}

function matchAgainstAliases(
  rawName: string,
  aliases: { pattern: string; matchType: string; displayName: string }[]
): string | null {
  for (const alias of aliases) {
    if (isMatch(rawName, alias.pattern, alias.matchType)) {
      return alias.displayName;
    }
  }
  return null;
}

function isMatch(name: string, pattern: string, matchType: string): boolean {
  switch (matchType) {
    case "exact":
      return name === pattern;
    case "starts_with":
      return name.startsWith(pattern);
    case "contains":
      return name.includes(pattern);
    default:
      return false;
  }
}

// Simple in-memory cache to avoid repeated DB reads during batch operations
let aliasCache: { pattern: string; matchType: string; displayName: string }[] | null = null;
let aliasCacheTime = 0;

async function getAllAliasesCached() {
  if (aliasCache && Date.now() - aliasCacheTime < 5000) return aliasCache;
  aliasCache = await prisma.vendorAlias.findMany({
    select: { pattern: true, matchType: true, displayName: true },
  });
  aliasCacheTime = Date.now();
  return aliasCache;
}

export function clearAliasCache() {
  aliasCache = null;
}

/**
 * Apply all aliases to existing vendor records. Updates vendor.displayName
 * for every vendor whose name matches an alias. Returns count of updated vendors.
 */
export async function applyAliasesToVendors(): Promise<{ updated: number; total: number }> {
  const aliases = await prisma.vendorAlias.findMany();
  const vendors = await prisma.vendor.findMany();

  let updated = 0;
  for (const vendor of vendors) {
    const displayName = matchAgainstAliases(vendor.name, aliases);
    const currentDisplay = vendor.displayName;

    if (displayName && currentDisplay !== displayName) {
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { displayName },
      });
      updated++;
    } else if (!displayName && currentDisplay) {
      // Alias was removed — clear the display name
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { displayName: null },
      });
      updated++;
    }
  }

  clearAliasCache();
  return { updated, total: vendors.length };
}
