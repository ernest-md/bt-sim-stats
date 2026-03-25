import { getPlayerEloHistory, getPlayersForStats, getMatchesByPlayer, getExpansions, getViewerStatsContext } from './api.js'
import { supabase } from './supabaseClient.js'

const playerSelect = document.getElementById("playerSelect")
const expansionSelect = document.getElementById("expansionSelect")
const syncButton = document.getElementById("syncMatchesBtn")
const syncAllButton = document.getElementById("syncAllMatchesBtn")
const summaryView = document.getElementById("summaryView")
const leaderView = document.getElementById("leaderView")
const backButton = document.getElementById("backToSummary")
const eloValue = document.getElementById("eloValue")
const eloToggleBtn = document.getElementById("eloToggleBtn")
const eloChartPanel = document.getElementById("eloChartPanel")
const eloChart = document.getElementById("eloChart")
const eloChartInfo = document.getElementById("eloChartInfo")
const eloChartEmpty = document.getElementById("eloChartEmpty")
const eloInfoBtn = document.getElementById("eloInfoBtn")
const eloInfoModal = document.getElementById("eloInfoModal")
const eloInfoClose = document.getElementById("eloInfoClose")

let allMatches = []
let allExpansions = []
let currentFilteredMatches = []
let allEloHistory = []
let selectedLeaderCode = null
let allowedPlayerIds = new Set()
let viewerRole = "user"
let isSyncRunning = false
let isEloChartOpen = false

function pickLeaderImage(leader) {
  return String(leader?.parallel_image_url || leader?.image_url || "").trim()
}

function leaderZoomHtml(src, alt = "Lider", thumbWidth = 45) {
  const safeSrc = String(src || "").trim()
  const safeAlt = String(alt || "Lider")
  if (!safeSrc) return `<span class="leaderMiniFallback">-</span>`
  return `
    <span class="leaderZoom">
      <img src="${safeSrc}" width="${thumbWidth}" alt="${safeAlt}">
      <span class="leaderZoomPreview">
        <img src="${safeSrc}" alt="${safeAlt} ampliado">
      </span>
    </span>
  `
}

function setLoading(on, text) {
  const overlay = document.getElementById("loadingOverlay")
  const label = document.getElementById("loadingText")
  if (!overlay || !label) return
  if (text) label.textContent = text
  overlay.style.display = on ? "flex" : "none"
  document.body.style.overflow = on ? "hidden" : ""
}

/* ================= INIT ================= */


async function init() {
  const viewer = await getViewerStatsContext()
  viewerRole = viewer?.role || "user"
  const players = await getPlayersForStats()
  allowedPlayerIds = new Set(players.map((p) => p.id))
  const canSyncAll = viewerRole === "admin" || viewerRole === "staff"

  if (syncAllButton) {
    syncAllButton.style.display = canSyncAll ? "" : "none"
  }

  if (players.length === 0) {
    showStatsAccessMessage("No tienes ningun perfil SIM vinculado o acceso concedido.")
    playerSelect.disabled = true
    syncButton.disabled = true
    if (syncAllButton) syncAllButton.disabled = true
  }

  players.forEach(player => {
    const option = document.createElement("option")
    option.value = player.id
    option.textContent = player.name
    playerSelect.appendChild(option)
  })

  if (players.length === 1) {
    playerSelect.disabled = true
  }

  const expansions = await getExpansions()
  allExpansions = expansions

  const allOption = document.createElement("option")
  allOption.value = "all"
  allOption.textContent = "Todas"
  expansionSelect.appendChild(allOption)

  expansions.forEach(exp => {
    const option = document.createElement("option")
    option.value = exp.id
    option.textContent = exp.name
    expansionSelect.appendChild(option)
  })

  const todayExpansion = getTodayExpansion(expansions)
  if (todayExpansion?.id) {
    expansionSelect.value = todayExpansion.id
  }

  if (players.length > 0) {
    const ownPlayer = players.find((p) => p.profile_id && p.profile_id === viewer.userId)
    const defaultPlayerId = ownPlayer?.id || players[0].id
    playerSelect.value = defaultPlayerId
    await loadPlayer(defaultPlayerId)
  }
}

function getTodayExpansion(expansions) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const active = (expansions || []).find((exp) => {
    const start = new Date(exp.start_date)
    const end = new Date(exp.end_date)
    const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const dayEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    return today >= dayStart && today <= dayEnd
  })

  return active || null
}

