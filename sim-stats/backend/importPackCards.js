import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

loadEnv()
let supabaseConfig = null

const SOURCE_MAP = {
  set: {
    key: 'set',
    label: 'allSetCards',
    url: 'https://www.optcgapi.com/api/allSetCards/'
  },
  st: {
    key: 'st',
    label: 'allSTCards',
    url: 'https://www.optcgapi.com/api/allSTCards/'
  },
  promo: {
    key: 'promo',
    label: 'allPromos',
    url: 'https://www.optcgapi.com/api/allPromos/'
  }
}

const DEFAULT_OPTIONS = {
  setCodes: [],
  sourceKeys: ['set'],
  releaseDate: null,
  packSize: 12,
  packsPerBox: 24,
  productLine: 'one_piece',
  dryRun: false,
  upsertSet: true,
  includeInactive: false,
  chunkSize: 250,
  verbose: false
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    printHelp()
    return
  }

  supabaseConfig = getSupabaseConfig()

  if (!options.setCodes.length) {
    console.error('Debes indicar al menos un set con --set OP12')
    printHelp()
    process.exit(1)
  }

  const normalizedSetCodes = Array.from(new Set(options.setCodes.map(normalizeSetCode).filter(Boolean)))
  const sourceDefs = options.sourceKeys.map((key) => {
    const source = SOURCE_MAP[key]
    if (!source) {
      throw new Error(`Fuente no soportada: ${key}`)
    }
    return source
  })

  console.log(`Importando sets: ${normalizedSetCodes.join(', ')}`)
  console.log(`Fuentes: ${sourceDefs.map((s) => s.label).join(', ')}`)
  if (options.dryRun) {
    console.log('Modo dry-run activo: no se escribira nada en Supabase.')
  }

  const rawRows = []
  for (const source of sourceDefs) {
    const rows = await fetchSourceRows(source, options.verbose)
    rawRows.push(...rows.map((row) => ({ ...row, __sourceKey: source.key, __sourceLabel: source.label })))
  }

  const filteredRows = rawRows.filter((row) => {
    const normalized = normalizeSetCode(row.set_id)
    return normalizedSetCodes.includes(normalized) && (options.includeInactive || isActiveRow(row))
  })

  if (!filteredRows.length) {
    console.error('No se encontraron cartas para los sets indicados.')
    const sampleSetIds = Array.from(new Set(rawRows.map((row) => normalizeSetCode(row.set_id)).filter(Boolean))).slice(0, 20)
    if (sampleSetIds.length) {
      console.error(`Sets detectados en la respuesta: ${sampleSetIds.join(', ')}`)
    }
    process.exit(1)
  }

  const grouped = groupRowsBySet(filteredRows)

  for (const setCode of normalizedSetCodes) {
    const rows = grouped.get(setCode) || []
    if (!rows.length) {
      console.warn(`No hay cartas para ${setCode}.`)
      continue
    }

    console.log(`\n=== ${setCode} ===`)
    console.log(`Cartas crudas encontradas: ${rows.length}`)

    const setName = pickSetName(rows, setCode)
    const packSet = await ensurePackSet({
      setCode,
      setName,
      releaseDate: options.releaseDate,
      packSize: options.packSize,
      packsPerBox: options.packsPerBox,
      productLine: options.productLine,
      upsertSet: options.upsertSet,
      dryRun: options.dryRun
    })

    const transformed = dedupeCards(rows)
      .map((row) => mapCardRow(row, packSet.id, options))
      .filter(Boolean)

    if (!transformed.length) {
      console.warn(`No hay cartas transformadas para ${setCode}.`)
      continue
    }

    printSummary(transformed)

    if (options.dryRun) {
      console.log(`Dry-run: ${transformed.length} cartas preparadas para ${setCode}.`)
      continue
    }

    await upsertCards(transformed, options.chunkSize)
    console.log(`Importacion completada para ${setCode}: ${transformed.length} cartas.`)
  }
}

function loadEnv() {
  const envCandidates = [
    path.join(__dirname, '.env'),
    path.join(repoRoot, '.env'),
    path.join(process.cwd(), '.env')
  ]

  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      loadEnvFile(envPath)
    }
  }
}

