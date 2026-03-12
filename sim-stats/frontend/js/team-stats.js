import { getPlayersForTeamOnly, getMatchesByPlayers, getExpansions } from './api.js'
import { supabase } from './supabaseClient.js'

const expansionSelect = document.getElementById("teamExpansionSelect")
const summaryTitle = document.getElementById("teamSummaryTitle")
const summaryBody = document.getElementById("teamSummaryBody")
const pageTitle = document.getElementById("teamPageTitle")

let allMatches = []
let allExpansions = []
let playersMap = new Map()
let currentUserTeam = "SIN EQUIPO"

function wilsonScore(wins, games, z = 1.96) {
  if (!games) return 0
  const p = wins / games
  const z2 = z * z
  const denominator = 1 + (z2 / games)
  const centre = p + (z2 / (2 * games))
  const margin = z * Math.sqrt((p * (1 - p) / games) + (z2 / (4 * games * games)))
  return (centre - margin) / denominator
}

function eloFromWilson(wilson) {
  return 1000 + (wilson * 1000)
}

function pickLeaderImage(leader) {
  return String(leader?.parallel_image_url || leader?.image_url || "").trim() || null
}

function setLoading(on, text) {
  const overlay = document.getElementById("loadingOverlay")
  const label = document.getElementById("loadingText")
  if (!overlay || !label) return
  if (text) label.textContent = text
  overlay.style.display = on ? "flex" : "none"
  document.body.style.overflow = on ? "hidden" : ""
}

async function init() {
  currentUserTeam = await getCurrentUserTeam()
  updateTitles()

  const players = await getPlayersForTeamOnly()
  playersMap = new Map(players.map((p) => [p.id, p]))

  const expansions = await getExpansions()
  allExpansions = expansions
  buildExpansionSelect(expansions)
  const todayExpansion = getTodayExpansion(expansions)
  if (todayExpansion?.id) {
    expansionSelect.value = todayExpansion.id
  }

  if (players.length === 0) {
    renderEmpty("No hay miembros en tu equipo con perfil SIM vinculado.")
    return
  }

  allMatches = await getMatchesByPlayers(players.map((p) => p.id))
  renderTeamSummary(applyExpansionFilter(allMatches))
}

function buildExpansionSelect(expansions) {
  expansionSelect.innerHTML = ""
  const allOption = document.createElement("option")
  allOption.value = "all"
  allOption.textContent = "Todas"
  expansionSelect.appendChild(allOption)

  expansions.forEach((exp) => {
    const option = document.createElement("option")
    option.value = exp.id
    option.textContent = exp.name
    expansionSelect.appendChild(option)
  })
}

function getTodayExpansion(expansions) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  return (expansions || []).find((exp) => {
    const start = new Date(exp.start_date)
    const end = new Date(exp.end_date)
    const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const dayEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    return today >= dayStart && today <= dayEnd
  }) || null
}

async function getCurrentUserTeam() {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (!userId) return "SIN EQUIPO"

  const { data } = await supabase
    .from("profiles")
    .select("team")
    .eq("id", userId)
    .maybeSingle()

  return data?.team || "SIN EQUIPO"
}

function updateTitles() {
  const suffix = currentUserTeam && currentUserTeam !== "SIN EQUIPO"
    ? ` - ${currentUserTeam}`
    : ""
  summaryTitle.textContent = `Resumen del equipo${suffix}`
  pageTitle.textContent = `Estadisticas del equipo${suffix}`
}

function applyExpansionFilter(matches) {
  let filtered = [...matches]
  const selectedExpansion = expansionSelect.value
  if (selectedExpansion === "all") return filtered

  const expansion = allExpansions.find((e) => e.id === selectedExpansion)
  if (!expansion) return filtered

  const start = new Date(expansion.start_date)
  const end = new Date(expansion.end_date)

  filtered = filtered.filter((m) => {
    const matchDate = new Date(m.match_date)
    return matchDate >= start && matchDate <= end
  })

  return filtered
}