function showStatsAccessMessage(message) {
  const statusDiv = document.getElementById("syncStatus")
  if (!statusDiv) return
  statusDiv.textContent = message
  statusDiv.className = "sync-status sync-info"
}

function setSyncState(loading) {
  isSyncRunning = !!loading
  if (syncButton) syncButton.disabled = isSyncRunning
  if (syncAllButton && syncAllButton.style.display !== "none") {
    syncAllButton.disabled = isSyncRunning
  }
}

async function callSyncMatches(playerId) {
  const res = await fetch("https://ceunhkqhskwnsoqyunze.supabase.co/functions/v1/sync-matches", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldW5oa3Foc2t3bnNvcXl1bnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDQ0ODcsImV4cCI6MjA4ODAyMDQ4N30.qBGXYYQXlyQwFGeyaeMOtLPHrjBy-eU05AO37yLvi5o",
      "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldW5oa3Foc2t3bnNvcXl1bnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDQ0ODcsImV4cCI6MjA4ODAyMDQ4N30.qBGXYYQXlyQwFGeyaeMOtLPHrjBy-eU05AO37yLvi5o"
    },
    body: JSON.stringify({ playerId })
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error || `Error HTTP ${res.status}`)
  }
  return Number(data?.inserted || 0)
}

/* ================= LOAD PLAYER ================= */

async function loadPlayer(playerId) {
  if (!allowedPlayerIds.has(playerId)) {
    allMatches = []
    allEloHistory = []
    calculateStats()
    return
  }
  const [matches, eloHistory] = await Promise.all([
    getMatchesByPlayer(playerId),
    getPlayerEloHistory(playerId)
  ])
  allMatches = matches
  allEloHistory = eloHistory
  calculateStats()
}

/* ================= CALCULATE STATS ================= */

function calculateStats() {

  let filteredMatches = [...allMatches]
  const selectedExpansion = expansionSelect.value

  if (selectedExpansion !== "all") {
    const expansion = allExpansions.find(e => e.id === selectedExpansion)

    if (expansion) {
      const start = new Date(expansion.start_date)
      const end = new Date(expansion.end_date)

      filteredMatches = filteredMatches.filter(m => {
        const matchDate = new Date(m.match_date)
        return matchDate >= start && matchDate <= end
      })
    }
  }

  currentFilteredMatches = filteredMatches

  const total = filteredMatches.length
  const wins = filteredMatches.filter(m => m.result === "Won").length
  const losses = total - wins
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0

  document.getElementById("total").textContent = total
  document.getElementById("wins").textContent = wins
  document.getElementById("losses").textContent = losses
  document.getElementById("wr").textContent = winRate + "%"
  updateEloSummary()
  renderEloChart()

  buildLeaderStats(filteredMatches)
  buildGlobalMatchups(filteredMatches)
}

function getSelectedExpansion() {
  const selectedExpansion = expansionSelect.value
  if (selectedExpansion === "all") return null
  return allExpansions.find((e) => e.id === selectedExpansion) || null
}

function getFilteredEloHistory() {
  const expansion = getSelectedExpansion()
  if (!expansion) return [...allEloHistory]

  const start = new Date(`${expansion.start_date}T00:00:00`)
  const end = new Date(`${expansion.end_date}T23:59:59.999`)
  return allEloHistory.filter((row) => {
    const day = new Date(`${row.snapshot_date}T12:00:00`)
    return day >= start && day <= end
  })
}

function getBaseEloValue() {
  const expansion = getSelectedExpansion()
  if (!expansion) return null
  return 1000
}