function loadEnvFile(envPath) {
  const raw = fs.readFileSync(envPath, 'utf8')
  const lines = raw.split(/\r?\n/g)

  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue

    const key = match[1]
    const value = normalizeEnvValue(match[2] || '')

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function normalizeEnvValue(value) {
  let normalized = String(value || '').trim()

  if (normalized.endsWith(';')) {
    normalized = normalized.slice(0, -1).trim()
  }

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1)
  }

  return normalized.trim()
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.')
    console.error('Puedes ponerlos en .env en sim-stats/backend, en la raiz del repo o exportarlos manualmente.')
    process.exit(1)
  }

  return {
    url: supabaseUrl.replace(/\/+$/, ''),
    serviceRoleKey: supabaseServiceRoleKey,
    restUrl: `${supabaseUrl.replace(/\/+$/, '')}/rest/v1`
  }
}

function parseArgs(argv) {
  const options = {
    ...DEFAULT_OPTIONS,
    setCodes: [],
    sourceKeys: [...DEFAULT_OPTIONS.sourceKeys]
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      return { help: true }
    }

    if (arg === '--set') {
      const value = argv[i + 1]
      if (!value) throw new Error('--set requiere un valor')
      options.setCodes.push(value)
      i += 1
      continue
    }

    if (arg === '--source') {
      const value = argv[i + 1]
      if (!value) throw new Error('--source requiere un valor')
      options.sourceKeys = value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
      i += 1
      continue
    }

    if (arg === '--release-date') {
      const value = argv[i + 1]
      if (!value) throw new Error('--release-date requiere un valor')
      options.releaseDate = value
      i += 1
      continue
    }

    if (arg === '--pack-size') {
      const value = Number(argv[i + 1])
      if (!Number.isInteger(value) || value <= 0) throw new Error('--pack-size debe ser un entero positivo')
      options.packSize = value
      i += 1
      continue
    }

    if (arg === '--packs-per-box') {
      const value = Number(argv[i + 1])
      if (!Number.isInteger(value) || value <= 0) throw new Error('--packs-per-box debe ser un entero positivo')
      options.packsPerBox = value
      i += 1
      continue
    }

    if (arg === '--product-line') {
      const value = argv[i + 1]
      if (!value) throw new Error('--product-line requiere un valor')
      options.productLine = value.trim() || DEFAULT_OPTIONS.productLine
      i += 1
      continue
    }

    if (arg === '--chunk-size') {
      const value = Number(argv[i + 1])
      if (!Number.isInteger(value) || value <= 0) throw new Error('--chunk-size debe ser un entero positivo')
      options.chunkSize = value
      i += 1
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--no-upsert-set') {
      options.upsertSet = false
      continue
    }

    if (arg === '--include-inactive') {
      options.includeInactive = true
      continue
    }

    if (arg === '--verbose') {
      options.verbose = true
      continue
    }

    throw new Error(`Argumento no reconocido: ${arg}`)
  }

  return options
}

function printHelp() {
  console.log(`
Uso:
  node importPackCards.js --set OP12 [opciones]

Opciones:
  --set OP12              Codigo del set a importar. Repetible.
  --source set,st,promo   Fuentes de optcgapi. Por defecto: set
  --release-date YYYY-MM-DD
  --pack-size 12
  --packs-per-box 24
  --product-line one_piece
  --chunk-size 250
  --dry-run
  --no-upsert-set
  --include-inactive
  --verbose

Ejemplos:
  node importPackCards.js --set OP12 --release-date 2025-11-21
  node importPackCards.js --set OP12 --set OP13 --source set --dry-run
  npm run import:pack-cards -- --set OP12 --release-date 2025-11-21
`)
}