function renderTeamSummary(matches) {
  if (!matches || matches.length === 0) {
    renderEmpty("No hay partidas del equipo en este filtro.")
    return
  }

  const byPlayer = new Map()

  matches.forEach((m) => {
    const pid = m.player_id
    if (!pid) return

    if (!byPlayer.has(pid)) {
      byPlayer.set(pid, {
        playerId: pid,
        name: playersMap.get(pid)?.name || "Jugador",
        games: 0,
        wins: 0,
        leaderMap: new Map()
      })
    }

    const row = byPlayer.get(pid)
    row.games += 1
    if (m.result === "Won") row.wins += 1

    const leaderCode = m.player?.code || "UNKNOWN"
    if (!row.leaderMap.has(leaderCode)) {
      row.leaderMap.set(leaderCode, {
        name: m.player?.name || leaderCode,
        imageUrl: pickLeaderImage(m.player),
        games: 0,
        wins: 0
      })
    }

    const leader = row.leaderMap.get(leaderCode)
    leader.games += 1
    if (m.result === "Won") leader.wins += 1
  })

  const list = Array.from(byPlayer.values()).map((p) => {
    const losses = p.games - p.wins
    const wr = p.games > 0 ? (p.wins / p.games) * 100 : 0
    const wilson = wilsonScore(p.wins, p.games)
    const leaders = Array.from(p.leaderMap.values())
    const topPlayed = leaders.sort((a, b) => b.games - a.games)[0] || null
    const topWr = leaders
      .filter((l) => l.games >= 3)
      .sort((a, b) => (b.wins / b.games) - (a.wins / a.games))[0] || topPlayed

    return { ...p, losses, wr, wilson, elo: eloFromWilson(wilson), topPlayed, topWr }
  })

  list.sort((a, b) => {
    if (b.wilson !== a.wilson) return b.wilson - a.wilson
    return b.games - a.games
  })

  const top = list[0]
  const rowsHtml = list.map((p, idx) => `
    <tr class="rankRow rank-${idx + 1}">
      <td class="rankPos">${idx + 1}</td>
      <td class="playerName">${escapeHtml(p.name)}</td>
      <td>${p.wr.toFixed(1)}%</td>
      <td class="statStrong">${Math.round(p.elo)}</td>
      <td class="statStrong">${p.games}</td>
      <td>${p.wins}</td>
      <td>${p.losses}</td>
      <td>${leaderMiniCardHtml(p.topPlayed, "games")}</td>
      <td>${leaderMiniCardHtml(p.topWr, "wr")}</td>
    </tr>
  `).join("")

  summaryBody.innerHTML = `
    <div class="teamHighlight">
      <div class="teamHighlightTop">Jugador destacado del equipo</div>
      <h4 class="teamHighlightName">${escapeHtml(top.name)}</h4>
      <p class="teamHighlightSub">Mejor WR con volumen de partidas en el filtro actual</p>
        <div class="teamKpis">
          <div class="teamKpi"><div class="teamKpiLabel">Partidas</div><div class="teamKpiValue">${top.games}</div></div>
          <div class="teamKpi"><div class="teamKpiLabel">Winrate</div><div class="teamKpiValue">${top.wr.toFixed(1)}%</div></div>
          <div class="teamKpi"><div class="teamKpiLabel">ELO</div><div class="teamKpiValue">${Math.round(top.elo)}</div></div>
          <div class="teamKpi"><div class="teamKpiLabel">Victorias</div><div class="teamKpiValue">${top.wins}</div></div>
          <div class="teamKpi"><div class="teamKpiLabel">Derrotas</div><div class="teamKpiValue">${top.losses}</div></div>
        </div>
    </div>

    <div class="teamRankWrap">
      <table class="teamRankTable">
        <thead>
          <tr>
            <th>#</th>
            <th>Jugador</th>
            <th>WR</th>
            <th>ELO</th>
            <th>Partidas</th>
            <th>Victorias</th>
            <th>Derrotas</th>
            <th>Lider mas jugado</th>
            <th>Lider con mayor WR</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `
}

function renderEmpty(text) {
  summaryBody.innerHTML = `<div class="teamHighlight"><p class="teamHighlightSub">${escapeHtml(text)}</p></div>`
}

function leaderMiniCardHtml(leader, metric) {
  if (!leader) return "-"

  const meta = metric === "games"
    ? `${leader.games} partidas`
    : `${leader.games > 0 ? ((leader.wins / leader.games) * 100).toFixed(1) : "0.0"}% WR`

  const img = leader.imageUrl
    ? `
      <span class="teamLeaderZoom">
        <img src="${escapeHtml(leader.imageUrl)}" alt="${escapeHtml(leader.name || "Lider")}" />
        <span class="teamLeaderZoomPreview">
          <img src="${escapeHtml(leader.imageUrl)}" alt="${escapeHtml(leader.name || "Lider")} ampliado" />
        </span>
      </span>
    `
    : `<div class="leaderMiniFallback">-</div>`

  return `
    <div class="teamLeaderCell">
      ${img}
      <span>${escapeHtml(meta)}</span>
    </div>
  `
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

expansionSelect.addEventListener("change", () => {
  renderTeamSummary(applyExpansionFilter(allMatches))
})

;(async function bootstrap() {
  setLoading(true, "Cargando estadisticas de equipo...")
  try {
    await init()
  } catch (err) {
    console.error("team stats init:", err)
    renderEmpty("Error cargando estadisticas de equipo.")
  } finally {
    setLoading(false)
  }
})()
