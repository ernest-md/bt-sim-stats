import { supabase } from './supabaseClient.js'

const MATCHES_PAGE_SIZE = 1000
const MATCHES_MAX_ROWS = 20000

export async function getPlayers() {
  const { data, error } = await supabase
    .from('players')
    .select('id, name')
    .order('name')

  if (error) {
    console.error('Error cargando jugadores:', error)
    return []
  }

  return data
}

export async function getExpansions() {
  const { data, error } = await supabase
    .from('expansions')
    .select('*')
    .order('start_date')

  if (error) {
    console.error('Error cargando expansiones:', error)
    return []
  }

  return data
}

export async function getMatchesByPlayer(playerId) {
  const rows = []
  for (let from = 0; from < MATCHES_MAX_ROWS; from += MATCHES_PAGE_SIZE) {
    const to = from + MATCHES_PAGE_SIZE - 1
    const { data, error } = await supabase
      .from("matches")
      .select(`
        *,
        player:leaders!matches_player_leader_fkey (
          code,
          name,
          image_url,
          parallel_image_url,
          color_primary,
          color_secondary
        ),
        opponent:leaders!matches_opponent_leader_fkey (
          code,
          name,
          image_url,
          parallel_image_url
        )
      `)
      .eq("player_id", playerId)
      .order("match_date", { ascending: false })
      .range(from, to)

    if (error) {
      console.error("Error cargando matches:", error)
      return []
    }

    const batch = Array.isArray(data) ? data : []
    rows.push(...batch)
    if (batch.length < MATCHES_PAGE_SIZE) break
  }

  return rows
}

export async function getMatchesByPlayers(playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return []

  const rows = []
  for (let from = 0; from < MATCHES_MAX_ROWS; from += MATCHES_PAGE_SIZE) {
    const to = from + MATCHES_PAGE_SIZE - 1
    const { data, error } = await supabase
      .from("matches")
      .select(`
        player_id,
        result,
        match_date,
        player:leaders!matches_player_leader_fkey (
          code,
          name,
          image_url,
          parallel_image_url
        )
      `)
      .in("player_id", playerIds)
      .order("match_date", { ascending: false })
      .range(from, to)

    if (error) {
      console.error("Error cargando matches por jugadores:", error)
      return []
    }

    const batch = Array.isArray(data) ? data : []
    rows.push(...batch)
    if (batch.length < MATCHES_PAGE_SIZE) break
  }

  return rows
}

export async function getTeamStatsMatches(team, startAt = null, endAt = null) {
  const safeTeam = String(team || "").trim()
  if (!safeTeam) return []

  const rows = []
  for (let from = 0; from < MATCHES_MAX_ROWS; from += MATCHES_PAGE_SIZE) {
    const to = from + MATCHES_PAGE_SIZE - 1
    const { data, error } = await supabase
      .rpc("get_team_stats_matches_v1", {
        p_team: safeTeam,
        p_start_at: startAt,
        p_end_at: endAt
      })
      .range(from, to)

    if (error) {
      console.error("Error cargando matches de team stats por RPC:", error)
      return []
    }

    const batch = Array.isArray(data) ? data : []
    rows.push(...batch)
    if (batch.length < MATCHES_PAGE_SIZE) break
  }

  return rows.map((row) => ({
    id: row.match_id,
    player_id: row.player_id,
    profile_id: row.profile_id,
    player_name: row.player_name,
    profile_username: row.profile_username,
    profile_display_name: row.profile_display_name,
    profile_team: row.profile_team,
    player_leader: row.player_leader,
    opponent_leader: row.opponent_leader,
    result: row.result,
    match_date: row.match_date,
    turn_order: row.turn_order,
    player: {
      code: row.player_leader_code,
      name: row.player_leader_name,
      image_url: row.player_leader_image_url,
      parallel_image_url: row.player_leader_parallel_image_url
    },
    opponent: {
      code: row.opponent_leader_code,
      name: row.opponent_leader_name,
      image_url: row.opponent_leader_image_url,
      parallel_image_url: row.opponent_leader_parallel_image_url
    }
  }))
}

