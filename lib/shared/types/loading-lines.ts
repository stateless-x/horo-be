/**
 * Loading-line copy served to the frontend's loading screens.
 *
 * Static content shipped with the code, not a database table. The `version`
 * field is a short content hash so the frontend can cache-bust when the copy
 * changes without waiting for a TTL to expire.
 */

/** The three loading surfaces that have their own line pool. */
export type LoadingSurface = 'today' | 'fortune' | 'compatibility';

/** A promotional line. Rendered as a card, never in the oracle voice. */
export interface SponsoredLine {
  text: string;
  label: string;
  url: string;
  /** Preferred href on iOS devices (App Store link). */
  iosUrl?: string;
  sponsor: string;
}

export interface LoadingLinesResponse {
  lines: string[];
  sponsored: SponsoredLine[];
  version: string;
}
