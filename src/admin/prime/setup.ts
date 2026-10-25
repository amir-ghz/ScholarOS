import type { App } from 'vue';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import { AdminPreset } from './preset';

/** PrimeVue for one admin island (each Astro island is its own Vue app). Loaded only on admin pages (src/pages/_app.ts). */
export function installAdmin(app: App): void {
  app.use(PrimeVue, {
    theme: { preset: AdminPreset, options: { darkModeSelector: '.app-dark' } },
  });
  app.use(ToastService);
  app.use(ConfirmationService);
  app.directive('tooltip', Tooltip);
}
