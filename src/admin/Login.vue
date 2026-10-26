<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';

/**
 * `firstRun`: no password account exists yet. 'create' (`pnpm dev`'s local database) offers the owner account here;
 * 'explain' (a deployment) says how to make it, since an open first-come sign-up would hand over the site.
 */
const props = defineProps<{
  adminPath: string;
  siteName: string;
  password: boolean;
  github: boolean;
  error: string;
  firstRun?: '' | 'create' | 'explain';
  homeHref?: string;
  /** What the deployment still lacks (src/lib/deploy-check.ts): shown first, since sign-in may not work until fixed. */
  setup?: { level: 'error' | 'warning'; text: string }[];
}>();
/** A sentence as plain runs and `code` runs. */
const runs = (text: string) => text.split(/`([^`]+)`/).map((part, i) => ({ part, code: i % 2 === 1 }));
const creating = ref(props.firstRun === 'create');
const name = ref('');
const username = ref('');
const pass = ref('');
const again = ref('');
const message = ref(props.error);
const busy = ref(false);

const MIN = 12;
const mismatch = computed(() => creating.value && !!again.value && again.value !== pass.value);
const short = computed(() => creating.value && !!pass.value && pass.value.length < MIN);

/** Not the shared api(): it reloads the page on 401, which here just means "wrong password". */
async function post(path: string, body: Record<string, string>) {
  busy.value = true;
  message.value = '';
  try {
    const res = await fetch(`/api/admin/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      location.href = `/${props.adminPath}`;
      return;
    }
    const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    // Someone else made the first account meanwhile: this screen is a sign-in now.
    if (res.status === 409 && creating.value) creating.value = false;
    message.value = error || `${creating.value ? 'Creating the account' : 'Sign-in'} failed (${res.status})`;
  } catch {
    message.value = 'Could not reach the site. Check that it is still running, then try again.';
  } finally {
    busy.value = false;
  }
}

function submit() {
  if (!creating.value) return post('password', { username: username.value, password: pass.value });
  if (short.value || mismatch.value) {
    message.value = short.value ? `Use at least ${MIN} characters for the password.` : 'The passwords don’t match.';
    return;
  }
  return post('setup', { name: name.value, username: username.value.trim().toLowerCase(), password: pass.value });
}
</script>

