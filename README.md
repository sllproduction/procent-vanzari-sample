# Raport Zilnic Barista (Cloudflare Workers MVP)

Aplicatie web mobile-first (iPhone Safari) cu:

- login pe baza de parola + session cookie httpOnly;
- upload de imagine zilnica (bon cash + bon card + total scris);
- OCR prin Google Cloud Vision (doar sugestii);
- confirmare manuala obligatorie inainte de salvare;
- persistenta in Cloudflare D1;
- istoric si rezumat lunar de comision.

## Tech stack

- Cloudflare Workers
- Cloudflare D1
- Static assets servite de Worker (`public/`)
- Google Cloud Vision API
- HTML/CSS/vanilla JavaScript

## Structura proiect

- `src/index.js` - Worker routes + auth + OCR + parser + D1 access
- `public/login.html` - pagina login
- `public/index.html` - pagina principala
- `public/app.js` - logica frontend
- `public/style.css` - UI mobile-first
- `migrations/001_init.sql` - schema D1
- `wrangler.toml` - configurare Worker + D1 + assets

## Prerequisites

1. Node.js 20+ instalat
2. Cloudflare account
3. Google Cloud project cu Vision API activat
4. `wrangler` instalat global:

```bash
npm install -g wrangler
```

## 1) Login in Cloudflare

```bash
wrangler login
```

## 2) Creeaza baza D1

```bash
wrangler d1 create procent_vanzari_db
```

Copiaza `database_id` returnat si pune-l in `wrangler.toml` la:

```toml
[[d1_databases]]
binding = "DB"
database_name = "procent_vanzari_db"
database_id = "REPLACE_WITH_D1_DATABASE_ID"
migrations_dir = "migrations"
```

## 3) Aplica migrarile

Local:

```bash
wrangler d1 migrations apply procent_vanzari_db --local
```

Remote (Cloudflare):

```bash
wrangler d1 migrations apply procent_vanzari_db --remote
```

## 4) Seteaza secretele

Seteaza parola de login:

```bash
wrangler secret put APP_PASSWORD
```

Seteaza secretul de semnare sesiune (valoare lunga random):

```bash
wrangler secret put SESSION_SECRET
```

Seteaza Google Vision API key:

```bash
wrangler secret put GOOGLE_VISION_API_KEY
```

## 5) Rulare locala

Pornire locala:

```bash
wrangler dev
```

Aplicatia ruleaza, in mod normal, pe:

- `http://127.0.0.1:8787`

Nota:

- Cookie-ul `Secure` este setat doar pe HTTPS.
- In local (`http`) cookie-ul ramane `httpOnly` + `SameSite=Strict`.

## 6) Deploy

```bash
wrangler deploy
```

Dupa deploy, deschide URL-ul Worker-ului.

## 7) Configurari importante

- Default comision este `10` in `migrations/001_init.sql`.
- Il poti schimba din UI (sectiunea Setari) sau direct in DB.
- OCR text brut apare doar cand `ENVIRONMENT=development`.

In `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
```

Daca vrei debug OCR in dev, foloseste:

```toml
[vars]
ENVIRONMENT = "development"
```

## 8) Security notes

- Parola nu pleaca in frontend ca secret stocat.
- `GOOGLE_VISION_API_KEY` ramane doar in Worker secret.
- Session cookie este semnat HMAC (`SESSION_SECRET`) si este `httpOnly`.
- Rutele API state-changing au verificare de origin (basic CSRF mitigation).
- Upload-ul este limitat la 8MB.

## 9) Flux functional

1. Login
2. Upload poza
3. OCR returneaza valori propuse
4. User confirma/editeaza manual
5. Save in D1 (detected + confirmed)
6. Istoric + rezumat lunar folosesc numai valorile confirmate
