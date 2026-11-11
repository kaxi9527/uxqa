import type { HintCheck } from './hints.js';

/** What each source observation actually detected, rather than a translated rule recommendation. */
export const ENGLISH_HINTS: Record<HintCheck, string> = {
  'img-alt': 'Image has no alt attribute',
  'icon-button-name': 'Icon-only control has no accessible name',
  'click-without-button': 'Clickable element is not a button or link',
  'link-href': 'Link has no usable destination',
  'blank-rel': 'New-window link is missing its rel safety setting',
  'positive-tabindex': 'Positive tabindex changes the keyboard focus order',
  autofocus: 'Control receives focus automatically',
  'input-label': 'Input has no associated label or accessible name',
  'form-button-type': 'Button inside a form has no type',
  'iframe-title': 'Embedded frame has no title',
  'img-size': 'Image dimensions are not specified',
  'outline-none': 'Keyboard focus outline is removed',
  'transition-all': 'Transition applies to all properties',
  important: 'Style declaration uses !important',
  'huge-z-index': 'Stacking value is unusually large',
  'wide-fixed-width': 'Fixed width may overflow a narrow screen',
  'zoom-disabled': 'Page zoom is disabled',
  'page-language': 'Page language is not specified',
};
