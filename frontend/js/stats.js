import { getPlayers, getMatchesByPlayer, getExpansions } from './api.js'
import { supabase } from './supabaseClient.js'

const playerSelect = document.getElementById("playerSelect")
const expansionSelect = document.getElementById("expansionSelect")
const syncButton = document.getElementById("syncMatchesBtn")
const summaryView = document.getElementById("summaryView")
const leaderView = document.getElementById("leaderView")
const backButton = document.getElementById("backToSummary")

let allMatches = []
let allExpansions = []
let currentFilteredMatches = []
let selectedLeaderCode = null

/* ================= INIT ================= */


async function init() {

  const players = await getPlayers()

  players.forEach(player => {
    const option = document.createElement("option")
    option.value = player.id
    option.textContent = player.name
    playerSelect.appendChild(option)
  })

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

  if (players.length > 0) {
    await loadPlayer(players[0].id)
  }
}

/* ================= LOAD PLAYER ================= */

async function loadPlayer(playerId) {
  allMatches = await getMatchesByPlayer(playerId)
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

  buildLeaderStats(filteredMatches)
  buildGlobalMatchups(filteredMatches)
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
        image: m.player.image_url,
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
        image: m.opponent.image_url,
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
          <img src="${fav.image}">
          <span class="${fav.wr >= 50 ? 'wr-positive' : 'wr-negative'}">
            ${fav.wr.toFixed(1)}%
          </span>
        </div>
      `

      desfHtml = `
        <div class="miniMatchup">
          <img src="${desf.image}">
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
      <td><img src="${data.image}" width="45"></td>
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
        image: m.opponent.image_url,
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
        <img src="${item.image}">
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
        <img src="${item.image}">
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
  <img src="${leaderInfo.image_url}" class="leaderImage">
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
        <td><img src="${m.info.image_url}" width="60"></td>
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

  statusDiv.textContent = "Cargando partidas..."
  statusDiv.className = "sync-status sync-loading"

  try {

    const res = await fetch("https://ceunhkqhskwnsoqyunze.supabase.co/functions/v1/sync-matches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldW5oa3Foc2t3bnNvcXl1bnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDQ0ODcsImV4cCI6MjA4ODAyMDQ4N30.qBGXYYQXlyQwFGeyaeMOtLPHrjBy-eU05AO37yLvi5o",
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldW5oa3Foc2t3bnNvcXl1bnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDQ0ODcsImV4cCI6MjA4ODAyMDQ4N30.qBGXYYQXlyQwFGeyaeMOtLPHrjBy-eU05AO37yLvi5o"
      },
      body: JSON.stringify({ playerId })
    })

    const data = await res.json()

    if (data.inserted > 0) {
      statusDiv.textContent = `Se han añadido ${data.inserted} partidas nuevas`
      statusDiv.className = "sync-status sync-success"
    } else {
      statusDiv.textContent = "No se han encontrado partidas nuevas"
      statusDiv.className = "sync-status sync-info"
    }

  } catch (err) {

    statusDiv.textContent = "Error al sincronizar partidas"
    statusDiv.className = "sync-status sync-error"

  }
}


init()