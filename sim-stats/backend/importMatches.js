import fetch from 'node-fetch'
import { supabase } from './supabase.js'

function normalizePlayerName(value) {
  const cleaned = String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase()

  if (!cleaned) return ''
  return cleaned.split('#')[0].trim()
}

export async function importMatches() {
  console.log('Iniciando importacion...')

  const { data: overrides, error: overrideError } = await supabase
    .from('sim_player_name_overrides')
    .select('player_id, expected_player_name, enabled')
    .eq('enabled', true)

  if (overrideError) {
    console.error('Error obteniendo overrides:', overrideError)
    return
  }

  const overrideByPlayerId = new Map(
    (overrides || []).map((row) => [
      row.player_id,
      normalizePlayerName(row.expected_player_name)
    ])
  )

  const { data: devices, error: deviceError } = await supabase
    .from('devices')
    .select('device_id, player_id')

  if (deviceError) {
    console.error('Error obteniendo devices:', deviceError)
    return
  }

  for (const device of devices) {
    const { device_id, player_id } = device
    const expectedPlayerName = overrideByPlayerId.get(player_id) || null

    console.log(`Importando device: ${device_id}`)

    try {
      const response = await fetch(
        `https://api.cardkaizoku.com/matches?deviceId=${device_id}`
      )

      const matches = await response.json()

      if (!Array.isArray(matches)) {
        console.log('No hay partidas o formato incorrecto')
        continue
      }

      const filteredMatches = expectedPlayerName
        ? matches.filter((m) => normalizePlayerName(m.playerName) === expectedPlayerName)
        : matches

      const formatted = filteredMatches.map((m) => ({
        player_id,
        device_id,
        player_name: String(m.playerName || '').trim() || null,
        player_leader: m.playerLeader,
        opponent_leader: m.oppLeader,
        result: m.result,
        match_date: new Date(m.date),
        turn_number: m.turnNumber,
        turn_order: m.turnOrder === 1 ? 1 : 2
      }))

      const uniqueMap = new Map()

      for (const match of formatted) {
        const key = `${match.device_id}_${match.match_date.toISOString()}_${match.opponent_leader}_${match.result}_${match.turn_order}`
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, match)
        }
      }

      const uniqueMatches = Array.from(uniqueMap.values())

      const { error: deleteError } = await supabase
        .from('matches')
        .delete()
        .eq('player_id', player_id)
        .eq('device_id', device_id)

      if (deleteError) {
        console.error('Error limpiando partidas previas:', deleteError)
        continue
      }

      if (uniqueMatches.length === 0) {
        console.log(
          expectedPlayerName
            ? `Device ${device_id} sin partidas para override ${expectedPlayerName}`
            : `Device ${device_id} sin partidas tras limpiar duplicados`
        )
        continue
      }

      const { error: insertError } = await supabase
        .from('matches')
        .insert(uniqueMatches)

      if (insertError) {
        console.error('Error insertando partidas:', insertError)
      } else {
        console.log(
          expectedPlayerName
            ? `Device ${device_id} importado con filtro ${expectedPlayerName}`
            : `Device ${device_id} importado`
        )
      }
    } catch (err) {
      console.error('Error llamando a la API:', err)
    }
  }

  console.log('Importacion finalizada')
}
