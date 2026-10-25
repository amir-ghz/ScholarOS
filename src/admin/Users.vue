<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import AdminShell from './AdminShell.vue';
import { api, report, toast } from './api';
import type { AdminCtx } from './types';

interface Account {
  username: string;
  name: string;
  created_at: string;
}
defineProps<{ ctx: AdminCtx }>();
const accounts = ref<Account[]>([]);
const githubAdmins = ref<string[]>([]);
const adding = ref({ username: '', name: '', password: '' });
const resetting = ref<{ username: string; password: string } | null>(null);
const confirmDelete = ref('');
const own = ref({ current: '', next: '', again: '' });

async function load() {
  try {
    const data = await api<{ accounts: Account[]; githubAdmins: string[] }>('users');
    accounts.value = data.accounts;
    githubAdmins.value = data.githubAdmins;
  } catch (e) {
    report(e);
  }
}

async function add() {
  try {
    await api('users', { body: adding.value });
    toast(`Added ${adding.value.username}`);
    adding.value = { username: '', name: '', password: '' };
    await load();
  } catch (e) {
    report(e);
  }
}

async function reset() {
  if (!resetting.value) return;
  try {
    await api(`users/${encodeURIComponent(resetting.value.username)}`, {
      method: 'PUT',
      body: { password: resetting.value.password },
    });
    toast(`Password reset; ${resetting.value.username} is signed out everywhere`);
    resetting.value = null;
  } catch (e) {
    report(e);
  }
}

