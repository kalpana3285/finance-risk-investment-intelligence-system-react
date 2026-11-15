import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Auth0Provider } from '@auth0/auth0-react'

const { VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, VITE_AUTH0_API_AUDIENCE } =
  import.meta.env

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('The frontend root element was not found.')
}

const root = createRoot(rootElement)

if (!VITE_AUTH0_DOMAIN || !VITE_AUTH0_CLIENT_ID || !VITE_AUTH0_API_AUDIENCE) {
  root.render(
    <main id="center">
        <h1>Connect your FRIIS workspace</h1>
      <p>
        Create <code>.env.local</code> with
        <code> VITE_AUTH0_DOMAIN</code>, <code>VITE_AUTH0_CLIENT_ID</code>, and
        <code> VITE_AUTH0_API_AUDIENCE</code>, then restart the frontend server.
      </p>
      <p>
        Set the API audience to the same value as <code>FRIIS_AUTH0_API_AUDIENCE</code> in the backend. API requests use the local Vite proxy by default; set <code>VITE_API_BASE_URL</code> when your API is hosted elsewhere.
      </p>
    </main>,
  )
} else {
  root.render(
    <StrictMode>
      <Auth0Provider
        domain={VITE_AUTH0_DOMAIN}
        clientId={VITE_AUTH0_CLIENT_ID}
        authorizationParams={{
          redirect_uri: `${window.location.origin}${import.meta.env.BASE_URL}`,
          audience: VITE_AUTH0_API_AUDIENCE,
        }}
      >
        <App />
      </Auth0Provider>
    </StrictMode>,
  )
}
