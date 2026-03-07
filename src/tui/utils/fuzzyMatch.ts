/**
 * Fuzzy Matcher Utility
 *
 * Provides fzf-style fuzzy matching with scoring and highlighting.
 */

export interface FuzzyMatchResult {
  /** The matched string */
  text: string;

  /** Score (higher is better) */
  score: number;

  /** Indices of matched characters for highlighting */
  matchIndices: number[];
}

/**
 * Perform fuzzy match on a string against a query
 *
 * Uses a scoring algorithm similar to fzf:
 * - Bonus for matching at word boundaries (after spaces, slashes, hyphens)
 * - Bonus for matching at start of string
 * - Bonus for consecutive matches
 * - Penalty for gaps between matches
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatchResult | null {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Empty query matches everything with score 0
  if (query.length === 0) {
    return { text, score: 0, matchIndices: [] };
  }

  // Quick check: all query chars must exist in text in order
  let queryIdx = 0;
  for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) {
      queryIdx++;
    }
  }

  if (queryIdx < queryLower.length) {
    return null; // Not all chars found
  }

  // Score all possible matches and find the best one
  const result = findBestMatch(text, textLower, queryLower);
  return result;
}

/**
 * Find the best matching path through the text
 */
function findBestMatch(
  text: string,
  textLower: string,
  queryLower: string
): FuzzyMatchResult | null {
  const textLen = text.length;
  const queryLen = queryLower.length;

  // DP approach: for each position, track best score ending with each query char
  // dp[i][j] = best score for matching first j chars of query ending at position i
  const NEG_INF = -Infinity;

  // Score matrix
  const scores: number[][] = [];
  for (let i = 0; i < textLen; i++) {
    scores[i] = [];
    for (let j = 0; j < queryLen; j++) {
      scores[i][j] = NEG_INF;
    }
  }

  // Track for reconstruction
  const prev: number[][][] = [];
  for (let i = 0; i < textLen; i++) {
    prev[i] = [];
    for (let j = 0; j < queryLen; j++) {
      prev[i][j] = [];
    }
  }

  // Fill the matrix
  for (let i = 0; i < textLen; i++) {
    for (let j = 0; j < queryLen; j++) {
      if (textLower[i] !== queryLower[j]) continue;

      // Base score for matching this character
      let charScore = 1;

      // Bonus for word boundary (start of string, after space, after special chars)
      if (i === 0) {
        charScore += 10; // Start of string
      } else if (/[ _\/\-:]/.test(text[i - 1])) {
        charScore += 8; // After word separator
      } else if (/[A-Z]/.test(text[i]) && /[a-z]/.test(text[i - 1])) {
        charScore += 8; // CamelCase boundary
      }

      // Capital letter bonus
      if (/[A-Z]/.test(text[i])) {
        charScore += 2;
      }

      if (j === 0) {
        // First query character
        scores[i][j] = charScore;
      } else {
        // Find best previous position
        let bestPrevScore = NEG_INF;
        let bestPrevIdx = -1;

        for (let k = j - 1; k < i; k++) {
          if (scores[k][j - 1] === NEG_INF) continue;

          let transitionScore = scores[k][j - 1];

          // Consecutive match bonus
          if (k === i - 1) {
            transitionScore += 5;
          } else {
            // Gap penalty (decreasing with distance)
            const gap = i - k - 1;
            transitionScore -= Math.min(gap, 3);
          }

          if (transitionScore > bestPrevScore) {
            bestPrevScore = transitionScore;
            bestPrevIdx = k;
          }
        }

        if (bestPrevIdx >= 0) {
          scores[i][j] = bestPrevScore + charScore;
          prev[i][j] = [bestPrevIdx, j - 1];
        }
      }
    }
  }

  // Find best ending position
  let bestScore = NEG_INF;
  let bestEnd = -1;

  for (let i = queryLen - 1; i < textLen; i++) {
    if (scores[i][queryLen - 1] > bestScore) {
      bestScore = scores[i][queryLen - 1];
      bestEnd = i;
    }
  }

  if (bestEnd < 0) {
    return null;
  }

  // Reconstruct match indices
  const matchIndices: number[] = [];
  let currI = bestEnd;
  let currJ = queryLen - 1;

  while (currJ >= 0) {
    matchIndices.unshift(currI);
    const [prevI, prevJ] = prev[currI][currJ];
    currI = prevI;
    currJ = prevJ;
  }

  return {
    text,
    score: bestScore,
    matchIndices,
  };
}

/**
 * Highlight matched characters in a string
 *
 * Returns a string with blessed tags for highlighting.
 */
export function highlightMatches(
  text: string,
  matchIndices: number[],
  highlightTag = '{yellow-fg}',
  endTag = '{/}'
): string {
  if (matchIndices.length === 0) {
    return text;
  }

  const result: string[] = [];
  let inHighlight = false;

  for (let i = 0; i < text.length; i++) {
    const shouldHighlight = matchIndices.includes(i);

    if (shouldHighlight && !inHighlight) {
      result.push(highlightTag);
      inHighlight = true;
    } else if (!shouldHighlight && inHighlight) {
      result.push(endTag);
      inHighlight = false;
    }

    result.push(text[i]);
  }

  if (inHighlight) {
    result.push(endTag);
  }

  return result.join('');
}

/**
 * Perform fuzzy search on an array of items
 */
export interface FuzzySearchableItem {
  /** Primary text to search */
  text: string;

  /** Additional fields to search */
  fields?: string[];

  /** Original item data */
  data?: unknown;
}

export interface ScoredItem<T> {
  item: T;
  score: number;
  matchIndices: number[];
  matchedField: string;
}

/**
 * Search items with fuzzy matching, returning sorted results
 */
export function fuzzySearch<T extends FuzzySearchableItem>(
  items: T[],
  query: string
): ScoredItem<T>[] {
  if (!query) {
    return items.map((item) => ({
      item,
      score: 0,
      matchIndices: [],
      matchedField: item.text,
    }));
  }

  const results: ScoredItem<T>[] = [];

  for (const item of items) {
    // Search primary text
    const primaryMatch = fuzzyMatch(item.text, query);
    if (primaryMatch) {
      results.push({
        item,
        score: primaryMatch.score,
        matchIndices: primaryMatch.matchIndices,
        matchedField: item.text,
      });
      continue;
    }

    // Search additional fields
    if (item.fields) {
      let bestFieldMatch: FuzzyMatchResult | null = null;
      let bestField = '';

      for (const field of item.fields) {
        const fieldMatch = fuzzyMatch(field, query);
        if (fieldMatch && (!bestFieldMatch || fieldMatch.score > bestFieldMatch.score)) {
          bestFieldMatch = fieldMatch;
          bestField = field;
        }
      }

      if (bestFieldMatch) {
        results.push({
          item,
          score: bestFieldMatch.score,
          matchIndices: bestFieldMatch.matchIndices,
          matchedField: bestField,
        });
      }
    }
  }

  // Sort by score (descending)
  results.sort((a, b) => b.score - a.score);

  return results;
}
