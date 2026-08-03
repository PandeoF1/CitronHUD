# CitronHUD

HUD CS2 plug-n-play pour **Citron Esport** — un client sans réglage pour le streamer, un serveur configurable avec interface admin pour l'orga.

---

## Le principe

Le streamer installe un `.exe`, choisit deux équipes, et c'est tout. Aucune URL à copier, aucun fichier à créer, aucun mot de passe à saisir.

Ce que le client fait tout seul au premier lancement :

1. **localise Steam et CS2** — y compris sur une bibliothèque secondaire — et écrit le fichier Game State Integration ;
2. **lit le mot de passe websocket d'OBS sur le disque**, se connecte, crée la source navigateur du HUD dans la scène active et active le tampon de replay ;
3. **identifie les équipes par SteamID** et attribue les camps automatiquement.

Le seul geste restant : sélectionner les deux équipes.

---

## Architecture

Le point structurant : **le client est local d'abord**. Il lit toujours son cache SQLite, jamais le réseau au moment de dessiner. Le serveur ne fait qu'alimenter ce cache en arrière-plan. Une coupure réseau en plein match ne change donc rien à l'antenne — et sans serveur configuré du tout, le client fonctionne en autonomie complète.

```
   CS2 ──GSI 10 Hz──►  ┌─────────────────────────────┐
                       │   Client Electron           │
   OBS ◄──websocket───►│   • serveur local (1 port)  │◄──sync──►  Serveur
    │                  │   • moteur GSI              │  (facultatif)
    │                  │   • cache SQLite + outbox   │
    │                  │   • capture des temps forts │
    │  source          └──────────────┬──────────────┘
    │  navigateur                     │ socket.io
    └─────────────────────────────────┴──►  Overlay (React)
```

### Monorepo

| Paquet               | Rôle                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts` | Schémas Zod partagés. Source de vérité unique des formes de données.                                                   |
| `packages/gsi`       | Moteur : normalisation, killfeed reconstruit, détection des camps, temps forts, records. Aucune dépendance navigateur. |
| `packages/theme`     | Design system « Zeste ». `tokens.ts` génère `tokens.css`.                                                              |
| `apps/overlay`       | Le HUD chargé par OBS. Ne prend aucune décision : il dessine.                                                          |
| `apps/client`        | Electron — serveur local, moteur, capture, panneau de contrôle.                                                        |
| `apps/server`        | Next.js 15 — API et interface admin.                                                                                   |
| `infra`              | docker-compose : Next + Postgres + MinIO + Caddy.                                                                      |

### Décisions qui méritent d'être connues

**Le GSI de CS2 ne fournit aucun killfeed.** Le moteur le reconstruit en comparant deux trames : un compteur de kills qui monte d'un côté, une santé qui tombe à zéro de l'autre. On n'expose donc que ce qui est réellement déductible — tueur, arme active, victime, headshot. Pas de wallbang ni de noscope, que le flux ne permet pas de connaître honnêtement.

**Les camps sont recalculés à chaque trame** en comptant les joueurs identifiés par SteamID de chaque côté. Conséquence utile : la mi-temps ne demande aucune logique dédiée, puisque les joueurs changent réellement de camp dans le flux. Un bouton d'inversion manuelle reste disponible quand des SteamID manquent au roster, et un indicateur de fiabilité prévient sous 60 %.

**Un seul port** sert l'overlay, les clips, le websocket et l'endpoint GSI. JT's HUD en utilise deux, ce qui double les pare-feux à autoriser.

**Le jaune de marque ne désigne jamais une équipe.** CT reste cyan, T reste orange. Le citron est réservé à la structure — sinon le spectateur confond le camp et l'identité visuelle.

---

## Démarrer

```bash
pnpm install

