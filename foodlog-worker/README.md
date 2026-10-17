# FoodLog server

A tiny Rust server on Cloudflare Workers (free plan) that the FoodLog app talks to.
It keeps your API keys secret and stores your log so it syncs between devices.

| Endpoint | What it does |
| --- | --- |
| `POST /sync` | Merges the app's log with the saved one and returns the result |
| `POST /estimate` | Asks Claude for nutrition facts from a description and/or photo |
| `GET /usda?q=…` | Searches USDA FoodData Central (`&upc=…` matches a barcode) |

Every request needs `Authorization: Bearer <APP_PASSWORD>`, and browsers may only
call it from the app's own site (`ALLOWED_ORIGINS` in `wrangler.toml`).

## Set up (once, all from a phone browser)

1. **Cloudflare:** sign up free at dash.cloudflare.com. Open *Workers & Pages* once
   so it gives you a `workers.dev` subdomain.
2. **Cloudflare API token:** My Profile › API Tokens › Create Token ›
   *Edit Cloudflare Workers* template › Create. Copy it.
3. **Account ID:** shown on the Workers & Pages overview page (right side). Copy it.
4. **Anthropic API key:** console.anthropic.com › API Keys › Create Key. Add a few
   dollars of credit under Billing.
5. **GitHub secrets:** in this repo, Settings › Secrets and variables › Actions ›
   New repository secret. Add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `ANTHROPIC_API_KEY`, and `APP_PASSWORD` (make one up, long and random).
   Optionally `USDA_API_KEY` from api.data.gov/signup (otherwise a shared demo key is used).
6. **Deploy:** Actions › *FoodLog server* › Run workflow. The run's summary shows
   the server address.
7. **App:** Settings › Sync & AI › paste the address and your password › Save & sync.

## Cost

Cloudflare's free plan covers this easily. Each AI estimate is a single Claude
request (`MODEL` in `wrangler.toml`, default `claude-opus-5-5`), typically a cent
or two with a photo. Setting `MODEL = "claude-haiku-5-5"` is much cheaper, but less accurate.

## Develop

```sh
cd foodlog-worker
printf 'APP_PASSWORD="dev"\nANTHROPIC_API_KEY="sk-ant-..."\n' > .dev.vars
npx wrangler dev        # http://127.0.0.1:8787
```
