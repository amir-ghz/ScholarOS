import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/**
 * The admin's PrimeVue theme: Aura (as in Sakai) re-coloured to the Conca dashboard look: indigo #5F4AFE, a
 * lavender-grey canvas, near-black headings. Light and dark both come from these scales; `.app-dark` on <html> switches.
 */
const indigo = {
  50: '#f3f1ff',
  100: '#e8e4ff',
  200: '#d1c9ff',
  300: '#b0a2ff',
  400: '#8c78fe',
  500: '#5f4afe',
  600: '#4f39ef',
  700: '#422ccf',
  800: '#3625a7',
  900: '#2d2285',
  950: '#1b1350',
};

export const AdminPreset = definePreset(Aura, {
  semantic: {
    primary: indigo,
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '#f9f9fb',
          100: '#f4f4f7',
          200: '#ececef',
          300: '#dfdfe3',
          400: '#a6a5b2',
          500: '#8a8995',
          600: '#716f7e',
          700: '#57575a',
          800: '#3d3c46',
          900: '#191822',
          950: '#0f0e15',
        },
        text: { color: '#57575a', mutedColor: '#8a8995', hoverColor: '#191822' },
        content: { borderColor: '#efefef' },
      },
      dark: {
        surface: {
          0: '#ffffff',
          50: '#f4f4f7',
          100: '#dedee0',
          200: '#bdbdc1',
          300: '#a6a5b2',
          400: '#8a8995',
          500: '#6b6a75',
          600: '#484751',
          700: '#2c2c30',
          800: '#1f1f21',
          900: '#161618',
          950: '#111112',
        },
        // Conca keeps the same indigo at night (Aura would lighten it to primary.400).
        primary: {
          color: '{primary.500}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.400}',
          activeColor: '{primary.300}',
        },
        text: { color: '#bdbdc1', mutedColor: '#8a8995', hoverColor: '#ffffff' },
        content: { background: '#1f1f21', borderColor: '#2c2c30' },
      },
    },
  },
});
