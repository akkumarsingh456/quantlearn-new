# QuantumLearn setup

## Authentication and Google sign-in

Authentication is handled by Clerk. Email/password accounts, email verification, and Google OAuth must be enabled for the Clerk application; the app does not store passwords or simulate Google accounts locally.

1. Copy `.env.example` to `.env` in this directory and configure all four values. Only the `VITE_CLERK_PUBLISHABLE_KEY` variable is exposed to browser code by Vite; the remaining variables are read by the API server.
2. In the Clerk dashboard, enable email/password and require email verification. Enable Google under social connections and configure the Google OAuth credentials/redirect URLs shown by Clerk.
3. `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are used by the API server to verify authenticated requests.

## AI tutor

The AI Tutor uses the authenticated API server and Gemini 3.5 Flash. Put `GEMINI_API_KEY` in this `.env` file; the API server reads the frontend-root `.env` as a server-side environment file. Never put it in a `VITE_*` variable or send it in chat. If you prefer, a server-only `artifacts/api-server/.env` can override values from this file.

For local development, start the API and frontend in separate PowerShell terminals.

**Terminal 1 — API** (from the workspace folder shown above):

```powershell
cd "C:\path\to\Quantumlearn-platform-main live\artifacts\api-server"
npm.cmd run dev
```

**Terminal 2 — frontend**:

```powershell
cd "C:\path\to\Quantumlearn-platform-main live\artifacts\quantumlearn-ai"
npm.cmd run dev
```

The frontend proxies `/api` to `http://localhost:3000` by default. The tutor reports authentication, configuration, provider, and timeout errors rather than presenting offline canned text as a live AI answer.

For deployment, set the same variables in the hosting platform's environment settings. `VITE_CLERK_PUBLISHABLE_KEY` is public by design; `CLERK_SECRET_KEY` and `GEMINI_API_KEY` must remain server-side secrets.
