import { prisma } from "@/lib/db/prisma";

// Simple in-memory cache (5-second TTL)
type AliasEntry = { pattern: string; matchType: string; displayName: string };
let aliasCache: AliasEntry[] | null = null;
let aliasCacheTime = 0;

async function getAllAliasesCached(): Promise<AliasEntry[]> {
  if (aliasCache && Date.now() - aliasCacheTime < 5000) return aliasCache;
  const result = await prisma.menuCategoryAlias.findMany({
    select: { pattern: true, matchType: true, displayName: true },
  });
  aliasCache = result;
  aliasCacheTime = Date.now();
  return result;
}

export function clearMenuCategoryAliasCache() {
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
 * Follow alias chains: if "A" → "B" and "B" → "C", resolving "A" returns "C".
 * Stops after 5 hops to prevent infinite loops.
 */
function followChain(name: string, aliases: AliasEntry[], maxHops = 5): string {
  let current = name;
  for (let hop = 0; hop < maxHops; hop++) {
    let found = false;
    for (const alias of aliases) {
      if (isMatch(current, alias.pattern, alias.matchType)) {
        if (alias.displayName.toLowerCase() === current.toLowerCase()) break; // self-reference guard
        current = alias.displayName;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return current;
}

/**
 * Resolve a single category name against all aliases (follows chains).
 * Returns the final display name if matched, or null if no match.
 */
export async function resolveCategoryName(rawName: string): Promise<string | null> {
  const aliases = await getAllAliasesCached();
  const hasMatch = aliases.some((a) => isMatch(rawName, a.pattern, a.matchType));
  if (!hasMatch) return null;
  return followChain(rawName, aliases);
}

/**
 * Batch resolve category names — single cache read, many lookups.
 * Follows alias chains so "A" → "B" → "C" resolves to "C".
 * Returns a Map of rawName → resolvedName (only includes entries that matched).
 */
export async function resolveCategoryNames(names: string[]): Promise<Map<string, string>> {
  const aliases = await getAllAliasesCached();
  const result = new Map<string, string>();
  for (const name of names) {
    const hasMatch = aliases.some((a) => isMatch(name, a.pattern, a.matchType));
    if (hasMatch) {
      result.set(name, followChain(name, aliases));
    }
  }
  return result;
}

/**
 * Check if a given category name matches any alias.
 */
export async function isCategoryMatched(rawName: string): Promise<boolean> {
  const aliases = await getAllAliasesCached();
  return aliases.some((alias) => isMatch(rawName, alias.pattern, alias.matchType));
}
