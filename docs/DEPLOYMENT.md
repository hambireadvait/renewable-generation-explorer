# Deployment

The app is a single Python service: FastAPI serves the JSON API (`/api/*`), the interactive API docs
(`/docs`) and the static frontend (`/`, `/static/*`). There is **no frontend build step**, and the
browser calls the API with relative URLs (`/api/...`), so nothing depends on `localhost` and no API
base URL has to be configured.

Nothing has been deployed. These files are ready for when you choose a host.

## Commands

| | Command |
|---|---|
| Install | `pip install -r requirements.txt` |
| Build | none (Python + static files). Docker: `docker build -t rge .` |
| Start (production) | `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers ${WEB_CONCURRENCY:-1} --proxy-headers --forwarded-allow-ips='*'` |
| Health check | `GET /api/health` → `{"status":"ok", ...}` |
| Tests | `pip install -r requirements-dev.txt && pytest` and `node --test 'tests/js/*.test.mjs'` |

The production start command was run locally (2 workers) and returned healthy responses, including gzip-compressed API payloads.

## Environment variables

None are required. See `.env.example` for the full list. Ones that matter in production:

| Variable | Recommended production value | Why |
|---|---|---|
| `PORT` | set by the platform | Port to bind |
| `WEB_CONCURRENCY` | `2` (≈ 1 per 512 MB RAM) | Uvicorn workers. Modelling is CPU-bound (≈0.5–2 s for a 5-year long-term run) |
| `CACHE_DIR` | `/tmp/rfe-cache` (Docker default) | Writable path for the on-disk provider cache. Ephemeral is fine — it only saves upstream calls |
| `HTTP_USER_AGENT` | include a contact e-mail | Courtesy to NASA POWER / Open-Meteo for traffic they can attribute |
| `OPEN_METEO_API_KEY` | **set for any commercial use** | Open-Meteo's free tier is non-commercial only. When set, the app switches to the `customer-*` hosts. Store it as a platform secret, never in the repo |
| `OFFLINE_MODE` | `0` | `1` disables outbound calls (demo mode only) |

Secrets stay on the server: the frontend never sees `OPEN_METEO_API_KEY`, and it is redacted from
cached request URLs and from the `source.request_url` shown in results.

## Option A — Docker (any container host: Render, Fly.io, Railway, Cloud Run, ECS…)

```bash
docker build -t renewable-generation-explorer .
docker run -p 8000:8000 -e PORT=8000 renewable-generation-explorer
```

The image runs as a non-root user, includes a `HEALTHCHECK` against `/api/health`, and honours `$PORT`.

## Option B — Render (blueprint included)

`render.yaml` defines one Docker web service with `healthCheckPath: /api/health` and `autoDeploy: false`.
Create a Blueprint from the repository in the Render dashboard, then set `OPEN_METEO_API_KEY` there if the
deployment is commercial. Applying it creates billable infrastructure, so it's left for you to trigger.

## Option C — plain VM / PaaS without Docker

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --proxy-headers
```

Put it behind a TLS-terminating reverse proxy (nginx, Caddy or the platform router).

## Production behaviour already in place

- **Compression**: gzip for responses over 1 KB (a 7-day forecast goes from ~24 KB to ~4 KB).
- **Headers**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: SAMEORIGIN`. HTML and static assets use `Cache-Control: no-cache` (ETag revalidation),
  because file names are not fingerprinted and deploys should show up immediately.
- **Caching**: raw provider responses are cached on disk (historical 30 days, forecast 1 h, geocoding 7 days).
  Each worker also keeps a small in-memory cache of recent results for exports.
- **Errors**: upstream failures return structured JSON errors (`502/503/504`) that the UI turns into retry /
  demo-mode options. Demo data is never substituted silently.

## Before going public

- **Licensing**: Open-Meteo's free tier is non-commercial; OpenStreetMap's standard tiles are for light use only.
  For a commercial or high-traffic deployment, buy an Open-Meteo plan and switch the map to a tile provider
  whose terms allow it (one URL in `static/js/map.js`).
- **CDN dependencies**: Leaflet and Chart.js load from jsDelivr, and the Geist font from Google Fonts. To remove these
  third-party requests, vendor the files into `static/vendor/` and update the tags in `static/index.html`.
- **Rate limiting**: there is no per-client rate limit. If the app is public, add one at the proxy/platform to
  protect the upstream quotas (Open-Meteo free tier: 10 000 calls/day).
- **Scaling**: the disk cache is per instance. With several instances, a shared cache (e.g. Redis) would cut
  upstream calls further. The cache interface is `app/cache.py`.