async function remove(username: string) {
  try {
    await api(`users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    toast(`Deleted ${username}`);
    confirmDelete.value = '';
    await load();
  } catch (e) {
    report(e);
  }
}

async function changeOwn() {
  if (own.value.next !== own.value.again) return toast('The new passwords don’t match');
  try {
    await api('account/password', { body: { current: own.value.current, next: own.value.next } });
    toast('Password changed; your other devices are signed out');
    own.value = { current: '', next: '', again: '' };
  } catch (e) {
    report(e);
  }
}

/** The avatar's letters: the first of up to two words of the name, else of the username. */
const initials = (a: Account) =>
  (a.name || a.username)
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
const TINTS = ['primary', 'success', 'warning', 'info', 'pink'];
const tint = (a: Account) => TINTS[[...a.username].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

onMounted(load);
</script>

<template>
  <AdminShell :ctx="ctx" active="users" title="Users">
    <section class="card card-flush usr-accounts" aria-labelledby="adm-accounts">
      <div class="card-head">
        <h2 id="adm-accounts" class="card-title"><i class="pi pi-users text-primary" aria-hidden="true" /> Accounts</h2>
      </div>
      <DataTable :value="accounts" data-key="username" class="usr-table">
        <Column field="username" header="Username">
          <template #body="{ data: a }">
            <span class="usr-user">
              <span :class="['usr-avatar', `tint-${tint(a)}`]" aria-hidden="true">{{ initials(a) }}</span>
              <span class="usr-username">{{ a.username }}</span>
            </span>
          </template>
        </Column>
        <Column field="name" header="Name" />
        <Column field="created_at" header="Created">
          <template #body="{ data: a }">{{ new Date(a.created_at).toLocaleDateString() }}</template>
        </Column>
        <Column>
          <template #header><span class="adm-visually-hidden">Actions</span></template>
          <template #body="{ data: a }">
            <div class="usr-actions">
              <template v-if="resetting?.username === a.username">
                <InputText
                  v-model="resetting.password"
                  type="password"
                  autocomplete="new-password"
                  size="small"
                  :aria-label="`New password for ${a.username}`"
                  placeholder="New password (12+ characters)"
                />
                <Button label="Save" size="small" @click="reset" />
                <Button label="Cancel" size="small" severity="secondary" outlined @click="resetting = null" />
              </template>
              <span
                v-else-if="a.username === ctx.user?.login && ctx.user?.provider === 'password'"
                class="chip chip-primary"
                >you</span
              >
              <template v-else-if="confirmDelete === a.username">
                <span class="usr-confirm">Delete {{ a.username }}?</span>
                <Button label="Delete" size="small" severity="danger" @click="remove(a.username)" />
                <Button label="Cancel" size="small" severity="secondary" outlined @click="confirmDelete = ''" />
              </template>
              <template v-else>
                <Button
                  icon="pi pi-lock"
                  label="Reset password"
                  size="small"
                  severity="secondary"
                  outlined
                  @click="resetting = { username: a.username, password: '' }"
                />
                <Button
                  icon="pi pi-trash"
                  label="Delete"
                  size="small"
                  severity="danger"
                  text
                  @click="confirmDelete = a.username"
                />
              </template>
            </div>
          </template>
        </Column>
      </DataTable>
      <p v-if="githubAdmins.length" class="usr-github">
        <i class="pi pi-github" aria-hidden="true" />
        <span>GitHub admins (managed in config/site.yml): {{ githubAdmins.join(', ') }}</span>
      </p>
    </section>

    <div class="usr-forms">
      <form class="card" aria-labelledby="adm-add" @submit.prevent="add">
        <div class="card-head usr-head">
          <span class="usr-icon tint-primary" aria-hidden="true"><i class="pi pi-user-plus" /></span>
          <h2 id="adm-add" class="card-title">Add an account</h2>
        </div>
        <div class="usr-fields">
          <label class="usr-field"
            ><span>Username</span><InputText v-model="adding.username" required autocapitalize="none" fluid
          /></label>
          <label class="usr-field"><span>Display name</span><InputText v-model="adding.name" fluid /></label>
          <label class="usr-field">
            <span>Initial password</span>
            <InputText v-model="adding.password" type="password" autocomplete="new-password" required fluid />
            <small>At least 12 characters. They can change it after signing in.</small>
          </label>
        </div>
        <div class="usr-submit"><Button type="submit" icon="pi pi-plus" label="Add account" /></div>
      </form>

      <form v-if="ctx.user?.provider === 'password'" class="card" aria-labelledby="adm-own" @submit.prevent="changeOwn">
        <div class="card-head usr-head">
          <span class="usr-icon tint-warning" aria-hidden="true"><i class="pi pi-lock" /></span>
          <h2 id="adm-own" class="card-title">Change your password</h2>
        </div>
        <div class="usr-fields">
          <label class="usr-field">
            <span>Current password</span>
            <InputText v-model="own.current" type="password" autocomplete="current-password" required fluid />
          </label>
          <label class="usr-field">
            <span>New password</span>
            <InputText v-model="own.next" type="password" autocomplete="new-password" required fluid />
          </label>
          <label class="usr-field">
            <span>New password again</span>
            <InputText v-model="own.again" type="password" autocomplete="new-password" required fluid />
          </label>
        </div>
        <div class="usr-submit"><Button type="submit" label="Change password" /></div>
      </form>
    </div>
  </AdminShell>
</template>

<style scoped>
.usr-accounts {
  margin-block-end: 1.5rem;
}
.usr-user {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}
.usr-avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  font-size: 0.8125rem;
  font-weight: 600;
}
.usr-username {
  color: var(--app-heading);
  font-weight: 600;
}
.usr-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}
.usr-confirm {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.usr-table :deep(td),
.usr-table :deep(th) {
  white-space: nowrap;
}
.usr-table :deep(td:first-child),
.usr-table :deep(th:first-child) {
  padding-inline-start: 1.5rem;
}
.usr-table :deep(td:last-child),
.usr-table :deep(th:last-child) {
  padding-inline-end: 1.5rem;
}
.usr-table :deep(.p-datatable-table-container) {
  overflow-x: auto;
}
.usr-github {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--app-border);
  color: var(--app-muted);
  font-size: 0.8125rem;
}
.usr-forms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
  gap: 1.5rem;
  align-items: start;
}
.usr-head {
  justify-content: flex-start;
  margin-block-end: 1.5rem;
}
.usr-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  font-size: 1.05rem;
}
.usr-fields {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
}
.usr-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.usr-field > span:first-child {
  color: var(--app-heading);
  font-size: 0.875rem;
  font-weight: 500;
}
.usr-field small {
  color: var(--app-muted);
  font-size: 0.75rem;
}
.usr-submit {
  display: flex;
  justify-content: flex-end;
  margin-block-start: 1.5rem;
}
</style>
