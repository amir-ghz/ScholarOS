<script setup lang="ts">
import { computed, ref } from 'vue';

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
  <main class="adm-login">
    <div class="adm-login-card">
      <header>
        <h1>{{ siteName || 'Your site' }}</h1>
        <p class="adm-muted">{{ creating ? 'Create your account' : 'Site admin' }}</p>
      </header>

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

      <p v-if="creating" class="adm-login-lead">
        This site has no account yet. The one you create now is the owner: it signs in here, sees every screen, and can
        add other people later under <strong>Users</strong>.
      </p>
      <div v-else-if="firstRun === 'explain'" class="adm-login-lead" role="note">
        <p>This site has no admin account yet. To create the first one, either:</p>
        <ul>
          <li>
            set <code>ADMIN_PASSWORD</code> (and optionally <code>ADMIN_USERNAME</code>) in your hosting settings and
            redeploy, or
          </li>
          <li>run <code>pnpm admin:create-user &lt;username&gt; --production</code> on your computer.</li>
        </ul>
      </div>

      <form v-if="password" class="adm-form" novalidate @submit.prevent="submit">
        <label v-if="creating" class="adm-field">
          <span>Your name</span>
          <input v-model="name" type="text" autocomplete="name" placeholder="Jane Smith" />
        </label>
        <label class="adm-field">
          <span>Username</span>
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            required
          />
          <small v-if="creating" class="adm-hint">Lowercase letters, digits, dots, dashes or underscores.</small>
        </label>
        <label class="adm-field">
          <span>Password</span>
          <input
            v-model="pass"
            type="password"
            :autocomplete="creating ? 'new-password' : 'current-password'"
            :aria-invalid="short || undefined"
            required
          />
          <small v-if="creating" class="adm-hint" :class="{ 'adm-error': short }">At least {{ MIN }} characters.</small>
        </label>
        <label v-if="creating" class="adm-field">
          <span>Password again</span>
          <input
            v-model="again"
            type="password"
            autocomplete="new-password"
            :aria-invalid="mismatch || undefined"
            required
          />
          <small v-if="mismatch" class="adm-error">The passwords don’t match.</small>
        </label>
        <p v-if="message" class="adm-login-error" role="alert">{{ message }}</p>
        <button type="submit" class="adm-btn adm-btn-primary adm-login-submit" :disabled="busy">
          <template v-if="creating">{{ busy ? 'Creating your account…' : 'Create account and sign in' }}</template>
          <template v-else>{{ busy ? 'Signing in…' : 'Sign in' }}</template>
        </button>
      </form>
      <p v-else-if="message" class="adm-login-error" role="alert">{{ message }}</p>
      <a
        v-if="github"
        class="adm-btn adm-login-submit"
        :class="{ 'adm-btn-primary': !password }"
        href="/api/admin/auth/login"
      >
        Sign in with GitHub
      </a>
    </div>
    <a class="adm-login-home" :href="homeHref || '/'">← Back to the site</a>
  </main>
</template>
