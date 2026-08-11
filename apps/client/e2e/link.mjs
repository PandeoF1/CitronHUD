/**
 * Vérifie que le client et le serveur se parlent réellement.
 *
 * Les deux moitiés ont longtemps été vérifiées séparément — le client contre un
 * flux GSI simulé, le serveur contre son propre harnais — et c'est la jonction
 * qui n'avait jamais été exercée. C'est pourtant là qu'on a trouvé le décalage
 * de forme sur `records/sync`, et là que le client n'envoyait aucun clip.
 *
 * Ce qui est exercé ici : le roster qui descend, la file d'envoi qui remonte,
 * et le clip qui monte vers le stockage objet. Le moteur GSI ne l'est pas — il
 * a ses propres tests — donc la file est amorcée directement.
 *
 * Lancé par `run.sh`, qui monte le serveur et le client autour.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const SERVER = process.env.LINK_SERVER_URL ?? 'http://localhost:3000'
const KEY = process.env.LINK_API_KEY ?? ''
const USER_DATA = process.env.LINK_USER_DATA ?? join(process.env.HOME ?? '', '.config/CitronHUD')
const CLIENT_DIR = process.env.LINK_CLIENT_DIR ?? process.cwd()
const CLIENT_PORT = Number(process.env.LINK_CLIENT_PORT ?? 3477)

/*
 * Le module `better-sqlite3` du client est compilé pour l'ABI d'Electron et ne
 * se charge pas sous Node : on lit la même base avec le client `sqlite3` en
 * ligne de commande.
 */
const SQLITE = process.env.LINK_SQLITE ?? 'sqlite3'
const sql = (statement) =>
  execFileSync(SQLITE, [join(USER_DATA, 'citronhud.db'), statement], { encoding: 'utf8' }).trim()
const sqlLines = (statement) => {
  const out = sql(statement)
  return out === '' ? [] : out.split('\n')
}

let passed = 0
const failures = []
const check = (label, ok, detail = '') => {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failures.push(label)
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const asClient = (path, init = {}) =>
  fetch(new URL(path, SERVER), {
    ...init,
    headers: { 'content-type': 'application/json', 'x-citron-key': KEY, ...(init.headers ?? {}) }
  })

/* ------------------------------------------------------------------------ */
console.log('\nPréparation du roster côté serveur')

const login = await fetch(new URL('/api/auth/sign-in/email', SERVER), {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: SERVER },
  body: JSON.stringify({
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD
  })
})
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
check('session admin obtenue', cookie.length > 0, `connexion ${login.status}`)

const asAdmin = (path, init = {}) =>
  fetch(new URL(path, SERVER), {
    ...init,
    headers: { 'content-type': 'application/json', cookie, origin: SERVER, ...(init.headers ?? {}) }
  })

// Identifiants uniques : le harnais doit pouvoir être rejoué sans repartir
// d'une base vierge.
const stamp = Date.now()
const teamResponse = await asAdmin('/api/v1/teams', {
  method: 'POST',
  body: JSON.stringify({
    slug: `citron-${stamp}`,
    name: 'Citron Esport',
    shortName: 'CIT',
    color: '#ffd400'
  })
})
const team = await teamResponse.json()
check('équipe créée', teamResponse.status === 201, `reçu ${teamResponse.status}`)

const steamId = `765611980${String(stamp).slice(-8)}`
const playerResponse = await asAdmin('/api/v1/players', {
  method: 'POST',
  body: JSON.stringify({ steamId, nickname: 'pépin', teamId: team.id, role: 'awper' })
})
check('joueur créé', playerResponse.status === 201, `reçu ${playerResponse.status}`)

/* ------------------------------------------------------------------------ */
console.log('\nConfiguration du client')

const settingsPath = join(USER_DATA, 'settings.json')
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
settings.client.serverUrl = SERVER
settings.client.apiKey = KEY
settings.client.syncIntervalMs = 30000
// OBS n'a rien à faire ici : ce harnais teste le réseau, pas la capture.
settings.client.obs.enabled = false
writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
check('le client pointe vers le serveur', true)

/*
 * Cache local vidé : sinon un roster déjà présent ferait passer le contrôle
 * suivant sans que rien n'ait transité par le réseau — le pire des faux verts.
 */
const dbPath = join(USER_DATA, 'citronhud.db')
for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
check('cache local vidé', !existsSync(dbPath))

/* ------------------------------------------------------------------------ */
console.log('\nDémarrage du client')

const client = spawn('pnpm', ['exec', 'electron', 'out/main/index.js', '--no-sandbox'], {
  cwd: CLIENT_DIR,
  stdio: ['ignore', 'pipe', 'pipe']
})
let clientLog = ''
client.stdout.on('data', (chunk) => (clientLog += chunk))
client.stderr.on('data', (chunk) => (clientLog += chunk))
const stop = () => {
  try {
    client.kill('SIGTERM')
  } catch {
    // Déjà parti : rien à faire.
  }
}
process.on('exit', stop)

