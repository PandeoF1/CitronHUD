/**
 * Vérification de bout en bout de l'API v1.
 *
 * Contre un vrai PostgreSQL et un vrai serveur de production, pas contre des
 * doublures : ce qui casse ici casse toujours à la jonction — une contrainte
 * d'unicité, un schéma Zod qui écrit `null` là où l'appelant n'a rien envoyé,
 * un en-tête de cache mal formé. Aucune de ces choses n'apparaît dans un test
 * unitaire, et c'est précisément ce qui atteint l'antenne.
 *
 * Lancé par `run.sh`, qui monte la base jetable et le serveur autour.
 */

import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100'
const KEY = process.env.E2E_API_KEY ?? ''
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@citron.gg'
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? ''

let passed = 0
const failures = []

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

/** Requête cliente : porte la clé d'API. */
function asClient(path, init = {}) {
  return fetch(new URL(path, BASE), {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-citron-key': KEY,
      ...(init.headers ?? {})
    }
  })
}

let cookie = ''

/** Requête administrateur : porte le cookie de session. */
function asAdmin(path, init = {}) {
  return fetch(new URL(path, BASE), {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie,
      // better-auth refuse une requête sans origine : protection CSRF, et un
      // client `fetch` de script n'en envoie pas spontanément.
      origin: BASE,
      ...(init.headers ?? {})
    }
  })
}

/** Construit un zip minimal en mémoire, sans dépendance. */
function makeZip(files) {
  const chunks = []
  const central = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content)
    const compressed = deflateRawSync(data)
    const nameBuffer = Buffer.from(name)
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(8, 10)
    header.writeUInt32LE(0, 12)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(compressed.length, 20)
    header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(nameBuffer.length, 28)
    header.writeUInt32LE(offset, 42)

    chunks.push(local, nameBuffer, compressed)
    central.push(header, nameBuffer)
    offset += local.length + nameBuffer.length + compressed.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...chunks, directory, end])
}

let crcTable = null
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let i = 0; i < 256; i += 1) {
      let c = i
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[i] = c
    }
  }
  let crc = -1
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ -1) >>> 0
}

const steamId = () => `7656119${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`