export async function getPlayerEloHistory(playerId) {
  if (!playerId) return [];

  const { data, error } = await supabase
    .from("player_elo_history")
    .select("snapshot_date, captured_at, games, wins, losses, winrate, wilson_score, elo_visual")
    .eq("player_id", playerId)
    .order("snapshot_date", { ascending: true });

  if (error) {
    console.error("Error cargando historial ELO:", error);
    return [];
  }

  return data || [];
}

export async function getViewerStatsContext() {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id || null
  if (!userId) return { userId: null, role: "user", team: "SIN EQUIPO", username: "", displayName: "" }

  const { data, error } = await supabase
    .from("profiles")
    .select("app_role, team, username, display_name")
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    console.error("Error cargando contexto de usuario stats:", error)
    return { userId, role: "user", team: "SIN EQUIPO", username: "", displayName: "" }
  }

  const normalizeRoleView = window.BarateamApp?.normalizeRoleView || ((value) => String(value || "").trim().toLowerCase() || "user")
  const canUseRoleViewSwitch = window.BarateamApp?.canUseRoleViewSwitch || (() => false)
  const getStoredRoleView = window.BarateamApp?.getStoredRoleView || (() => "")
  const overrideRole = canUseRoleViewSwitch(data || null, session?.user || null) ? getStoredRoleView(userId) : ""
  const effectiveRole = overrideRole || data?.app_role || "user"

  return {
    userId,
    role: normalizeRoleView(effectiveRole),
    actualRole: normalizeRoleView(data?.app_role || "user"),
    roleView: overrideRole ? normalizeRoleView(overrideRole) : "",
    team: data?.team || "SIN EQUIPO",
    username: data?.username || "",
    displayName: data?.display_name || ""
  }
}

export async function getPlayersForStats() {
  const viewer = await getViewerStatsContext()
  const { userId, role, team } = viewer

  const { data, error } = await supabase
    .from("players")
    .select(`
      id,
      name,
      profile_id,
      owner:profiles!players_profile_id_fkey (
        team
      )
    `)
    .order("name")

  if (error) {
    console.error("Error cargando jugadores para stats:", error)
    return []
  }

  if (role === "admin" || role === "staff" || role === "vdj") {
    return data.map((p) => ({ id: p.id, name: p.name, profile_id: p.profile_id || null }))
  }

  const sameTeamPlayers = data.filter((p) => {
    const ownerTeam = p?.owner?.team || "SIN EQUIPO"
    if (team === "SIN EQUIPO") return p.profile_id === userId
    return ownerTeam === team || p.profile_id === userId
  })

  return sameTeamPlayers.map((p) => ({ id: p.id, name: p.name, profile_id: p.profile_id || null }))
}

export async function getPlayersForTeamOnly() {
  const viewer = await getViewerStatsContext()
  const team = viewer?.team || "SIN EQUIPO"

  const { data, error } = await supabase
    .from("players")
    .select(`
      id,
      name,
      profile_id,
      owner:profiles!players_profile_id_fkey (
        team
      )
    `)
    .order("name")

  if (error) {
    console.error("Error cargando jugadores por equipo:", error)
    return []
  }

  const filtered = data.filter((p) => {
    const ownerTeam = p?.owner?.team || "SIN EQUIPO"
    return ownerTeam === team
  })

  return filtered.map((p) => ({ id: p.id, name: p.name }))
}

export async function getPlayersForSpecificTeam(team) {
  const safeTeam = String(team || "").trim()
  if (!safeTeam) return []

  const { data, error } = await supabase
    .from("players")
    .select(`
      id,
      name,
      profile_id,
      owner:profiles!players_profile_id_fkey (
        team
      )
    `)
    .order("name")

  if (error) {
    console.error("Error cargando jugadores por equipo seleccionado:", error)
    return []
  }

  return data
    .filter((p) => (p?.owner?.team || "SIN EQUIPO") === safeTeam)
    .map((p) => ({ id: p.id, name: p.name }))
}

export async function getAvailableTeamsForStats() {
  const { data, error } = await supabase
    .from("profiles")
    .select("team")
    .not("team", "is", null)

  if (error) {
    console.error("Error cargando equipos para stats:", error)
    return []
  }

  return Array.from(
    new Set(
      (data || [])
        .map((row) => String(row?.team || "").trim())
        .filter((team) => team && team !== "SIN EQUIPO")
    )
  ).sort((a, b) => a.localeCompare(b, "es"))
}
