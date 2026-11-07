# reQuest / request-web

Independent frontend for the reQuest login. The final e has an orange accent. Its green background and centered identity take their visual direction from the read-only `pulse-web` reference. Selecting the seal slides it left beside the sign-in form on desktop; below 768px, the seal fades out and the form replaces it. Authentication uses the existing MySQL-backed accounts through `request-api`; no fixed credentials are included.

This is an independent application and Git repository at `C:\VertrigoServ\www\request-web`, beside `request-api` and `rrms`.

## Run locally

Requires Node.js 22 and the PHP backend running at `http://127.0.0.1:8016`.

```sh
npm run dev
```

Open `http://127.0.0.1:5178`. While both development servers are running, the local Apache URL `http://localhost/request-web/` redirects to this frontend. The source folder blocks directory listing and direct file access; the frontend is served by Node locally and Vercel in production. No package installation is required: the frontend and development server use built-in browser/Node APIs. A local ignored `.env` is provided; `.env.example` records the configuration keys for another checkout. Database credentials belong only in the API `.env` and are never included in this frontend.

```sh
npm test
npm run build
```

## Vercel

Create a separate GitHub repository named `request-web` and add its URL as this application's `origin`. Commit and push the source; `.env`, generated builds, and Vercel local state are ignored. The package lock is included. No remote repository or deployment is created automatically.

Import the GitHub repository into Vercel. Use its repository root, Node.js 22, build command `npm run build`, and output directory `dist` (Framework Preset: Other). Set the server-side `REQUEST_API_ORIGIN` environment variable to the deployed PHP backend's HTTPS base URL. Set it for the intended Production/Preview environments and redeploy. Use Vercel Environment Variables for hosted configuration; do not upload a local `.env`.

`vercel.json` routes backend requests to the Node proxy in `api/proxy.js`; `.vercelignore` excludes local environment files from deployment uploads. No database password, connection string, or private key is exposed through client-side configuration.

`/api/*` is forwarded by `api/proxy.js`. Session cookies, CSRF headers, form submissions, and redirects remain on the frontend origin. Large reports stream through the proxy instead of being buffered as one function response. Concurrent startup/sign-in calls share one session request to avoid a CSRF race on slow connections. Database credentials belong only on the PHP host. Do not expose the local backend directly to the internet for a preview deployment.

After sign-in, `/api/administrator/` displays the preserved PHP administrative workspace through the same proxy. These screens are still rendered by `request-api`; extracting their interfaces into this frontend is a later phase. Vercel hosts the frontend/proxy; PHP and MySQL require their own backend hosting.

## Files

- `public/index.html`: login interface.
- `public/assets/`: scoped styles, JavaScript, and locally bundled fonts with their licenses.
- `api/proxy.js`: backend forwarding for allowed application routes.
- `scripts/dev.mjs`: local frontend server and API proxy.
- `vercel.json`: deployment and routing settings.

The original `rrms` application and `pulse-web` are separate from these folders. New work should be made in `request-web` and `request-api`.

Reference: [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js).

The supplied Student Records and Admission Office emblem is bundled unchanged as `public/assets/request-logo.png` and used for the login logo, favicon, and touch icon. The reQuest wordmark uses the same Paola font as the read-only Pulse reference, with an orange final e. The font attribution and existing usage notice are included in `public/assets/fonts/PAOLA-NOTICE.md`.