async function main() {
  console.log(`Serveur : ${BASE}`)

  /* ---------------------------------------------------------------------- */
  section("Clés d'API")

  check('sans clé, le roster est refusé', (await fetch(new URL('/api/v1/roster', BASE))).status === 401)
  check(
    'clé inconnue refusée',
    (await fetch(new URL('/api/v1/roster', BASE), { headers: { 'x-citron-key': 'citron_faux' } }))
      .status === 401
  )
  const health = await asClient('/api/v1/health')
  check('clé valide acceptée', health.status === 200)
  check('la santé annonce une version', (await health.json()).ok === true)

  /* ---------------------------------------------------------------------- */
  section('Authentification administrateur')

  const badLogin = await fetch(new URL('/api/auth/sign-in/email', BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: 'mauvais-mot-de-passe' })
  })
  check('mot de passe faux refusé', badLogin.status >= 400)
  check('aucun cookie de session délivré', !badLogin.headers.get('set-cookie'))

  const login = await fetch(new URL('/api/auth/sign-in/email', BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  })
  check('connexion acceptée', login.status === 200)
  cookie = (login.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(';')[0])
    .join('; ')
  check('session posée en cookie', cookie.length > 0)

  /* ---------------------------------------------------------------------- */
  section('Séparation des droits')

  const clientWrite = await asClient('/api/v1/teams', {
    method: 'POST',
    body: JSON.stringify({ slug: 'interdit', name: 'Interdit', shortName: 'INT' })
  })
  check('une clé de régie ne peut pas créer une équipe', clientWrite.status === 403)

  /* ---------------------------------------------------------------------- */
  section('Roster')

  const teamResponse = await asAdmin('/api/v1/teams', {
    method: 'POST',
    body: JSON.stringify({
      slug: 'citron-esport',
      name: 'Citron Esport',
      shortName: 'CIT',
      color: '#ffd400'
    })
  })
  check('équipe créée', teamResponse.status === 201, `reçu ${teamResponse.status}`)
  const team = await teamResponse.json()

  const duplicate = await asAdmin('/api/v1/teams', {
    method: 'POST',
    body: JSON.stringify({ slug: 'citron-esport', name: 'Doublon', shortName: 'DUP' })
  })
  check('slug déjà pris refusé', duplicate.status === 409)

  const playerSteamId = steamId()
  const playerResponse = await asAdmin('/api/v1/players', {
    method: 'POST',
    body: JSON.stringify({
      steamId: playerSteamId,
      nickname: 'Zeste',
      teamId: team.id,
      avatarUrl: 'https://example.test/zeste.png',
      role: 'awper'
    })
  })
  check('joueur créé', playerResponse.status === 201, `reçu ${playerResponse.status}`)
  const player = await playerResponse.json()

  const badSteam = await asAdmin('/api/v1/players', {
    method: 'POST',
    body: JSON.stringify({ steamId: '42', nickname: 'Faux' })
  })
  check('SteamID invalide refusé', badSteam.status === 422)

  /* ---------------------------------------------------------------------- */
  section('Modification partielle')

  const patch = await asAdmin(`/api/v1/players/${player.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ nickname: 'Zeste2' })
  })
  check('renommage accepté', patch.status === 200)
  const renamed = await patch.json()
  check('le pseudo a changé', renamed.nickname === 'Zeste2')
  check("le joueur reste dans son équipe", renamed.teamId === team.id, `teamId=${renamed.teamId}`)
  check("l'avatar est conservé", renamed.avatarUrl === 'https://example.test/zeste.png')
  check('le rôle est conservé', renamed.role === 'awper')

  const erase = await asAdmin(`/api/v1/players/${player.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ avatarUrl: null })
  })
  check('un effacement explicite passe', (await erase.json()).avatarUrl === null)

  // Un PATCH sans champ n'est pas une erreur : il ne demande rien. Le serveur
  // renvoie la fiche inchangée plutôt qu'un refus, et surtout ne tente pas un
  // `set` vide que Drizzle rejetterait.
  const empty = await asAdmin(`/api/v1/players/${player.id}`, {
    method: 'PATCH',
    body: JSON.stringify({})
  })
  check('un patch vide ne casse rien', empty.status === 200, `reçu ${empty.status}`)
  check('et laisse la fiche intacte', (await empty.json()).nickname === 'Zeste2')

  /* ---------------------------------------------------------------------- */
  section('Instantané et cache')

  const roster = await asClient('/api/v1/roster')
  const snapshot = await roster.json()
  check("l'instantané contient l'équipe", snapshot.teams.length === 1)
  check("l'instantané contient le joueur", snapshot.players.length === 1)
  const etag = roster.headers.get('etag')
  check('une empreinte est servie', Boolean(etag))

  const byVersion = await asClient(`/api/v1/roster?version=${encodeURIComponent(snapshot.version)}`)
  check('304 sur version connue', byVersion.status === 304)

  const byEtag = await asClient('/api/v1/roster', { headers: { 'if-none-match': etag ?? '' } })
  check('304 sur If-None-Match', byEtag.status === 304)

  /* ---------------------------------------------------------------------- */
  section('Temps forts')

  const highlightId = crypto.randomUUID()
  const highlight = {
    id: highlightId,
    kind: 'ace',
    sessionId: crypto.randomUUID(),
    matchId: null,
    steamId: playerSteamId,
    playerName: 'Zeste2',
    playerAvatarUrl: null,
    teamId: team.id,
    teamName: 'Citron Esport',
    side: 'CT',
    slot: 'left',
    mapName: 'de_mirage',
    round: 12,
    scoreAt: { left: 7, right: 4 },
    killCount: 5,
    clutchAgainst: null,
    victims: [],
    weapons: ['awp'],
    headshots: 3,
    occurredAt: new Date().toISOString(),
    clip: {
      status: 'ready',
      source: 'obs',
      localPath: 'C:/clips/x.mp4',
      localUrl: '/clips/x.mp4',
      remoteUrl: null,
      durationMs: 9000,
      width: null,
      height: null,
      sizeBytes: null,
      error: null
    }
  }

  const created = await asClient('/api/v1/highlights', {
    method: 'POST',
    body: JSON.stringify(highlight)
  })
  const storedHighlight = await created.json()
  check(
    'temps fort accepté',
    created.status === 201,
    `reçu ${created.status} ${JSON.stringify(storedHighlight).slice(0, 300)}`
  )
  check("l'identifiant du client est conservé", storedHighlight.id === highlightId)

  const replay = await asClient('/api/v1/highlights', {
    method: 'POST',
    body: JSON.stringify(highlight)
  })
  check('renvoi idempotent', replay.status === 200, `reçu ${replay.status}`)

  /* ---------------------------------------------------------------------- */
  section('Clip')

  const clipBytes = Buffer.from('clip-de-test-non-vide')
  const ticketResponse = await asClient(`/api/v1/highlights/${highlightId}/clip`, {
    method: 'POST',
    body: JSON.stringify({
      contentType: 'video/mp4',
      sizeBytes: clipBytes.length,
      durationMs: 9000
    })
  })
  check('autorisation de téléversement délivrée', ticketResponse.status === 200,
    `reçu ${ticketResponse.status}`)

  if (ticketResponse.ok) {
    const ticket = await ticketResponse.json()
    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: clipBytes
    })
    check('le stockage accepte le fichier', put.ok, `reçu ${put.status}`)

    const readBack = await fetch(ticket.publicUrl)
    check('le clip est relisible publiquement', readBack.status === 200)

    const confirm = await asClient(`/api/v1/highlights/${highlightId}/clip`, {
      method: 'PUT',
      body: JSON.stringify({
        remoteUrl: ticket.publicUrl,
        durationMs: 9000,
        sizeBytes: clipBytes.length
      })
    })
    check('confirmation acceptée', confirm.status === 200, `reçu ${confirm.status}`)
    const confirmed = await confirm.json()
    check('le clip est marqué téléversé', confirmed.clip.status === 'uploaded')
    check("l'URL distante est enregistrée", confirmed.clip.remoteUrl === ticket.publicUrl)
  }

  const unknownClip = await asClient(`/api/v1/highlights/${crypto.randomUUID()}/clip`, {
    method: 'POST',
    body: JSON.stringify({ contentType: 'video/mp4', sizeBytes: 10, durationMs: 1000 })
  })
  check('clip sur temps fort inconnu refusé', unknownClip.status === 404)

  /* ---------------------------------------------------------------------- */
  section('Records')

  const sessionId = crypto.randomUUID()
  const envelope = {
    sessionId,
    candidates: [
      {
        metric: 'kills_round',
        scope: 'player',
        steamId: playerSteamId,
        playerName: 'Zeste2',
        teamId: team.id,
        value: 5,
        achievedAt: new Date().toISOString(),
        mapName: 'de_mirage',
        round: 12
      }
    ]
  }
  const firstSync = await asClient('/api/v1/records/sync', {
    method: 'POST',
    body: JSON.stringify(envelope)
  })
  check("l'enveloppe du contrat est acceptée", firstSync.status === 200, `reçu ${firstSync.status}`)
  check('le record est retenu', (await firstSync.json()).accepted.length === 1)

  const lower = await asClient('/api/v1/records/sync', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      candidates: [{ ...envelope.candidates[0], value: 3 }]
    })
  })
  check('une valeur inférieure est rejetée', (await lower.json()).accepted.length === 0)

  const equal = await asClient('/api/v1/records/sync', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      candidates: [{ ...envelope.candidates[0], value: 5 }]
    })
  })
  check("une valeur égale ne détrône pas", (await equal.json()).accepted.length === 0)

  const better = await asClient('/api/v1/records/sync', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      candidates: [{ ...envelope.candidates[0], value: 6 }]
    })
  })
  check('une meilleure valeur est retenue', (await better.json()).accepted.length === 1)

  // Le désamorçage se bat vers le bas : plus c'est court, meilleur c'est.
  const defuseBase = {
    metric: 'fastest_defuse_ms',
    scope: 'player',
    steamId: playerSteamId,
    playerName: 'Zeste2',
    teamId: team.id,
    achievedAt: new Date().toISOString(),
    mapName: 'de_mirage',
    round: 14
  }
  await asClient('/api/v1/records/sync', {
    method: 'POST',
    body: JSON.stringify({ sessionId, candidates: [{ ...defuseBase, value: 4000 }] })
  })
  const slower = await asClient('/api/v1/records/sync', {
    method: 'POST',
    body: JSON.stringify({ sessionId, candidates: [{ ...defuseBase, value: 5000 }] })
  })
  check('un désamorçage plus lent est rejeté', (await slower.json()).accepted.length === 0)
  const faster = await asClient('/api/v1/records/sync', {
    method: 'POST',
    body: JSON.stringify({ sessionId, candidates: [{ ...defuseBase, value: 2500 }] })
  })
  check('un désamorçage plus rapide est retenu', (await faster.json()).accepted.length === 1)

  /*
   * Le contrat décrit une enveloppe, mais la file d'envoi du client poste un
   * évènement isolé. Refuser cette forme laisserait chaque record accumulé hors
   * ligne coincé dans la file jusqu'à son abandon.
   */
  const isolated = await asClient('/api/v1/records/sync', {
    method: 'POST',
    body: JSON.stringify({
      metric: 'kills_round',
      scope: 'player',
      steamId: playerSteamId,
      playerName: 'Zeste2',
      teamId: team.id,
      value: 7,
      previousValue: 6,
      achievedAt: new Date().toISOString(),
      mapName: 'de_mirage',
      round: 20
    })
  })
  check("l'évènement isolé du client est accepté", isolated.status === 200, `reçu ${isolated.status}`)
  check('et son record est retenu', (await isolated.json()).accepted.length === 1)

  /* ---------------------------------------------------------------------- */
  section("Versions de l'overlay")

  const noManifest = await asClient('/api/v1/overlay/manifest')
  check('aucune version publiée = 404', noManifest.status === 404, `reçu ${noManifest.status}`)

  const clientPublish = await asClient('/api/v1/overlay/releases', { method: 'POST' })
  check('une clé de régie ne peut pas publier', clientPublish.status === 403,
    `reçu ${clientPublish.status}`)

  const badZip = new FormData()
  badZip.set('version', '0.0.1')
  badZip.set('bundle', new Blob([Buffer.from('pas un zip')]), 'overlay.zip')
  const badZipResponse = await fetch(new URL('/api/v1/overlay/releases', BASE), {
    method: 'POST',
    headers: { cookie, origin: BASE },
    body: badZip
  })
  check('une archive illisible est refusée', badZipResponse.status === 415,
    `reçu ${badZipResponse.status}`)

  const wrongZip = new FormData()
  wrongZip.set('version', '0.0.2')
  wrongZip.set('bundle', new Blob([makeZip({ 'dist/index.html': '<html></html>' })]), 'overlay.zip')
  const wrongZipResponse = await fetch(new URL('/api/v1/overlay/releases', BASE), {
    method: 'POST',
    headers: { cookie, origin: BASE },
    body: wrongZip
  })
  check("un zip sans index.html à la racine est refusé", wrongZipResponse.status === 422,
    `reçu ${wrongZipResponse.status}`)

  const bundle = makeZip({ 'index.html': '<html><body>citron</body></html>' })
  const publish = new FormData()
  publish.set('version', '1.0.0')
  publish.set('notes', 'Première version')
  publish.set('bundle', new Blob([bundle]), 'overlay.zip')
  const published = await fetch(new URL('/api/v1/overlay/releases', BASE), {
    method: 'POST',
    headers: { cookie, origin: BASE },
    body: publish
  })
  check('bundle valide publié', published.status === 201, `reçu ${published.status}`)

  const manifest = await asClient('/api/v1/overlay/manifest')
  check('le manifeste est servi', manifest.status === 200, `reçu ${manifest.status}`)
  const manifestBody = await manifest.json()
  check('il annonce la version publiée', manifestBody.version === '1.0.0')
  check(
    "l'empreinte correspond à l'archive envoyée",
    manifestBody.sha256 === createHash('sha256').update(bundle).digest('hex')
  )

  const archive = await fetch(manifestBody.url)
  check("l'archive est téléchargeable sans clé", archive.status === 200)
  const downloaded = Buffer.from(await archive.arrayBuffer())
  check(
    "l'archive téléchargée correspond à son empreinte",
    createHash('sha256').update(downloaded).digest('hex') === manifestBody.sha256
  )

  const again = new FormData()
  again.set('version', '1.0.0')
  again.set('bundle', new Blob([bundle]), 'overlay.zip')
  const duplicateVersion = await fetch(new URL('/api/v1/overlay/releases', BASE), {
    method: 'POST',
    headers: { cookie, origin: BASE },
    body: again
  })
  check('une version déjà publiée est refusée', duplicateVersion.status === 409)

  const second = new FormData()
  second.set('version', '1.1.0')
  second.set('bundle', new Blob([makeZip({ 'index.html': '<html>v2</html>' })]), 'overlay.zip')
  await fetch(new URL('/api/v1/overlay/releases', BASE), {
    method: 'POST',
    headers: { cookie, origin: BASE },
    body: second
  })
  const afterSecond = await (await asClient('/api/v1/overlay/manifest')).json()
  check('la nouvelle version prend la main', afterSecond.version === '1.1.0')

  const releases = await (
    await fetch(new URL('/api/v1/overlay/releases', BASE), { headers: { cookie, origin: BASE } })
  ).json()
  check("l'historique conserve les deux versions", releases.items.length === 2)
  check(
    'une seule version est courante',
    releases.items.filter((item) => item.isCurrent).length === 1
  )

  /* ---------------------------------------------------------------------- */
  section('Interface admin')

  for (const path of [
    '/admin',
    '/admin/teams',
    '/admin/players',
    '/admin/highlights',
    '/admin/records',
    '/admin/sessions',
    '/admin/overlay',
    '/admin/keys'
  ]) {
    const page = await fetch(new URL(path, BASE), { headers: { cookie } })
    check(`${path} répond`, page.status === 200, `reçu ${page.status}`)
  }

  const anonymous = await fetch(new URL('/admin/teams', BASE), { redirect: 'manual' })
  check("l'admin est fermée sans session", anonymous.status === 307 || anonymous.status === 302,
    `reçu ${anonymous.status}`)

  /* ---------------------------------------------------------------------- */
  console.log(`\n${passed} vérifications passées, ${failures.length} échec(s).`)
  if (failures.length > 0) {
    console.log('\nÉchecs :')
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('\nLe harnais a échoué :', error)
  process.exit(1)
})
