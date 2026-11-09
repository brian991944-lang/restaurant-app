/**
 * Suggest which server a review is about, from names in its text.
 *
 * A SUGGESTION only: nothing here awards points. A review still has to be
 * claimed by the server (see app/actions/reviewClaims.ts). The suggestion is
 * what lets a claim auto-approve when the claimant is the person the guest
 * named.
 *
 * Roster = tip-eligible staff (same list the tip sheet uses), so a new hire
 * shows up here the day they land on a tip sheet. Aliases cover how guests
 * actually spell people ("Justin" for Jostin, "Roxana" for Roxi). Edit
 * NAME_ALIASES as the team changes; keys are the staff member's first name
 * as it appears on the tip sheet, lowercased.
 */

export type RosterMember = { id: string; name: string };
export type ServerMatch = {
  staffId: string;
  staffName: string;
  matchedWord: string;
  confidence: "exact" | "alias" | "close";
};

export const NAME_ALIASES: Record<string, string[]> = {
  jostin: ["justin", "juston", "josten", "jostyn", "justyn"],
  roxi: ["roxy", "roxana", "roxanna", "roxanne"],
  josh: ["joshua"],
  alex: ["alexander", "alejandro", "alexis"],
  jeremy: ["jeremi", "jeremie", "jeremías", "jeremias"],
  julie: ["julia", "juli"],
};

// Words that look like names but are ordinary review vocabulary. Prevents
// e.g. a future server named "Grace" matching "grace" in a sentence.
const STOPWORDS = new Set(["the", "and", "our", "her", "his", "was", "great", "amazing", "food", "service"]);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** All roster members named in the text, best confidence first, one entry per person. */
export function matchServers(text: string | null | undefined, roster: RosterMember[]): ServerMatch[] {
  if (!text) return [];
  const words = norm(text).match(/[a-z]+/g) ?? [];
  const found = new Map<string, ServerMatch>();
  const rank = { exact: 0, alias: 1, close: 2 } as const;

  for (const member of roster) {
    const first = norm(member.name.split(/\s+/)[0] ?? "");
    if (first.length < 3 || STOPWORDS.has(first)) continue;
    const aliases = (NAME_ALIASES[first] ?? []).map(norm);

    for (const w of words) {
      let confidence: ServerMatch["confidence"] | null = null;
      if (w === first) confidence = "exact";
      else if (aliases.includes(w)) confidence = "alias";
      // One typo allowed, only for names of 5+ letters: "Jeremi", "Jostn".
      // Short names (Alex, Josh, Roxi) must match exactly or by alias.
      else if (first.length >= 5 && w.length >= 4 && editDistance(w, first) === 1) confidence = "close";
      if (!confidence) continue;

      const prev = found.get(member.id);
      if (!prev || rank[confidence] < rank[prev.confidence]) {
        found.set(member.id, { staffId: member.id, staffName: member.name, matchedWord: w, confidence });
      }
    }
  }
  return [...found.values()].sort((a, b) => rank[a.confidence] - rank[b.confidence]);
}
