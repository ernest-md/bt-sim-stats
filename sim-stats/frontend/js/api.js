import { supabase } from './supabaseClient.js'

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
  const { data, error } = await supabase
    .from("matches")
    .select(`
      *,
      player:leaders!matches_player_leader_fkey (
        code,
        name,
        image_url,
        color_primary,
        color_secondary
      ),
      opponent:leaders!matches_opponent_leader_fkey (
        code,
        name,
        image_url
      )
    `)
    .eq("player_id", playerId);

  if (error) {
    console.error("Error cargando matches:", error);
    return [];
  }

  return data;
}

export async function getMatchesByPlayers(playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return [];

  const { data, error } = await supabase
    .from("matches")
    .select(`
      player_id,
      result,
      match_date,
      player:leaders!matches_player_leader_fkey (
        code,
        name,
        image_url
      )
    `)
    .in("player_id", playerIds);

  if (error) {
    console.error("Error cargando matches por jugadores:", error);
    return [];
  }

  return data;
}

export async function getViewerStatsContext() {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id || null
  if (!userId) return { userId: null, role: "user", team: "SIN EQUIPO" }

  const { data, error } = await supabase
    .from("profiles")
    .select("app_role, team")
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    console.error("Error cargando contexto de usuario stats:", error)
    return { userId, role: "user", team: "SIN EQUIPO" }
  }

  return {
    userId,
    role: data?.app_role || "user",
    team: data?.team || "SIN EQUIPO"
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

  if (role === "admin" || role === "staff") {
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
