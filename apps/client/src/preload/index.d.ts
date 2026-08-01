import type { CitronApi, CitronRecorder } from './index'

declare global {
  interface Window {
    citron: CitronApi
    citronRecorder: CitronRecorder
  }
}

export {}
