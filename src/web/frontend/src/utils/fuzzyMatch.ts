/**
 * Fuzzy Matcher Utility (Web Frontend)
 *
 * Browser-compatible port of src/tui/utils/fuzzyMatch.ts.
 * Provides fzf-style fuzzy matching with scoring and highlighting.
 */

export interface FuzzyMatchResult {
  text: string;
  score: number;
  matchIndices: number[];
}

/**
 * Perform fuzzy match on a string against a query.
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

  if (query.length === 0) {
    return { text, score: 0, matchIndices: [] };
  }

  // Quick check: all query chars must exist in text in order
  let queryIdx = 0;
  for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) queryIdx++;
  }
  if (queryIdx < queryLower.length) return null;

  return findBestMatch(text, textLower, queryLower);
}

function findBestMatch(
  text: string,
  textLower: string,
  queryLower: string,
): FuzzyMatchResult | null {
  const textLen = text.length;
  const queryLen = queryLower.length;
  const NEG_INF = -Infinity;

  const scores: number[][] = [];
  const prev: number[][][] = [];
  for (let i = 0; i < textLen; i++) {
    scores[i] = new Array(queryLen).fill(NEG_INF);
    prev[i] = Array.from({ length: queryLen }, () => []);
  }

  for (let i = 0; i < textLen; i++) {
    for (let j = 0; j < queryLen; j++) {
      if (textLower[i] !== queryLower[j]) continue;

      let charScore = 1;
      if (i === 0) {
        charScore += 10;
      } else if (/[ _\/\-:]/.test(text[i - 1])) {
        charScore += 8;
      } else if (/[A-Z]/.test(text[i]) && /[a-z]/.test(text[i - 1])) {
        charScore += 8;
      }
      if (/[A-Z]/.test(text[i])) charScore += 2;

      if (j === 0) {
        scores[i][j] = charScore;
      } else {
        let bestPrevScore = NEG_INF;
        let bestPrevIdx = -1;

        for (let k = j - 1; k < i; k++) {
          if (scores[k][j - 1] === NEG_INF) continue;
          let transitionScore = scores[k][j - 1];
          if (k === i - 1) {
            transitionScore += 5;
          } else {
            transitionScore -= Math.min(i - k - 1, 3);
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

  let bestScore = NEG_INF;
  let bestEnd = -1;
  for (let i = queryLen - 1; i < textLen; i++) {
    if (scores[i][queryLen - 1] > bestScore) {
      bestScore = scores[i][queryLen - 1];
      bestEnd = i;
    }
  }
  if (bestEnd < 0) return null;

  const matchIndices: number[] = [];
  let currI = bestEnd;
  let currJ = queryLen - 1;
  while (currJ >= 0) {
    matchIndices.unshift(currI);
    if (prev[currI][currJ].length === 0) break;
    const [prevI, prevJ] = prev[currI][currJ];
    currI = prevI;
    currJ = prevJ;
  }

  return { text, score: bestScore, matchIndices };
}

/**
 * Render text with highlighted match indices as React-renderable segments.
 * Returns an array of { text, highlight } pairs.
 */
export function getHighlightSegments(
  text: string,
  matchIndices: number[],
): Array<{ text: string; highlight: boolean }> {
  if (!matchIndices.length) return [{ text, highlight: false }];

  const indexSet = new Set(matchIndices);
  const segments: Array<{ text: string; highlight: boolean }> = [];
  let i = 0;

  while (i < text.length) {
    const highlight = indexSet.has(i);
    const start = i;
    while (i < text.length && indexSet.has(i) === highlight) i++;
    segments.push({ text: text.slice(start, i), highlight });
  }

  return segments;
}