let up = false
for (let i = 0; i < 45 && !up; i += 1) {
  await sleep(1000)
  try {
    up = (await fetch(`http://localhost:${CLIENT_PORT}/health`, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    // Pas encore debout.
  }
}
check(`le client répond sur :${CLIENT_PORT}`, up, clientLog.slice(-400))

if (!up) {
  console.log(`\n${passed} vérifications passées, ${failures.length} échec(s).`)
  console.log(clientLog.slice(-2000))
  process.exit(1)
}

/* ------------------------------------------------------------------------ */
console.log('\nRoster descendant')

let teams = []
let players = []
for (let i = 0; i < 30; i += 1) {
  await sleep(1000)
  try {
    teams = sqlLines('SELECT payload FROM teams')
    players = sqlLines('SELECT payload FROM players')
    if (teams.length && players.length) break
  } catch {
    // Base pas encore créée.
  }
}

check("l'équipe est arrivée dans le cache local", teams.length >= 1, `${teams.length} équipe(s)`)
check('le joueur aussi', players.length >= 1, `${players.length} joueur(s)`)
if (players.length) {
  const cached = JSON.parse(players[players.length - 1])
  check('avec son pseudo', cached.nickname === 'pépin', cached.nickname)
}

/* ------------------------------------------------------------------------ */
console.log("\nFile d'envoi montante")

const sessionId = randomUUID()
const highlightId = randomUUID()

const enqueue = (kind, payload) => {
  const escaped = JSON.stringify(payload).replaceAll("'", "''")
  sql(
    `INSERT INTO outbox (kind, payload, created_at) VALUES ('${kind}', '${escaped}', '${new Date().toISOString()}')`
  )
}

enqueue('highlight', {
  id: highlightId,
  kind: 'ace',
  sessionId,
  matchId: null,
  steamId,
  playerName: 'pépin',
  playerAvatarUrl: null,
  teamId: team.id,
  teamName: 'Citron Esport',
  side: 'CT',
  slot: 'left',
  mapName: 'de_mirage',
  round: 14,
  scoreAt: { left: 8, right: 6 },
  killCount: 5,
  clutchAgainst: null,
  victims: [],
  weapons: ['awp'],
  headshots: 2,
  occurredAt: new Date().toISOString(),
  clip: {
    status: 'ready',
    source: 'obs',
    localPath: null,
    localUrl: null,
    remoteUrl: null,
    durationMs: 9000,
    width: null,
    height: null,
    sizeBytes: null,
    error: null
  }
})

/* Un fichier réel, pour que la montée vers le stockage soit une vraie montée. */
const CLIP_BYTES = 200_000
const clipsDir = join(USER_DATA, 'clips')
mkdirSync(clipsDir, { recursive: true })
const clipPath = join(clipsDir, `${highlightId}.mp4`)
writeFileSync(clipPath, Buffer.alloc(CLIP_BYTES, 7))

// Après le temps fort, jamais avant : le serveur refuse un clip dont il ne
// connaît pas encore le temps fort.
enqueue('clip', { highlightId, path: clipPath, durationMs: 9000 })
check("file d'envoi amorcée (temps fort puis clip)", true)

console.log('  … attente de la synchronisation')
let remote = null
for (let i = 0; i < 60; i += 1) {
  await sleep(1000)
  const response = await asClient(`/api/v1/highlights?sessionId=${sessionId}`)
  if (!response.ok) continue
  const body = await response.json()
  if (body.items?.length) {
    remote = body.items[0]
    if (remote.clip?.status === 'uploaded') break
  }
}

check('le temps fort est arrivé sur le serveur', Boolean(remote))
if (remote) {
  check("l'identifiant choisi par le client est conservé", remote.id === highlightId)
  check('le joueur est reconnu', remote.playerName === 'pépin')
  check('le clip est marqué téléversé', remote.clip.status === 'uploaded', remote.clip.status)
  check('sa taille est enregistrée', remote.clip.sizeBytes === CLIP_BYTES, `${remote.clip.sizeBytes}`)

  if (remote.clip.remoteUrl) {
    const stored = await fetch(remote.clip.remoteUrl)
    check('le clip est relisible depuis le stockage', stored.status === 200)
    const bytes = (await stored.arrayBuffer()).byteLength
    check('et fait la bonne taille', bytes === CLIP_BYTES, `${bytes} octets`)
  }
}

const pending = sqlLines('SELECT kind FROM outbox')
check("la file d'envoi est vidée", pending.length === 0, pending.join(', '))

/* ------------------------------------------------------------------------ */
console.log('\nServeur local du client')

const overlay = await fetch(`http://localhost:${CLIENT_PORT}/overlay/`)
check("l'overlay est servi", overlay.status === 200)

stop()
await sleep(1000)

console.log(`\n${passed} vérifications passées, ${failures.length} échec(s).`)
if (failures.length > 0) {
  console.log('\nÉchecs :')
  for (const failure of failures) console.log(`  - ${failure}`)
  console.log('\nJournal du client :\n' + clientLog.slice(-2000))
  process.exit(1)
}
