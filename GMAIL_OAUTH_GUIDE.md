# Gmail OAuth & Real Email Integration Guide
## NC Compliance CRM — HR On Demand

This guide covers two things:
1. **Google Sign-In** — let users log in with their real Gmail account
2. **Gmail API integration** — send and read emails directly from the CRM

---

## PART 1 — Google Sign-In (OAuth Login)

### Step 1 — Create a Google Cloud Project

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)**
2. Click **Select a project** → **New Project**
3. Name it: `NC Compliance CRM`
4. Click **Create**

---

### Step 2 — Enable the Gmail API

1. In your project, go to **APIs & Services → Library**
2. Search for **Gmail API** → click it → **Enable**
3. Also search for **Google Identity** → **Enable**

---

### Step 3 — Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** → **Create**
3. Fill in:
   - **App name:** `NC Compliance CRM`
   - **User support email:** your Gmail
   - **Developer contact:** your Gmail
4. Click **Save and Continue**
5. On Scopes page, click **Add or Remove Scopes** and add:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.readonly`
6. Click **Save and Continue** through the rest
7. Under **Test users**, add the Gmail accounts that will use the CRM

---

### Step 4 — Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `NC CRM Web Client`
5. Under **Authorized JavaScript origins** add:
   ```
   http://localhost:3000
   https://crm.hrondemand.com
   ```
6. Under **Authorized redirect URIs** add:
   ```
   http://localhost:3000
   https://crm.hrondemand.com
   https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback
   ```
7. Click **Create** — copy the **Client ID** and **Client Secret**

---

### Step 5 — Enable Google Auth in Supabase

1. Go to your Supabase dashboard → **Authentication → Providers**
2. Find **Google** → toggle it **ON**
3. Paste your:
   - **Client ID** (from step 4)
   - **Client Secret** (from step 4)
4. Click **Save**

---

### Step 6 — Add Supabase Auth SDK to the CRM

Add this to your `package.json` dependencies:
```json
"@supabase/supabase-js": "^2.45.0"
```

Then run:
```bash
npm install @supabase/supabase-js
```

---

### Step 7 — Update the CRM code for real Google Sign-In

Add this near the top of `App.jsx` (after the SUPABASE config):

```javascript
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client (for Auth)
const supabaseClient = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// Real Google sign-in function
async function signInWithGoogle() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
      redirectTo: window.location.origin,
    },
  });
  if (error) console.error("Google sign-in error:", error.message);
}

// Listen for auth state changes
supabaseClient?.auth.onAuthStateChange(async (event, session) => {
  if (event === "SIGNED_IN" && session?.user) {
    const googleUser = session.user;
    // Match against crm_users by email
    const dbUsers = await DB.getUsers();
    const matched = dbUsers.find(u => u.email === googleUser.email && u.active);
    if (matched) {
      // Store Google access token for Gmail API calls
      sessionStorage.setItem("google_access_token", session.provider_token || "");
      // Log them into the CRM
      login(matched);
    } else {
      console.warn("Google account not found in CRM users:", googleUser.email);
      alert(`No CRM account found for ${googleUser.email}. Ask your admin to add your email to the system.`);
      await supabaseClient.auth.signOut();
    }
  }
});
```

Then replace the `googleSign` function in `LoginScreen` with:

```javascript
const googleSign = () => {
  if (supabaseClient) {
    signInWithGoogle(); // real OAuth
  } else {
    // Demo mode fallback
    setGload(true);
    setTimeout(() => { const u = users.find(x => x.active); if(u) onLogin(u); }, 900);
  }
};
```

---

## PART 2 — Gmail API Integration (Send & Read Emails)

Once the user signs in with Google, the CRM has their **access token**. This lets you send emails through their real Gmail account and read replies.

### Send emails via Gmail API

Replace the Gmail compose links in the Email Hub with real API calls:

```javascript
async function sendViaGmailAPI({ to, subject, body, from }) {
  const accessToken = sessionStorage.getItem("google_access_token");
  if (!accessToken) {
    // Fall back to Gmail compose link
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    return null;
  }

  // Encode email as RFC 2822
  const email = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join("\r\n");

  const encoded = btoa(unescape(encodeURIComponent(email)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || "Gmail send failed");
  }
  return await res.json();
}
```

### Read inbox replies via Gmail API

```javascript
async function fetchGmailInbox() {
  const accessToken = sessionStorage.getItem("google_access_token");
  if (!accessToken) return [];

  // Get latest 20 messages
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=in:inbox",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listData = await listRes.json();
  if (!listData.messages) return [];

  // Fetch each message detail
  const messages = await Promise.all(
    listData.messages.map(async (msg) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return msgRes.json();
    })
  );

  // Parse into CRM inbox format
  return messages.map(m => {
    const headers = m.payload?.headers || [];
    const get = name => headers.find(h => h.name.toLowerCase() === name)?.value || "";
    const bodyData = m.payload?.parts?.[0]?.body?.data || m.payload?.body?.data || "";
    const body = bodyData ? atob(bodyData.replace(/-/g,"+").replace(/_/g,"/")) : "(no body)";
    return {
      id: m.id,
      from: get("from"),
      fromEmail: get("from").match(/<(.+)>/)?.[1] || get("from"),
      subject: get("subject"),
      preview: body.slice(0, 120),
      body,
      date: new Date(parseInt(m.internalDate)).toLocaleString("sv-SE").slice(0,16).replace("T"," "),
      read: !m.labelIds?.includes("UNREAD"),
      starred: m.labelIds?.includes("STARRED") || false,
      label: "reply",
      sentiment: "neutral",
    };
  });
}
```

Call `fetchGmailInbox()` when the user clicks **Refresh** or opens the Inbox tab to replace the mock emails with real ones.

---

## PART 3 — Environment Variables to Add

Add these to your `.env.local` and Vercel environment variables:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_KEY=eyJhbGc...
VITE_GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
```

---

## Summary Checklist

- [ ] Create Google Cloud project
- [ ] Enable Gmail API + Google Identity
- [ ] Configure OAuth consent screen with Gmail scopes
- [ ] Create OAuth credentials (Web application)
- [ ] Add authorized origins + redirect URIs
- [ ] Enable Google provider in Supabase Auth
- [ ] Add `@supabase/supabase-js` to package.json
- [ ] Add `signInWithGoogle()` and `onAuthStateChange` to App.jsx
- [ ] Replace `googleSign` function in LoginScreen
- [ ] Add `sendViaGmailAPI()` function
- [ ] Add `fetchGmailInbox()` function
- [ ] Wire inbox Refresh button to `fetchGmailInbox()`
- [ ] Add `VITE_GOOGLE_CLIENT_ID` to Vercel env vars
- [ ] Redeploy on Vercel

---

*NC Compliance CRM v4.0 — HR On Demand*
