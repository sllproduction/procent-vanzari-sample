# Procent Vanzari - Sample

Aplicatie front-end simpla (fara backend) pentru calculul comisionului la final de luna:

- introduci luna
- introduci vanzarile totale
- introduci procentul de comision
- introduci avansul deja platit
- vezi suma finala de plata

## Rulare locala

Deschide `index.html` direct in browser.

## Structura

- `index.html` - UI-ul aplicatiei
- `styles.css` - stilizare
- `script.js` - logica de calcul

## Deploy pe Cloudflare Pages

1. Pune proiectul intr-un repository GitHub.
2. In Cloudflare Pages: **Create a project** -> **Connect to Git**.
3. Selecteaza repository-ul.
4. Configurare build:
   - Framework preset: `None`
   - Build command: *(gol)*
   - Build output directory: `/`
5. Deploy.

## Comenzi Git utile

```bash
git init
git add .
git commit -m "Sample: calculator procent vanzari"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```