<template>
  <main class="auth-page">
    <div class="auth-card">
      <section class="auth-cover" aria-hidden="true">
        <div>
          <p class="auth-cover-kicker">{{ siteName || 'ScholarOS' }}</p>
          <h2>{{ creating ? 'Welcome to your new site.' : 'Welcome back to your research site.' }}</h2>
          <p>Publications, CV, news, reading and visitors, kept current from one place.</p>
        </div>
        <svg class="auth-art" viewBox="0 0 320 220" fill="none">
          <rect x="12" y="24" width="296" height="180" rx="18" fill="#fff" fill-opacity=".1" />
          <rect x="32" y="48" width="84" height="44" rx="10" fill="#fff" fill-opacity=".16" />
          <rect x="126" y="48" width="84" height="44" rx="10" fill="#fff" fill-opacity=".16" />
          <rect x="220" y="48" width="68" height="44" rx="10" fill="#fff" fill-opacity=".16" />
          <circle cx="50" cy="66" r="8" fill="#fff" fill-opacity=".7" />
          <circle cx="144" cy="66" r="8" fill="#ffd18a" />
          <circle cx="238" cy="66" r="8" fill="#9ff0c5" />
          <path
            d="M36 178 L76 150 L108 162 L146 124 L184 140 L222 112 L256 126 L290 104"
            stroke="#fff"
            stroke-width="4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M36 178 L76 160 L108 170 L146 146 L184 156 L222 136 L256 146 L290 132"
            stroke="#ffd18a"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-dasharray="2 8"
          />
        </svg>
      </section>

      <section class="auth-form">
        <div class="auth-brand">
          <span class="layout-logo-mark" aria-hidden="true">{{ (siteName || 'S').slice(0, 1) }}</span>
          <span>{{ siteName || 'Your site' }}</span>
        </div>
        <h1>{{ creating ? 'Create your account' : 'Sign in to the admin' }}</h1>
        <p class="auth-sub">
          {{
            creating ? 'The first account on this site becomes its owner.' : 'Manage your site, content and analytics.'
          }}
        </p>

        <section v-if="setup?.length" class="adm-login-setup" role="alert">
          <h2>This site isn’t fully set up yet</h2>
          <ul>
            <li v-for="p in setup" :key="p.text" :class="`is-${p.level}`">
              <template v-for="(r, i) in runs(p.text)" :key="i">
                <code v-if="r.code">{{ r.part }}</code>
                <template v-else>{{ r.part }}</template>
              </template>
            </li>
          </ul>
        </section>

        <p v-if="creating" class="auth-lead">
          It signs in here, sees every screen, and can add other people later under <strong>Users</strong>.
        </p>
        <div v-else-if="firstRun === 'explain'" class="auth-lead" role="note">
          <p>This site has no admin account yet. To create the first one, either:</p>
          <ul>
            <li>
              set <code>ADMIN_PASSWORD</code> (and optionally <code>ADMIN_USERNAME</code>) in your hosting settings and
              redeploy, or
            </li>
            <li>run <code>pnpm admin:create-user &lt;username&gt; --production</code> on your computer.</li>
          </ul>
        </div>

        <form v-if="password" class="auth-fields" novalidate @submit.prevent="submit">
          <div v-if="creating" class="auth-field">
            <label for="auth-name">Your name</label>
            <InputText id="auth-name" v-model="name" autocomplete="name" placeholder="Jane Smith" fluid />
          </div>
          <div class="auth-field">
            <label for="auth-username">Username</label>
            <InputText
              id="auth-username"
              v-model="username"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              required
              fluid
            />
            <small v-if="creating" class="auth-hint">Lowercase letters, digits, dots, dashes or underscores.</small>
          </div>
          <div class="auth-field">
            <label for="auth-password">Password</label>
            <Password
              v-model="pass"
              input-id="auth-password"
              :input-props="{ autocomplete: creating ? 'new-password' : 'current-password', required: true }"
              :invalid="short"
              :feedback="false"
              toggle-mask
              fluid
            />
            <small v-if="creating" class="auth-hint" :class="{ 'is-error': short }"
              >At least {{ MIN }} characters.</small
            >
          </div>
          <div v-if="creating" class="auth-field">
            <label for="auth-again">Password again</label>
            <Password
              v-model="again"
              input-id="auth-again"
              :input-props="{ autocomplete: 'new-password', required: true }"
              :invalid="mismatch"
              :feedback="false"
              toggle-mask
              fluid
            />
            <small v-if="mismatch" class="auth-hint is-error">The passwords don’t match.</small>
          </div>
          <Message v-if="message" severity="error" role="alert">{{ message }}</Message>
          <Button
            type="submit"
            :loading="busy"
            :label="
              creating
                ? busy
                  ? 'Creating your account…'
                  : 'Create account and sign in'
                : busy
                  ? 'Signing in…'
                  : 'Sign in'
            "
            fluid
          />
        </form>
        <Message v-else-if="message" severity="error" role="alert">{{ message }}</Message>
        <div v-if="github && password" class="auth-or"><span>or</span></div>
        <Button
          v-if="github"
          as="a"
          href="/api/admin/auth/login"
          icon="pi pi-github"
          label="Sign in with GitHub"
          :severity="password ? 'secondary' : undefined"
          :outlined="password"
          fluid
        />
        <a class="auth-home" :href="homeHref || '/'"
          ><i class="pi pi-arrow-left" aria-hidden="true" /> Back to the site</a
        >
      </section>
    </div>
  </main>
</template>
