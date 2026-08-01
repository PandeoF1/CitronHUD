/**
 * Armes — libellés d'affichage et classification.
 *
 * Le GSI renvoie des noms techniques (`weapon_ak47`). Le HUD affiche des noms
 * lisibles, et la détection de temps forts a besoin de savoir ce qui est un
 * couteau, un Zeus ou un utilitaire.
 */

const WEAPON_LABELS: Record<string, string> = {
  // Pistolets
  weapon_deagle: 'Desert Eagle',
  weapon_revolver: 'R8 Revolver',
  weapon_elite: 'Dual Berettas',
  weapon_fiveseven: 'Five-SeveN',
  weapon_glock: 'Glock-18',
  weapon_hkp2000: 'P2000',
  weapon_p250: 'P250',
  weapon_tec9: 'Tec-9',
  weapon_usp_silencer: 'USP-S',
  weapon_cz75a: 'CZ75-Auto',

  // Mitraillettes
  weapon_mac10: 'MAC-10',
  weapon_mp5sd: 'MP5-SD',
  weapon_mp7: 'MP7',
  weapon_mp9: 'MP9',
  weapon_bizon: 'PP-Bizon',
  weapon_p90: 'P90',
  weapon_ump45: 'UMP-45',

  // Fusils
  weapon_ak47: 'AK-47',
  weapon_aug: 'AUG',
  weapon_famas: 'FAMAS',
  weapon_galilar: 'Galil AR',
  weapon_m4a1: 'M4A4',
  weapon_m4a1_silencer: 'M4A1-S',
  weapon_sg556: 'SG 553',

  // Snipers
  weapon_awp: 'AWP',
  weapon_g3sg1: 'G3SG1',
  weapon_scar20: 'SCAR-20',
  weapon_ssg08: 'SSG 08',

  // Armes lourdes
  weapon_mag7: 'MAG-7',
  weapon_nova: 'Nova',
  weapon_sawedoff: 'Sawed-Off',
  weapon_xm1014: 'XM1014',
  weapon_m249: 'M249',
  weapon_negev: 'Negev',

  // Utilitaires
  weapon_flashbang: 'Flashbang',
  weapon_hegrenade: 'Grenade HE',
  weapon_smokegrenade: 'Fumigène',
  weapon_molotov: 'Molotov',
  weapon_incgrenade: 'Incendiaire',
  weapon_decoy: 'Leurre',

  // Divers
  weapon_taser: 'Zeus x27',
  weapon_c4: 'C4',
  weapon_healthshot: 'Piqûre',
  weapon_knife: 'Couteau',
  weapon_knife_t: 'Couteau'
}

/** Libellé d'affichage d'une arme ; repli propre sur les skins de couteau. */
export function weaponLabel(name: string | null | undefined): string {
  if (!name) return ''
  const known = WEAPON_LABELS[name]
  if (known) return known
  if (name.startsWith('weapon_knife') || name === 'weapon_bayonet') return 'Couteau'
  // Dernier recours : « weapon_new_gun » → « New Gun ».
  return name
    .replace(/^weapon_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Vrai pour tous les couteaux, y compris les skins.
 *
 * CS2 nomme chaque skin différemment (`weapon_knife_karambit`,
 * `weapon_bayonet`…). Une liste exhaustive serait périmée à chaque opération,
 * donc on teste le préfixe et on complète par les exceptions sans préfixe.
 */
export function isKnife(name: string | null | undefined): boolean {
  if (!name) return false
  return name.startsWith('weapon_knife') || name === 'weapon_bayonet'
}

export function isZeus(name: string | null | undefined): boolean {
  return name === 'weapon_taser'
}

const GRENADES = new Set([
  'weapon_flashbang',
  'weapon_hegrenade',
  'weapon_smokegrenade',
  'weapon_molotov',
  'weapon_incgrenade',
  'weapon_decoy'
])

export function isGrenade(name: string | null | undefined): boolean {
  return !!name && GRENADES.has(name)
}

/** Ordre d'affichage des utilitaires : constant, pour que l'œil s'y habitue. */
const GRENADE_ORDER = [
  'weapon_flashbang',
  'weapon_smokegrenade',
  'weapon_hegrenade',
  'weapon_molotov',
  'weapon_incgrenade',
  'weapon_decoy'
]

export function grenadeSortIndex(name: string): number {
  const index = GRENADE_ORDER.indexOf(name)
  return index === -1 ? GRENADE_ORDER.length : index
}

/**
 * Vrai pour les armes que le joueur « porte » sans les tenir vraiment.
 *
 * Le C4 et les piqûres apparaissent dans `weapons` mais ne doivent pas compter
 * comme arme principale dans le panneau du joueur observé.
 */
export function isCarriedItem(name: string | null | undefined): boolean {
  return name === 'weapon_c4' || name === 'weapon_healthshot'
}

/** Classe une arme pour l'affichage : primaire, secondaire, utilitaire, mêlée. */
export function weaponSlot(name: string, type: string | null): 'primary' | 'secondary' | 'grenade' | 'melee' | 'item' {
  if (isKnife(name)) return 'melee'
  if (isGrenade(name)) return 'grenade'
  if (isCarriedItem(name)) return 'item'
  if (type === 'Pistol' || isZeus(name)) return 'secondary'
  return 'primary'
}
