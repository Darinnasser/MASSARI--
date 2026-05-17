# Masari Academic App

Production-ready rebuild of the original single-file Masari React app.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- AI: server-only Google Gemini API calls through `/api/chat`
- Uploads: PDF, DOCX, and TXT extraction in the backend
- Deployment: Vercel-ready

## Local Setup

1. Install Node.js 20 or newer.
2. Install dependencies:

```bash
npm install
```

3. Create `.env` from the example:

```bash
cp .env.example .env
```

4. Add your server-side API key:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash-latest
VITE_SITE_URL=http://localhost:5173
```

5. Run frontend and backend together:

```bash
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies `/api` requests to the Express backend on `http://localhost:3001`.

## AI Assistant Uploads

Open the AI Assistant page, choose a `.pdf`, `.docx`, or `.txt` file, then ask Masari Buddy to summarize, explain, generate MCQs, make a study plan, or extract key points. The frontend sends the file to `/api/chat`; text extraction and AI calls happen only on the backend.

## Build

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Vercel Deployment

1. Push this project to GitHub.
2. Import it in Vercel.
3. Set these environment variables in Vercel Project Settings:
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` (optional, defaults to `gemini-1.5-flash-latest`)
   - `VITE_SITE_URL` with your production URL
4. Deploy with the default settings from `vercel.json`.
5. Update `public/robots.txt` and `public/sitemap.xml` to use your real domain instead of `https://your-domain.com`.

## Custom Domain

In Vercel, open Project Settings, then Domains. Add your domain, follow the DNS instructions Vercel gives you, and wait for verification. After the domain is active, update:

- `VITE_SITE_URL`
- `public/robots.txt`
- `public/sitemap.xml`

Then redeploy.

## Notes

The account, task, note, Pomodoro, and profile demo data remains localStorage-based to preserve the original app behavior. The AI assistant is no longer local-only or frontend-key based; it uses the backend `/api/chat` endpoint with Gemini 1.5 Flash Latest.
