import { createAuthClient } from 'better-auth/react';

/** Session credentials stay in server-issued HttpOnly cookies on the app's origin. */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  fetchOptions: { credentials: 'same-origin' },
});
