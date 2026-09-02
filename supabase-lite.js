const SESSION_KEY = "bsd7.supabase.session";

function jsonHeaders(key, token) {
  return {
    apikey: key,
    Authorization: `Bearer ${token || key}`,
    "Content-Type": "application/json"
  };
}

async function readJson(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || response.statusText;
    return { data: null, error: { message, context: { json: async () => data } }, response };
  }
  return { data, error: null, response };
}

function saveSession(session) {
  if (!session?.access_token) return;
  const expiresAt = session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, expires_at: expiresAt }));
}

function storedSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!session?.access_token) return null;
    return session;
  } catch {
    return null;
  }
}

function parseOAuthSession() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const access_token = hash.get("access_token");
  if (!access_token) return null;
  const session = {
    access_token,
    refresh_token: hash.get("refresh_token") || "",
    expires_in: Number(hash.get("expires_in") || 3600),
    token_type: hash.get("token_type") || "bearer"
  };
  saveSession(session);
  history.replaceState(null, "", location.pathname + location.search);
  return storedSession();
}

class QueryBuilder {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.method = "GET";
    this.body = null;
    this.params = new URLSearchParams();
    this.filters = [];
    this.orders = [];
    this.count = false;
    this.expectOne = false;
    this.allowEmpty = false;
    this.returnRows = false;
  }

  select(columns = "*", options = {}) {
    this.params.set("select", columns);
    this.count = options.count === "exact";
    if (this.method !== "GET") this.returnRows = true;
    return this;
  }

  insert(value) {
    this.method = "POST";
    this.body = value;
    return this;
  }

  update(value) {
    this.method = "PATCH";
    this.body = value;
    return this;
  }

  eq(column, value) {
    this.params.append(column, `eq.${value}`);
    return this;
  }

  in(column, values) {
    this.params.append(column, `in.(${values.join(",")})`);
    return this;
  }

  ilike(column, value) {
    this.params.append(column, `ilike.${value}`);
    return this;
  }

  or(value) {
    this.params.append("or", `(${value})`);
    return this;
  }

  order(column, options = {}) {
    this.orders.push(`${column}.${options.ascending === false ? "desc" : "asc"}`);
    this.params.set("order", this.orders.join(","));
    return this;
  }

  limit(value) {
    this.params.set("limit", String(value));
    return this;
  }

  single() {
    this.expectOne = true;
    return this;
  }

  maybeSingle() {
    this.expectOne = true;
    this.allowEmpty = true;
    return this;
  }

  async execute() {
    if (!this.params.has("select") && this.method === "GET") this.params.set("select", "*");
    const url = `${this.client.url}/rest/v1/${this.table}?${this.params}`;
    const headers = jsonHeaders(this.client.key, this.client.session()?.access_token);
    if (this.count) headers.Prefer = "count=exact";
    if (this.method !== "GET") headers.Prefer = `${this.returnRows ? "return=representation" : "return=minimal"}${this.count ? ",count=exact" : ""}`;
    const response = await fetch(url, {
      method: this.method,
      headers,
      body: this.body ? JSON.stringify(this.body) : undefined
    });
    const result = await readJson(response);
    if (result.error) return result;
    let data = result.data;
    if (this.expectOne) {
      if (Array.isArray(data) && data.length === 0 && this.allowEmpty) data = null;
      else if (Array.isArray(data)) data = data[0] ?? null;
    }
    const range = result.response.headers.get("content-range");
    const count = range?.includes("/") ? Number(range.split("/").pop()) : null;
    return { data, error: null, count };
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

export function createClient(url, key) {
  const client = {
    url,
    key,
    session: () => storedSession(),
    auth: {
      async signInWithOAuth({ provider, options = {} }) {
        const redirectTo = options.redirectTo || location.href;
        location.href = `${url}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirectTo)}`;
        return { data: null, error: null };
      },
      async signInWithPassword({ email, password }) {
        const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: jsonHeaders(key),
          body: JSON.stringify({ email, password })
        });
        const result = await readJson(response);
        if (!result.error) saveSession(result.data);
        return result;
      },
      async signUp({ email, password, options = {} }) {
        const response = await fetch(`${url}/auth/v1/signup`, {
          method: "POST",
          headers: jsonHeaders(key),
          body: JSON.stringify({ email, password, data: options.data || {} })
        });
        const result = await readJson(response);
        if (!result.error && result.data?.session) saveSession(result.data.session);
        return result;
      },
      async resetPasswordForEmail(email, options = {}) {
        const response = await fetch(`${url}/auth/v1/recover`, {
          method: "POST",
          headers: jsonHeaders(key),
          body: JSON.stringify({ email, redirect_to: options.redirectTo || location.href })
        });
        return readJson(response);
      },
      async signOut() {
        const session = storedSession();
        if (session?.access_token) {
          await fetch(`${url}/auth/v1/logout`, {
            method: "POST",
            headers: jsonHeaders(key, session.access_token)
          }).catch(() => {});
        }
        localStorage.removeItem(SESSION_KEY);
        return { error: null };
      },
      async getSession() {
        const parsed = parseOAuthSession();
        let session = parsed || storedSession();
        if (!session) return { data: { session: null }, error: null };
        const userResult = await fetch(`${url}/auth/v1/user`, {
          headers: jsonHeaders(key, session.access_token)
        }).then(readJson);
        if (userResult.error) {
          localStorage.removeItem(SESSION_KEY);
          return { data: { session: null }, error: null };
        }
        session = { ...session, user: userResult.data };
        saveSession(session);
        return { data: { session }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      }
    },
    from(table) {
      return new QueryBuilder(client, table);
    },
    functions: {
      async invoke(name, { body } = {}) {
        const response = await fetch(`${url}/functions/v1/${name}`, {
          method: "POST",
          headers: jsonHeaders(key, client.session()?.access_token),
          body: JSON.stringify(body || {})
        });
        return readJson(response);
      }
    }
  };
  return client;
}
