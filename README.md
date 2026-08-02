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

### Déployer le serveur

```bash
cd infra
cp .env.example .env      # renseigner domaine et secrets
docker compose up -d
```

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

### Serveur Next.js — non commencé

Schéma Drizzle, better-auth, API v1, UI admin CRUD, upload S3.

### Non vérifié

- **La capture vidéo elle-même.** La chaîne complète a été exercée jusqu'au
  point de capture, où le client conclut correctement qu'aucune source n'est
  disponible : OBS n'est pas installé ici et `desktopCapturer` n'a pas d'écran à
  filmer. Le temps fort est alors journalisé et diffusé sans clip — le
  comportement prévu — mais le montage et la lecture du replay demandent une
  machine avec OBS pour être confirmés.
