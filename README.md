# GitHub Profile Roaster

Enter a GitHub username. The app pulls public profile data (repos, commits, languages, README excerpts) and streams a brutally honest roast plus improvement plan from NVIDIA GLM via the Integrate API.

## Stack

- Next.js 16 (App Router)
- OpenAI SDK → `https://integrate.api.nvidia.com/v1`
- GitHub GraphQL API

## Local setup

```bash
cp .env.example .env.local
# Fill in NVIDIA_API_KEY and GITHUB_TOKEN
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import the project in [Vercel](https://vercel.com/new).
3. Add environment variables (same keys as `.env.example`):
   - `NVIDIA_API_KEY` (required)
   - `GITHUB_TOKEN` (required, public repo read)
   - `NVIDIA_MODEL` (optional, default `z-ai/glm-5.1`)
   - `NVIDIA_MAX_TOKENS` (optional, default `8192`)
4. Deploy. The roast API route uses up to 120s (`maxDuration`).

Never commit `.env.local` or paste API keys in the repo.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Run production build |
| `npm run lint` | ESLint |