pnpm dev:overlay   # overlay seul, http://localhost:5180/?demo=1
pnpm dev:client    # client Electron
pnpm dev:server    # admin + API
```

Le mode `?demo=1` charge une scène fabriquée (pseudo très long, joueur à 3 PV, joueur hors roster, bombe posée) pour travailler l'apparence sans lancer CS2.

Le serveur a besoin d'une base PostgreSQL et, pour les images, d'un stockage
objet. Les deux se montent avec le docker-compose du dépôt :

```bash
cd infra
cp .env.example .env   # renseigner les mots de passe
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres minio createbucket
```

La surcouche `docker-compose.dev.yml` publie PostgreSQL sur `127.0.0.1:5432` et
MinIO sur `127.0.0.1:9000` — nécessaire parce qu'en développement l'application
tourne sur la machine et non dans un conteneur. Elle n'est **pas** nommée
`docker-compose.override.yml`, qui se chargerait tout seul : un déploiement ne
doit pas exposer sa base de données par la simple présence d'un fichier oublié.

Puis, côté serveur :

```bash
cd apps/server
cp .env.example .env   # reprendre les identifiants de infra/.env
pnpm db:migrate        # applique le schéma
pnpm db:seed           # premier admin + première clé d'API
```

`db:seed` affiche la clé d'API en clair **une seule fois** : seul son haché est
stocké. L'inscription est fermée dans l'admin, donc c'est aussi le seul moyen de
créer le compte de départ.

### Déployer le serveur

```bash
cd infra
cp .env.example .env      # renseigner domaine et secrets
docker compose up -d
docker compose exec app pnpm db:seed
```

Les migrations passent au démarrage du conteneur : un déploiement en une
commande ne laisse jamais le schéma en retard sur le code.

---

## État d'avancement

### Terminé et vérifié

- **`packages/contracts`** — schémas complets (roster, match, état HUD, temps forts, records, config, socket, API).
- **`packages/gsi`** — moteur complet. **45 tests passent** (`pnpm --filter @citronhud/gsi test`) : killfeed reconstruit, détection des camps, détection des coachs, suivi des utilitaires, bilan de fin de manche.
- **`packages/theme`** — tokens + CSS généré, polices Fontsource auto-hébergées.
- **`apps/overlay`** — **compile, build et s'affiche correctement**. Matchbar, pépin signature, listes joueurs, panneau observé, killfeed, radar canvas, bilan de fin de manche, scène de replay, bandeaux de record, champ de zestes. **13 tests** sur la projection radar et l'interpolation.
- **`infra`** — docker-compose, Caddyfile, `.env.example`.

- **`apps/client`** — **démarre et fonctionne**. Vérifié bout en bout contre le
  client réel, flux GSI simulé injecté sur `POST /gsi`, overlay branché en
  socket.io :

  | Vérification                            | Résultat                                                                     |
  | --------------------------------------- | ---------------------------------------------------------------------------- |
  | Démarrage                               | serveur local sur `:3477`, `/health` et `/overlay/` répondent, aucune erreur |
  | Ingestion GSI                           | 401 trames acceptées, 401 états rediffusés à l'overlay                       |
  | Killfeed reconstruit                    | 11 kills, avec arme, camp et côté d'écran corrects                           |
  | Temps forts                             | ace détecté à la clôture de manche, 5 victimes reconstituées, arme AWP        |
  | Records                                 | annoncés au dépassement, une seule fois par match                            |
  | Persistance locale                      | records et temps forts écrits en base ; outbox empilée hors ligne            |
  | Mémoire entre sessions                  | après redémarrage, un record déjà tombé n'est pas réannoncé                  |
  | Extraction des radars                   | 18 cartes tirées du VPK de CS2 en 1,7 s, aucune ignorée, servies en HTTP     |
  | Détection des coachs                    | équipe à six, sixième homme masqué, dix joueurs affichés                     |
  | Utilitaires                             | fumée déployée + nappe de feu + traînée de six points, camps corrects        |
  | Bilan de fin de manche                  | vainqueur, cause, MVP et dix lignes de tableau, figés à la fin de la manche  |
  | Rendu de l'overlay                      | capturé à l'écran ; fond de carte, utilitaires et bilan conformes            |

### Fonds de radar

Les images ne sont pas livrées avec l'application : elles sont **extraites de
l'installation CS2 du poste** au premier lancement (`pak01_dir.vpk` → `.vtex_c`
→ LZ4 → PNG), avec la géométrie de projection officielle
(`resource/overviews/*.txt`). Trois raisons : elles appartiennent à Valve, une
copie figée se périme dès qu'une carte est remaniée, et les variantes d'étage
(Nuke, Vertigo, Train) comme les cartes de l'atelier arrivent gratuitement.
Le bouton « Ré-extraire les radars » du panneau force l'opération.

- **`apps/server`** — **API v1 et admin complets**. Vérifié bout en bout contre
  un vrai PostgreSQL, serveur de production démarré, plus **23 tests** unitaires
  (`pnpm --filter @citronhud/server test`) :

  | Vérification                            | Résultat                                                                          |
  | --------------------------------------- | --------------------------------------------------------------------------------- |
  | Migrations et amorçage                  | schéma appliqué, premier admin et première clé créés, relance idempotente          |
  | Clés d'API                              | absente, inconnue et révoquée refusées ; comparaison en temps constant             |
  | Séparation des droits                   | une clé lit le roster et rapporte, mais ne peut pas créer d'équipe (403)           |
  | Authentification admin                  | connexion, session en cookie, mot de passe faux refusé sans cookie                 |
  | CRUD roster                             | création, modification, doublons de slug et de SteamID refusés (409), SteamID invalide (422) |
  | Instantané et cache                     | empreinte du contenu, 304 sur `?version=` **et** sur `If-None-Match`               |
  | Modification partielle                  | un `PATCH { nickname }` ne détache pas le joueur de son équipe                     |
  | Temps forts                             | acceptés avec l'identifiant du client, renvoi idempotent, session créée au vol     |
  | Arbitrage des records                   | valeur inférieure et valeur égale rejetées, valeur détrônée conservée              |
  | Sens des métriques                      | le désamorçage se bat vers le bas, tout le reste vers le haut                      |
  | Deux formes de synchronisation          | enveloppe du contrat **et** évènement isolé de la file d'envoi du client           |
  | Stockage absent                         | 503 franc sur les téléversements, tout le reste fonctionne                         |
  | Stockage présent (MinIO)                | présignature, envoi réel du fichier, relecture anonyme de l'URL publique            |
  | Interface admin                         | sept pages rendues et capturées à l'écran, clé jamais réaffichée                   |

### Deux détails du serveur qui méritent d'être connus

**Une clé d'API ne modifie jamais le roster.** Elle le lit et rapporte ce qui
s'est passé ; toute modification éditoriale passe par une session
d'administration. Les clés vivent sur les machines des streamers, souvent
partagées et rarement changées — une clé perdue ne doit pas permettre d'effacer
les équipes de la structure.

**L'arbitrage des records est côté serveur.** Le client propose, le serveur
tranche, sous verrou de ligne. C'est ce qui empêche une machine à l'heure fausse
ou un client d'une version dont le comptage a changé d'inscrire un record que
personne n'a réalisé. Une date trop lointaine est corrigée, pas rejetée : un ace
reste un ace même sur une machine mal réglée.

### Non vérifié

- **La capture vidéo elle-même.** La chaîne complète a été exercée jusqu'au
  point de capture, où le client conclut correctement qu'aucune source n'est
  disponible : OBS n'est pas installé ici et `desktopCapturer` n'a pas d'écran à
  filmer. Le temps fort est alors journalisé et diffusé sans clip — le
  comportement prévu — mais le montage et la lecture du replay demandent une
  machine avec OBS pour être confirmés.
