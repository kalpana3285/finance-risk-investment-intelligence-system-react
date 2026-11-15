# FRIIS frontend

The React workspace provides Auth0 sign-in and authenticated access to the FRIIS portfolio, query, escalation, and document-ingestion APIs.

## Local setup

1. Copy `.env.example` to `.env.local` and set `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, and `VITE_AUTH0_API_AUDIENCE`. The audience must match `FRIIS_AUTH0_API_AUDIENCE` in the backend.
2. In Auth0, allow the frontend URL (normally `http://localhost:5173`) in **Allowed Callback URLs**, **Allowed Logout URLs**, and **Allowed Web Origins**. Assign supported FRIIS roles and the expected portfolio scope claims through your Auth0 configuration.
3. Leave `VITE_API_BASE_URL` blank for local development. Start the API at `http://127.0.0.1:8000`, then run `npm run dev` from this directory. Vite proxies `/api` and `/health` to that local API by default.
4. Set `VITE_API_BASE_URL` to an API origin only when using a separately hosted API (for example, `http://localhost:8081` if the API is actually listening there). That deployment must allow the frontend origin through CORS or use a same-origin reverse proxy. Restart Vite after changing `.env.local`.

## GitHub Pages deployment

The GitHub Actions workflow builds the frontend from the `frontend` directory. Add these repository variables under **Settings → Secrets and variables → Actions → Variables** so they are available during the build:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_API_AUDIENCE` (must match the backend's `FRIIS_AUTH0_API_AUDIENCE`)
- `VITE_API_BASE_URL` (optional; set this to the deployed API origin if the API is hosted separately)

The Auth0 application must allow the deployed Pages URL in its **Allowed Callback URLs**, **Allowed Logout URLs**, and **Allowed Web Origins**. These `VITE_` values are included in the public frontend bundle; never put an Auth0 client secret in them. A deployment build fails if any of the three required Auth0 variables are missing.

## Connected workflows

- Analyst research submits `POST /api/v1/queries`, polls `GET /api/v1/queries/{query_id}`, and displays citations, limitations, clarification requests, and escalation handoffs.
- Portfolio views use `GET /api/v1/portfolios` and `GET /api/v1/portfolios/{portfolio_id}`.
- Reviewer queue and updates use `GET /api/v1/escalations`, `GET /api/v1/escalations/{escalation_id}`, and `PATCH /api/v1/escalations/{escalation_id}`.
- Operator document upload uses `POST /api/v1/admin/ingestions`.
- New conversation clears server-side short-term memory with `DELETE /api/v1/sessions/{session_id}/memory`.

The backend remains responsible for role and portfolio-scope enforcement. Auth0 uses Authorization Code with PKCE; never place a client secret in frontend configuration. FRIIS is research decision support and does not provide investment advice.
