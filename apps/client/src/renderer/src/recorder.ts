/**
 * Tampon circulaire de capture — le repli quand OBS n'est pas disponible.
 *
 * Fonctionne en découpant l'enregistrement en tranches d'une seconde et en ne
 * gardant que les N dernières. Un `MediaRecorder` unique qu'on arrêterait au
 * moment du temps fort produirait un fichier de la taille du match entier ;
 * ici la mémoire reste bornée par la durée du tampon.
 *
 * Limite assumée : les tranches WebM produites par `MediaRecorder` ne sont
 * concaténables que si la première porte l'en-tête d'initialisation. On
 * relance donc l'enregistreur périodiquement pour disposer d'un en-tête frais,
 * au prix d'une coupure de quelques millisecondes.
 */

interface StartOptions {
  sourceId: string
  bufferSeconds: number
  fps: number
  height: number
}

/** Durée d'une tranche. Une seconde est le meilleur compromis granularité/surcoût. */
const SLICE_MS = 1000
/** Période de relance, pour garder un en-tête exploitable. */
const RESTART_MS = 30_000

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let slices: Blob[] = []
let header: Blob | null = null
let maxSlices = 40
let restartTimer: ReturnType<typeof setInterval> | null = null

async function start(options: StartOptions): Promise<void> {
  stop()
  maxSlices = options.bufferSeconds

  try {
    /*
     * `chromeMediaSource: 'desktop'` est l'API de capture d'Electron ; elle
     * passe par des contraintes non standard, d'où le cast.
     */
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: options.sourceId,
          maxFrameRate: options.fps,
          maxHeight: options.height
        }
      }
    } as unknown as MediaStreamConstraints)
  } catch (error) {
    console.error('[recorder] Capture d’écran refusée :', error)
    return
  }

  launch()
  restartTimer = setInterval(launch, RESTART_MS)
}

/** (Re)démarre l'enregistreur en conservant les tranches déjà collectées. */
function launch(): void {
  if (!stream) return
  recorder?.stop()

  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm'

  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
  let first = true

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    if (first) {
      // La première tranche porte l'en-tête WebM : on la garde à part pour
      // pouvoir reconstituer un fichier lisible à tout moment.
      header = event.data
      first = false
      return
    }
    slices.push(event.data)
    if (slices.length > maxSlices) slices.shift()
  }

  recorder.start(SLICE_MS)
}

/** Reconstitue le tampon et le renvoie au process principal. */
async function flush(): Promise<void> {
  if (!header || slices.length === 0) {
    window.citronRecorder.sendChunk(null)
    return
  }
  try {
    const blob = new Blob([header, ...slices], { type: 'video/webm' })
    window.citronRecorder.sendChunk(await blob.arrayBuffer())
  } catch (error) {
    console.error('[recorder] Assemblage impossible :', error)
    window.citronRecorder.sendChunk(null)
  }
}

function stop(): void {
  if (restartTimer) {
    clearInterval(restartTimer)
    restartTimer = null
  }
  recorder?.stop()
  recorder = null
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  slices = []
  header = null
}

window.citronRecorder.onStart((options) => void start(options))
window.citronRecorder.onFlush(() => void flush())
window.citronRecorder.onStop(() => stop())
