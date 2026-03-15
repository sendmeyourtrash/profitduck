import { prisma } from "@/lib/db/prisma";

// Simple in-memory cache (5-second TTL)
type AliasEntry = { pattern: string; matchType: string; displayName: string };
let aliasCache: AliasEntry[] | null = null;
let aliasCacheTime = 0;

async function getAllAliasesCached(): Promise<AliasEntry[]> {
  if (aliasCache && Date.now() - aliasCacheTime < 5000) return aliasCache;
  const result = await prisma.menuItemAlias.findMany({
    select: { pattern: true, matchType: true, displayName: true },
  });
  aliasCache = result;
  aliasCacheTime = Date.now();
  return result;
}

export function clearMenuItemAliasCache() {
  aliasCache = null;
}

function isMatch(name: string, pattern: string, matchType: string): boolean {
  const lowerName = name.toLowerCase();
  const lowerPattern = pattern.toLowerCase();
  switch (matchType) {
    case "exact":
      return lowerName === lowerPattern;
    case "starts_with":
      return lowerName.startsWith(lowerPattern);
    case "contains":
      return lowerName.includes(lowerPattern);
    default:
      return false;
  }
}

/**
 * Resolve a single item name against all aliases.
 * Returns the display name if matched, or null if no match.
 */
export async function resolveItemName(rawName: string): Promise<string | null> {
  const aliases = await getAllAliasesCached();
  for (const alias of aliases) {
    if (isMatch(rawName, alias.pattern, alias.matchType)) {
      return alias.displayName;
    }
  }
  return null;
}

/**
 * Batch resolve item names — single cache read, many lookups.
 * Returns a Map of rawName → resolvedName (only includes entries that matched).
 */
export async function resolveItemNames(names: string[]): Promise<Map<string, string>> {
  const aliases = await getAllAliasesCached();
  const result = new Map<string, string>();
  for (const name of names) {
    for (const alias of aliases) {
      if (isMatch(name, alias.pattern, alias.matchType)) {
        result.set(name, alias.displayName);
        break;
      }
    }
  }
  return result;
}

/**
 * Check if a given item name matches any alias.
 */
export async function isItemMatched(rawName: string): Promise<boolean> {
  const aliases = await getAllAliasesCached();
  return aliases.some((alias) => isMatch(rawName, alias.pattern, alias.matchType));
}
