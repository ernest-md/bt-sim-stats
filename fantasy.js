(() => {
  const App = window.BarateamApp;
  if (!App) return;

  const sb = App.createClient();
  const readSb = App.createClient({
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'barateam-fantasy-public'
    }
  });
  window.__barateamLastSupabaseClient = sb;
  const $ = App.byId;
  const escapeHtml = App.escapeHtml;
  const escapeAttr = App.escapeAttr;
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const intFmt = new Intl.NumberFormat('es-ES');
  const decFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const CURRENT_SEASON = 'OP15';
  const SHEET_ID = '1bRu9xDWAO8vBLF2GkzmsGL2M4P3AqczkDCXl6t-coFo';
  const PORTRAITS = window.BarateamFantasyPortraits || {};
  const PORTRAIT_PLACEHOLDER = String(window.BarateamFantasyPortraitPlaceholder || 'fantasy_placeholder.jpeg').trim();
  const COIN_ICON = 'fantasy_coin.png';
  const DEFAULT_BUDGET = 40;
  const DEFAULT_SQUAD_SIZE = 5;
  const DEFAULT_STARTER_SIZE = 5;
  const MAX_WEEKLY_TRANSFERS = 2;
  const MAX_WEEKLY_CAPTAIN_CHANGES = 1;
  const MAX_SAVINGS = 60;
  const MAX_MARKET_CARDS = 60;
  const MIN_PLAYER_PRICE = 4;
  const MAX_PLAYER_PRICE = 14;
  const PLAYER_PRICE_BASE = 4;
  const PLAYER_PRICE_AVG_MULT = 0.5;
  const PLAYER_PRICE_WIN_MULT = 2;

  App.bindProtectedNavLinks(sb, { skipGuard: true });
  const navController = App.initUserNav({
    supabase: sb,
    stopPropagationOnToggle: true,
    onLogout: async () => {
      await sb.auth.signOut();
      App.clearAccessStateCache();
      window.location.href = 'login.html';
    },
    formatLabel: (user) => (user?.email || 'Usuario').split('@')[0] || 'Usuario',
    formatEmail: (user) => user?.email || 'user'
  });

  function syncNavUser(user){
    const navLogin = $('navLogin');
    const navUser = $('navUser');
    const userEmail = $('userEmail');
    const userLabel = $('userLabel');
    const publicProfileLink = $('publicProfileLink');
    const avatarImg = $('navAvatarImg');
    const avatarFallback = $('navAvatarFallback');
    const initial = String((user?.email || 'Usuario').trim()).slice(0, 1).toUpperCase() || '?';
    const avatarUrl = String(state.currentProfile?.avatar_url || '').trim();
    if (navLogin) navLogin.style.display = user ? 'none' : 'inline-flex';
    if (navUser) navUser.style.display = user ? 'flex' : 'none';
    if (userEmail) userEmail.textContent = user?.email || '-';
    if (userLabel) userLabel.textContent = (user?.email || 'Usuario').split('@')[0] || 'Usuario';
    if (!user && navController?.closeMenu) navController.closeMenu();
    if (publicProfileLink){
      const username = String(state.currentProfile?.username || '').trim();
      const member = state.currentProfile?.member === true;
      const href = username ? `user.html?u=${encodeURIComponent(username)}` : (user?.id ? `user.html?id=${encodeURIComponent(user.id)}` : '');
      const visible = !!user && !!href && member;
      publicProfileLink.style.display = visible ? '' : 'none';
      if (visible) publicProfileLink.setAttribute('href', href);
      else publicProfileLink.removeAttribute('href');
    }
    if (avatarImg){
      avatarImg.onerror = () => {
        avatarImg.style.display = 'none';
        avatarImg.removeAttribute('src');
        if (avatarFallback){
          avatarFallback.style.display = 'flex';
          avatarFallback.textContent = user ? initial : '?';
        }
      };
      if (user && avatarUrl){
        avatarImg.src = avatarUrl;
        avatarImg.style.display = 'block';
      } else {
        avatarImg.style.display = 'none';
        avatarImg.removeAttribute('src');
      }
    }
    if (avatarFallback){
      const showFallback = !user || !avatarUrl;
      avatarFallback.style.display = showFallback ? 'flex' : 'none';
      avatarFallback.textContent = user ? initial : '?';
    }
  }

  const state = {
    currentUser: null,
    currentProfile: null,
    seasonConfig: null,
    poolPlayers: [],
    eventLabels: [],
    playersBySlug: new Map(),
    seasonTeams: [],
    seasonRoster: [],
    teamRounds: [],
    currentTeam: null,
    profilesById: new Map(),
    schemaReady: null,
    schemaMessage: '',
    loadingPlayers: false,
    loadingLeague: false,
    syncingRound: false,
    refreshPromise: null,
    currentRound: null,
    sheetRound: null,
    marketSearch: '',
    marketSort: 'weekly_desc',
    modalPlayerSlug: '',
    modalSource: '',
    confirmBuySlug: '',
    initialized: false
  };

  function showPageMsg(text, type){
    const box = $('pageMsg');
    if (!box) return;
    if (!text){ box.className = 'pageMsg'; box.textContent = ''; return; }
    box.className = `pageMsg ${type || ''}`.trim();
    box.textContent = text;
  }

  function setSchemaMessage(html){
    const box = $('schemaNote');
    if (!box) return;
    if (!html){ box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'block';
    box.innerHTML = html;
  }

  function setLoading(active, label){
    const overlay = $('loadingOverlay');
    const text = $('loadingLabel');
    if (text && label) text.textContent = label;
    if (!overlay) return;
    overlay.classList.toggle('hidden', !active);
    document.body.setAttribute('aria-busy', active ? 'true' : 'false');
  }

  function isSchemaError(error){
    const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
    return text.includes('fantasy_vbf') || text.includes('does not exist') || text.includes('schema cache') || text.includes('could not find the function') || text.includes('relation');
  }

  function markSchemaMissing(error){
    state.schemaReady = false;
    state.schemaMessage = error?.message || String(error || '');
    setSchemaMessage(`La capa fantasy de Supabase aun no esta activa. Ejecuta <code>fantasy-vbf-schema.sql</code> y recarga esta pagina.<br><span style="opacity:.88;">Detalle: ${escapeHtml(state.schemaMessage)}</span>`);
  }

  function clamp(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  function isAuthLockError(error){
    return String(error?.message || error || '').toLowerCase().includes('stole it');
  }

  async function sleep(ms){
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function withTimeout(promise, label, timeoutMs){
    const ms = Number(timeoutMs || 10000);
    let timer = null;
    try{
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = window.setTimeout(() => reject(new Error(`Timeout ${label || 'request'}`)), ms);
        })
      ]);
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  async function withAuthRetry(task){
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1){
      try{
        return await task();
      } catch (error){
        lastError = error;
        if (!isAuthLockError(error) || attempt === 2) throw error;
        await sleep(100 * (attempt + 1));
      }
    }
    throw lastError;
  }

  async function rpcWithTimeout(name, args, label, timeoutMs){
    return withTimeout(withAuthRetry(() => sb.rpc(name, args || {})), label || name, timeoutMs || 12000);
  }

  function formatCoins(value){
    return `${intFmt.format(Math.round(Number(value || 0)))} baracoins`;
  }

  function formatPoints(value){
    return decFmt.format(Number(value || 0));
  }

  function formatPointsLabel(value){
    return `${formatPoints(value)} pts`;
  }

  function renderCoinInline(value, compact){
    const amount = intFmt.format(Math.round(Number(value || 0)));
    const variant = compact === 'large' ? ' large' : compact ? ' compact' : '';
    return `<span class="coinInline${variant}"><img class="coinIcon${variant}" src="${escapeAttr(COIN_ICON)}" alt="" aria-hidden="true" /><span class="coinValue">${amount}</span></span>`;
  }

  function getSheetUrl(force){
    const stamp = force ? `&cacheBust=${Date.now()}` : '';
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(CURRENT_SEASON)}${stamp}`;
  }

  function parseGviz(text){
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Respuesta GViz invalida');
    const json = JSON.parse(text.slice(start, end + 1));
    const table = json?.table;
    if (!table || !Array.isArray(table.cols) || !Array.isArray(table.rows)) throw new Error('Formato GViz inesperado');
    return {
      rows: table.rows.map((row) => (row?.c || []).map((cell) => {
        const value = cell?.v;
        if (value == null) return '';
        if (typeof value === 'number') return value;
        return String(value).trim();
      }))
    };
  }

  function normalizeTable(rows){
    let maxCols = 0;
    rows.forEach((row) => { maxCols = Math.max(maxCols, row.length); });
    const padded = rows.map((row) => {
      const next = row.slice();
      while (next.length < maxCols) next.push('');
      return next;
    });
    const nonEmpty = padded.filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
    if (!nonEmpty.length) return [];
    const keep = [];
    for (let col = 0; col < maxCols; col += 1){
      if (nonEmpty.some((row) => String(row[col] || '').trim() !== '')) keep.push(col);
    }
    return nonEmpty.map((row) => keep.map((col) => row[col]));
  }

  function getNumber(value){
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = String(value || '').trim().replace(',', '.');
    if (!text) return NaN;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function serialDateToLabel(serial){
    const number = Number(serial);
    if (!Number.isFinite(number) || number < 30000) return String(serial || '');
    const ms = Math.round((number - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    const day = String(dt.getUTCDate());
    const month = dt.toLocaleString('es-ES', { month: 'short', timeZone: 'UTC' }).replace('.', '');
    return `${day}-${month}`;
  }

  function computeStreak(values){
    let best = 0;
    let current = 0;
    values.forEach((value) => {
      if (Number.isFinite(value) && value > 0){ current += 1; best = Math.max(best, current); }
      else current = 0;
    });
    return best;
  }

  function computeCurrentStreak(values){
    let streak = 0;
    for (let index = values.length - 1; index >= 0; index -= 1){
      const value = values[index];
      if (Number.isFinite(value) && value > 0) streak += 1;
      else break;
    }
    return streak;
  }

  function slugifyPlayerName(value){
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizePortraitKey(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function initials(name){
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
  }

  function placeholderGlyph(name){
    const first = String(name || '').trim().slice(0, 1).toUpperCase();
    return first || '?';
  }

  function tierClass(tier){
    const key = String(tier || '').trim().toLowerCase();
    if (key === 'pirate king') return 'tier-king';
    if (key === 'yonkou') return 'tier-yonkou';
    if (key === 'shichibukai') return 'tier-shichibukai';
    if (key === 'supernova') return 'tier-supernova';
    return 'tier-piratilla';
  }

  function frameClass(tier){
    const key = String(tier || '').trim().toLowerCase();
    if (key === 'pirate king') return 'frame-king';
    if (key === 'yonkou') return 'frame-yonkou';
    if (key === 'shichibukai') return 'frame-shichibukai';
    if (key === 'supernova') return 'frame-supernova';
    return 'frame-piratilla';
  }

  function tierLabel(tier){
    const text = String(tier || '').trim();
    return text || 'Piratilla';
  }

  function playerPortraitUrl(player){
    const rawName = String(player?.name || '').trim();
    const baseName = rawName.replace(/\([^)]*\)/g, ' ').trim();
    const firstWord = baseName.split(/\s+/).filter(Boolean)[0] || '';
    const keys = [
      normalizePortraitKey(player?.slug),
      normalizePortraitKey(rawName),
      normalizePortraitKey(baseName),
      normalizePortraitKey(firstWord)
    ].filter(Boolean);
    for (const key of keys){
      const url = String(PORTRAITS[key] || '').trim();
      if (url) return url;
    }
    return String(PORTRAIT_PLACEHOLDER || '').trim();
  }

  function weeklyRewardBonus(rank, totalTeams){
    const total = Math.max(0, Number(totalTeams || 0));
    if (rank === 1) return 8;
    if (rank === 2) return 6;
    if (rank === 3) return 5;
    if (rank <= Math.min(10, total || 10)) return 4;
    if (rank <= Math.ceil(total / 2)) return 2;
    return 1;
  }

  function readCurrentUserLabel(){
    const profile = state.currentProfile || {};
    const fallback = (state.currentUser?.email || '').split('@')[0] || 'Mi equipo';
    return profile.display_name || profile.username || fallback || 'Mi equipo';
  }

  function renderPlayerVisual(player, overlayHtml){
    const tier = escapeHtml(player.tier || 'Sin tier');
    const portraitUrl = playerPortraitUrl(player);
    return `<div class="playerVisual ${tierClass(player.tier)} ${portraitUrl ? 'has-photo' : ''}">${portraitUrl ? `<img class="playerPhoto" src="${escapeAttr(portraitUrl)}" alt="${escapeAttr(player.name || 'Jugador')}" loading="lazy" decoding="async" />` : ''}${portraitUrl ? '<div class="playerPhotoShade"></div>' : ''}<div class="playerArtFallback"></div>${overlayHtml ? `<div class="playerOverlay">${overlayHtml}</div>` : ''}</div>`;
  }

  function teamEntryBySlug(playerSlug){
    if (!state.currentTeam) return null;
    return state.seasonRoster.find((row) => String(row.team_id) === String(state.currentTeam.id) && String(row.player_slug) === String(playerSlug || '')) || null;
  }

  function recentHistory(player){
    const labels = Array.isArray(state.eventLabels) ? state.eventLabels : [];
    const points = Array.isArray(player?.points) ? player.points : [];
    return labels.map((label, index) => {
      const raw = points[index];
      const rawValue = Number.isFinite(raw) ? raw : 0;
      return {
        label,
        fantasy: rawValue > 0 ? rawValue / 1000 : 0
      };
    }).filter((item) => item.label).slice(-6).reverse();
  }

  function chartSeries(player){
    const labels = Array.isArray(state.eventLabels) ? state.eventLabels : [];
    const points = Array.isArray(player?.points) ? player.points : [];
    return labels.map((label, index) => {
      const raw = points[index];
      const rawValue = Number.isFinite(raw) ? raw : null;
      const fantasy = rawValue && rawValue > 0 ? rawValue / 1000 : null;
      return { label, fantasy };
    }).filter((item) => item.label).slice(-8);
  }

  function renderHistoryChart(player){
    const series = chartSeries(player);
    if (!series.length) return '<div class="empty">Aun no hay historial para este jugador.</div>';
    const width = 620;
    const height = 220;
    const padX = 28;
    const padTop = 20;
    const padBottom = 30;
    const plotWidth = width - padX * 2;
    const plotHeight = height - padTop - padBottom;
    const numericValues = series.map((item) => item.fantasy).filter((value) => Number.isFinite(value));
    const maxValue = numericValues.length ? Math.max(...numericValues, 1) : 1;
    const stepX = series.length > 1 ? plotWidth / (series.length - 1) : 0;
    const yFor = (value) => padTop + (plotHeight - (Number(value || 0) / maxValue) * plotHeight);
    const xFor = (index) => padX + index * stepX;

    const segments = [];
    const bridges = [];
    let current = [];
    let lastPoint = null;
    series.forEach((item, index) => {
      if (Number.isFinite(item.fantasy)){
        const point = { index, value: item.fantasy };
        if (lastPoint && point.index - lastPoint.index > 1){
          bridges.push(`${xFor(lastPoint.index).toFixed(2)},${yFor(lastPoint.value).toFixed(2)} ${xFor(point.index).toFixed(2)},${yFor(point.value).toFixed(2)}`);
        }
        current.push(`${xFor(index).toFixed(2)},${yFor(item.fantasy).toFixed(2)}`);
        lastPoint = point;
      } else if (current.length){
        segments.push(current.join(' '));
        current = [];
      }
    });
    if (current.length) segments.push(current.join(' '));

    const gridValues = [0, maxValue / 2, maxValue];
    const pointsSvg = series.map((item, index) => {
      const x = xFor(index).toFixed(2);
      if (Number.isFinite(item.fantasy)){
        const y = yFor(item.fantasy).toFixed(2);
        const raw = Array.isArray(player?.points) ? player.points[index] : null;
        const title = `${item.label}: ${formatPointsLabel(item.fantasy)}${Number.isFinite(raw) ? ` · ${intFmt.format(Math.round(raw))} berries` : ''}`;
        return `<line class="chartStem" x1="${x}" y1="${height - padBottom}" x2="${x}" y2="${y}"></line><circle class="chartPoint" cx="${x}" cy="${y}" r="6"><title>${escapeHtml(title)}</title></circle>`;
      }
      return `<circle class="chartPoint miss" cx="${x}" cy="${yFor(0).toFixed(2)}" r="3.5"><title>${escapeHtml(`${item.label}: sin participacion`)}</title></circle>`;
    }).join('');

    const labelsSvg = series.map((item, index) => `<text x="${xFor(index).toFixed(2)}" y="${height - 8}" text-anchor="middle" font-size="10" font-weight="900" fill="#64748b">${escapeHtml(item.label)}</text>`).join('');
    const gridSvg = gridValues.map((value) => {
      const y = yFor(value).toFixed(2);
      return `<line class="chartGridLine" x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}"></line><text x="0" y="${Number(y) + 4}" font-size="10" font-weight="900" fill="#64748b">${formatPoints(value)}</text>`;
    }).join('');
    const bridgesSvg = bridges.map((points) => `<polyline class="chartBridge" points="${points}"></polyline>`).join('');
    const linesSvg = segments.map((points) => `<polyline class="chartLine" points="${points}"></polyline>`).join('');
    const lastPlayed = [...series].reverse().find((item) => Number.isFinite(item.fantasy));
    return `<div class="chartCard"><div class="chartMeta"><span>Linea temporal</span><strong>${lastPlayed ? `Ultimo registro ${formatPointsLabel(lastPlayed.fantasy)}` : 'Sin participaciones'}</strong></div><svg class="chartSvg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafica de puntos por torneo">${gridSvg}<line class="chartAxis" x1="${padX}" y1="${height - padBottom}" x2="${width - padX}" y2="${height - padBottom}"></line>${bridgesSvg}${linesSvg}${pointsSvg}${labelsSvg}</svg></div>`;
  }

  function buildPlayerPool(payload){
    const rows = normalizeTable(payload?.rows || []);
    if (!rows.length) return { players: [], currentRound: null, eventLabels: [] };
    const headerRow = rows[0] || [];
    const sourceRows = rows.slice(1).filter((row) => String(row[2] || '').trim() !== '');
    const eventIndexes = [];
    const eventLabels = [];
    for (let index = 3; index < headerRow.length; index += 1){
      eventIndexes.push(index);
      eventLabels.push(serialDateToLabel(headerRow[index]) || `T${index - 2}`);
    }

    const players = sourceRows.map((row) => {
      const name = String(row[2] || '').trim();
      const slug = slugifyPlayerName(name);
      const points = eventIndexes.map((idx) => {
        const number = getNumber(row[idx]);
        return Number.isFinite(number) ? number : null;
      });
      const totalPoints = points.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0);
      const played = points.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? 1 : 0), 0);
      return { tier: String(row[0] || '').trim(), name, slug, points, totalPoints, played, avgPoints: played ? totalPoints / played : 0, bestStreak: computeStreak(points), currentStreak: computeCurrentStreak(points), wins: 0, rank: 0, price: MIN_PLAYER_PRICE, avgFantasyPoints: 0, currentFantasyPoints: 0, currentRawPoints: 0, currentWon: false, isTop5: false, isTop10: false };
    }).filter((player) => player.slug && player.name);

    const eventMax = eventIndexes.map((_, eventPos) => {
      let max = 0;
      players.forEach((player) => {
        const value = player.points[eventPos];
        if (Number.isFinite(value) && value > max) max = value;
      });
      return max;
    });

    players.forEach((player) => {
      let wins = 0;
      player.points.forEach((value, eventPos) => {
        if (Number.isFinite(value) && value > 0 && eventMax[eventPos] > 0 && value === eventMax[eventPos]) wins += 1;
      });
      player.wins = wins;
      player.avgFantasyPoints = player.avgPoints / 1000;
      player.price = clamp(
        Math.round(PLAYER_PRICE_BASE + player.avgFantasyPoints * PLAYER_PRICE_AVG_MULT + player.wins * PLAYER_PRICE_WIN_MULT),
        MIN_PLAYER_PRICE,
        MAX_PLAYER_PRICE
      );
    });

    players.sort((a, b) => b.totalPoints - a.totalPoints || b.avgPoints - a.avgPoints || collator.compare(a.name, b.name));
    players.forEach((player, index) => {
      player.rank = index + 1;
      player.isTop5 = index < 5;
      player.isTop10 = index < 10;
    });

    let currentRound = null;
    if (eventIndexes.length){
      const roundIndex = eventIndexes.length - 1;
      currentRound = { key: `${CURRENT_SEASON}:R${roundIndex + 1}`, label: eventLabels[roundIndex] || `T${roundIndex + 1}`, order: roundIndex + 1 };
      players.forEach((player) => {
        const rawPoints = player.points[roundIndex];
        const score = Number.isFinite(rawPoints) && rawPoints > 0 ? rawPoints : 0;
        const won = score > 0 && score === eventMax[roundIndex];
        const streakBonus = player.currentStreak >= 5 ? 5 : player.currentStreak >= 3 ? 2 : 0;
        player.currentRawPoints = score;
        player.currentWon = won;
        player.currentFantasyPoints = score > 0 ? (score / 1000) + (won ? 10 : 0) + streakBonus : 0;
      });
    }

    return { players, currentRound, eventLabels };
  }

  async function loadCurrentProfile(user){
    if (!user?.id){ state.currentProfile = null; return null; }
    try{
      const { data, error } = await withTimeout(readSb.from('profiles').select('id,username,display_name,avatar_url,member').eq('id', user.id).maybeSingle(), 'perfil actual');
      if (error) throw error;
      state.currentProfile = data || null;
    } catch (_error){
      state.currentProfile = null;
    }
    syncNavUser(state.currentUser);
    return state.currentProfile;
  }

  async function refreshSession(){
    syncNavUser(state.currentUser);
    await loadCurrentProfile(state.currentUser);
    return state.currentUser;
  }

  async function safeRefreshSession(){
    try{
      await refreshSession();
    } catch (_error){
      if (!state.currentUser) state.currentProfile = null;
      syncNavUser(state.currentUser);
    }
  }

  async function loadSeasonConfig(){
    try{
      const { data, error } = await withTimeout(readSb.from('fantasy_vbf_seasons').select('*').eq('season', CURRENT_SEASON).maybeSingle(), 'config fantasy');
      if (error) throw error;
      state.schemaReady = true;
      state.schemaMessage = '';
      setSchemaMessage('');
      state.seasonConfig = data || {};
      if (!state.currentRound && data?.current_round_key){
        state.currentRound = { key: data.current_round_key, label: data.current_round_label || data.current_round_key, order: Number(data.current_round_order || 0) };
      }
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      else console.warn('fantasy loadSeasonConfig:', error?.message || error);
      state.seasonConfig = { season: CURRENT_SEASON, label: `Fantasy ${CURRENT_SEASON}`, budget: DEFAULT_BUDGET, squad_size: DEFAULT_SQUAD_SIZE, starter_size: DEFAULT_STARTER_SIZE, max_weekly_transfers: MAX_WEEKLY_TRANSFERS, max_weekly_captain_changes: MAX_WEEKLY_CAPTAIN_CHANGES, max_savings: MAX_SAVINGS, captain_multiplier: 1.5, is_open: true };
      if (state.schemaReady == null) state.schemaReady = true;
    }
  }

  async function loadPlayerPool(force){
    state.loadingPlayers = true;
    renderHero();
    try{
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 12000);
      const response = await fetch(getSheetUrl(force), { cache: force ? 'no-store' : 'default', signal: controller.signal }).finally(() => window.clearTimeout(timer));
      if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
      const model = buildPlayerPool(parseGviz(await response.text()));
      state.poolPlayers = model.players;
      state.eventLabels = Array.isArray(model.eventLabels) ? model.eventLabels : [];
      state.playersBySlug = new Map(state.poolPlayers.map((player) => [player.slug, player]));
      state.sheetRound = model.currentRound || null;
      if (!state.currentRound?.key) state.currentRound = model.currentRound || state.currentRound;
    } catch (error){
      state.poolPlayers = [];
      state.eventLabels = [];
      state.playersBySlug = new Map();
      showPageMsg(`No pude cargar el sheet de ${CURRENT_SEASON}: ${error?.message || error}`, 'err');
    } finally {
      state.loadingPlayers = false;
      renderAll();
    }
  }

  async function loadProfiles(userIds){
    const ids = Array.from(new Set((userIds || []).filter(Boolean)));
    state.profilesById = new Map();
    if (!ids.length) return;
    const { data, error } = await withTimeout(readSb.from('profiles').select('id,username,display_name,avatar_url,member').in('id', ids), 'perfiles fantasy');
    if (error) return;
    (data || []).forEach((profile) => state.profilesById.set(String(profile.id), profile));
  }

  async function loadLeagueContext(){
    state.seasonTeams = [];
    state.seasonRoster = [];
    state.teamRounds = [];
    state.currentTeam = null;
    if (state.schemaReady === false){ renderAll(); return; }
    state.loadingLeague = true;
    renderAll();
    try{
      const teamsRes = await withTimeout(readSb.from('fantasy_vbf_teams').select('id,season,user_id,team_name,coins,captain_player_slug,total_points,created_at').eq('season', CURRENT_SEASON).order('created_at', { ascending: true }), 'equipos fantasy');
      const rosterRes = await withTimeout(readSb.from('fantasy_vbf_roster_players').select('id,season,team_id,user_id,player_slug,player_name,player_tier,player_rank,buy_price,created_at').eq('season', CURRENT_SEASON).order('created_at', { ascending: true }), 'plantillas fantasy');
      const roundsRes = await withTimeout(readSb.from('fantasy_vbf_team_rounds').select('*').eq('season', CURRENT_SEASON).order('round_order', { ascending: true }), 'jornadas fantasy');
      if (teamsRes.error) throw teamsRes.error;
      if (rosterRes.error) throw rosterRes.error;
      if (roundsRes.error) throw roundsRes.error;
      state.seasonTeams = Array.isArray(teamsRes.data) ? teamsRes.data : [];
      state.seasonRoster = Array.isArray(rosterRes.data) ? rosterRes.data : [];
      state.teamRounds = Array.isArray(roundsRes.data) ? roundsRes.data : [];
      state.currentTeam = state.currentUser ? state.seasonTeams.find((team) => String(team.user_id) === String(state.currentUser.id)) || null : null;
      await loadProfiles(state.seasonTeams.map((team) => team.user_id));
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      else showPageMsg(`No pude cargar la liga fantasy: ${error?.message || error}`, 'err');
    } finally {
      state.loadingLeague = false;
      renderAll();
    }
  }

  function config(){
    const cfg = state.seasonConfig || {};
    return { season: cfg.season || CURRENT_SEASON, budget: Number(cfg.budget || DEFAULT_BUDGET), squadSize: Number(cfg.squad_size || DEFAULT_SQUAD_SIZE), starterSize: Number(cfg.starter_size || DEFAULT_STARTER_SIZE), maxWeeklyTransfers: Number(cfg.max_weekly_transfers || MAX_WEEKLY_TRANSFERS), maxWeeklyCaptainChanges: Number(cfg.max_weekly_captain_changes || MAX_WEEKLY_CAPTAIN_CHANGES), maxSavings: Number(cfg.max_savings || MAX_SAVINGS), captainMultiplier: Number(cfg.captain_multiplier || 1.5), isOpen: cfg.is_open !== false };
  }

  function profileNameForUser(userId){
    const profile = state.profilesById.get(String(userId)) || {};
    return profile.display_name || profile.username || String(userId || '').slice(0, 8) || 'Usuario';
  }

  function playerForRosterRow(row){
    const player = state.playersBySlug.get(String(row.player_slug || ''));
    if (player) return player;
    const rank = Number(row.player_rank || 9999);
    return { slug: row.player_slug, name: row.player_name || row.player_slug || 'Jugador', tier: row.player_tier || '', rank, price: Number(row.buy_price || 0), wins: 0, avgFantasyPoints: 0, currentFantasyPoints: 0, currentStreak: 0, isTop5: rank <= 5, isTop10: rank <= 10 };
  }

  function restrictionSnapshot(roster){
    return roster.reduce((acc, row) => {
      const rank = Number(playerForRosterRow(row).rank || row.player_rank || 9999);
      if (rank <= 5) acc.top5 += 1;
      if (rank <= 10) acc.top10 += 1;
      return acc;
    }, { top5: 0, top10: 0 });
  }

  function getTeamRound(teamId, roundKey){
    return state.teamRounds.find((row) => String(row.team_id) === String(teamId) && String(row.round_key) === String(roundKey || '')) || null;
  }

  function liveWeeklyPoints(roster, captainSlug){
    const captainMultiplier = config().captainMultiplier;
    let total = 0;
    roster.forEach((row) => {
      const player = playerForRosterRow(row);
      const value = Number(player.currentFantasyPoints || 0);
      total += value;
      if (String(row.player_slug) === String(captainSlug || '')) total += value * (captainMultiplier - 1);
    });
    return total;
  }

  function generalPoints(teamId, liveWeekly){
    const currentKey = state.currentRound?.key || '';
    const rows = state.teamRounds.filter((row) => String(row.team_id) === String(teamId));
    let total = rows.reduce((sum, row) => sum + Number(row.weekly_points || 0), 0);
    if (currentKey){
      const currentStored = rows.find((row) => String(row.round_key) === currentKey);
      total += liveWeekly - Number(currentStored?.weekly_points || 0);
    }
    return total;
  }

  function sortPlayers(a, b, mode){
    if (mode === 'price_desc') return (b.price || 0) - (a.price || 0) || collator.compare(a.name, b.name);
    if (mode === 'price_asc') return (a.price || 0) - (b.price || 0) || collator.compare(a.name, b.name);
    if (mode === 'avg_desc') return (b.avgFantasyPoints || 0) - (a.avgFantasyPoints || 0) || collator.compare(a.name, b.name);
    if (mode === 'wins_desc') return (b.wins || 0) - (a.wins || 0) || (b.totalPoints || 0) - (a.totalPoints || 0);
    if (mode === 'name_asc') return collator.compare(a.name, b.name);
    if (mode === 'general_desc') return (b.totalPoints || 0) - (a.totalPoints || 0) || collator.compare(a.name, b.name);
    return (b.currentFantasyPoints || 0) - (a.currentFantasyPoints || 0) || (b.totalPoints || 0) - (a.totalPoints || 0) || collator.compare(a.name, b.name);
  }

  function leagueDerived(){
    const cfg = config();
    const rosterByTeam = new Map();
    state.seasonRoster.forEach((row) => {
      const key = String(row.team_id);
      if (!rosterByTeam.has(key)) rosterByTeam.set(key, []);
      rosterByTeam.get(key).push(row);
    });

    const standings = state.seasonTeams.map((team) => {
      const roster = rosterByTeam.get(String(team.id)) || [];
      const captain = roster.some((row) => String(row.player_slug) === String(team.captain_player_slug || '')) ? String(team.captain_player_slug || '') : String(roster[0]?.player_slug || '');
      const weeklyPoints = liveWeeklyPoints(roster, captain);
      const coachName = profileNameForUser(team.user_id);
      const teamName = String(team.team_name || '').trim() || coachName || 'Equipo';
      const weeklyState = getTeamRound(team.id, state.currentRound?.key || '');
      return { id: String(team.id), userId: String(team.user_id), teamName, coachName, coins: Number(team.coins || 0), rosterCount: roster.length, captain, weeklyPoints, generalPoints: generalPoints(team.id, weeklyPoints), transfersUsed: Number(weeklyState?.transfers_used || 0) };
    }).sort((a, b) => b.weeklyPoints - a.weeklyPoints || b.generalPoints - a.generalPoints || collator.compare(a.teamName, b.teamName)).map((row, index) => ({ ...row, rank: index + 1 }));

    const myRoster = state.currentTeam ? (rosterByTeam.get(String(state.currentTeam.id)) || []) : [];
    const myCaptain = myRoster.some((row) => String(row.player_slug) === String(state.currentTeam?.captain_player_slug || '')) ? String(state.currentTeam.captain_player_slug) : String(myRoster[0]?.player_slug || '');
    const restrictions = restrictionSnapshot(myRoster);
    const squadCards = myRoster.map((row) => ({ ...row, player: playerForRosterRow(row), isCaptain: String(row.player_slug) === myCaptain })).sort((a, b) => Number(b.isCaptain) - Number(a.isCaptain) || (b.player.currentFantasyPoints || 0) - (a.player.currentFantasyPoints || 0) || collator.compare(a.player.name || '', b.player.name || ''));

    const marketPlayers = state.poolPlayers.filter((player) => {
      const query = state.marketSearch.trim().toLowerCase();
      return !query || player.name.toLowerCase().includes(query) || String(player.tier || '').toLowerCase().includes(query);
    }).sort((a, b) => sortPlayers(a, b, state.marketSort)).slice(0, MAX_MARKET_CARDS);

    return { standings, squadCards, marketPlayers, restrictions, myRoster, myCaptain };
  }

  function buyBlockReason(player, roster){
    const cfg = config();
    if (!state.currentUser) return 'Inicia sesion';
    if (!state.currentTeam) return 'Crea equipo';
    if (!cfg.isOpen) return 'Mercado cerrado';
    if (roster.some((row) => String(row.player_slug) === String(player.slug))) return 'Ya en plantilla';
    if (roster.length >= cfg.squadSize) return 'Plantilla completa';
    if (Number(state.currentTeam?.coins || 0) < Number(player.price || 0)) return 'Sin baracoins';
    const restrictions = restrictionSnapshot(roster);
    if (player.isTop5 && restrictions.top5 >= 1) return 'Max 1 top5';
    if (player.isTop10 && restrictions.top10 >= 2) return 'Max 2 top10';
    return '';
  }

  function renderHero(){
    $('statPlayers').textContent = state.loadingPlayers ? '...' : intFmt.format(state.poolPlayers.length);
    $('statTeams').textContent = state.loadingLeague ? '...' : intFmt.format(state.seasonTeams.length);
    $('statCurrentRound').textContent = state.loadingPlayers ? '...' : (state.currentRound?.label || '-');
  }

  function openPlayerModal(slug, source){
    state.modalPlayerSlug = String(slug || '').trim();
    state.modalSource = String(source || '').trim();
    renderPlayerModal();
  }

  function closePlayerModal(){
    state.modalPlayerSlug = '';
    state.modalSource = '';
    renderPlayerModal();
  }

  function openBuyConfirm(slug){
    state.confirmBuySlug = String(slug || '').trim();
    renderBuyConfirm();
  }

  function closeBuyConfirm(){
    state.confirmBuySlug = '';
    renderBuyConfirm();
  }

  function renderBuyConfirm(){
    const wrap = $('buyConfirmWrap');
    const text = $('buyConfirmText');
    const action = $('buyConfirmAccept');
    if (!wrap || !text || !action) return;
    if (!state.confirmBuySlug){
      wrap.classList.add('hidden');
      wrap.setAttribute('aria-hidden', 'true');
      if (!state.modalPlayerSlug) document.body.style.overflow = '';
      return;
    }
    const player = state.playersBySlug.get(state.confirmBuySlug);
    const blocked = player ? buyBlockReason(player, leagueDerived().myRoster) : 'Jugador invalido';
    text.innerHTML = player ? `Vas a comprar a <strong>${escapeHtml(player.name)}</strong> por ${renderCoinInline(player.price || 0, false)}.` : 'No pude encontrar el jugador seleccionado.';
    action.innerHTML = player ? `Comprar - ${renderCoinInline(player.price || 0, true)}` : 'Comprar';
    action.disabled = !!blocked;
    if (blocked) text.innerHTML = `${text.innerHTML} ${escapeHtml(blocked)}.`;
    wrap.classList.remove('hidden');
    wrap.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function renderPlayerModal(){
    const wrap = $('playerModalWrap');
    const body = $('playerModalBody');
    if (!wrap || !body) return;
    if (!state.modalPlayerSlug){
      wrap.classList.add('hidden');
      wrap.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      body.innerHTML = '';
      return;
    }
    const source = state.modalSource === 'team' ? 'team' : 'market';
    const rosterEntry = source === 'team' ? teamEntryBySlug(state.modalPlayerSlug) : null;
    const player = rosterEntry ? playerForRosterRow(rosterEntry) : state.playersBySlug.get(state.modalPlayerSlug);
    if (!player){
      closePlayerModal();
      return;
    }
    const history = recentHistory(player);
    const roster = leagueDerived().myRoster;
    const blocked = source === 'market' ? buyBlockReason(player, roster) : '';
    const isCaptain = !!rosterEntry && String(state.currentTeam?.captain_player_slug || '') === String(rosterEntry.player_slug || player.slug || '');
    const roundState = state.currentTeam ? getTeamRound(state.currentTeam.id, state.currentRound?.key || '') : null;
    const captainChangesUsed = Number(roundState?.captain_changes_used || 0);
    const captainChangesMax = config().maxWeeklyCaptainChanges;
    const currentPrice = source === 'team' ? Number(rosterEntry?.buy_price || player.price || 0) : Number(player.price || 0);
    const actionSlug = String(rosterEntry?.player_slug || player.slug || '');
    const modalOverlay = `<div class="playerOverlayBottom"><div class="overlayNamePlain">${escapeHtml(player.name)}</div><div class="overlaySubtitle">#${intFmt.format(player.rank || 0)} - ${escapeHtml(tierLabel(player.tier))}</div></div>`;
    const buyLabel = blocked || `Comprar - ${intFmt.format(player.price || 0)} baracoins`;
    const recentLabel = history.length ? escapeHtml(history[0].label) : 'Sin jornada';
    body.innerHTML = `<div class="modalVisual"><article class="playerCard ${frameClass(player.tier)}"><div class="playerHead">${renderPlayerVisual(player, modalOverlay)}</div></article></div><div class="modalPanel"><div><div class="modalEyebrow">${source === 'team' ? 'Tu plantilla' : 'Pool de jugadores'}</div><h3 class="modalTitle">${escapeHtml(player.name)}</h3><div class="modalSubtitle">#${intFmt.format(player.rank || 0)} - ${escapeHtml(tierLabel(player.tier))}</div></div><div class="modalStats"><div class="modalStat"><span>Precio actual</span><strong>${renderCoinInline(currentPrice, false)}</strong></div><div class="modalStat"><span>Ultima semana</span><strong>${formatPointsLabel(player.currentFantasyPoints || 0)}</strong></div><div class="modalStat"><span>Victorias</span><strong>${intFmt.format(player.wins || 0)}</strong></div><div class="modalStat"><span>Racha activa</span><strong>${intFmt.format(player.currentStreak || 0)}</strong></div><div class="modalStat"><span>Mejor racha</span><strong>${intFmt.format(player.bestStreak || 0)}</strong></div><div class="modalStat"><span>Torneos jugados</span><strong>${intFmt.format(player.played || 0)}</strong></div></div><div class="historyWrap"><div class="historyTitle">Progresion por torneo</div>${renderHistoryChart(player)}<div class="chartMeta"><span>Ultimo torneo</span><strong>${recentLabel}</strong></div></div><div class="modalActions">${source === 'team' ? `<div class="modalActionGroup"><button class="btn ${isCaptain ? 'btnPrimary' : ''}" type="button" data-modal-action="captain" data-player-slug="${escapeAttr(actionSlug)}" ${!isCaptain && captainChangesUsed >= captainChangesMax ? 'disabled' : ''} title="El capitan puntua x1.5 sobre su puntuacion final de la jornada.">${isCaptain ? 'Capitan activo' : 'Hacer capitan'}</button><div class="modalActionHint">${isCaptain ? 'Este jugador ya es tu capitan activo de la jornada.' : `El capitan puntua x1.5 sobre su puntuacion final de la jornada. Cambios usados: ${intFmt.format(captainChangesUsed)}/${intFmt.format(captainChangesMax)}.`}</div></div><button class="btn btnDanger" type="button" data-modal-action="sell" data-player-slug="${escapeAttr(actionSlug)}">Vender</button>` : `<button class="btn btnPrimary" type="button" data-modal-action="buy" data-player-slug="${escapeAttr(actionSlug)}" ${blocked ? 'disabled' : ''}>${blocked ? escapeHtml(buyLabel) : `Comprar - ${renderCoinInline(player.price || 0, true)}`}</button>`}</div></div>`;
    wrap.classList.remove('hidden');
    wrap.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function renderSeasonFacts(){
    const cfg = config();
    const facts = $('seasonFacts');
    const authHint = $('authHint');
    const title = $('teamCardTitle');
    const subtitle = $('teamCardSubtitle');
    const meta = $('teamCardMeta');
    if (title) title.textContent = state.currentTeam ? (state.currentTeam.team_name || 'Mi equipo') : 'Fantasy oficial OP15';
    if (subtitle){
      subtitle.textContent = state.currentTeam
        ? 'Tu equipo fantasy OP15. Ajusta la plantilla, revisa el ranking y gestiona la jornada desde aqui.'
        : 'Un solo equipo por manager, 40 baracoins iniciales, 5 jugadores y hasta 2 cambios por semana.';
    }
    if (meta){
      meta.innerHTML = state.currentTeam
        ? `<span class="pill teamCoinPill" title="Baracoins disponibles para fichajes y cambios de tu equipo.">${renderCoinInline(state.currentTeam.coins || 0, 'large')}</span>`
        : '';
    }
    if (facts){
      const showRulesStrip = !state.currentTeam;
      facts.classList.toggle('hidden', !showRulesStrip);
      facts.innerHTML = showRulesStrip ? `<div class="helper fantasyRulesStrip">Presupuesto inicial ${formatCoins(cfg.budget)}, plantilla de ${intFmt.format(cfg.squadSize)} jugadores, maximo ${intFmt.format(cfg.maxWeeklyTransfers)} cambios por jornada y ahorro cap de ${formatCoins(cfg.maxSavings)}.</div>` : '';
    }
    if (authHint){
      authHint.textContent = state.currentUser ? 'Tu sesion esta lista. Al entrar se refrescan jugadores, ranking y estado de tu equipo.' : 'Necesitas sesion para crear tu equipo, comprar jugadores, elegir capitan y sincronizar tu semana.';
      authHint.classList.toggle('hidden', !!state.currentTeam);
    }
  }

  function renderSetupPanel(){
    const host = $('teamSetupPanel');
    if (!host) return;
    const cfg = config();
    host.classList.remove('hidden');
    if (state.schemaReady === false){ host.innerHTML = '<div class="empty">Ejecuta <code>fantasy-vbf-schema.sql</code> en Supabase y recarga la pagina para activar el fantasy salary cap.</div>'; return; }
    if (state.loadingLeague){ host.innerHTML = '<div class="empty">Cargando estado del fantasy...</div>'; return; }
    if (!state.currentUser){
      host.innerHTML = '<div class="subPanelHead"><div><h3>Entra para crear tu equipo</h3><p>La tabla es publica, pero necesitas sesion para competir y sincronizar tu semana.</p></div><span class="pill">1 equipo por manager</span></div><div class="empty">Inicia sesion para registrar tu equipo OP15.</div>';
      return;
    }
    if (!state.currentTeam){
      const suggested = escapeAttr(readCurrentUserLabel());
      host.innerHTML = `<div class="subPanelHead"><div><h3>Crea tu equipo OP15</h3><p>Empiezas con ${formatCoins(cfg.budget)} y luego gestionas una plantilla fija de ${intFmt.format(cfg.squadSize)} jugadores.</p></div><span class="pill strong">Salary cap semanal</span></div><form class="miniForm" id="createTeamForm"><label class="control"><span>Nombre del equipo</span><input id="createTeamName" type="text" maxlength="60" placeholder="Ej: ${suggested}" value="${suggested}" autocomplete="off" /></label><button class="btn btnPrimary" type="submit" ${cfg.isOpen ? '' : 'disabled'}>${cfg.isOpen ? 'Crear equipo' : 'Mercado cerrado'}</button></form>`;
      return;
    }
    host.innerHTML = '';
    host.classList.add('hidden');
  }

  function renderStandings(){
    const wrap = $('standingsBoard');
    const empty = $('standingsEmpty');
    const meta = $('standingsMeta');
    if (!wrap || !empty || !meta) return;
    const derived = leagueDerived();
    meta.textContent = `${state.currentRound?.label || 'Sin jornada'} · ${derived.standings.length} equipos`;
    if (!derived.standings.length){ wrap.classList.add('hidden'); empty.classList.remove('hidden'); empty.textContent = 'Todavia no hay equipos inscritos en el fantasy.'; return; }
    empty.classList.add('hidden');
    wrap.classList.remove('hidden');
    wrap.innerHTML = derived.standings.map((row) => {
      const mine = state.currentUser && String(row.userId) === String(state.currentUser.id);
      const rankClass = row.rank === 1 ? 'top1' : row.rank === 2 ? 'top2' : row.rank === 3 ? 'top3' : '';
      return `<article class="standingRow ${mine ? 'isMine' : ''}"><div><span class="rankBadge ${rankClass}">#${row.rank}</span></div><div class="standingIdentity"><div class="standingIdentityTop"><strong>${escapeHtml(row.teamName)}</strong><span>Equipo fantasy</span></div><div class="standingIdentityBottom"><strong>${escapeHtml(row.coachName || 'Manager')}</strong><span>Manager</span></div></div><div class="standingStatsGrid"><div class="standingStatCard" title="Puntuacion de la jornada actual, basada en el ultimo torneo disponible del sheet."><span>Jornada</span><strong>${formatPointsLabel(row.weeklyPoints)}</strong></div><div class="standingStatCard" title="Suma de todas las jornadas fantasy cerradas hasta este momento."><span>Acumulado</span><strong>${formatPointsLabel(row.generalPoints)}</strong></div><div class="standingStatCard isCoins" title="Baracoins actuales disponibles en el equipo para fichar y rearmar plantilla."><span>Baracoins</span><strong>${renderCoinInline(row.coins, 'large')}</strong></div><div class="standingStatCard" title="Cambios de plantilla usados durante la jornada actual."><span>Cambios</span><strong>${intFmt.format(row.transfersUsed)}/${intFmt.format(config().maxWeeklyTransfers)}</strong><small>Usados esta semana</small></div></div></article>`;
    }).join('');
  }

  function renderTeam(){
    const empty = $('squadEmpty');
    const grid = $('squadGrid');
    const summary = $('teamSummary');
    if (!empty || !grid || !summary) return;
    if (!state.currentTeam){
      summary.innerHTML = '';
      grid.classList.add('hidden');
      empty.classList.remove('hidden');
      empty.textContent = state.currentUser ? 'Crea tu equipo OP15 para empezar a comprar jugadores.' : 'Inicia sesion y crea tu equipo OP15 para entrar al fantasy.';
      return;
    }
    const derived = leagueDerived();
    const roundState = getTeamRound(state.currentTeam.id, state.currentRound?.key || '');
    const transfers = Number(roundState?.transfers_used || 0);
    const captainChanges = Number(roundState?.captain_changes_used || 0);
    summary.innerHTML = `<span class="pill strong" title="Jugadores comprados actualmente para tu plantilla fantasy.">${derived.squadCards.length}/${intFmt.format(config().squadSize)} jugadores</span><span class="pill" title="Cambios de plantilla usados en la jornada actual.">${intFmt.format(transfers)}/${intFmt.format(config().maxWeeklyTransfers)} cambios</span><span class="pill" title="Cambios de capitan usados en la jornada actual. Puedes reasignar el capitan una vez por semana.">${intFmt.format(captainChanges)}/${intFmt.format(config().maxWeeklyCaptainChanges)} capitan</span>`;
    if (!derived.squadCards.length){ grid.classList.add('hidden'); empty.classList.remove('hidden'); empty.textContent = 'Tu plantilla esta vacia. Compra jugadores en el pool para empezar.'; return; }
    empty.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = derived.squadCards.map((entry) => {
      const player = entry.player;
      const overlay = `<div class="playerOverlayBottom"><div class="overlayNamePlain">${escapeHtml(player.name)}</div><div class="overlaySubtitle">#${intFmt.format(player.rank || 0)} - ${escapeHtml(tierLabel(player.tier))}</div></div>`;
      return `<article class="playerCard squadCard isInteractive ${frameClass(player.tier)} ${entry.isCaptain ? 'isCaptainCard squadCaptainCard' : 'squadSupportCard'}" data-open-player="${escapeAttr(entry.player_slug)}" data-player-source="team">${entry.isCaptain ? '<div class="captainHalo" aria-hidden="true"></div><div class="captainBadge">Capitan x1.5</div>' : ''}<div class="playerHead">${renderPlayerVisual(player, overlay)}</div></article>`;
    }).join('');
  }

  function renderMarket(){
    const grid = $('marketGrid');
    const empty = $('marketEmpty');
    const meta = $('marketMeta');
    if (!grid || !empty || !meta) return;
    const derived = leagueDerived();
    meta.textContent = `${derived.marketPlayers.length} visibles`;
    if (!derived.marketPlayers.length){ grid.innerHTML = ''; empty.classList.remove('hidden'); empty.textContent = state.poolPlayers.length ? 'No hay jugadores que coincidan con este filtro.' : 'Todavia no se ha cargado el pool de jugadores.'; return; }
    const roster = derived.myRoster;
    empty.classList.add('hidden');
    grid.innerHTML = derived.marketPlayers.map((player) => {
      const overlay = `<div class="playerOverlayBottom"><div class="overlayNamePlain">${escapeHtml(player.name)}</div><div class="overlaySubtitle">#${intFmt.format(player.rank || 0)} - ${escapeHtml(tierLabel(player.tier))}</div></div>`;
      const blocked = buyBlockReason(player, roster);
      return `<article class="playerCard marketCard isInteractive ${frameClass(player.tier)}" data-open-player="${escapeAttr(player.slug)}" data-player-source="market"><div class="playerHead">${renderPlayerVisual(player, overlay)}</div><div class="actionRow compactActions single"><button class="btn btnPrimary compactBtn buyFullBtn" type="button" data-buy-confirm="${escapeAttr(player.slug)}" aria-label="Comprar ${escapeAttr(player.name)}" ${blocked ? 'disabled' : ''} title="${escapeAttr(blocked || `Comprar ${player.name}`)}">${blocked ? escapeHtml(blocked) : `${renderCoinInline(player.price || 0, true)} Comprar`}</button></div></article>`;
    }).join('');
  }

  function renderAll(){
    renderHero();
    renderSeasonFacts();
    renderSetupPanel();
    renderStandings();
    renderTeam();
    renderMarket();
    renderPlayerModal();
    renderBuyConfirm();
  }

  async function createTeam(event){
    event.preventDefault();
    const teamName = $('createTeamName')?.value.trim() || '';
    if (!state.currentUser) return showPageMsg('Necesitas sesion para crear tu equipo.', 'err');
    try{
      const { error } = await rpcWithTimeout('fantasy_vbf_create_team', { p_season: CURRENT_SEASON, p_team_name: teamName }, 'crear equipo fantasy');
      if (error) throw error;
      showPageMsg('Equipo OP15 creado. Ya puedes completar tu plantilla.', 'ok');
      await loadLeagueContext();
      await syncCurrentRound(true);
      renderAll();
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      showPageMsg(`No pude crear tu equipo: ${error?.message || error}`, 'err');
    }
  }

  async function buyPlayer(playerSlug){
    const player = state.playersBySlug.get(String(playerSlug || ''));
    if (!player || !state.currentTeam) return;
    try{
      const { error } = await rpcWithTimeout('fantasy_vbf_buy_player', { p_season: CURRENT_SEASON, p_round_key: state.currentRound?.key || 'manual', p_player_slug: player.slug, p_player_name: player.name, p_player_tier: player.tier || '', p_player_rank: Number(player.rank || 0), p_price: Number(player.price || 0) }, `comprar ${player.name}`);
      if (error) throw error;
      showPageMsg(`${player.name} anadido a tu plantilla.`, 'ok');
      await loadLeagueContext();
      await syncCurrentRound(true);
      renderAll();
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      showPageMsg(`No pude comprar a ${player.name}: ${error?.message || error}`, 'err');
    }
  }

  async function sellPlayer(playerSlug){
    if (!state.currentTeam) return;
    try{
      const { error } = await rpcWithTimeout('fantasy_vbf_sell_player', { p_season: CURRENT_SEASON, p_round_key: state.currentRound?.key || 'manual', p_player_slug: String(playerSlug || '') }, 'vender jugador');
      if (error) throw error;
      showPageMsg('Venta registrada.', 'ok');
      await loadLeagueContext();
      await syncCurrentRound(true);
      renderAll();
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      showPageMsg(`No pude vender el jugador: ${error?.message || error}`, 'err');
    }
  }

  async function saveCaptain(playerSlug){
    if (!state.currentTeam) return;
    const roster = state.seasonRoster.filter((row) => String(row.team_id) === String(state.currentTeam.id));
    try{
      const { error } = await rpcWithTimeout('fantasy_vbf_save_lineup', { p_season: CURRENT_SEASON, p_player_ids: roster.map((row) => row.player_slug), p_captain_player_slug: playerSlug || null }, 'guardar capitan');
      if (error) throw error;
      await loadLeagueContext();
      await syncCurrentRound(true);
      renderAll();
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      showPageMsg(`No pude guardar el capitan: ${error?.message || error}`, 'err');
    }
  }

  async function syncCurrentRound(silent){
    if (state.syncingRound || state.schemaReady === false || !state.currentUser || !state.currentRound?.key) return;
    const derived = leagueDerived();
    if (!derived.standings.length) return;
    state.syncingRound = true;
    try{
      const results = derived.standings.map((row) => ({ team_id: row.id, weekly_points: Number(row.weeklyPoints || 0) }));
      const { error } = await rpcWithTimeout('fantasy_vbf_sync_round', { p_season: CURRENT_SEASON, p_round_key: state.currentRound.key, p_round_label: state.currentRound.label, p_round_order: state.currentRound.order, p_results: results }, 'sincronizar jornada fantasy', 12000);
      if (error) throw error;
      await loadLeagueContext();
      if (!silent) showPageMsg(`Jornada ${state.currentRound.label} sincronizada.`, 'ok');
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      else {
        console.warn('fantasy syncCurrentRound:', error?.message || error);
        if (!silent) showPageMsg(`No pude sincronizar la jornada: ${error?.message || error}`, 'err');
      }
    } finally {
      state.syncingRound = false;
      renderAll();
    }
  }

  function queueRoundSync(){
    if (state.schemaReady === false || !state.currentUser || !state.currentRound?.key) return;
    window.setTimeout(() => {
      void syncCurrentRound(true);
    }, 0);
  }

  function isMonday(){
    return new Date().getDay() === 1;
  }

  async function maybeOpenNewWeek(){
    if (!state.currentUser || state.schemaReady === false || !state.sheetRound?.key) return false;
    const currentKey = String(state.currentRound?.key || state.seasonConfig?.current_round_key || '').trim();
    if (!isMonday() || currentKey === state.sheetRound.key) return false;
    try{
      const { error } = await rpcWithTimeout('fantasy_vbf_start_week', {
        p_season: CURRENT_SEASON,
        p_week_key: state.sheetRound.key,
        p_week_label: state.sheetRound.label,
        p_week_order: state.sheetRound.order
      }, 'abrir nueva jornada fantasy', 12000);
      if (error) throw error;
      state.currentRound = { ...state.sheetRound };
      await loadSeasonConfig();
      await loadLeagueContext();
      showPageMsg(`Nueva jornada ${state.sheetRound.label} iniciada. Plantillas reiniciadas y baracoins acumulados.`, 'ok');
      return true;
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      else showPageMsg(`No pude abrir la nueva jornada: ${error?.message || error}`, 'err');
      return false;
    }
  }

  async function refreshAllData(options){
    const opts = options || {};
    if (state.refreshPromise) return state.refreshPromise;
    setLoading(true, opts.loadingLabel || (state.initialized ? 'Actualizando fantasy...' : 'Cargando fantasy...'));
    const promise = (async () => {
      if (!opts.skipSession) await safeRefreshSession();
      await loadSeasonConfig();
      await loadPlayerPool(Boolean(opts.forceSheet));
      await loadLeagueContext();
      await maybeOpenNewWeek();
      renderAll();
    })().finally(() => {
      state.refreshPromise = null;
      state.initialized = true;
      setLoading(false);
    });
    state.refreshPromise = promise;
    try{
      await promise;
    } finally {
      queueRoundSync();
    }
    return promise;
  }

  $('reloadPlayersButton').addEventListener('click', async () => {
    showPageMsg('Refrescando fantasy desde VBF...', 'ok');
    await refreshAllData({ forceSheet: true, skipSession: true, loadingLabel: 'Refrescando fantasy...' });
  });
  $('marketSearch').addEventListener('input', () => { state.marketSearch = $('marketSearch').value || ''; renderMarket(); });
  $('marketSort').addEventListener('change', () => { state.marketSort = $('marketSort').value || 'weekly_desc'; renderMarket(); });
  document.addEventListener('submit', async (event) => { if (event.target?.id === 'createTeamForm') await createTeam(event); });
  function handleOpenPlayerClick(event){
    const buyTrigger = event.target.closest('[data-buy-confirm]');
    if (buyTrigger){
      openBuyConfirm(buyTrigger.getAttribute('data-buy-confirm') || '');
      return;
    }
    const trigger = event.target.closest('[data-open-player]');
    if (!trigger) return;
    openPlayerModal(trigger.getAttribute('data-open-player') || '', trigger.getAttribute('data-player-source') || 'market');
  }
  $('marketGrid').addEventListener('click', handleOpenPlayerClick);
  $('squadGrid').addEventListener('click', handleOpenPlayerClick);
  $('playerModalWrap')?.addEventListener('click', async (event) => {
    const closeTrigger = event.target.closest('[data-close-player-modal]');
    if (closeTrigger){ closePlayerModal(); return; }
    const actionButton = event.target.closest('[data-modal-action]');
    if (!actionButton) return;
    const slug = actionButton.getAttribute('data-player-slug') || '';
    const action = actionButton.getAttribute('data-modal-action') || '';
    if (action === 'buy'){
      await buyPlayer(slug);
      closePlayerModal();
      return;
    }
    if (action === 'sell'){
      await sellPlayer(slug);
      closePlayerModal();
      return;
    }
    if (action === 'captain'){
      await saveCaptain(slug);
      renderPlayerModal();
    }
  });
  $('playerModalClose')?.addEventListener('click', closePlayerModal);
  $('buyConfirmWrap')?.addEventListener('click', async (event) => {
    if (event.target.closest('[data-close-buy-confirm]')){ closeBuyConfirm(); return; }
    if (event.target.closest('#buyConfirmCancel')){ closeBuyConfirm(); return; }
    if (event.target.closest('#buyConfirmAccept')){
      const slug = state.confirmBuySlug;
      closeBuyConfirm();
      if (slug) await buyPlayer(slug);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.modalPlayerSlug) closePlayerModal();
    if (event.key === 'Escape' && state.confirmBuySlug) closeBuyConfirm();
  });

  if (sb?.auth?.onAuthStateChange){
    sb.auth.onAuthStateChange(async (_event, session) => {
      App.clearAccessStateCache();
      state.currentUser = session?.user || null;
      syncNavUser(state.currentUser);
      await loadCurrentProfile(state.currentUser);
      const pendingRefresh = state.refreshPromise;
      if (pendingRefresh){
        try { await pendingRefresh; } catch (_error) {}
      }
      await refreshAllData({ forceSheet: true, skipSession: true, loadingLabel: state.initialized ? 'Actualizando fantasy...' : 'Cargando fantasy...' });
    });
  }

  window.addEventListener('pageshow', async (event) => {
    if (!state.initialized || !event.persisted) return;
    await refreshAllData({ forceSheet: true, skipSession: true, loadingLabel: 'Actualizando fantasy...' });
  });

  void refreshAllData({ forceSheet: true, skipSession: true, loadingLabel: 'Cargando fantasy...' }).catch((error) => {
    console.warn('fantasy init:', error?.message || error);
  });
})();
