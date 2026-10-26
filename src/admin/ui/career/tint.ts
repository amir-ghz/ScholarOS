import type { PostingStatus } from '../../../lib/career/types';

/**
 * Job search colours (presentation only): a score's chip by the match threshold (at or above it green, up to 20 below
 * it amber, lower red, none grey), and a posting status's chip.
 */
export function scoreTint(score: number | null, threshold: number): string {
  if (score === null) return 'secondary';
  return score >= threshold ? 'success' : score >= threshold - 20 ? 'warning' : 'danger';
}

export const STATUS_TINT: Record<PostingStatus, string> = {
  found: 'info',
  skipped: 'secondary',
  drafted: 'primary',
  ready: 'warning',
  submitted: 'success',
  interview: 'pink',
  offer: 'success',
  rejected: 'danger',
  'no-response': 'secondary',
  withdrawn: 'secondary',
};
