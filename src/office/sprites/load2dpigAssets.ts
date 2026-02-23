/**
 * 2dPig Sprite Pack Loader
 *
 * Loads the extracted 2dPig CC0 office sprites from JSON and emits them
 * as a furnitureAssetsLoaded event so the dynamic catalog picks them up.
 *
 * Sprite data was extracted from assets/2dpig/PixelOfficeAssets.png
 * using flood-fill connected component analysis. Each sprite is a
 * SpriteData (string[][]) — 2D array of hex color strings.
 *
 * License: CC0 (Creative Commons Public Domain Dedication)
 * Artist: 2dPig (https://2dpig.itch.io)
 */

import { eventBus } from '../../eventBus.js'
import { buildDynamicCatalog } from '../layout/furnitureCatalog.js'
import spriteJson from './2dpigSprites.json'

// Cache the last emitted payload so late subscribers (React useEffect) can pick it up
let cachedPayload: Record<string, unknown> | null = null

/** Return the cached furniture assets payload (if load2dpigAssets was already called). */
export function getCached2dpigPayload(): Record<string, unknown> | null {
  return cachedPayload
}

// Tile size is 16px — footprint = ceil(pixelDim / 16)
const TILE_PX = 16
function toTiles(px: number): number {
  return Math.max(1, Math.ceil(px / TILE_PX))
}

// ── Sprite → Catalog Entry Mapping ──────────────────────────────
// Each entry maps a sprite name from the JSON to a FurnitureAsset catalog entry
// with category, footprint, and placement metadata.

interface SpriteMeta {
  label: string
  category: string
  isDesk: boolean
  canPlaceOnWalls?: boolean
  canPlaceOnSurfaces?: boolean
}

const SPRITE_META: Record<string, SpriteMeta> = {
  // Desks
  desk_sm:   { label: 'Small Desk',      category: 'desks',       isDesk: true },
  desk_lg:   { label: 'Large Desk',      category: 'desks',       isDesk: true },
  cubicle:   { label: 'Cubicle',         category: 'desks',       isDesk: true },
  desk_mon:  { label: 'Desk w/ Monitor', category: 'desks',       isDesk: true },

  // Seating
  couch_1:   { label: 'Couch (Blue)',    category: 'chairs',      isDesk: false },
  couch_2:   { label: 'Couch (Red)',     category: 'chairs',      isDesk: false },
  couch_3:   { label: 'Couch (Green)',   category: 'chairs',      isDesk: false },
  couch_4:   { label: 'Couch (Yellow)',  category: 'chairs',      isDesk: false },
  bench:     { label: 'Bench',           category: 'chairs',      isDesk: false },

  // Storage
  bookshelf_1:  { label: 'Bookshelf A',     category: 'storage',  isDesk: false },
  bookshelf_2:  { label: 'Bookshelf B',     category: 'storage',  isDesk: false },
  shelf_sm:     { label: 'Small Shelf',     category: 'storage',  isDesk: false },
  cabinet_1:    { label: 'Cabinet A',       category: 'storage',  isDesk: false },
  cabinet_2:    { label: 'Cabinet B',       category: 'storage',  isDesk: false },
  cabinet_3:    { label: 'Cabinet C',       category: 'storage',  isDesk: false },
  cabinet_4:    { label: 'Cabinet D',       category: 'storage',  isDesk: false },
  cabinet_tall: { label: 'Tall Cabinet',    category: 'storage',  isDesk: false },

  // Electronics
  phone:     { label: 'Phone',           category: 'electronics', isDesk: false, canPlaceOnSurfaces: true },
  monitor:   { label: 'Monitor',         category: 'electronics', isDesk: false, canPlaceOnSurfaces: true },
  laptop:    { label: 'Laptop',          category: 'electronics', isDesk: false, canPlaceOnSurfaces: true },

  // Decor
  plant_1:    { label: 'Plant',          category: 'decor',       isDesk: false },
  plant_sm1:  { label: 'Small Plant A',  category: 'decor',       isDesk: false },
  plant_sm2:  { label: 'Small Plant B',  category: 'decor',       isDesk: false },
  plant_sm3:  { label: 'Small Plant C',  category: 'decor',       isDesk: false },
  frame_1:    { label: 'Frame A',        category: 'wall',        isDesk: false, canPlaceOnWalls: true },
  frame_2:    { label: 'Frame B',        category: 'wall',        isDesk: false, canPlaceOnWalls: true },
  frame_3:    { label: 'Frame C',        category: 'wall',        isDesk: false, canPlaceOnWalls: true },
  window_1:   { label: 'Window A',       category: 'wall',        isDesk: false, canPlaceOnWalls: true },
  window_2:   { label: 'Window B',       category: 'wall',        isDesk: false, canPlaceOnWalls: true },
  door:       { label: 'Door',           category: 'wall',        isDesk: false, canPlaceOnWalls: true },

  // Misc
  counter:      { label: 'Counter',       category: 'misc',       isDesk: false },
  vending_1:    { label: 'Vending A',     category: 'misc',       isDesk: false },
  vending_2:    { label: 'Vending B',     category: 'misc',       isDesk: false },
  vending_lg1:  { label: 'Lg Vending A',  category: 'misc',       isDesk: false },
  vending_lg2:  { label: 'Lg Vending B',  category: 'misc',       isDesk: false },
  wastebin:     { label: 'Waste Bin',     category: 'misc',       isDesk: false },
  cooler:       { label: 'Water Cooler',  category: 'misc',       isDesk: false },
  stand:        { label: 'Stand',         category: 'misc',       isDesk: false },
  mug:          { label: 'Mug',           category: 'misc',       isDesk: false, canPlaceOnSurfaces: true },
  cup:          { label: 'Cup',           category: 'misc',       isDesk: false, canPlaceOnSurfaces: true },
}

