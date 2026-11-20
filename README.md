# GardeClic

Outil **gratuit**, self-host, pour plusieurs sites Google Ads. Ce n’est **pas** un clone de ClickCease : pas de 2000 tests secrets, pas de SaaS payant, pas de fingerprint.

Tu héberges une instance. Tes sites envoient uniquement les **clics payants** (`gclid` / `gbraid` / `wbraid`) + l’IP vue par ton serveur. Des **règles lisibles** décident d’exclure l’IP. Tu exportes un CSV, ou tu branches l’API Google Ads si tu as un token.

## Ce que ça fait

1. **Beacon first-party** — le snippet ne part que s’il y a un identifiant de clic Ads.
2. **Trois règles**, dans `src/rules.mjs` :
   - `repeat_paid` : trop de clics payants de la même IP dans la fenêtre (défaut 4 / 24 h)
   - `network_repeat` : la même IP clique **plusieurs de tes sites** (le cas concurrent / ferme)
   - `datacenter` : préfixes hébergeur, **off** par défaut (trop large)
3. **Multi-sites** via `data/sites.json` (copie de `sites.example.json`).
4. **Google Ads** optionnel : exclusions IP sur tes campagnes. Sans token, l’export CSV suffit.

Google Ads **ne donne pas l’IP du clic**. D’où le petit collecteur sur tes landings. Plafond Google : 500 IP par campagne.

## Lancer

```bash
cp sites.example.json data/sites.json   # créé tout seul au premier start
cp .env.example .env
npm start
```

Ouvre `http://localhost:8787/?key=ta-clé`.

Sur chaque site :

```html
<script src="https://TON-INSTANCE/s.js" data-site="site-1"></script>
```

`data-site` = l’`id` dans `sites.json`. Renseigne `customerId` et `campaignIds` pour la sync Ads.

## Gratuit pour tout le monde

Licence MIT. Chacun tourne **sa** instance (VPS, Railway, Fly, un `node` sur un Raspberry). On ne vend pas de quota. Tes données restent chez toi (`data/` n’est pas commité).

## Ce que ça n’est pas

Pas un remplaçant magique de ClickCease, pas un bloqueur 4G grand public (une IP mobile partagée peut être un vrai client). Reste conservateur sur un métier local (serrurier, dépannage…).

## Tests

```bash
npm test
```