async function fetchSourceRows(source, verbose) {
  console.log(`Descargando ${source.label}...`)
  const response = await fetch(source.url, { headers: { Accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Error ${response.status} al descargar ${source.label} (${source.url})`)
  }

  const data = await response.json()
  if (!Array.isArray(data)) {
    throw new Error(`Respuesta inesperada en ${source.label}`)
  }

  if (verbose) {
    console.log(`${source.label}: ${data.length} filas`)
  }

  return data
}

function groupRowsBySet(rows) {
  const map = new Map()
  for (const row of rows) {
    const setCode = normalizeSetCode(row.set_id)
    if (!setCode) continue
    if (!map.has(setCode)) map.set(setCode, [])
    map.get(setCode).push(row)
  }
  return map
}

function pickSetName(rows, fallbackCode) {
  const counts = new Map()
  for (const row of rows) {
    const name = normalizeWhitespace(row.set_name)
    if (!name) continue
    counts.set(name, (counts.get(name) || 0) + 1)
  }

  const winner = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]
  return winner?.[0] || fallbackCode
}

async function ensurePackSet({ setCode, setName, releaseDate, packSize, packsPerBox, productLine, upsertSet, dryRun }) {
  const existing = await restSelectMaybeSingle('pack_sets', {
    select: 'id,code,name,release_date,pack_size,packs_per_box,product_line',
    code: `eq.${setCode}`
  })

  if (existing) {
    console.log(`pack_set encontrado: ${existing.code} (${existing.name})`)
    return existing
  }

  if (!upsertSet) {
    throw new Error(`No existe pack_set para ${setCode} y --no-upsert-set esta activo`)
  }

  const payload = {
    code: setCode,
    name: setName,
    product_line: productLine,
    release_date: releaseDate,
    pack_size: packSize,
    packs_per_box: packsPerBox,
    metadata: {
      imported_from: 'optcgapi',
      imported_at: new Date().toISOString()
    }
  }

  if (dryRun) {
    console.log(`Dry-run: se crearia pack_set ${setCode} (${setName})`)
    return { id: `dry-run-${setCode}`, ...payload }
  }

  const data = await restInsertSingle('pack_sets', payload, 'id,code,name,release_date,pack_size,packs_per_box,product_line')

  console.log(`pack_set creado: ${data.code} (${data.name})`)
  return data
}

function dedupeCards(rows) {
  const map = new Map()

  for (const row of rows) {
    const cardCode = normalizeCardCode(row.card_set_id)
    const variant = inferVariant(row)
    const key = `${cardCode}::${variant}`
    const existing = map.get(key)
    if (!existing || shouldReplaceRow(existing, row)) {
      map.set(key, row)
    }
  }

  return Array.from(map.values())
}

function shouldReplaceRow(current, next) {
  const currentScore = rowQualityScore(current)
  const nextScore = rowQualityScore(next)
  return nextScore > currentScore
}

function rowQualityScore(row) {
  let score = 0
  if (normalizeWhitespace(row.card_image)) score += 5
  if (normalizeWhitespace(row.card_text)) score += 2
  if (Number.isFinite(Number(row.market_price))) score += Number(row.market_price)
  if (normalizeWhitespace(row.card_image_id)) score += 1
  return score
}

function mapCardRow(row, setId, options) {
  const cardCode = normalizeCardCode(row.card_set_id)
  if (!cardCode) return null

  const name = normalizeWhitespace(row.card_name)
  if (!name) return null

  const variant = inferVariant(row)
  const rarity = normalizeWhitespace(row.rarity).toUpperCase() || 'UNKNOWN'
  const cardType = normalizeWhitespace(row.card_type) || null
  const imageUrl = normalizeWhitespace(row.card_image) || null
  const drawWeight = inferDrawWeight(row)

  return {
    set_id: setId,
    card_code: cardCode,
    card_name: name,
    rarity,
    variant,
    card_type: cardType,
    image_url: imageUrl,
    draw_weight: drawWeight,
    external_source: `optcgapi:${row.__sourceLabel}`,
    external_payload: buildExternalPayload(row, options)
  }
}

function inferDrawWeight(row) {
  const rarity = normalizeWhitespace(row.rarity).toUpperCase()
  const variant = inferVariant(row)

  if (variant.startsWith('manga')) return 0.05
  if (variant.startsWith('sp')) return 0.1
  if (variant.startsWith('parallel')) return 0.25

  if (rarity === 'SEC') return 0.2
  if (rarity === 'SR') return 0.5
  return 1
}

function buildExternalPayload(row, options) {
  return {
    source_key: row.__sourceKey,
    source_label: row.__sourceLabel,
    imported_at: new Date().toISOString(),
    normalized_set_code: normalizeSetCode(row.set_id),
    normalized_card_code: normalizeCardCode(row.card_set_id),
    inferred_variant: inferVariant(row),
    include_inactive: options.includeInactive === true,
    raw: row
  }
}

function inferVariant(row) {
  const name = normalizeWhitespace(row.card_name).toLowerCase()
  const imageId = normalizeWhitespace(row.card_image_id).toLowerCase()
  const labels = []

  if (name.includes('(manga)')) labels.push('manga')
  if (name.includes('(sp)')) labels.push('sp')
  if (name.includes('(silver)')) labels.push('silver')
  if (name.includes('(gold)')) labels.push('gold')
  if (name.includes('(signed)')) labels.push('signed')
  if (name.includes('(parallel)')) labels.push('parallel')

  const pMatch = imageId.match(/(?:_|-)(p\d+)(?:_|$)/i)
  if (pMatch) {
    if (!labels.includes('parallel')) labels.push('parallel')
    labels.push(pMatch[1].toLowerCase())
  }

  if (!labels.length && imageId) {
    const baseCode = normalizeCardCode(row.card_set_id).toLowerCase()
    const normalizedImageId = imageId.replace(/\.png$|\.jpg$|\.jpeg$/i, '')
    if (baseCode && normalizedImageId && normalizedImageId !== baseCode.toLowerCase()) {
      const suffix = normalizedImageId
        .replace(new RegExp(`^${escapeRegExp(baseCode.toLowerCase())}[\\-_]?`), '')
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
      if (suffix) labels.push(`art_${suffix}`)
    }
  }

  if (!labels.length && normalizeWhitespace(row.rarity).toUpperCase() === 'TR') {
    labels.push('treasure_rare')
  }

  return labels.length ? labels.join('_') : 'base'
}

function isActiveRow(row) {
  if (row?.active === false || row?.enabled === false) return false

  const status = normalizeWhitespace(row?.status || row?.card_status).toLowerCase()
  if (!status) return true

  return !['inactive', 'disabled', 'retired', 'unreleased'].includes(status)
}

function normalizeSetCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function normalizeCardCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function printSummary(rows) {
  const rarityCounts = new Map()
  const variantCounts = new Map()

  for (const row of rows) {
    rarityCounts.set(row.rarity, (rarityCounts.get(row.rarity) || 0) + 1)
    variantCounts.set(row.variant, (variantCounts.get(row.variant) || 0) + 1)
  }

  const raritySummary = Array.from(rarityCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([rarity, count]) => `${rarity}:${count}`)
    .join(' | ')

  const variantSummary = Array.from(variantCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([variant, count]) => `${variant}:${count}`)
    .join(' | ')

  console.log(`Resumen rarezas: ${raritySummary}`)
  console.log(`Resumen variantes: ${variantSummary}`)
}

async function upsertCards(rows, chunkSize) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    await restUpsert('pack_cards', chunk, 'set_id,card_code,variant')

    console.log(`Upsert OK: ${Math.min(i + chunk.length, rows.length)}/${rows.length}`)
  }
}

async function restSelectMaybeSingle(table, query) {
  const params = new URLSearchParams(query)
  const url = `${supabaseConfig.restUrl}/${table}?${params.toString()}`
  const response = await fetch(url, {
    method: 'GET',
    headers: buildRestHeaders({
      Prefer: 'count=exact'
    })
  })

  if (!response.ok) {
    const body = await safeJson(response)
    throw new Error(`Error consultando ${table}: ${body?.message || response.statusText}`)
  }

  const rows = await response.json()
  if (!Array.isArray(rows)) {
    throw new Error(`Respuesta inesperada consultando ${table}`)
  }

  if (rows.length > 1) {
    throw new Error(`Se esperaba una sola fila en ${table} y llegaron ${rows.length}`)
  }

  return rows[0] || null
}

async function restInsertSingle(table, payload, selectColumns) {
  const params = new URLSearchParams()
  if (selectColumns) params.set('select', selectColumns)

  const response = await fetch(`${supabaseConfig.restUrl}/${table}?${params.toString()}`, {
    method: 'POST',
    headers: buildRestHeaders({
      Prefer: 'return=representation'
    }),
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const body = await safeJson(response)
    throw new Error(`Error insertando en ${table}: ${body?.message || response.statusText}`)
  }

  const data = await response.json()
  if (Array.isArray(data)) return data[0] || null
  return data
}

async function restUpsert(table, rows, onConflict) {
  const params = new URLSearchParams()
  if (onConflict) params.set('on_conflict', onConflict)

  const response = await fetch(`${supabaseConfig.restUrl}/${table}?${params.toString()}`, {
    method: 'POST',
    headers: buildRestHeaders({
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify(rows)
  })

  if (!response.ok) {
    const body = await safeJson(response)
    throw new Error(`Error haciendo upsert en ${table}: ${body?.message || response.statusText}`)
  }
}

function buildRestHeaders(extraHeaders) {
  return {
    apikey: supabaseConfig.serviceRoleKey,
    Authorization: `Bearer ${supabaseConfig.serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...(extraHeaders || {})
  }
}

async function safeJson(response) {
  try {
    return await response.json()
  } catch (_error) {
    return null
  }
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