function updateEloSummary() {
  const history = getFilteredEloHistory()
  const latest = history[history.length - 1] || null
  if (latest) {
    eloValue.textContent = Number(latest.elo_visual || 1000).toFixed(1)
    return
  }

  const baseElo = getBaseEloValue()
  eloValue.textContent = baseElo !== null ? Number(baseElo).toFixed(1) : "-"
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function formatChartDay(value) {
  const raw = String(value || "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return `${raw.slice(8, 10)}/${raw.slice(5, 7)}`
}

function renderEloChart() {
  if (!eloChart || !eloChartPanel) return

  const history = getFilteredEloHistory()
  const expansion = getSelectedExpansion()
  const title = expansion
    ? `Mostrando snapshots diarios de ${expansion.name}.`
    : "Mostrando snapshots diarios de todas las expansiones."
  if (eloChartInfo) eloChartInfo.textContent = title

  if (history.length === 0) {
    eloChart.innerHTML = ""
    if (eloChartEmpty) eloChartEmpty.hidden = false
    return
  }

  if (eloChartEmpty) eloChartEmpty.hidden = true

  const width = 900
  const height = 260
  const left = 60
  const right = 18
  const top = 18
  const bottom = 36
  const innerWidth = width - left - right
  const innerHeight = height - top - bottom
  const values = history.map((row) => Number(row.elo_visual || 1000))
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const yMin = Math.max(0, Math.floor((minValue - 100) / 10) * 10)
  const yMax = Math.ceil((maxValue + 100) / 10) * 10
  const yRange = Math.max(1, yMax - yMin)
  const pointCount = Math.max(history.length - 1, 1)

  const xForIndex = (index) => left + (index / pointCount) * innerWidth
  const yForValue = (value) => top + innerHeight - ((value - yMin) / yRange) * innerHeight

  const yTicks = 4
  const grid = []
  for (let i = 0; i <= yTicks; i++) {
    const value = yMin + ((yRange / yTicks) * i)
    const y = yForValue(value)
    grid.push(`
      <line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="rgba(148,163,184,.35)" stroke-dasharray="4 5" />
      <text x="${left - 10}" y="${y + 4}" text-anchor="end" font-size="11" font-family="Segoe UI, Arial, sans-serif" fill="#64748b">${Math.round(value)}</text>
    `)
  }

  const xLabels = history.map((row, index) => {
    const x = xForIndex(index)
    const label = formatChartDay(row.snapshot_date)
    return `<text x="${x}" y="${height - 12}" text-anchor="middle" font-size="11" font-family="Segoe UI, Arial, sans-serif" fill="#475569">${escapeHtml(label)}</text>`
  }).join("")

  const points = history.map((row, index) => {
    const value = Number(row.elo_visual || 1000)
    const x = xForIndex(index)
    const y = yForValue(value)
    return `
      <circle cx="${x}" cy="${y}" r="5" fill="#ffffff" stroke="#2563eb" stroke-width="3" />
      <text x="${x}" y="${Math.max(14, y - 10)}" text-anchor="middle" font-size="11" font-family="Segoe UI, Arial, sans-serif" fill="#0f172a">${value.toFixed(1)}</text>
    `
  }).join("")

  const linePath = history.map((row, index) => {
    const value = Number(row.elo_visual || 1000)
    const x = xForIndex(index)
    const y = yForValue(value)
    return `${index === 0 ? "M" : "L"} ${x} ${y}`
  }).join(" ")

  eloChart.innerHTML = `
    <defs>
      <linearGradient id="eloLineAreaGradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="rgba(37,99,235,.22)" />
        <stop offset="100%" stop-color="rgba(37,99,235,0)" />
      </linearGradient>
    </defs>
    ${grid.join("")}
    <line x1="${left}" y1="${top + innerHeight}" x2="${width - right}" y2="${top + innerHeight}" stroke="rgba(15,23,42,.35)" />
    <path d="${linePath}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    ${points}
    ${xLabels}
  `
}

function toggleEloChart(forceOpen) {
  isEloChartOpen = typeof forceOpen === "boolean" ? forceOpen : !isEloChartOpen
  eloChartPanel.hidden = !isEloChartOpen
  eloToggleBtn.textContent = isEloChartOpen ? "Cerrar" : "Evolucion"
  eloToggleBtn.setAttribute("aria-expanded", isEloChartOpen ? "true" : "false")
  if (isEloChartOpen) renderEloChart()
}

/* ================= BUILD LEADER TABLE ================= */

function buildLeaderStats(matches) {

  const container = document.getElementById("leaderStats")
  container.innerHTML = ""

  const leaderMap = {}

  matches.forEach(m => {

    const leaderCode = m.player.code

    if (!leaderMap[leaderCode]) {
      leaderMap[leaderCode] = {
        name: m.player.name,
        image: pickLeaderImage(m.player),
        games: 0,
        wins: 0,
        matchups: {}
      }
    }

    const leader = leaderMap[leaderCode]

    leader.games++
    if (m.result === "Won") leader.wins++

    const oppCode = m.opponent.code

    if (!leader.matchups[oppCode]) {
      leader.matchups[oppCode] = {
        name: m.opponent.name,
        image: pickLeaderImage(m.opponent),
        games: 0,
        wins: 0
      }
    }

    leader.matchups[oppCode].games++
    if (m.result === "Won") {
      leader.matchups[oppCode].wins++
    }
  })

  Object.entries(leaderMap)
  .sort((a, b) => b[1].games - a[1].games)
  .forEach(([leaderCode, data]) => {

    const losses = data.games - data.wins
    const wr = data.games > 0
      ? ((data.wins / data.games) * 100).toFixed(1)
      : 0

    const wrClass = wr >= 50 ? "wr-positive" : "wr-negative"

    // ========================
    // CALCULAR FAV / DESF
    // ========================

    const validMatchups = Object.values(data.matchups)
      .filter(m => m.games >= 3)
      .map(m => ({
        ...m,
        wr: (m.wins / m.games) * 100
      }))

    let favHtml = "-"
    let desfHtml = "-"

    if (validMatchups.length > 0) {

      const fav = [...validMatchups].sort((a,b) => b.wr - a.wr)[0]
      const desf = [...validMatchups].sort((a,b) => a.wr - b.wr)[0]

      favHtml = `
        <div class="miniMatchup">
          ${leaderZoomHtml(fav.image, fav.name || "Matchup", 50)}
          <span class="${fav.wr >= 50 ? 'wr-positive' : 'wr-negative'}">
            ${fav.wr.toFixed(1)}%
          </span>
        </div>
      `

      desfHtml = `
        <div class="miniMatchup">
          ${leaderZoomHtml(desf.image, desf.name || "Matchup", 50)}
          <span class="${desf.wr >= 50 ? 'wr-positive' : 'wr-negative'}">
            ${desf.wr.toFixed(1)}%
          </span>
        </div>
      `
    }

    const row = document.createElement("tr")
    row.style.cursor = "pointer"
    row.onclick = () => showLeaderView(leaderCode)

    row.innerHTML = `
      <td>${leaderZoomHtml(data.image, data.name || "Lider", 45)}</td>
      <td><strong>${data.name}</strong></td>
      <td>${data.games}</td>
      <td>${data.wins}</td>
      <td>${losses}</td>
      <td class="${wrClass}">${wr}%</td>
      <td>${favHtml}</td>
      <td>${desfHtml}</td>
    `

    container.appendChild(row)
  })
}

/* ================= BUILD GLOBAL MATCHUPS ================= */

function buildGlobalMatchups(matches) {

  const winContainer = document.getElementById("topWins")
  const lossContainer = document.getElementById("topLosses")

  winContainer.innerHTML = ""
  lossContainer.innerHTML = ""

  const globalMap = {}

  matches.forEach(m => {

    const oppCode = m.opponent.code

    if (!globalMap[oppCode]) {
      globalMap[oppCode] = {
        name: m.opponent.name,
        image: pickLeaderImage(m.opponent),
        games: 0,
        wins: 0
      }
    }

    globalMap[oppCode].games++
    if (m.result === "Won") globalMap[oppCode].wins++
  })

  const array = Object.values(globalMap).map(data => ({
    ...data,
    losses: data.games - data.wins,
    wr: data.games > 0 ? ((data.wins / data.games) * 100).toFixed(1) : 0
  }))

  const topWins = [...array].sort((a,b) => b.wins - a.wins).slice(0,4)
  const topLosses = [...array].sort((a,b) => b.losses - a.losses).slice(0,4)

  topWins.forEach(item => {

    const wrClass = item.wr >= 50 ? "wr-positive" : "wr-negative"

    const tr = document.createElement("tr")
    tr.innerHTML = `
      <td class="matchupLeader">
        ${leaderZoomHtml(item.image, item.name || "Lider", 40)}
        <span>${item.name}</span>
      </td>
      <td>${item.wins}</td>
      <td>${item.games}</td>
      <td class="${wrClass}">${item.wr}%</td>
    `
    winContainer.appendChild(tr)
  })

  topLosses.forEach(item => {

    const wrClass = item.wr >= 50 ? "wr-positive" : "wr-negative"

    const tr = document.createElement("tr")
    tr.innerHTML = `
      <td class="matchupLeader">
        ${leaderZoomHtml(item.image, item.name || "Lider", 40)}
        <span>${item.name}</span>
      </td>
      <td>${item.losses}</td>
      <td>${item.games}</td>
      <td class="${wrClass}">${item.wr}%</td>
    `
    lossContainer.appendChild(tr)
  })
}

/* ================= LEADER VIEW ================= */

function showLeaderView(leaderCode) {
  selectedLeaderCode = leaderCode
  summaryView.style.display = "none"
  leaderView.style.display = "block"
  buildLeaderDetail(leaderCode)
}

backButton.addEventListener("click", () => {
  leaderView.style.display = "none"
  summaryView.style.display = "block"
  selectedLeaderCode = null
})

eloToggleBtn.addEventListener("click", () => {
  toggleEloChart()
})

eloInfoBtn.addEventListener("click", () => {
  eloInfoModal.hidden = false
})

eloInfoClose.addEventListener("click", () => {
  eloInfoModal.hidden = true
})

eloInfoModal.addEventListener("click", (e) => {
  if (e.target === eloInfoModal) {
    eloInfoModal.hidden = true
  }
})

/* ================= BUILD LEADER DETAIL ================= */

function buildLeaderDetail(leaderCode) {

  const summaryContainer = document.getElementById("leaderSummary")
  const matchupContainer = document.getElementById("leaderMatchups")

  summaryContainer.innerHTML = ""
  matchupContainer.innerHTML = ""

  const matches = currentFilteredMatches.filter(m => m.player && m.player.code === leaderCode)
  if (matches.length === 0) return

  const leaderInfo = matches[0].player

  const total = matches.length
  const wins = matches.filter(m => m.result === "Won").length
  const losses = total - wins
  const wr = ((wins / total) * 100).toFixed(1)
  const wrClass = wr >= 50 ? "wr-positive" : "wr-negative"

summaryContainer.innerHTML = `
  ${leaderZoomHtml(pickLeaderImage(leaderInfo), leaderInfo.name || "Lider", 140)}
  <div class="leaderSummaryStats">
    <div>
      <strong>${total}</strong>
      Partidas
    </div>
    <div>
      <strong>${wins}</strong>
      Victorias
    </div>
    <div>
      <strong>${losses}</strong>
      Derrotas
    </div>
    <div class="${wrClass}">
      <strong>${wr}%</strong>
      WR
    </div>
  </div>
`

  const matchupMap = {}

  matches.forEach(m => {

    const opp = m.opponent.code

    if (!matchupMap[opp]) {
      matchupMap[opp] = {
        info: m.opponent,
        games: 0,
        wins: 0,
        firstGames: 0,
        firstWins: 0,
        secondGames: 0,
        secondWins: 0
      }
    }

    const entry = matchupMap[opp]

    entry.games++
    if (m.result === "Won") entry.wins++

    if (m.turn_order === 1) {
      entry.firstGames++
      if (m.result === "Won") entry.firstWins++
    }

    if (m.turn_order === 2) {
      entry.secondGames++
      if (m.result === "Won") entry.secondWins++
    }
  })

  Object.values(matchupMap)
    .sort((a,b) => b.games - a.games)
    .forEach(m => {

      const wr = ((m.wins / m.games) * 100).toFixed(1)

      const wrFirst = m.firstGames > 0
        ? ((m.firstWins / m.firstGames) * 100).toFixed(1)
        : null

      const wrSecond = m.secondGames > 0
        ? ((m.secondWins / m.secondGames) * 100).toFixed(1)
        : null

      const tr = document.createElement("tr")

      tr.innerHTML = `
        <td>${leaderZoomHtml(pickLeaderImage(m.info), m.info.name || "Lider", 60)}</td>
        <td>${m.info.name}</td>
        <td>${m.games}</td>
        <td>${m.wins}</td>
        <td>${m.games - m.wins}</td>
        <td class="${wr >= 50 ? 'wr-positive' : 'wr-negative'}">${wr}%</td>
        <td>${m.firstGames}</td>
        <td class="${wrFirst !== null ? (wrFirst >= 50 ? 'wr-positive' : 'wr-negative') : ''}">
          ${wrFirst !== null ? wrFirst + '%' : '-'}
        </td>
        <td>${m.secondGames}</td>
        <td class="${wrSecond !== null ? (wrSecond >= 50 ? 'wr-positive' : 'wr-negative') : ''}">
          ${wrSecond !== null ? wrSecond + '%' : '-'}
        </td>
      `

      matchupContainer.appendChild(tr)
    })
}

/* ================= EVENTS ================= */

playerSelect.addEventListener("change", (e) => {
  loadPlayer(e.target.value)
})

expansionSelect.addEventListener("change", () => {

  calculateStats()

  if (selectedLeaderCode) {
    buildLeaderDetail(selectedLeaderCode)
  }
})

syncButton.addEventListener("click", async () => {
  await syncMatchesForSelectedPlayer()
})

async function syncMatchesForSelectedPlayer(playerId) {

  const statusDiv = document.getElementById("syncStatus")
  const selectedPlayerId = playerId ?? playerSelect.value
  if (isSyncRunning) return

  if (!selectedPlayerId) {
    statusDiv.textContent = "Selecciona un jugador antes de sincronizar"
    statusDiv.className = "sync-status sync-error"
    return
  }

  if (!allowedPlayerIds.has(selectedPlayerId)) {
    statusDiv.textContent = "No tienes permisos para sincronizar ese jugador"
    statusDiv.className = "sync-status sync-error"
    return
  }

  statusDiv.textContent = "Cargando partidas..."
  statusDiv.className = "sync-status sync-loading"

  try {
    setSyncState(true)
    const inserted = await callSyncMatches(selectedPlayerId)

    if (inserted > 0) {
      statusDiv.textContent = `Se han anadido ${inserted} partidas nuevas`
      statusDiv.className = "sync-status sync-success"
    } else {
      statusDiv.textContent = "No se han encontrado partidas nuevas"
      statusDiv.className = "sync-status sync-info"
    }

    await loadPlayer(selectedPlayerId)

  } catch (err) {

    statusDiv.textContent = `Error al sincronizar partidas: ${err.message}`
    statusDiv.className = "sync-status sync-error"

  } finally {
    setSyncState(false)
  }
}

async function syncMatchesForAllPlayers() {
  const statusDiv = document.getElementById("syncStatus")
  if (isSyncRunning) return

  if (!(viewerRole === "admin" || viewerRole === "staff")) {
    statusDiv.textContent = "No tienes permisos para actualizar todos los jugadores"
    statusDiv.className = "sync-status sync-error"
    return
  }

  const playerIds = Array.from(allowedPlayerIds)
  if (playerIds.length === 0) {
    statusDiv.textContent = "No hay jugadores disponibles para sincronizar"
    statusDiv.className = "sync-status sync-info"
    return
  }

  let totalInserted = 0
  let okCount = 0
  let failCount = 0

  setSyncState(true)
  try {
    for (let i = 0; i < playerIds.length; i++) {
      const pid = playerIds[i]
      statusDiv.textContent = `Actualizando ${i + 1}/${playerIds.length}...`
      statusDiv.className = "sync-status sync-loading"

      try {
        const inserted = await callSyncMatches(pid)
        totalInserted += inserted
        okCount++
      } catch (_err) {
        failCount++
      }
    }

    statusDiv.textContent = `Actualizacion completa: ${okCount}/${playerIds.length} jugadores, ${totalInserted} partidas nuevas${failCount ? `, ${failCount} errores` : ""}`
    statusDiv.className = failCount ? "sync-status sync-info" : "sync-status sync-success"

    const selectedPlayerId = playerSelect.value
    if (selectedPlayerId && allowedPlayerIds.has(selectedPlayerId)) {
      await loadPlayer(selectedPlayerId)
    }
  } finally {
    setSyncState(false)
  }
}

if (syncAllButton) {
  syncAllButton.addEventListener("click", async () => {
    await syncMatchesForAllPlayers()
  })
}

;(async function bootstrap() {
  setLoading(true, "Cargando estadisticas...")
  try {
    await init()
  } catch (err) {
    console.error("stats init:", err)
    const statusDiv = document.getElementById("syncStatus")
    if (statusDiv) {
      statusDiv.textContent = "Error cargando estadisticas."
      statusDiv.className = "sync-status sync-error"
    }
  } finally {
    setLoading(false)
  }
})()
