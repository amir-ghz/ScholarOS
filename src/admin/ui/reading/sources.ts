import type { NoteKind } from '../../../lib/reading/types';

/** The chip colour of each paper source (`chip-*` / `tint-*` in prime/layout.css). */
const SOURCE_TINTS: Record<string, string> = {
  arxiv: 'danger',
  biorxiv: 'pink',
  medrxiv: 'info',
  pubmed: 'info',
  openalex: 'warning',
  huggingface: 'warning',
  bluesky: 'primary',
  alphaxiv: 'success',
  library: 'secondary',
};
export const sourceTint = (id: string) => SOURCE_TINTS[id] ?? 'secondary';

/** A vault note's icon and tint, by kind. */
export const KIND_LOOK: Record<NoteKind, { icon: string; tint: string }> = {
  paper: { icon: 'pi-file', tint: 'primary' },
  chat: { icon: 'pi-comments', tint: 'pink' },
  free: { icon: 'pi-pencil', tint: 'success' },
};
