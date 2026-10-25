import type { App } from 'vue';

/**
 * Every Vue island's app. Admin pages (body `data-admin`) get PrimeVue, loaded as its own chunk, so public pages never
 * download it. Admin islands are client-only, so the server render never takes this branch.
 */
export default async (app: App) => {
  if (typeof document !== 'undefined' && document.body?.hasAttribute('data-admin')) {
    const { installAdmin } = await import('../admin/prime/setup');
    installAdmin(app);
  }
};
