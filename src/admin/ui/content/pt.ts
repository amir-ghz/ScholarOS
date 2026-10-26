/**
 * PrimeVue Button pass-through that hides the icon from assistive tech. PrimeIcons draw with a private-use glyph in
 * `::before`, which would otherwise end up in the button's accessible name ("<glyph> Publish" instead of "Publish").
 */
export const HIDE_ICON = { icon: { 'aria-hidden': 'true' } } as const;