// Characters are not furniture — skip them
const SKIP_SPRITES = new Set(['char_1', 'char_2', 'char_3', 'char_4', 'char_5', 'char_cat'])

/**
 * Load 2dPig sprites and emit furnitureAssetsLoaded event.
 * Call this once at app startup (e.g., in openclawAdapter or App init).
 */
export function load2dpigAssets(): void {
  const sprites = spriteJson as Record<string, string[][]>
  const catalog: Array<{
    id: string
    name: string
    label: string
    category: string
    file: string
    width: number
    height: number
    footprintW: number
    footprintH: number
    isDesk: boolean
    canPlaceOnWalls: boolean
    canPlaceOnSurfaces?: boolean
  }> = []

  for (const [name, sprite] of Object.entries(sprites)) {
    if (SKIP_SPRITES.has(name)) continue

    const meta = SPRITE_META[name]
    if (!meta) {
      console.warn(`[2dPig] No metadata for sprite: ${name}, skipping`)
      continue
    }

    const height = sprite.length
    const width = height > 0 ? sprite[0].length : 0
    if (width === 0 || height === 0) continue

    catalog.push({
      id: `2dpig-${name}`,
      name,
      label: meta.label,
      category: meta.category,
      file: name, // not a real file path — sprites are inline
      width,
      height,
      footprintW: toTiles(width),
      footprintH: toTiles(height),
      isDesk: meta.isDesk,
      canPlaceOnWalls: meta.canPlaceOnWalls ?? false,
      ...(meta.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
    })
  }

  // Build sprite map with 2dpig- prefixed keys to match catalog IDs
  const spriteMap: Record<string, string[][]> = {}
  for (const [name, sprite] of Object.entries(sprites)) {
    if (SKIP_SPRITES.has(name)) continue
    if (!SPRITE_META[name]) continue
    spriteMap[`2dpig-${name}`] = sprite
  }

  console.log(`[2dPig] Loaded ${catalog.length} furniture assets from 2dPig sprite pack`)

  // Build the dynamic catalog directly (synchronous, no event timing issues)
  buildDynamicCatalog({ catalog, sprites: spriteMap })

  // Cache payload so late React subscribers can pick it up
  cachedPayload = { catalog, sprites: spriteMap }

  // Also emit the event for any listeners that need it
  eventBus.emit('furnitureAssetsLoaded', { catalog, sprites: spriteMap })
}
