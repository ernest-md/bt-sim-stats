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
  const COIN_ICON = 'berries.png';
  const PAGE_VIEW = String(document.body?.dataset?.fantasyView || 'overview').trim().toLowerCase();
  const DEFAULT_BUDGET = 100000;
  const DEFAULT_SQUAD_SIZE = 3;
  const DEFAULT_STARTER_SIZE = 3;
  const DEFAULT_STARTER_PACK_SIZE = 3;
  const DEFAULT_MAX_PLAYER_COPIES = 3;
  const MAX_WEEKLY_TRANSFERS = 999;
  const MAX_WEEKLY_CAPTAIN_CHANGES = 0;
  const MAX_SAVINGS = 999999999;
  const MAX_MARKET_CARDS = 60;
  const DEFAULT_CLAUSE_MULTIPLIER = 1.25;
  const PRICE_BUCKET_WINNER = 50000;
  const PRICE_BUCKET_TOP4 = 40000;
  const PRICE_BUCKET_TOP8 = 30000;
  const PRICE_BUCKET_TOP16 = 20000;
  const PRICE_BUCKET_REST = 10000;
  let authRpcQueue = Promise.resolve();
  let actionRpcClient = null;
  let actionRpcToken = '';
  let backgroundHydrationPromise = null;
  let fantasyAccessAllowed = false;

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
    currentSession: null,
    currentProfile: null,
    seasonConfig: null,
    poolPlayers: [],
    eventLabels: [],
    playersBySlug: new Map(),
    seasonTeams: [],
    seasonRoster: [],
    seasonRounds: [],
    seasonSnapshots: [],
    teamRounds: [],
    transactions: [],
    notifications: [],
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
    marketSort: 'vbf_full_rank',
    marketFilter: 'all',
    watchlistSlugs: new Set(),
    modalPlayerSlug: '',
    modalSource: '',
    modalTeamId: '',
    confirmBuySlug: '',
    confirmBuyTargetTeamId: '',
    confirmBuyOutgoingSlug: '',
    actionInFlight: false,
    poolSyncedRoundKey: '',
    poolSyncedAt: 0,
    initialized: false
  };

  function showPageMsg(text, type){
    const box = $('pageMsg');
    if (!box) return;
    if (!text){ box.className = 'pageMsg'; box.textContent = ''; return; }
    box.className = `pageMsg ${type || ''}`.trim();
    box.textContent = text;
  }

  function prefersReducedMotion(){
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  function ensureToastHost(){
    let host = document.getElementById('fantasyToastHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'fantasyToastHost';
    host.className = 'fantasyToastHost';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    return host;
  }

  function showFantasyToast(title, body, type){
    const host = ensureToastHost();
    const toast = document.createElement('article');
    toast.className = `fantasyToast ${type || 'info'}`.trim();
    toast.innerHTML = `<strong>${escapeHtml(title || 'VadeFantasy')}</strong>${body ? `<span>${escapeHtml(body)}</span>` : ''}`;
    host.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add('isLeaving');
      window.setTimeout(() => toast.remove(), prefersReducedMotion() ? 0 : 220);
    }, type === 'err' ? 5200 : 3200);
  }

  function watchlistStorageKey(){
    const userKey = state.currentUser?.id ? String(state.currentUser.id) : 'anon';
    return `barateamFantasyWatchlist:${CURRENT_SEASON}:${userKey}`;
  }

  function readLocalWatchlist(){
    try{
      const raw = window.localStorage?.getItem(watchlistStorageKey()) || '[]';
      const rows = JSON.parse(raw);
      return (Array.isArray(rows) ? rows : []).map((item) => String(item || '').trim()).filter(Boolean);
    } catch (_error){
      return [];
    }
  }

  function writeLocalWatchlist(rows){
    try{
      window.localStorage?.setItem(watchlistStorageKey(), JSON.stringify((rows || []).slice(0, 80)));
    } catch (_error){}
  }

  async function loadWatchlist(){
    const localRows = readLocalWatchlist();
    state.watchlistSlugs = new Set(localRows);
    if (!state.currentUser?.id) return;

    try{
      const { data, error } = await withTimeout(
        sb.from('fantasy_vbf_watchlist')
          .select('player_slug')
          .eq('season', CURRENT_SEASON)
          .eq('user_id', state.currentUser.id)
          .order('created_at', { ascending: false })
          .limit(100),
        'watchlist fantasy',
        8000
      );
      if (error) throw error;
      const remoteRows = (Array.isArray(data) ? data : []).map((row) => String(row.player_slug || '').trim()).filter(Boolean);
      if (remoteRows.length){
        state.watchlistSlugs = new Set(remoteRows);
        writeLocalWatchlist(remoteRows);
      } else if (localRows.length){
        await persistWatchlist(localRows);
      }
    } catch (error){
      console.warn('fantasy watchlist fallback:', error?.message || error);
    }
  }

  async function persistWatchlist(rows){
    if (!state.currentUser?.id) return;
    const slugs = Array.from(new Set((rows || []).map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 80);
    try{
      const { error: deleteError } = await withTimeout(
        sb.from('fantasy_vbf_watchlist')
          .delete()
          .eq('season', CURRENT_SEASON)
          .eq('user_id', state.currentUser.id),
        'limpiar watchlist fantasy',
        8000
      );
      if (deleteError) throw deleteError;
      if (!slugs.length) return;
      const payload = slugs.map((slug) => ({
        season: CURRENT_SEASON,
        user_id: state.currentUser.id,
        player_slug: slug
      }));
      const { error: upsertError } = await withTimeout(
        sb.from('fantasy_vbf_watchlist')
          .upsert(payload, { onConflict: 'season,user_id,player_slug' }),
        'guardar watchlist fantasy',
        8000
      );
      if (upsertError) throw upsertError;
    } catch (error){
      console.warn('fantasy watchlist persist:', error?.message || error);
    }
  }

  function saveWatchlist(){
    const rows = Array.from(state.watchlistSlugs || []).slice(0, 80);
    writeLocalWatchlist(rows);
    void persistWatchlist(rows);
  }

  function isWatched(playerSlug){
    return state.watchlistSlugs?.has(String(playerSlug || '').trim()) === true;
  }

  function toggleWatchlist(playerSlug){
    const slug = String(playerSlug || '').trim();
    if (!slug) return;
    const player = state.playersBySlug.get(slug);
    const next = new Set(state.watchlistSlugs || []);
    if (next.has(slug)){
      next.delete(slug);
      showFantasyToast('Fuera de seguimiento', `${player?.name || 'Jugador'} sale de tu radar.`, 'info');
    } else {
      next.add(slug);
      showFantasyToast('Anadido al radar', `${player?.name || 'Jugador'} queda en tu watchlist.`, 'ok');
    }
    state.watchlistSlugs = next;
    saveWatchlist();
    renderWatchlistPanel();
    renderMarket();
    renderPlayerModal();
  }

  function setActionBusy(button, active, label){
    if (!button) return;
    if (active){
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.classList.add('isBusy');
      button.disabled = true;
      button.innerHTML = `<span class="btnSpinner" aria-hidden="true"></span><span>${escapeHtml(label || 'Procesando')}</span>`;
      return;
    }
    button.classList.remove('isBusy');
    button.disabled = false;
    if (button.dataset.originalHtml){
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

  function animateStatNumber(node, nextValue){
    if (!node) return;
    const target = Number(nextValue || 0);
    if (!Number.isFinite(target) || prefersReducedMotion()){
      node.textContent = intFmt.format(target);
      node.dataset.statValue = String(target);
      return;
    }
    const previous = Number(node.dataset.statValue || String(node.textContent || '').replace(/\D/g, '') || 0);
    if (previous === target){
      node.textContent = intFmt.format(target);
      return;
    }
    node.dataset.statValue = String(target);
    node.classList.add('isCounting');
    const start = performance.now();
    const duration = 520;
    const delta = target - previous;
    const step = (now) => {
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = intFmt.format(Math.round(previous + delta * eased));
      if (progress < 1) window.requestAnimationFrame(step);
      else {
        node.textContent = intFmt.format(target);
        node.classList.remove('isCounting');
      }
    };
    window.requestAnimationFrame(step);
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
    const run = authRpcQueue.catch(() => {}).then(() => {
      const rpcClient = getRpcClient();
      return withTimeout(withAuthRetry(() => rpcClient.rpc(name, args || {})), label || name, timeoutMs || 12000);
    });
    authRpcQueue = run.catch(() => {});
    return run;
  }

  function getRpcClient(){
    const token = String(state.currentSession?.access_token || '').trim();
    if (!token || !window.supabase?.createClient){
      return sb;
    }
    if (actionRpcClient && actionRpcToken === token){
      return actionRpcClient;
    }
    actionRpcToken = token;
    actionRpcClient = window.supabase.createClient(App.SUPABASE_URL, App.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'barateam-fantasy-rpc'
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    return actionRpcClient;
  }

  function formatCoins(value){
    return `${intFmt.format(Math.round(Number(value || 0)))} berries`;
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

  function defaultClauseForPrice(price){
    const cfg = config();
    const value = Math.max(0, Math.round(Number(price || 0)));
    const multiplier = Math.max(Number(cfg.clauseMultiplier || DEFAULT_CLAUSE_MULTIPLIER), 1.1);
    return Math.max(value + 2, Math.ceil(Math.max(value, 1) * multiplier));
  }

  function shuffleList(items){
    const list = Array.isArray(items) ? items.slice() : [];
    for (let index = list.length - 1; index > 0; index -= 1){
      const swap = Math.floor(Math.random() * (index + 1));
      [list[index], list[swap]] = [list[swap], list[index]];
    }
    return list;
  }

  function pickStarterPack(players, size, unavailableSlugs){
    const blocked = new Set((unavailableSlugs || []).map((value) => String(value || '')));
    const pool = shuffleList(players).filter((player) => player?.slug && !blocked.has(String(player.slug)));
    const picked = [];
    const seen = new Set();
    for (const player of pool){
      if (picked.length >= size) break;
      const slug = String(player.slug || '');
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      picked.push({
        player_slug: slug,
        player_name: String(player.name || slug),
        player_tier: String(player.tier || ''),
        player_rank: Number(player.rank || 9999),
        price: Number(player.price || 0),
        clause_price: defaultClauseForPrice(player.price || 0)
      });
    }
    return picked;
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

  function serialDateInfo(serial){
    const number = Number(serial);
    if (!Number.isFinite(number) || number < 30000){
      return {
        raw: serial,
        key: String(serial || '').trim(),
        label: String(serial || '').trim(),
        date: null,
        iso: '',
        weekday: -1
      };
    }
    const ms = Math.round((number - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    const day = String(dt.getUTCDate());
    const month = dt.toLocaleString('es-ES', { month: 'short', timeZone: 'UTC' }).replace('.', '');
    const iso = dt.toISOString().slice(0, 10);
    return {
      raw: serial,
      key: iso,
      label: `${day}-${month}`,
      date: dt,
      iso,
      weekday: dt.getUTCDay()
    };
  }

  function serialDateToLabel(serial){
    return serialDateInfo(serial).label;
  }

  function isSaturdayInfo(info){
    return Number(info?.weekday) === 6;
  }

  function madridNowParts(){
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return {
      year: Number(map.year || 0),
      month: Number(map.month || 0),
      day: Number(map.day || 0),
      hour: Number(map.hour || 0),
      minute: Number(map.minute || 0),
      second: Number(map.second || 0),
      weekday: String(map.weekday || '')
    };
  }

  function marketOpenNow(){
    const parts = madridNowParts();
    return !['Sat', 'Sun'].includes(parts.weekday);
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

  function chartSeries(player){
    const history = Array.isArray(player?.history) ? player.history : [];
    return history.map((entry, index) => {
      const raw = Number.isFinite(Number(entry?.raw_points)) ? Number(entry.raw_points) : null;
      const fantasy = Number.isFinite(Number(entry?.fantasy_points))
        ? Number(entry.fantasy_points)
        : (Number.isFinite(raw) && raw > 0 ? Number((raw / 1000).toFixed(1)) : null);
      return {
        index,
        label: String(entry?.round_label || entry?.round_key || `T${index + 1}`).trim(),
        fantasy,
        raw,
        countsForFantasy: entry?.counts_for_fantasy === true,
        won: entry?.won === true
      };
    }).filter((item) => item.label);
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
        const title = `${item.label}${item.countsForFantasy ? ' · cuenta para fantasy' : ''}: ${formatPointsLabel(item.fantasy)}${Number.isFinite(item.raw) ? ` · ${intFmt.format(Math.round(item.raw))} berries` : ''}${item.won ? ' · victoria' : ''}`;
        const pointClass = `chartPoint${item.countsForFantasy ? ' scoring' : ''}${item.won ? ' won' : ''}`;
        const radius = item.countsForFantasy ? 8.5 : 6;
        return `<line class="chartStem${item.countsForFantasy ? ' scoring' : ''}" x1="${x}" y1="${height - padBottom}" x2="${x}" y2="${y}"></line><circle class="${pointClass}" cx="${x}" cy="${y}" r="${radius}"><title>${escapeHtml(title)}</title></circle>`;
      }
      return `<circle class="chartPoint miss${item.countsForFantasy ? ' scoring' : ''}" cx="${x}" cy="${yFor(0).toFixed(2)}" r="${item.countsForFantasy ? '4.5' : '3.5'}"><title>${escapeHtml(`${item.label}${item.countsForFantasy ? ' · jornada fantasy' : ''}: sin participacion`)}</title></circle>`;
    }).join('');

    const labelsSvg = series.map((item, index) => `<text x="${xFor(index).toFixed(2)}" y="${height - 8}" text-anchor="middle" font-size="${item.countsForFantasy ? '10' : '9'}" font-weight="${item.countsForFantasy ? '1000' : '800'}" fill="${item.countsForFantasy ? '#0f172a' : '#64748b'}">${escapeHtml(item.label)}</text>`).join('');
    const gridSvg = gridValues.map((value) => {
      const y = yFor(value).toFixed(2);
      return `<line class="chartGridLine" x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}"></line><text x="0" y="${Number(y) + 4}" font-size="10" font-weight="900" fill="#64748b">${formatPoints(value)}</text>`;
    }).join('');
    const bridgesSvg = bridges.map((points) => `<polyline class="chartBridge" points="${points}"></polyline>`).join('');
    const linesSvg = segments.map((points) => `<polyline class="chartLine" points="${points}"></polyline>`).join('');
    return `<div class="chartCard"><div class="chartMeta"><span>Todos los torneos</span><strong>Sabados marcados para fantasy</strong></div><svg class="chartSvg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafica de puntos por torneo">${gridSvg}<line class="chartAxis" x1="${padX}" y1="${height - padBottom}" x2="${width - padX}" y2="${height - padBottom}"></line>${bridgesSvg}${linesSvg}${pointsSvg}${labelsSvg}</svg></div>`;
  }

  function buildPlayerPool(payload){
    const rows = normalizeTable(payload?.rows || []);
    if (!rows.length) return { players: [], currentRound: null, eventLabels: [] };
    const headerRow = rows[0] || [];
    const sourceRows = rows.slice(1).filter((row) => String(row[2] || '').trim() !== '');
    const allEventColumns = [];
    const eventColumns = [];
    for (let index = 3; index < headerRow.length; index += 1){
      const info = serialDateInfo(headerRow[index]);
      const fallbackLabel = `T${index - 2}`;
      const label = String(info.label || fallbackLabel).trim();
      if (!label) continue;
      const column = {
        index,
        key: info.key || fallbackLabel,
        label,
        order: allEventColumns.length + 1,
        countsForFantasy: isSaturdayInfo(info)
      };
      allEventColumns.push(column);
      if (!column.countsForFantasy) continue;
      eventColumns.push({
        index: column.index,
        key: column.key,
        label: column.label,
        order: eventColumns.length + 1,
        countsForFantasy: true
      });
    }

    const players = sourceRows.map((row) => {
      const name = String(row[2] || '').trim();
      const slug = slugifyPlayerName(name);
      const berries = getNumber(row[1]);
      const allPoints = allEventColumns.map((event) => {
        const number = getNumber(row[event.index]);
        return Number.isFinite(number) ? number : null;
      });
      const points = eventColumns.map((event) => {
        const idx = event.index;
        const number = getNumber(row[idx]);
        return Number.isFinite(number) ? number : null;
      });
      const totalPoints = allPoints.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0);
      const played = allPoints.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? 1 : 0), 0);
      const fantasyPlayed = points.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? 1 : 0), 0);
      return {
        tier: String(row[0] || '').trim(),
        berries: Number.isFinite(berries) ? berries : 0,
        name,
        slug,
        sheetRow: row,
        allPoints,
        points,
        history: [],
        totalPoints,
        played,
        avgPoints: played ? totalPoints / played : 0,
        bestStreak: computeStreak(points),
        currentStreak: computeCurrentStreak(points),
        fantasyPlayed,
        wins: 0,
        rank: 0,
        roundRank: 9999,
        price: PRICE_BUCKET_REST,
        avgFantasyPoints: played ? totalPoints / played / 1000 : 0,
        currentFantasyPoints: 0,
        currentRawPoints: 0,
        currentWon: false,
        isTop5: false,
        isTop10: false
      };
    }).filter((player) => player.slug && player.name);

    const allEventMax = allEventColumns.map((_, eventPos) => {
      let max = 0;
      players.forEach((player) => {
        const value = player.allPoints[eventPos];
        if (Number.isFinite(value) && value > max) max = value;
      });
      return max;
    });

    const eventMax = eventColumns.map((_, eventPos) => {
      let max = 0;
      players.forEach((player) => {
        const value = player.points[eventPos];
        if (Number.isFinite(value) && value > max) max = value;
      });
      return max;
    });

    players.forEach((player) => {
      let wins = 0;
      player.allPoints.forEach((value, eventPos) => {
        if (Number.isFinite(value) && value > 0 && allEventMax[eventPos] > 0 && value === allEventMax[eventPos]) wins += 1;
      });
      player.wins = wins;
    });

    players.sort((a, b) => {
      if ((b.berries || 0) !== (a.berries || 0)) return (b.berries || 0) - (a.berries || 0);
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      return collator.compare(a.name, b.name);
    });
    players.forEach((player, index) => {
      player.rank = index + 1;
      player.isTop5 = index < 5;
      player.isTop10 = index < 10;
    });

    let currentRound = null;
    if (eventColumns.length){
      const roundIndex = eventColumns.length - 1;
      const event = eventColumns[roundIndex];
      currentRound = { key: `${CURRENT_SEASON}:${event.key}`, label: event.label || `T${roundIndex + 1}`, order: event.order };
      const ranking = players.map((player) => ({
        slug: player.slug,
        raw: Number.isFinite(player.points[roundIndex]) ? player.points[roundIndex] : 0
      })).sort((a, b) => b.raw - a.raw || collator.compare(a.slug, b.slug));
      const roundRankBySlug = new Map(ranking.map((entry, index) => [entry.slug, index + 1]));
      players.forEach((player) => {
        const rawPoints = player.points[roundIndex];
        const score = Number.isFinite(rawPoints) && rawPoints > 0 ? rawPoints : 0;
        const won = score > 0 && score === eventMax[roundIndex];
        player.currentRawPoints = score;
        player.currentWon = won;
        player.currentFantasyPoints = score > 0 ? (score / 1000) : 0;
        player.roundRank = Number(roundRankBySlug.get(player.slug) || 9999);
      });
    }

    players.forEach((player) => {
      player.price = player.roundRank <= 1
        ? PRICE_BUCKET_WINNER
        : player.roundRank <= 4
          ? PRICE_BUCKET_TOP4
          : player.roundRank <= 8
            ? PRICE_BUCKET_TOP8
            : player.roundRank <= 16
              ? PRICE_BUCKET_TOP16
              : PRICE_BUCKET_REST;
      player.history = allEventColumns.map((event, eventPos) => {
        const raw = getNumber(player.sheetRow?.[event.index]);
        const fantasy = Number.isFinite(raw) && raw > 0 ? raw / 1000 : null;
        return {
          round_key: `${CURRENT_SEASON}:${event.key}`,
          round_label: event.label,
          round_order: event.order,
          raw_points: Number.isFinite(raw) ? Math.round(raw) : null,
          fantasy_points: Number.isFinite(fantasy) ? Number(fantasy.toFixed(1)) : null,
          won: Number.isFinite(raw) && raw > 0 && allEventMax[eventPos] > 0 && raw === allEventMax[eventPos],
          counts_for_fantasy: event.countsForFantasy
        };
      });
    });

    return {
      players,
      currentRound,
      eventLabels: eventColumns.map((event) => event.label),
      eventColumns
    };
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
      state.seasonConfig = {
        season: CURRENT_SEASON,
        label: `Fantasy ${CURRENT_SEASON}`,
        budget: DEFAULT_BUDGET,
        squad_size: DEFAULT_SQUAD_SIZE,
        starter_size: DEFAULT_STARTER_SIZE,
        starter_pack_size: DEFAULT_STARTER_PACK_SIZE,
        max_player_copies: DEFAULT_MAX_PLAYER_COPIES,
        max_weekly_transfers: MAX_WEEKLY_TRANSFERS,
        max_weekly_captain_changes: MAX_WEEKLY_CAPTAIN_CHANGES,
        max_savings: MAX_SAVINGS,
        captain_multiplier: 1,
        clause_multiplier: DEFAULT_CLAUSE_MULTIPLIER,
        is_open: true
      };
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
      renderHero();
    }
  }

  function playerPoolSyncPayload(){
    return state.poolPlayers.map((player) => ({
      player_slug: player.slug,
      player_name: player.name,
      player_tier: player.tier || '',
      player_rank: Number(player.rank || 9999),
      round_rank: Number(player.roundRank || 9999),
      total_points: Number(player.totalPoints || 0),
      avg_fantasy_points: Number(player.avgFantasyPoints || 0),
      played: Number(player.played || 0),
      wins: Number(player.wins || 0),
      current_fantasy_points: Number(player.currentFantasyPoints || 0),
      current_raw_points: Number(player.currentRawPoints || 0),
      current_won: !!player.currentWon,
      current_streak: Number(player.currentStreak || 0),
      best_streak: Number(player.bestStreak || 0),
      history: Array.isArray(player.history) ? player.history : []
    }));
  }

  async function syncPlayerPoolToBackend(){
    if (!state.currentUser || state.schemaReady === false || !state.sheetRound?.key || !state.poolPlayers.length) return;
    try{
      const { error } = await rpcWithTimeout('fantasy_vbf_sync_player_pool', {
        p_season: CURRENT_SEASON,
        p_round_key: state.sheetRound.key,
        p_round_label: state.sheetRound.label,
        p_round_order: state.sheetRound.order,
        p_players: playerPoolSyncPayload()
      }, 'sincronizar pool fantasy', 18000);
      if (error) throw error;
      state.poolSyncedRoundKey = String(state.sheetRound?.key || '');
      state.poolSyncedAt = Date.now();
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      else console.warn('fantasy syncPlayerPoolToBackend:', error?.message || error);
    }
  }

  async function withActionLock(task){
    state.actionInFlight = true;
    try{
      return await task();
    } finally {
      state.actionInFlight = false;
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
    state.seasonRounds = [];
    state.seasonSnapshots = [];
    state.teamRounds = [];
    state.transactions = [];
    state.notifications = [];
    state.currentTeam = null;
    if (state.schemaReady === false){ renderAll(); return; }
    state.loadingLeague = true;
    renderHero();
    try{
      const [teamsRes, rosterRes, seasonRoundsRes, snapshotsRes, roundsRes, txRes] = await Promise.all([
        withTimeout(readSb.from('fantasy_vbf_teams').select('id,season,user_id,team_name,coins,captain_player_slug,total_points,created_at').eq('season', CURRENT_SEASON).order('created_at', { ascending: true }), 'equipos fantasy'),
        withTimeout(readSb.from('fantasy_vbf_roster_players').select('id,season,team_id,user_id,player_slug,player_name,player_tier,player_rank,buy_price,clause_price,acquisition_type,acquired_round_key,created_at').eq('season', CURRENT_SEASON).order('created_at', { ascending: true }), 'plantillas fantasy'),
        withTimeout(readSb.from('fantasy_vbf_rounds').select('season,round_key,round_label,round_order,rewards_applied,created_at,updated_at').eq('season', CURRENT_SEASON).order('round_order', { ascending: true }), 'rondas fantasy'),
        withTimeout(readSb.from('fantasy_vbf_roster_snapshots').select('season,round_key,round_label,round_order,team_id,user_id,player_slug,player_name,player_tier,player_rank,buy_price,clause_price,captured_at,created_at').eq('season', CURRENT_SEASON).order('round_order', { ascending: true }).order('captured_at', { ascending: true }), 'snapshots fantasy'),
        withTimeout(readSb.from('fantasy_vbf_team_rounds').select('*').eq('season', CURRENT_SEASON).order('round_order', { ascending: true }), 'jornadas fantasy'),
        withTimeout(readSb.from('fantasy_vbf_transactions').select('id,season,round_key,team_id,user_id,player_slug,player_name,tx_type,amount,counts_as_transfer,created_at').eq('season', CURRENT_SEASON).order('created_at', { ascending: false }).limit(80), 'historial fantasy')
      ]);
      if (teamsRes.error) throw teamsRes.error;
      if (rosterRes.error) throw rosterRes.error;
      if (seasonRoundsRes.error) throw seasonRoundsRes.error;
      if (snapshotsRes.error) throw snapshotsRes.error;
      if (roundsRes.error) throw roundsRes.error;
      if (txRes.error) throw txRes.error;
      state.seasonTeams = Array.isArray(teamsRes.data) ? teamsRes.data : [];
      state.seasonRoster = Array.isArray(rosterRes.data) ? rosterRes.data : [];
      state.seasonRounds = Array.isArray(seasonRoundsRes.data) ? seasonRoundsRes.data : [];
      state.seasonSnapshots = Array.isArray(snapshotsRes.data) ? snapshotsRes.data : [];
      state.teamRounds = Array.isArray(roundsRes.data) ? roundsRes.data : [];
      state.transactions = Array.isArray(txRes.data) ? txRes.data : [];
      state.currentTeam = state.currentUser ? state.seasonTeams.find((team) => String(team.user_id) === String(state.currentUser.id)) || null : null;
      const profileIds = [
        ...state.seasonTeams.map((team) => team.user_id),
        ...state.transactions.map((tx) => tx.user_id)
      ];
      const jobs = [loadProfiles(profileIds)];
      if (state.currentUser){
        jobs.push((async () => {
          const notesClient = getRpcClient();
          const notesRes = await withTimeout(notesClient.from('fantasy_vbf_notifications').select('id,kind,title,body,payload,read_at,created_at').eq('user_id', state.currentUser.id).order('read_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: false }).limit(24), 'avisos fantasy');
          if (notesRes.error) throw notesRes.error;
          state.notifications = Array.isArray(notesRes.data) ? notesRes.data : [];
        })());
      }
      await Promise.all(jobs);
      if (App.refreshFantasyNavAlerts) void App.refreshFantasyNavAlerts({ force: true });
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      else showPageMsg(`No pude cargar la liga fantasy: ${error?.message || error}`, 'err');
    } finally {
      state.loadingLeague = false;
      renderHero();
    }
  }

  function config(){
    const cfg = state.seasonConfig || {};
    return {
      season: cfg.season || CURRENT_SEASON,
      budget: Number(cfg.budget || DEFAULT_BUDGET),
      squadSize: Number(cfg.squad_size || DEFAULT_SQUAD_SIZE),
      starterSize: Number(cfg.starter_size || DEFAULT_STARTER_SIZE),
      starterPackSize: Number(cfg.starter_pack_size || DEFAULT_STARTER_PACK_SIZE),
      maxPlayerCopies: Number(cfg.max_player_copies || DEFAULT_MAX_PLAYER_COPIES),
      maxWeeklyTransfers: Number(cfg.max_weekly_transfers || MAX_WEEKLY_TRANSFERS),
      maxWeeklyCaptainChanges: Number(cfg.max_weekly_captain_changes || MAX_WEEKLY_CAPTAIN_CHANGES),
      maxSavings: Number(cfg.max_savings || MAX_SAVINGS),
      captainMultiplier: Number(cfg.captain_multiplier || 1),
      clauseMultiplier: Number(cfg.clause_multiplier || DEFAULT_CLAUSE_MULTIPLIER),
      isOpen: cfg.is_open !== false
    };
  }

  function profileNameForUser(userId){
    const profile = state.profilesById.get(String(userId)) || {};
    return profile.display_name || profile.username || String(userId || '').slice(0, 8) || 'Usuario';
  }

  function notificationPayload(note){
    return note?.payload && typeof note.payload === 'object' ? note.payload : {};
  }

  function unreadClauseLostNotifications(){
    return state.notifications.filter((note) =>
      String(note?.kind || '') === 'clause_lost'
      && !note?.read_at
    );
  }

  function inferClauseBuyer(note){
    const payload = notificationPayload(note);
    const playerSlug = String(payload.player_slug || '').trim();
    const currentTeamId = String(state.currentTeam?.id || payload.team_id || note?.team_id || '').trim();
    const explicitTeamId = String(payload.buyer_team_id || '').trim();
    const explicitUserId = String(payload.buyer_user_id || '').trim();
    const rows = state.seasonRoster
      .filter((row) => String(row.player_slug || '') === playerSlug && String(row.team_id || '') !== currentTeamId)
      .sort((a, b) => {
        const buyoutScore = (String(b.acquisition_type || '') === 'buyout' ? 1 : 0) - (String(a.acquisition_type || '') === 'buyout' ? 1 : 0);
        if (buyoutScore) return buyoutScore;
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
    const inferred = explicitTeamId
      ? state.seasonRoster.find((row) => String(row.team_id || '') === explicitTeamId && String(row.player_slug || '') === playerSlug)
      : rows[0];
    const teamId = explicitTeamId || String(inferred?.team_id || '').trim();
    const userId = explicitUserId || String(inferred?.user_id || '').trim();
    const team = state.seasonTeams.find((item) => String(item.id || '') === teamId) || null;
    return {
      teamId,
      userId,
      teamName: payload.buyer_team_name || team?.team_name || (teamId ? 'Equipo rival' : 'Equipo rival'),
      managerName: payload.buyer_manager_name || (userId ? profileNameForUser(userId) : 'otro manager')
    };
  }

  function clauseLostDetails(note){
    const payload = notificationPayload(note);
    const playerSlug = String(payload.player_slug || '').trim();
    const player = state.playersBySlug.get(playerSlug) || null;
    const buyer = inferClauseBuyer(note);
    const amount = Number(payload.amount || 0);
    const playerName = player?.name || payload.player_name || String(note?.title || '').replace(/^Te han pagado la clausula de\s+/i, '') || 'un jugador';
    return { payload, player, playerSlug, playerName, buyer, amount };
  }

  function renderClauseLostNotice(note){
    const details = clauseLostDetails(note);
    const dateLabel = App.formatRelativeTime ? App.formatRelativeTime(note.created_at, '') : '';
    return `<article class="noticeItem clauseNotice">
      <span>Clausulazo recibido${dateLabel ? ` · ${escapeHtml(dateLabel)}` : ''}</span>
      <strong>${escapeHtml(details.buyer.managerName)} te ha quitado a ${escapeHtml(details.playerName)}</strong>
      <p>El equipo ${escapeHtml(details.buyer.teamName)} ha pagado ${renderCoinInline(details.amount || 0, false)}. Esa cantidad ya queda compensada en tu saldo fantasy.</p>
      <div class="noticeActions">
        ${details.playerSlug ? `<button class="btn compactBtn" type="button" data-open-player="${escapeAttr(details.playerSlug)}" data-player-source="market">Ver ficha</button>` : ''}
        <button class="btn btnPrimary compactBtn" type="button" data-mark-notification-read="${escapeAttr(note.id || '')}">Visto</button>
      </div>
    </article>`;
  }

  function playerForRosterRow(row){
    const player = state.playersBySlug.get(String(row.player_slug || ''));
    if (player) return { ...player, clausePrice: Number(row.clause_price || defaultClauseForPrice(player.price || 0)), buyPrice: Number(row.buy_price || 0), acquisitionType: String(row.acquisition_type || 'market') };
    const rank = Number(row.player_rank || 9999);
    return {
      slug: row.player_slug,
      name: row.player_name || row.player_slug || 'Jugador',
      tier: row.player_tier || '',
      rank,
      price: Number(row.buy_price || 0),
      clausePrice: Number(row.clause_price || defaultClauseForPrice(row.buy_price || 0)),
      buyPrice: Number(row.buy_price || 0),
      acquisitionType: String(row.acquisition_type || 'market'),
      wins: 0,
      avgFantasyPoints: 0,
      currentFantasyPoints: 0,
      currentStreak: 0,
      isTop5: rank <= 5,
      isTop10: rank <= 10
    };
  }

  function getTeamRound(teamId, roundKey){
    return state.teamRounds.find((row) => String(row.team_id) === String(teamId) && String(row.round_key) === String(roundKey || '')) || null;
  }

  function roundMetaForKey(roundKey){
    const key = String(roundKey || '').trim();
    if (!key) return null;
    return state.seasonRounds.find((row) => String(row.round_key || '') === key) || null;
  }

  function closedRounds(){
    return state.seasonRounds
      .filter((row) => row?.rewards_applied === true)
      .slice()
      .sort((a, b) => Number(a.round_order || 0) - Number(b.round_order || 0));
  }

  function latestClosedRound(){
    const rounds = closedRounds();
    return rounds.length ? rounds[rounds.length - 1] : null;
  }

  function displayRoundMeta(){
    return latestClosedRound()
      || roundMetaForKey(state.currentRound?.key || '')
      || (state.currentRound?.key ? { round_key: state.currentRound.key, round_label: state.currentRound.label || state.currentRound.key, round_order: Number(state.currentRound.order || 0), rewards_applied: false } : null);
  }

  function snapshotRowsForTeam(teamId, roundKey){
    return state.seasonSnapshots
      .filter((row) =>
        String(row.team_id || '') === String(teamId || '')
        && String(row.round_key || '') === String(roundKey || '')
      )
      .slice()
      .sort((a, b) =>
        Number(a.player_rank || 9999) - Number(b.player_rank || 9999)
        || collator.compare(String(a.player_name || ''), String(b.player_name || ''))
      );
  }

  function storedWeeklyPoints(teamId){
    const currentKey = String(displayRoundMeta()?.round_key || '');
    if (!currentKey) return 0;
    return Number(getTeamRound(teamId, currentKey)?.weekly_points || 0);
  }

  function storedGeneralPoints(team){
    const direct = Number(team?.total_points);
    if (Number.isFinite(direct)) return direct;
    return state.teamRounds
      .filter((row) => String(row.team_id) === String(team?.id || ''))
      .reduce((sum, row) => sum + Number(row.weekly_points || 0), 0);
  }

  function storedRewardCoins(teamId){
    const currentKey = String(displayRoundMeta()?.round_key || '');
    if (!currentKey) return 0;
    return Number(getTeamRound(teamId, currentKey)?.reward_coins || 0);
  }

  function currentWeekTeamRows(){
    const currentKey = String(displayRoundMeta()?.round_key || '');
    if (!currentKey) return [];
    return state.teamRounds.filter((row) => String(row.round_key || '') === String(currentKey));
  }

  function topGeneralPlayers(limit){
    return state.poolPlayers
      .slice()
      .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0) || (b.wins || 0) - (a.wins || 0) || collator.compare(a.name, b.name))
      .slice(0, Number(limit || 5));
  }

  function topSurprisePlayers(limit){
    const source = state.poolPlayers
      .map((player) => ({
        ...player,
        surpriseDelta: Math.max(0, Number(player.rank || 9999) - Number(player.roundRank || 9999))
      }))
      .filter((player) => player.surpriseDelta > 0 && Number(player.currentFantasyPoints || 0) > 0)
      .sort((a, b) => b.surpriseDelta - a.surpriseDelta || (b.currentFantasyPoints || 0) - (a.currentFantasyPoints || 0) || collator.compare(a.name, b.name));
    return (source.length ? source : state.poolPlayers.slice().sort((a, b) => (b.currentFantasyPoints || 0) - (a.currentFantasyPoints || 0) || collator.compare(a.name, b.name)))
      .slice(0, Number(limit || 5));
  }

  function latestFantasyEntry(player){
    const history = Array.isArray(player?.history) ? player.history : [];
    const rows = history.filter((entry) => entry?.counts_for_fantasy === true);
    return rows.length ? rows[rows.length - 1] : null;
  }

  function previousFantasyEntry(player){
    const history = Array.isArray(player?.history) ? player.history : [];
    const rows = history.filter((entry) => entry?.counts_for_fantasy === true);
    return rows.length > 1 ? rows[rows.length - 2] : null;
  }

  function fantasyTrendDelta(player){
    const latest = latestFantasyEntry(player);
    const previous = previousFantasyEntry(player);
    if (!latest) return 0;
    if (!previous) return Number(latest.fantasy_points || 0);
    return Number(latest.fantasy_points || 0) - Number(previous.fantasy_points || 0);
  }

  function playerPulse(player){
    const latestPoints = Number(player?.currentFantasyPoints || latestFantasyEntry(player)?.fantasy_points || 0);
    const delta = fantasyTrendDelta(player);
    if (player?.currentWon) return { label: 'Viene de ganar', tone: 'gold' };
    if (delta >= 8) return { label: `Explota +${formatPoints(delta)}`, tone: 'hot' };
    if (latestPoints >= 18) return { label: `Muy caliente ${formatPointsLabel(latestPoints)}`, tone: 'good' };
    if (delta >= 3) return { label: `Sube ${formatPointsLabel(delta)}`, tone: 'good' };
    if (delta <= -3) return { label: `Baja ${formatPointsLabel(Math.abs(delta))}`, tone: 'muted' };
    return { label: 'Ritmo estable', tone: 'soft' };
  }

  function surpriseDelta(player){
    return Math.max(0, Number(player?.rank || 9999) - Number(player?.roundRank || 9999));
  }

  function historyEntryForRound(player, roundKey){
    const history = Array.isArray(player?.history) ? player.history : [];
    return history.find((entry) => String(entry?.round_key || '') === String(roundKey || '')) || null;
  }

  function previousFantasyEntryForRound(player, roundKey){
    const history = Array.isArray(player?.history) ? player.history : [];
    const current = historyEntryForRound(player, roundKey);
    const currentOrder = Number(current?.round_order || roundMetaForKey(roundKey)?.round_order || 0);
    if (!currentOrder) return null;
    const rows = history
      .filter((entry) => entry?.counts_for_fantasy === true && Number(entry?.round_order || 0) < currentOrder)
      .sort((a, b) => Number(a.round_order || 0) - Number(b.round_order || 0));
    return rows.length ? rows[rows.length - 1] : null;
  }

  function fantasyTrendDeltaForRound(player, roundKey){
    const latest = historyEntryForRound(player, roundKey);
    const previous = previousFantasyEntryForRound(player, roundKey);
    if (!latest) return 0;
    if (!previous) return Number(latest.fantasy_points || 0);
    return Number(latest.fantasy_points || 0) - Number(previous.fantasy_points || 0);
  }

  function playerPulseForRound(player, roundKey){
    const latest = historyEntryForRound(player, roundKey) || latestFantasyEntry(player);
    const latestPoints = Number(latest?.fantasy_points || 0);
    const delta = roundKey ? fantasyTrendDeltaForRound(player, roundKey) : fantasyTrendDelta(player);
    if (latest?.won) return { label: 'Viene de ganar', tone: 'gold' };
    if (delta >= 8) return { label: `Explota +${formatPoints(delta)}`, tone: 'hot' };
    if (latestPoints >= 18) return { label: `Muy caliente ${formatPointsLabel(latestPoints)}`, tone: 'good' };
    if (delta >= 3) return { label: `Sube ${formatPointsLabel(delta)}`, tone: 'good' };
    if (delta <= -3) return { label: `Baja ${formatPointsLabel(Math.abs(delta))}`, tone: 'muted' };
    return { label: 'Ritmo estable', tone: 'soft' };
  }

  function rosterEntriesWithPlayers(entries){
    return (entries || [])
      .map((entry) => ({ ...entry, player: entry?.player || playerForRosterRow(entry) }))
      .filter((entry) => entry.player);
  }

  function contributionRowsFromEntries(entries, roundKey){
    const rows = rosterEntriesWithPlayers(entries).map((entry) => {
      const player = entry.player;
      const roundEntry = roundKey ? historyEntryForRound(player, roundKey) : null;
      const weeklyPoints = roundKey ? Number(roundEntry?.fantasy_points || 0) : Number(player.currentFantasyPoints || 0);
      const roundLabel = String(roundEntry?.round_label || latestFantasyEntry(player)?.round_label || state.currentRound?.label || '');
      return {
        slug: String(entry.player_slug || player.slug || ''),
        name: player.name || entry.player_name || 'Jugador',
        tier: player.tier || entry.player_tier || '',
        rank: Number(player.rank || entry.player_rank || 9999),
        weeklyPoints,
        totalPoints: Number(player.totalPoints || 0),
        price: Number(entry.buy_price || player.price || 0),
        clause: Number(entry.clause_price || player.clausePrice || defaultClauseForPrice(player.price || 0)),
        wins: Number(player.wins || 0),
        delta: roundKey ? fantasyTrendDeltaForRound(player, roundKey) : fantasyTrendDelta(player),
        roundLabel,
        player
      };
    }).sort((a, b) =>
      b.weeklyPoints - a.weeklyPoints
      || b.price - a.price
      || collator.compare(a.name, b.name)
    );
    const maxPoints = Math.max(...rows.map((row) => Number(row.weeklyPoints || 0)), 0);
    return rows.map((row) => ({
      ...row,
      share: maxPoints > 0 ? clamp(Number(row.weeklyPoints || 0) / maxPoints, 0, 1) : 0,
      pulse: roundKey ? playerPulseForRound(row.player, roundKey) : playerPulse(row.player)
    }));
  }

  function renderContributionList(rows, options){
    const opts = options || {};
    if (!rows.length){
      return '<div class="empty">Aun no hay una jornada cerrada suficiente para desgranar el impacto del roster.</div>';
    }
    const listClasses = [
      'impactList',
      opts.compact ? 'compact' : '',
      opts.hidePrice && opts.hideClause ? 'statsHidden' : ''
    ].filter(Boolean).join(' ');
    return `<div class="${listClasses}">${rows.map((row) => {
      const portrait = playerPortraitUrl(row.player);
      const weeklyLabel = row.weeklyPoints > 0 ? formatPointsLabel(row.weeklyPoints) : 'Sin puntos';
      const deltaLabel = row.delta > 0 ? `+${formatPoints(row.delta)} vs cierre previo` : row.delta < 0 ? `-${formatPoints(Math.abs(row.delta))} vs cierre previo` : 'Mismo ritmo';
      const relativePct = Math.max(8, Math.round((row.share || 0) * 100));
      const railTitle = `${row.name}: ${weeklyLabel}. La barra representa su peso relativo frente al jugador que mas puntos te dio en el ultimo cierre del sabado (${relativePct}% del pico del equipo).`;
      return `<article class="impactRow ${frameClass(row.tier)}">
        <div class="impactIdentity">
          <div class="impactAvatar">${portrait ? `<img src="${escapeAttr(portrait)}" alt="${escapeAttr(row.name)}" loading="lazy" decoding="async" />` : ''}</div>
          <div class="impactCopy">
            <strong>${escapeHtml(row.name)}</strong>
            <span>#${intFmt.format(row.rank || 0)} · ${escapeHtml(tierLabel(row.tier))}</span>
          </div>
        </div>
        <div class="impactScore">
          <div class="impactScoreTop">
            <strong>${weeklyLabel}</strong>
            <span class="signalTag ${escapeAttr(row.pulse.tone)}">${escapeHtml(row.pulse.label)}</span>
          </div>
          <div class="impactRail" title="${escapeAttr(railTitle)}" aria-label="${escapeAttr(railTitle)}"><span style="width:${relativePct}%"></span></div>
          <div class="impactHint" title="${escapeAttr(railTitle)}">${escapeHtml(deltaLabel)}</div>
        </div>
        <div class="impactStats">
          ${opts.hidePrice ? '' : `<span>${renderCoinInline(row.price || 0, false)}<small>valor</small></span>`}
          ${opts.hideClause ? '' : `<span>${renderCoinInline(row.clause || 0, false)}<small>clausula</small></span>`}
        </div>
      </article>`;
    }).join('')}</div>`;
  }

  function compareMetric(label, incomingValue, outgoingValue, formatter, options){
    const fmt = formatter || ((value) => String(value ?? '-'));
    const opts = options || {};
    const incoming = Number(incomingValue || 0);
    const outgoing = Number(outgoingValue || 0);
    const delta = opts.lowerIsBetter ? outgoing - incoming : incoming - outgoing;
    const tone = delta > 0 ? 'good' : delta < 0 ? 'bad' : 'flat';
    const deltaText = delta > 0 ? `+${fmt(delta)}` : delta < 0 ? `-${fmt(Math.abs(delta))}` : 'Sin cambio';
    return `<span class="compareMetric ${tone}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(deltaText)}</strong></span>`;
  }

  function renderComparePlayerCard(player, label, metaHtml, options){
    const opts = options || {};
    if (!player){
      return `<article class="comparePlayerCard empty"><div class="comparePlayerEmpty">${escapeHtml(opts.emptyText || 'Elige una salida para comparar.')}</div></article>`;
    }
    const portrait = playerPortraitUrl(player);
    const pulse = playerPulse(player);
    const weeklyPoints = Number(player.currentFantasyPoints || 0);
    return `<article class="comparePlayerCard ${frameClass(player.tier)}">
      <div class="comparePlayerVisual">${portrait ? `<img src="${escapeAttr(portrait)}" alt="${escapeAttr(player.name || 'Jugador')}" loading="lazy" decoding="async" />` : ''}<div class="standingRosterShade"></div></div>
      <div class="comparePlayerBody">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(player.name || 'Jugador')}</strong>
        <small>#${intFmt.format(player.rank || 0)} · ${escapeHtml(tierLabel(player.tier))}</small>
        <div class="comparePlayerTags">
          <span class="signalTag ${escapeAttr(pulse.tone)}">${escapeHtml(pulse.label)}</span>
          <span>${weeklyPoints > 0 ? formatPointsLabel(weeklyPoints) : 'Sin puntos'} ultimo sabado</span>
          ${metaHtml || ''}
        </div>
      </div>
    </article>`;
  }

  function renderTransferComparison(targetPlayer, outgoingEntry, mode, cost, targetOwner, needsReplacement){
    if (!targetPlayer) return '';
    const outgoingPlayer = outgoingEntry ? playerForRosterRow(outgoingEntry) : null;
    const targetCostLabel = mode === 'buyout' ? 'Coste clausula' : 'Coste fichaje';
    const targetMeta = `<span>${renderCoinInline(cost || targetPlayer.price || 0, true)} ${escapeHtml(targetCostLabel.toLowerCase())}</span>${targetOwner ? `<span>Sale de ${escapeHtml(targetOwner.teamName || 'equipo rival')}</span>` : ''}`;
    const outgoingClause = outgoingEntry ? Number(outgoingEntry.clause_price || outgoingPlayer?.clausePrice || defaultClauseForPrice(outgoingPlayer?.price || 0)) : 0;
    const outgoingMeta = outgoingPlayer ? `<span>${renderCoinInline(outgoingPlayer.price || 0, true)} valor</span><span>${renderCoinInline(outgoingClause, true)} clausula</span>` : '';
    const targetWeekly = Number(targetPlayer.currentFantasyPoints || 0);
    const outgoingWeekly = Number(outgoingPlayer?.currentFantasyPoints || 0);
    const targetValue = Number(targetPlayer.price || cost || 0);
    const outgoingValue = Number(outgoingPlayer?.price || 0);
    const rankIncoming = Number(targetPlayer.rank || 9999);
    const rankOutgoing = Number(outgoingPlayer?.rank || 9999);
    return `<div class="transferCompare">
      <div class="transferCompareHead">
        <div>
          <span>Comparador de fichaje</span>
          <strong>${outgoingPlayer ? 'Antes de confirmar, compara entrada y salida.' : (needsReplacement ? 'Elige que jugador sale para activar la comparativa.' : 'Tienes hueco libre: este fichaje entra directo en plantilla.')}</strong>
        </div>
      </div>
      <div class="transferCompareGrid">
        ${renderComparePlayerCard(outgoingPlayer, 'Sale de tu equipo', outgoingMeta, { emptyText: needsReplacement ? 'Selecciona un jugador de tu plantilla.' : 'Hueco libre en plantilla.' })}
        ${renderComparePlayerCard(targetPlayer, 'Entra al equipo', targetMeta)}
      </div>
      ${outgoingPlayer ? `<div class="transferCompareMetrics">
        ${compareMetric('Ultimo sabado', targetWeekly, outgoingWeekly, (value) => formatPoints(value))}
        ${compareMetric('Valor mercado', targetValue, outgoingValue, (value) => formatCoins(value))}
        ${compareMetric('Ranking VBF', rankIncoming, rankOutgoing, (value) => `${intFmt.format(value)} puestos`, { lowerIsBetter: true })}
      </div>` : ''}
    </div>`;
  }

  function renderOverviewFeature(player, mode){
    const portrait = playerPortraitUrl(player);
    const pulse = playerPulse(player);
    const latestPoints = Number(player.currentFantasyPoints || 0);
    const delta = surpriseDelta(player);
    const rankValue = mode === 'surprise' ? (player.roundRank || 0) : (player.rank || 0);
    const subtitle = mode === 'surprise'
      ? `${tierLabel(player.tier)} · jornada #${intFmt.format(player.roundRank || 0)}`
      : `${tierLabel(player.tier)} · ranking VBF #${intFmt.format(player.rank || 0)}`;
    const chips = mode === 'surprise'
      ? [
        pulse.label,
        latestPoints > 0 ? `${formatPointsLabel(latestPoints)} ultimo sabado` : 'Ult. sabado sin puntos',
        `+${intFmt.format(delta)} puestos sobre VadeBack`
      ]
      : [
        pulse.label,
        `${intFmt.format(Math.round(player.totalPoints || 0))} berries historicas`,
        `${intFmt.format(player.wins || 0)} victorias`,
        latestPoints > 0 ? `Ult. sabado ${formatPointsLabel(latestPoints)}` : 'Ult. sabado sin puntos'
      ];
    return `<button class="overviewFeatureCard ${frameClass(player.tier)}" type="button" data-open-player="${escapeAttr(player.slug || '')}" data-player-source="market">
      <div class="overviewFeatureVisual">${portrait ? `<img src="${escapeAttr(portrait)}" alt="${escapeAttr(player.name || 'Jugador')}" loading="lazy" decoding="async" />` : ''}<div class="standingRosterShade"></div></div>
      <div class="overviewFeatureBody">
        <div class="overviewFeatureHead">
          <div class="overviewFeatureTopline">
            <div class="overviewFeatureName">${escapeHtml(player.name || 'Jugador')}</div>
            <div class="overviewFeatureMarkers">
              <span class="overviewRankChip">#${intFmt.format(rankValue)}</span>
            </div>
          </div>
          <div class="overviewFeatureSubtitle">${escapeHtml(subtitle)}</div>
        </div>
        <div class="overviewFeatureStats compact">${chips.map((text, index) => index === 0 ? `<span class="signalTag ${escapeAttr(pulse.tone)}">${escapeHtml(text)}</span>` : `<span>${escapeHtml(text)}</span>`).join('')}</div>
      </div>
    </button>`;
  }

  function marketBadgeForPlayer(player){
    const delta = fantasyTrendDelta(player);
    if (isWatched(player.slug)) return { icon: 'R', title: 'En tu radar: jugador guardado en tu watchlist.', tone: 'watch' };
    if (player.currentWon) return { icon: 'W', title: 'Ganador: viene de cerrar la mejor jornada puntuable del sabado.', tone: 'gold' };
    if (surpriseDelta(player) >= 6 && Number(player.currentFantasyPoints || 0) > 0) return { icon: '+', title: 'Oportunidad: esta rindiendo por encima de su sitio natural en VadeBack.', tone: 'good' };
    if (delta >= 6 || Number(player.currentFantasyPoints || 0) >= 16) return { icon: 'H', title: 'En racha: viene encadenando cierres fantasy muy fuertes.', tone: 'hot' };
    if (delta <= -4) return { icon: '-', title: 'A la baja: llega con menos ritmo que en cierres anteriores.', tone: 'soft' };
    return null;
  }

  function fantasyValueScore(player, cost){
    const price = Math.max(1, Number(cost || player?.price || 0));
    return (Number(player?.currentFantasyPoints || 0) * 10000) / price;
  }

  function marketFilterAllows(player, ownership){
    const mode = String(state.marketFilter || 'all');
    const cfg = config();
    const copiesUsed = Number(ownership?.count || 0);
    const direct = copiesUsed < cfg.maxPlayerCopies;
    if (mode === 'watchlist') return isWatched(player.slug);
    if (mode === 'free') return direct;
    if (mode === 'clause') return !direct;
    if (mode === 'hot') return fantasyTrendDelta(player) >= 4 || Number(player.currentFantasyPoints || 0) >= 16 || player.currentWon === true;
    if (mode === 'bargain') return direct && fantasyValueScore(player, player.price || 0) >= 1.25;
    return true;
  }

  function marketFilterLabel(){
    const map = {
      all: 'Todo el mercado',
      watchlist: 'Mi watchlist',
      free: 'Libres',
      clause: 'Clausulables',
      hot: 'En racha',
      bargain: 'Gangas'
    };
    return map[String(state.marketFilter || 'all')] || map.all;
  }

  function sortPlayers(a, b, mode){
    if (mode === 'vbf_full_rank') return (a.rank || 9999) - (b.rank || 9999) || collator.compare(a.name, b.name);
    if (mode === 'price_desc') return (b.price || 0) - (a.price || 0) || collator.compare(a.name, b.name);
    if (mode === 'price_asc') return (a.price || 0) - (b.price || 0) || collator.compare(a.name, b.name);
    if (mode === 'wins_desc') return (b.wins || 0) - (a.wins || 0) || (b.totalPoints || 0) - (a.totalPoints || 0);
    if (mode === 'name_asc') return collator.compare(a.name, b.name);
    if (mode === 'general_desc') return (b.totalPoints || 0) - (a.totalPoints || 0) || collator.compare(a.name, b.name);
    return (b.currentFantasyPoints || 0) - (a.currentFantasyPoints || 0) || (b.totalPoints || 0) - (a.totalPoints || 0) || collator.compare(a.name, b.name);
  }

  function leagueDerived(){
    const cfg = config();
    const rosterByTeam = new Map();
    const ownershipBySlug = new Map();
    state.seasonRoster.forEach((row) => {
      const key = String(row.team_id);
      if (!rosterByTeam.has(key)) rosterByTeam.set(key, []);
      rosterByTeam.get(key).push(row);
      const slug = String(row.player_slug || '');
      if (slug){
        const next = ownershipBySlug.get(slug) || { count: 0, minClause: null, owners: [] };
        const clause = Number(row.clause_price || 0);
        next.count += 1;
        next.minClause = next.minClause == null ? clause : Math.min(next.minClause, clause);
        next.owners.push({
          teamId: String(row.team_id || ''),
          userId: String(row.user_id || ''),
          clausePrice: clause,
          playerName: row.player_name || slug,
          acquiredAt: row.created_at || ''
        });
        ownershipBySlug.set(slug, next);
      }
    });

    const teamById = new Map(state.seasonTeams.map((team) => [String(team.id), team]));
    const standings = state.seasonTeams.map((team) => {
      const roster = rosterByTeam.get(String(team.id)) || [];
      const weeklyPoints = storedWeeklyPoints(team.id);
      const coachName = profileNameForUser(team.user_id);
      const teamName = String(team.team_name || '').trim() || coachName || 'Equipo';
      const weeklyState = getTeamRound(team.id, state.currentRound?.key || '');
      const players = roster
        .map((row) => ({ ...row, player: playerForRosterRow(row) }))
        .sort((a, b) => (a.player.rank || 9999) - (b.player.rank || 9999) || collator.compare(a.player.name || '', b.player.name || ''));
      return {
        id: String(team.id),
        userId: String(team.user_id),
        teamName,
        coachName,
        coins: Number(team.coins || 0),
        rosterCount: roster.length,
        weeklyPoints,
        generalPoints: storedGeneralPoints(team),
        rewardCoins: Number(weeklyState?.reward_coins || Math.max(0, Math.round(weeklyPoints * 1000))),
        transfersUsed: Number(weeklyState?.transfers_used || 0),
        players
      };
    }).sort((a, b) => b.weeklyPoints - a.weeklyPoints || b.generalPoints - a.generalPoints || collator.compare(a.teamName, b.teamName)).map((row, index) => ({ ...row, rank: index + 1 }));

    const myRoster = state.currentTeam ? (rosterByTeam.get(String(state.currentTeam.id)) || []) : [];
    const squadCards = myRoster
      .map((row) => ({ ...row, player: playerForRosterRow(row) }))
      .sort((a, b) => (a.player.rank || 9999) - (b.player.rank || 9999) || collator.compare(a.player.name || '', b.player.name || ''));

    const marketPlayers = state.poolPlayers.map((player) => {
      const ownership = ownershipBySlug.get(String(player.slug || '')) || { count: 0, minClause: null, owners: [] };
      const minClause = ownership.minClause == null ? defaultClauseForPrice(player.price || 0) : ownership.minClause;
      const owners = ownership.owners.map((owner) => {
        const team = teamById.get(String(owner.teamId || ''));
        return {
          ...owner,
          teamName: team?.team_name || 'Equipo',
          coachName: profileNameForUser(owner.userId),
          isMine: state.currentTeam ? String(owner.teamId) === String(state.currentTeam.id) : false
        };
      }).sort((a, b) => a.clausePrice - b.clausePrice || collator.compare(a.teamName || '', b.teamName || ''));
      return {
        ...player,
        ownershipCount: ownership.count,
        copiesUsed: ownership.count,
        copiesLeft: Math.max(0, cfg.maxPlayerCopies - ownership.count),
        minClause,
        marketMode: ownership.count < cfg.maxPlayerCopies ? 'market' : 'buyout',
        canDirectBuy: ownership.count < cfg.maxPlayerCopies,
        owners
      };
    }).filter((player) => {
      const query = state.marketSearch.trim().toLowerCase();
      const textMatch = !query || player.name.toLowerCase().includes(query) || String(player.tier || '').toLowerCase().includes(query);
      return textMatch && marketFilterAllows(player, { count: player.copiesUsed || 0 });
    }).sort((a, b) => sortPlayers(a, b, state.marketSort)).slice(0, MAX_MARKET_CARDS);

    return { standings, squadCards, marketPlayers, myRoster, ownershipBySlug };
  }

  function buyBlockReason(player, roster){
    const cfg = config();
    if (!state.currentUser) return 'Inicia sesion';
    if (!state.currentTeam) return 'Crea equipo';
    if (!cfg.isOpen || !marketOpenNow()) return 'Mercado cerrado';
    if (roster.some((row) => String(row.player_slug) === String(player.slug))) return 'Ya en plantilla';
    if (!player?.canDirectBuy) return 'Solo clausula';
    const cost = Number(player.price || 0);
    if (Number(state.currentTeam?.coins || 0) < cost) return 'Sin berries';
    return '';
  }

  function marketDetailsForPlayer(player, derived){
    const visible = derived.marketPlayers.find((item) => String(item.slug) === String(player?.slug || ''));
    if (visible) return visible;
    const cfg = config();
    const teamById = new Map(state.seasonTeams.map((team) => [String(team.id), team]));
    const ownershipRows = state.seasonRoster.filter((row) => String(row.player_slug || '') === String(player?.slug || ''));
    const owners = ownershipRows.map((row) => ({
      teamId: String(row.team_id || ''),
      userId: String(row.user_id || ''),
      clausePrice: Number(row.clause_price || defaultClauseForPrice(player?.price || 0)),
      playerName: row.player_name || player?.name || row.player_slug || 'Jugador',
      acquiredAt: row.created_at || '',
      teamName: teamById.get(String(row.team_id || ''))?.team_name || 'Equipo',
      coachName: profileNameForUser(row.user_id),
      isMine: state.currentTeam ? String(row.team_id) === String(state.currentTeam.id) : false
    })).sort((a, b) => a.clausePrice - b.clausePrice || collator.compare(a.teamName || '', b.teamName || ''));
    const copiesUsed = owners.length;
    const minClause = owners.length ? Math.min(...owners.map((owner) => Number(owner.clausePrice || 0))) : defaultClauseForPrice(player?.price || 0);
    return {
      ...player,
      ownershipCount: copiesUsed,
      copiesUsed,
      copiesLeft: Math.max(0, cfg.maxPlayerCopies - copiesUsed),
      minClause,
      marketMode: copiesUsed < cfg.maxPlayerCopies ? 'market' : 'buyout',
      canDirectBuy: copiesUsed < cfg.maxPlayerCopies,
      owners
    };
  }

  function suggestedTargets(limit){
    if (!state.currentTeam) return [];
    const derived = leagueDerived();
    const ownSlugs = new Set((derived.myRoster || []).map((row) => String(row.player_slug || '')));
    const currentRows = contributionRowsFromEntries(derived.myRoster || []);
    const weakest = currentRows.slice().sort((a, b) =>
      a.weeklyPoints - b.weeklyPoints
      || a.price - b.price
      || collator.compare(a.name, b.name)
    )[0] || null;
    const budget = Number(state.currentTeam?.coins || 0);
    return state.poolPlayers
      .filter((player) => !ownSlugs.has(String(player.slug || '')))
      .map((player) => {
        const details = marketDetailsForPlayer(player, derived);
        const direct = details.canDirectBuy;
        const cost = direct ? Number(player.price || 0) : Number(details.minClause || defaultClauseForPrice(player.price || 0));
        const delta = surpriseDelta(player);
        const gain = weakest ? Number(player.currentFantasyPoints || 0) - Number(weakest.weeklyPoints || 0) : Number(player.currentFantasyPoints || 0);
        const affordable = budget >= cost;
        const score = (Number(player.currentFantasyPoints || 0) * 5)
          + (delta * 1.5)
          + (Number(player.wins || 0) * 1.2)
          + (direct ? 5 : 0)
          + (affordable ? 3 : -8)
          + gain;
        const reason = direct
          ? (delta > 0 ? `Sube ${intFmt.format(delta)} puestos y sigue libre` : 'Disponible ahora mismo')
          : `Solo clausula · desde ${formatCoins(cost)}`;
        return {
          player,
          details,
          cost,
          affordable,
          gain,
          reason,
          score,
          direct
        };
      })
      .sort((a, b) =>
        b.score - a.score
        || b.gain - a.gain
        || (b.player.currentFantasyPoints || 0) - (a.player.currentFantasyPoints || 0)
        || collator.compare(a.player.name, b.player.name)
      )
      .slice(0, Number(limit || 4));
  }

  function teamNameForId(teamId){
    const team = state.seasonTeams.find((item) => String(item.id || '') === String(teamId || ''));
    return String(team?.team_name || '').trim() || 'Equipo fantasy';
  }

  function marketActivityRows(limit){
    const seen = new Set();
    return (state.transactions || [])
      .filter((tx) => ['starter', 'buy', 'release', 'clause_in', 'system_reward'].includes(String(tx.tx_type || '')))
      .filter((tx) => {
        if (String(tx.tx_type || '') !== 'clause_in') return true;
        const key = `${tx.round_key || ''}:${tx.team_id || ''}:${tx.player_slug || ''}:${tx.amount || 0}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, Number(limit || 8));
  }

  function txTypeMeta(tx){
    const type = String(tx?.tx_type || '');
    if (type === 'buy') return { label: 'Fichaje', tone: 'good', verb: 'ficha' };
    if (type === 'clause_in') return { label: 'Clausulazo', tone: 'hot', verb: 'paga clausula por' };
    if (type === 'release') return { label: 'Salida', tone: 'soft', verb: 'libera a' };
    if (type === 'starter') return { label: 'Starter', tone: 'gold', verb: 'recibe a' };
    if (type === 'system_reward') return { label: 'Premio', tone: 'good', verb: 'cobra recompensa' };
    return { label: 'Movimiento', tone: 'soft', verb: 'mueve' };
  }

  function renderMarketActivity(){
    const host = $('marketActivityPanel');
    if (!host) return;
    const rows = marketActivityRows(PAGE_VIEW === 'market' ? 10 : 6);
    if (!rows.length){
      host.innerHTML = '<div class="empty">Aun no hay movimientos de mercado para mostrar.</div>';
      return;
    }
    host.innerHTML = `<div class="activityList">${rows.map((tx) => {
      const meta = txTypeMeta(tx);
      const player = state.playersBySlug.get(String(tx.player_slug || '')) || null;
      const manager = profileNameForUser(tx.user_id);
      const teamName = teamNameForId(tx.team_id);
      const amount = Number(tx.amount || 0);
      const dateLabel = App.formatRelativeTime ? App.formatRelativeTime(tx.created_at, '') : '';
      const playerName = player?.name || tx.player_name || 'jugador';
      const actionHtml = String(tx.tx_type || '') === 'system_reward'
        ? `${escapeHtml(manager)} cobra recompensa de jornada`
        : `${escapeHtml(manager)} ${escapeHtml(meta.verb)} ${tx.player_slug ? `<button class="textAction" type="button" data-open-player="${escapeAttr(tx.player_slug || '')}" data-player-source="market">${escapeHtml(playerName)}</button>` : escapeHtml(playerName)}`;
      return `<article class="activityItem ${escapeAttr(meta.tone)}">
        <div class="activityBadge">${escapeHtml(meta.label)}</div>
        <div class="activityBody">
          <strong>${escapeHtml(teamName)}</strong>
          <span>${actionHtml}</span>
          <small>${amount > 0 ? renderCoinInline(amount, true) : 'Sin coste'}${dateLabel ? ` · ${escapeHtml(dateLabel)}` : ''}</small>
        </div>
      </article>`;
    }).join('')}</div>`;
  }

  function renderRoundPulse(){
    const host = $('roundPulsePanel');
    if (!host) return;
    const round = displayRoundMeta();
    const roundKey = String(round?.round_key || state.currentRound?.key || '');
    const players = state.poolPlayers.map((player) => {
      const entry = roundKey ? historyEntryForRound(player, roundKey) : latestFantasyEntry(player);
      const weeklyPoints = Number(entry?.fantasy_points || player.currentFantasyPoints || 0);
      const delta = roundKey ? fantasyTrendDeltaForRound(player, roundKey) : fantasyTrendDelta(player);
      return { player, weeklyPoints, delta, valueScore: fantasyValueScore(player, player.price || 0) };
    }).filter((row) => row.weeklyPoints > 0 || row.delta !== 0);
    const derived = leagueDerived();
    const topManager = derived.standings.slice().sort((a, b) => (b.rewardCoins || 0) - (a.rewardCoins || 0) || (b.weeklyPoints || 0) - (a.weeklyPoints || 0))[0] || null;
    const topPlayer = players.slice().sort((a, b) => b.weeklyPoints - a.weeklyPoints || collator.compare(a.player.name, b.player.name))[0] || null;
    const riser = players.slice().sort((a, b) => b.delta - a.delta || b.weeklyPoints - a.weeklyPoints)[0] || null;
    const bargain = players.slice().filter((row) => Number(row.player.price || 0) > 0).sort((a, b) => b.valueScore - a.valueScore || b.weeklyPoints - a.weeklyPoints)[0] || null;
    if (!topPlayer && !topManager){
      host.innerHTML = '<div class="empty">Todavia no hay suficiente informacion de jornada para construir el pulso.</div>';
      return;
    }
    const pulseCards = [
      topManager ? {
        kicker: 'Manager caliente',
        title: topManager.teamName,
        meta: `${topManager.coachName || 'Manager'} · ${formatPointsLabel(topManager.weeklyPoints || 0)}`,
        value: renderCoinInline(topManager.rewardCoins || 0, true),
        tone: 'good'
      } : null,
      topPlayer ? {
        kicker: 'MVP fantasy',
        title: topPlayer.player.name,
        meta: `#${intFmt.format(topPlayer.player.rank || 0)} VBF · ${tierLabel(topPlayer.player.tier)}`,
        value: formatPointsLabel(topPlayer.weeklyPoints),
        slug: topPlayer.player.slug,
        tone: 'gold'
      } : null,
      riser ? {
        kicker: 'Subida de ritmo',
        title: riser.player.name,
        meta: `Cambio vs cierre previo`,
        value: riser.delta > 0 ? `+${formatPoints(riser.delta)}` : formatPoints(riser.delta),
        slug: riser.player.slug,
        tone: riser.delta >= 0 ? 'hot' : 'soft'
      } : null,
      bargain ? {
        kicker: 'Valor por berry',
        title: bargain.player.name,
        meta: `${formatPointsLabel(bargain.weeklyPoints)} por ${formatCoins(bargain.player.price || 0)}`,
        value: decFmt.format(bargain.valueScore),
        slug: bargain.player.slug,
        tone: 'watch'
      } : null
    ].filter(Boolean);
    host.innerHTML = `<div class="pulseGrid">${pulseCards.map((card) => {
      const content = `<div class="pulseKicker ${escapeAttr(card.tone)}">${escapeHtml(card.kicker)}</div><strong>${escapeHtml(card.title)}</strong><span>${escapeHtml(card.meta)}</span><div class="pulseValue">${card.value}</div>`;
      return card.slug
        ? `<button class="pulseCard" type="button" data-open-player="${escapeAttr(card.slug)}" data-player-source="market">${content}</button>`
        : `<article class="pulseCard">${content}</article>`;
    }).join('')}</div><div class="helper compactHelper">Pulso calculado con ${escapeHtml(round?.round_label || state.currentRound?.label || 'la jornada actual')} y el historico fantasy disponible.</div>`;
  }

  function renderHero(){
    const statPlayers = $('statPlayers');
    const statTeams = $('statTeams');
    const statCurrentRound = $('statCurrentRound');
    if (statPlayers){
      if (state.loadingPlayers) statPlayers.textContent = '...';
      else animateStatNumber(statPlayers, state.poolPlayers.length);
    }
    if (statTeams){
      if (state.loadingLeague) statTeams.textContent = '...';
      else animateStatNumber(statTeams, state.seasonTeams.length);
    }
    if (statCurrentRound) statCurrentRound.textContent = state.loadingPlayers ? '...' : (state.currentRound?.label || '-');
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

  function openTeamModal(teamId){
    state.modalTeamId = String(teamId || '').trim();
    renderTeamModal();
  }

  function closeTeamModal(){
    state.modalTeamId = '';
    renderTeamModal();
  }

  function openBuyConfirm(slug, targetTeamId){
    state.confirmBuySlug = String(slug || '').trim();
    state.confirmBuyTargetTeamId = String(targetTeamId || '').trim();
    state.confirmBuyOutgoingSlug = '';
    renderBuyConfirm();
  }

  function closeBuyConfirm(){
    state.confirmBuySlug = '';
    state.confirmBuyTargetTeamId = '';
    state.confirmBuyOutgoingSlug = '';
    renderBuyConfirm();
  }

  function buyConfirmBlockReason(player, mode, cost, roster, targetOwner){
    const cfg = config();
    if (!state.currentUser) return 'Inicia sesion';
    if (!state.currentTeam) return 'Crea equipo';
    if (!cfg.isOpen || !marketOpenNow()) return 'Mercado cerrado';
    if (roster.some((row) => String(row.player_slug) === String(player.slug))) return 'Ya en plantilla';
    if (mode === 'market' && !player?.canDirectBuy) return 'Solo disponible por clausula';
    if (mode === 'buyout' && !targetOwner) return 'Elige un equipo propietario';
    if (Number(state.currentTeam?.coins || 0) < Number(cost || 0)) return 'Sin berries';
    if (roster.length >= cfg.squadSize && !state.confirmBuyOutgoingSlug) return 'Elige a quien sustituyes';
    return '';
  }

  function renderBuyConfirm(){
    const wrap = $('buyConfirmWrap');
    const title = $('buyConfirmTitle');
    const text = $('buyConfirmText');
    const action = $('buyConfirmAccept');
    const body = $('buyConfirmBody');
    if (!wrap || !title || !text || !action || !body) return;
    if (!state.confirmBuySlug){
      wrap.classList.add('hidden');
      wrap.setAttribute('aria-hidden', 'true');
      if (!state.modalPlayerSlug) document.body.style.overflow = '';
      body.innerHTML = '';
      return;
    }
    const derived = leagueDerived();
    const player = derived.marketPlayers.find((item) => String(item.slug) === String(state.confirmBuySlug || ''));
    const roster = derived.myRoster || [];
    const targetOwner = player?.owners?.find((owner) => String(owner.teamId || '') === String(state.confirmBuyTargetTeamId || '')) || null;
    const mode = targetOwner ? 'buyout' : (player?.canDirectBuy ? 'market' : 'buyout');
    const cost = targetOwner ? Number(targetOwner.clausePrice || 0) : Number(player?.price || 0);
    const blocked = player ? buyConfirmBlockReason(player, mode, cost, roster, targetOwner) : 'Jugador invalido';
    const actionLabel = mode === 'buyout' ? 'Pagar clausula' : 'Fichar';
    title.textContent = mode === 'buyout' ? 'Confirmar clausulazo' : 'Confirmar fichaje';
    text.innerHTML = player
      ? `Vas a ${mode === 'buyout' ? 'pagar la clausula de' : 'fichar a'} <strong>${escapeHtml(player.name)}</strong> por ${renderCoinInline(cost, false)}.`
      : 'No pude encontrar el jugador seleccionado.';
    action.innerHTML = player ? `${actionLabel} - ${renderCoinInline(cost, true)}` : 'Comprar';
    action.disabled = !!blocked;
    if (blocked) text.innerHTML = `${text.innerHTML} ${escapeHtml(blocked)}.`;
    const outgoingEntry = roster.find((row) => String(row.player_slug || '') === String(state.confirmBuyOutgoingSlug || '')) || null;
    const needsReplacement = roster.length >= config().squadSize;
    const comparisonHtml = player ? renderTransferComparison(player, outgoingEntry, mode, cost, targetOwner, needsReplacement) : '';
    const replacementOptions = roster.map((row) => {
      const rosterPlayer = playerForRosterRow(row);
      const checked = String(state.confirmBuyOutgoingSlug || '') === String(row.player_slug || '');
      return `<label class="replaceOption"><input type="radio" name="buyReplacePlayer" value="${escapeAttr(row.player_slug || '')}" ${checked ? 'checked' : ''} /><div><strong>${escapeHtml(rosterPlayer.name || row.player_name || 'Jugador')}</strong><span>#${intFmt.format(rosterPlayer.rank || 0)} - ${escapeHtml(tierLabel(rosterPlayer.tier))}</span></div></label>`;
    }).join('');
    const ownerInfo = targetOwner
      ? `<div class="helper">La clausula sale del equipo <strong>${escapeHtml(targetOwner.teamName || 'Equipo')}</strong> de ${escapeHtml(targetOwner.coachName || 'Manager')} y le abona ${renderCoinInline(targetOwner.clausePrice || 0, false)}.</div>`
      : '';
    body.innerHTML = `${ownerInfo}${comparisonHtml}${needsReplacement ? `<div class="confirmPicker"><div class="confirmPickerLabel">Jugador que sale de tu plantilla</div><div class="replaceGrid">${replacementOptions}</div></div>` : `<div class="helper">Tienes un hueco libre en plantilla, asi que esta ficha entra directa.</div>`}`;
    wrap.classList.remove('hidden');
    wrap.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function renderPlayerInsightPanel(player, marketPlayer, source, rosterEntry){
    if (!player) return '';
    const latest = Number(player.currentFantasyPoints || 0);
    const delta = fantasyTrendDelta(player);
    const price = Number(player.price || rosterEntry?.buy_price || 0);
    const clauseValue = source === 'team'
      ? Number(rosterEntry?.clause_price || defaultClauseForPrice(price))
      : Number(marketPlayer?.minClause || defaultClauseForPrice(price));
    const valueScore = fantasyValueScore(player, source === 'market' && marketPlayer && !marketPlayer.canDirectBuy ? clauseValue : price);
    const availability = source === 'market'
      ? (marketPlayer?.canDirectBuy ? `${intFmt.format(marketPlayer.copiesLeft || 0)} cupos libres` : 'Solo por clausula')
      : 'En tu plantilla';
    const recommendation = source === 'team'
      ? (latest >= 14 || delta >= 4 ? 'Mantener como pieza caliente' : latest <= 4 && delta < 0 ? 'Candidato a reemplazo' : 'Seguimiento normal')
      : (marketPlayer?.canDirectBuy && valueScore >= 1.25 ? 'Oportunidad de compra' : !marketPlayer?.canDirectBuy ? 'Mirar clausula concreta' : 'Objetivo estable');
    const tone = recommendation.includes('Oportunidad') || recommendation.includes('Mantener') ? 'good' : recommendation.includes('reemplazo') ? 'bad' : 'flat';
    return `<div class="playerInsightPanel">
      <div class="playerInsightHead">
        <div>
          <span>Lectura fantasy</span>
          <strong>${escapeHtml(recommendation)}</strong>
        </div>
        <span class="compareMetric ${escapeAttr(tone)}"><small>Valor/berry</small><strong>${decFmt.format(valueScore)}</strong></span>
      </div>
      <div class="playerInsightGrid">
        <span><small>Tendencia</small><strong>${delta > 0 ? `+${formatPoints(delta)}` : delta < 0 ? `-${formatPoints(Math.abs(delta))}` : '0,0'}</strong></span>
        <span><small>Disponibilidad</small><strong>${escapeHtml(availability)}</strong></span>
        <span><small>Ranking jornada</small><strong>#${intFmt.format(player.roundRank || player.rank || 0)}</strong></span>
        <span><small>Sorpresa</small><strong>${surpriseDelta(player) > 0 ? `+${intFmt.format(surpriseDelta(player))}` : 'Estable'}</strong></span>
      </div>
    </div>`;
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
    const derived = leagueDerived();
    const roster = derived.myRoster;
    const marketPlayer = source === 'market' ? marketDetailsForPlayer(player, derived) : null;
    const currentPrice = source === 'team' ? Number(rosterEntry?.buy_price || player.price || 0) : Number(player.price || 0);
    const modalOverlay = `<div class="playerOverlayBottom"><div class="overlayNamePlain">${escapeHtml(player.name)}</div><div class="overlaySubtitle">#${intFmt.format(player.rank || 0)} - ${escapeHtml(tierLabel(player.tier))}</div></div>`;
    const clauseValue = source === 'team' ? Number(rosterEntry?.clause_price || player.clausePrice || defaultClauseForPrice(player.price || 0)) : Number(marketPlayer?.minClause || defaultClauseForPrice(player.price || 0));
    const copiesLabel = source === 'market' ? `${intFmt.format(Number(marketPlayer?.copiesUsed || 0))}/${intFmt.format(config().maxPlayerCopies)}` : `${intFmt.format((derived.ownershipBySlug.get(String(player.slug || ''))?.count) || 0)}/${intFmt.format(config().maxPlayerCopies)}`;
    const fullHistory = Array.isArray(player.history) ? player.history : [];
    const playedCount = fullHistory.filter((item) => Number.isFinite(Number(item?.raw_points)) && Number(item.raw_points) > 0).length;
    const saturdayCount = fullHistory.filter((item) => item?.counts_for_fantasy === true && Number.isFinite(Number(item?.raw_points)) && Number(item.raw_points) > 0).length;
    const ownerRows = (marketPlayer?.owners || []).map((owner) => {
      const disabled = owner.isMine || !marketOpenNow() || Number(state.currentTeam?.coins || 0) < Number(owner.clausePrice || 0);
      const title = owner.isMine ? 'Ya tienes esta copia' : (!marketOpenNow() ? 'Mercado cerrado' : (Number(state.currentTeam?.coins || 0) < Number(owner.clausePrice || 0) ? 'Sin berries suficientes' : `Pagar clausula a ${owner.teamName}`));
      return `<div class="ownerRow"><div class="ownerMeta"><strong>${escapeHtml(owner.teamName || 'Equipo')}</strong><span>${escapeHtml(owner.coachName || 'Manager')}</span><span class="ownerHint">${owner.isMine ? 'Tu copia actual' : 'Copia en juego'}</span></div><button class="btn btnPrimary compactBtn" type="button" data-buy-confirm="${escapeAttr(player.slug || '')}" data-buy-target-team="${escapeAttr(owner.teamId || '')}" ${disabled ? 'disabled' : ''} title="${escapeAttr(title)}">Clausula - ${renderCoinInline(owner.clausePrice || 0, true)}</button></div>`;
    }).join('');
    const marketHint = source === 'market'
      ? (marketPlayer?.canDirectBuy
        ? `<div class="modalMarketHint">Quedan cupos libres (${copiesLabel}). Puedes ficharlo directo desde el pool y, si ya tienes 3, eliges a quien sustituyes.</div>`
        : `<div class="modalMarketHint">Ya ha llenado sus ${intFmt.format(config().maxPlayerCopies)} cupos (${copiesLabel}). Solo entra por clausula sobre alguno de los equipos que lo tienen.</div>`)
      : `<div class="modalMarketHint">Tu copia actual tiene un valor de mercado de ${renderCoinInline(Number(player.price || currentPrice), false)} y una clausula vigente de ${renderCoinInline(clauseValue, false)}.</div>`;
    const directBlocked = source === 'market' ? buyBlockReason(marketPlayer, roster) : '';
    const directAction = source === 'market' && marketPlayer?.canDirectBuy
      ? `<div class="modalActions"><button class="btn btnPrimary" type="button" data-buy-confirm="${escapeAttr(player.slug || '')}" ${directBlocked ? 'disabled' : ''}>Fichar - ${renderCoinInline(Number(player.price || 0), true)}</button></div>`
      : '';
    const ownersBlock = source === 'market' && ownerRows
      ? `<div class="historyWrap"><div class="historyTitle">Equipos donde juega ahora</div><div class="ownerList">${ownerRows}</div></div>`
      : '';
    const watchAction = source === 'market' ? renderWatchButton(player) : '';
    const insightPanel = renderPlayerInsightPanel(player, marketPlayer, source, rosterEntry);
    body.innerHTML = `<div class="modalVisual"><article class="playerCard ${frameClass(player.tier)}"><div class="playerHead">${renderPlayerVisual(player, modalOverlay)}</div></article>${watchAction}</div><div class="modalPanel"><div><div class="modalEyebrow">${source === 'team' ? 'Tu plantilla' : 'Pool de jugadores'}</div><h3 class="modalTitle">${escapeHtml(player.name)}</h3><div class="modalSubtitle">#${intFmt.format(player.rank || 0)} - ${escapeHtml(tierLabel(player.tier))}</div></div><div class="modalStats"><div class="modalStat"><span>${source === 'team' ? 'Valor actual' : 'Precio mercado'}</span><strong>${renderCoinInline(source === 'team' ? Number(player.price || currentPrice) : currentPrice, false)}</strong></div><div class="modalStat"><span>Clausula</span><strong>${renderCoinInline(clauseValue, false)}</strong></div><div class="modalStat"><span>${source === 'team' ? 'Copias en liga' : 'Cupos usados'}</span><strong>${copiesLabel}</strong></div><div class="modalStat"><span>Ultima jornada fantasy</span><strong>${formatPointsLabel(player.currentFantasyPoints || 0)}</strong></div><div class="modalStat"><span>Victorias</span><strong>${intFmt.format(player.wins || 0)}</strong></div><div class="modalStat"><span>Torneos jugados</span><strong>${intFmt.format(playedCount)}</strong><small>${intFmt.format(saturdayCount)} sabados fantasy</small></div></div>${insightPanel}${marketHint}${ownersBlock}<div class="historyWrap"><div class="historyTitle">Progresion por torneo</div>${renderHistoryChart(player)}</div>${directAction}</div>`;
    wrap.classList.remove('hidden');
    wrap.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function renderTeamModal(){
    const wrap = $('teamModalWrap');
    const body = $('teamModalBody');
    if (!wrap || !body) return;
    if (!state.modalTeamId){
      wrap.classList.add('hidden');
      wrap.setAttribute('aria-hidden', 'true');
      if (!state.modalPlayerSlug && !state.confirmBuySlug) document.body.style.overflow = '';
      body.innerHTML = '';
      return;
    }
    const derived = leagueDerived();
    const team = derived.standings.find((row) => String(row.id) === String(state.modalTeamId || ''));
    if (!team){
      closeTeamModal();
      return;
    }
    const slots = Array.from({ length: config().squadSize }, (_, index) => team.players[index] || null);
    const closedRound = latestClosedRound();
    const contributionRows = closedRound
      ? contributionRowsForTeamRound(team.id, closedRound.round_key, team.players || [])
      : contributionRowsFromEntries(team.players || []);
    const marketValue = contributionRows.reduce((sum, row) => sum + Number(row.price || 0), 0);
    const clauseValue = contributionRows.reduce((sum, row) => sum + Number(row.clause || 0), 0);
    const avgRank = contributionRows.length ? Math.round(contributionRows.reduce((sum, row) => sum + Number(row.rank || 0), 0) / contributionRows.length) : 0;
    const bestAsset = contributionRows.slice().sort((a, b) => b.price - a.price || collator.compare(a.name, b.name))[0] || null;
    const roster = slots.map((entry) => {
      if (!entry){
        return `<div class="standingRosterCard empty" aria-hidden="true"><div class="standingRosterVisual empty"></div><span class="standingRosterName">Hueco libre</span></div>`;
      }
      const portrait = playerPortraitUrl(entry.player);
      return `<button class="standingRosterCard ${frameClass(entry.player.tier)}" type="button" data-open-player="${escapeAttr(entry.player_slug || '')}" data-player-source="market" title="Ver ficha de ${escapeAttr(entry.player.name || entry.player_slug || 'Jugador')}"><div class="standingRosterVisual">${portrait ? `<img src="${escapeAttr(portrait)}" alt="${escapeAttr(entry.player.name || 'Jugador')}" loading="lazy" decoding="async" />` : ''}<div class="standingRosterShade"></div></div><span class="standingRosterName">${escapeHtml(entry.player.name || entry.player_slug || 'Jugador')}</span></button>`;
    }).join('');
    body.innerHTML = `<div class="teamModalShell">
      <div class="teamModalHero">
        <div>
          <div class="modalEyebrow">Equipo fantasy</div>
          <h3 class="modalTitle">${escapeHtml(team.teamName)}</h3>
          <div class="modalSubtitle">${escapeHtml(team.coachName || 'Manager')} · ${formatPointsLabel(team.generalPoints)} acumulados</div>
        </div>
        <div class="pillRow">
          <span class="pill strong">${renderCoinInline(team.rewardCoins || 0, false)} esta semana</span>
          <span class="pill">Jornada ${formatPointsLabel(team.weeklyPoints)}</span>
        </div>
      </div>
      <div class="modalStats teamModalStatsWide">
        <div class="modalStat"><span>Puesto semanal</span><strong>#${intFmt.format(team.displayRank || team.rank || 0)}</strong></div>
        <div class="modalStat"><span>Valor del roster</span><strong>${renderCoinInline(marketValue, false)}</strong></div>
        <div class="modalStat"><span>Clausulas vivas</span><strong>${renderCoinInline(clauseValue, false)}</strong></div>
        <div class="modalStat"><span>Ranking medio</span><strong>#${intFmt.format(avgRank || 0)}</strong></div>
        <div class="modalStat"><span>Mejor activo</span><strong>${escapeHtml(bestAsset?.name || 'Sin datos')}</strong></div>
        <div class="modalStat"><span>Pieza mas caliente</span><strong>${escapeHtml(contributionRows[0]?.name || 'Sin datos')}</strong></div>
      </div>
      <div class="teamModalSplit">
        <div class="historyWrap">
          <div class="historyTitle">Plantilla actual</div>
          <div class="standingRoster modalTeamRoster">${roster}</div>
          <div class="helper">Pulsa una ficha para ver su rendimiento, sus copias en liga y, si procede, entrar por clausula.</div>
        </div>
        <div class="historyWrap">
          <div class="historyTitle">${closedRound ? `Impacto del cierre ${escapeHtml(closedRound.round_label || '')}` : 'Impacto de la jornada'}</div>
          ${renderContributionList(contributionRows, { compact: true })}
        </div>
      </div>
    </div>`;
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
        ? ''
        : 'Un solo equipo por manager, starter pack aleatorio por tramos de ranking y hasta 3 copias del mismo jugador en toda la liga.';
      subtitle.classList.toggle('hidden', !!state.currentTeam);
    }
    if (meta){
      meta.innerHTML = state.currentTeam
        ? `<div class="teamBudgetBox" title="Berries disponibles ahora mismo para entrar al mercado fantasy."><img class="teamBudgetIcon" src="${escapeAttr(COIN_ICON)}" alt="" aria-hidden="true" /><strong class="teamBudgetAmount">${intFmt.format(Math.round(Number(state.currentTeam.coins || 0)))}</strong></div>`
        : '';
    }
    if (facts){
      const showRulesStrip = !state.currentTeam;
      facts.classList.toggle('hidden', !showRulesStrip);
      const marketStatus = cfg.isOpen && marketOpenNow() ? 'Abierto' : 'Cerrado';
      facts.innerHTML = showRulesStrip ? `
        <article class="fact factProduct">
          <span>Presupuesto inicial</span>
          <strong>${renderCoinInline(cfg.budget, false)}</strong>
          <small>Capital base para crear roster y moverte en mercado.</small>
        </article>
        <article class="fact factProduct">
          <span>Starter pack</span>
          <strong>${intFmt.format(cfg.starterPackSize)} jugadores</strong>
          <small>Reparto por tramos: top 10, top 20 y resto del pool.</small>
        </article>
        <article class="fact factProduct">
          <span>Cupos por jugador</span>
          <strong>${intFmt.format(cfg.maxPlayerCopies)}</strong>
          <small>Cuando se llenan, solo entra por clausula.</small>
        </article>
        <article class="fact factProduct">
          <span>Mercado ahora</span>
          <strong>${marketStatus}</strong>
          <small>Operativa normal de lunes a viernes.</small>
        </article>` : '';
    }
    if (authHint){
      authHint.textContent = state.currentUser ? 'Tu sesion esta lista. Al entrar se refrescan mercado, ranking, clausulas y avisos fantasy.' : 'Necesitas sesion para crear tu equipo, recibir tu starter pack y entrar al mercado.';
      authHint.classList.toggle('hidden', !!state.currentTeam);
    }
  }

  function renderSetupPanel(){
    const host = $('teamSetupPanel');
    if (!host) return;
    const cfg = config();
    host.classList.remove('hidden');
    if (state.schemaReady === false){ host.innerHTML = '<div class="empty">Ejecuta <code>fantasy-vbf-schema.sql</code> en Supabase y recarga la pagina para activar el nuevo modelo de mercado fantasy.</div>'; return; }
    if (state.loadingLeague){ host.innerHTML = '<div class="empty">Cargando estado del fantasy...</div>'; return; }
    if (!state.currentUser){
      host.innerHTML = `<div class="subPanelHead"><div><h3>Entra para crear tu equipo</h3><p>La tabla es publica, pero necesitas sesion para recibir tu starter pack y entrar al mercado.</p></div><span class="pill">1 equipo por manager</span></div><div class="setupStepGrid"><div class="setupStep"><strong>01</strong><span>Crea equipo OP15</span></div><div class="setupStep"><strong>02</strong><span>Recibe starter pack</span></div><div class="setupStep"><strong>03</strong><span>Ficha o paga clausulas</span></div></div><div class="actionRow setupActions"><a class="btn btnPrimary" href="login.html">Entrar al hub</a></div>`;
      return;
    }
    if (!state.currentTeam){
      const suggested = escapeAttr(readCurrentUserLabel());
      host.innerHTML = `<div class="subPanelHead"><div><h3>Crea tu equipo OP15</h3><p>Empiezas con ${formatCoins(cfg.budget)} y el sistema te reparte un starter pack aleatorio con 1 top 10, 1 top 20 y 1 jugador del resto.</p></div><span class="pill strong">Starter pack</span></div><div class="setupStepGrid"><div class="setupStep"><strong>${renderCoinInline(cfg.budget, true)}</strong><span>Presupuesto</span></div><div class="setupStep"><strong>${intFmt.format(cfg.starterPackSize)}</strong><span>Jugadores iniciales</span></div><div class="setupStep"><strong>${intFmt.format(cfg.maxPlayerCopies)}</strong><span>Copias maximas</span></div></div><form class="miniForm" id="createTeamForm"><label class="control"><span>Nombre del equipo</span><input id="createTeamName" type="text" maxlength="60" placeholder="Ej: ${suggested}" value="${suggested}" autocomplete="off" /></label><button class="btn btnPrimary" type="submit" ${cfg.isOpen ? '' : 'disabled'}>${cfg.isOpen ? 'Crear equipo y recibir pack' : 'Mercado cerrado'}</button></form>`;
      return;
    }
    host.innerHTML = '';
    host.classList.add('hidden');
  }

  function renderOverviewPanels(){
    const topPlayersHost = $('topPlayersList');
    const surpriseHost = $('surprisePlayersList');
    if (topPlayersHost){
      const rows = topGeneralPlayers(5);
      topPlayersHost.innerHTML = rows.map((player) => renderOverviewFeature(player, 'general')).join('') || '<div class="empty">Aun no hay datos de jugadores.</div>';
    }
    if (surpriseHost){
      const rows = topSurprisePlayers(5);
      surpriseHost.innerHTML = rows.map((player) => renderOverviewFeature(player, 'surprise')).join('') || '<div class="empty">Todavia no hay sorpresas marcadas esta jornada.</div>';
    }
  }

  function renderTeamInsights(){
    const host = $('teamInsights');
    if (!host) return;
    host.innerHTML = '';
    host.classList.add('hidden');
  }

  function contributionRowsForTeamRound(teamId, roundKey, fallbackEntries){
    const snapshotEntries = snapshotRowsForTeam(teamId, roundKey);
    if (snapshotEntries.length) return contributionRowsFromEntries(snapshotEntries, roundKey);
    return contributionRowsFromEntries(fallbackEntries || [], roundKey);
  }

  function contributionBreakdownText(teamId, roundKey, fallbackEntries){
    const rows = contributionRowsForTeamRound(teamId, roundKey, fallbackEntries);
    return rows.map((row) => `${row.name}: ${formatPointsLabel(row.weeklyPoints)}`).join(' · ');
  }

  function renderManagerTrend(){
    const host = $('managerTrendPanel');
    if (!host) return;
    if (!state.currentTeam){
      host.innerHTML = '<div class="empty">Crea tu equipo para ver tu evolucion semanal como manager.</div>';
      return;
    }
    const closedRoundKeys = new Set(closedRounds().map((row) => String(row.round_key || '')));
    const rows = state.teamRounds
      .filter((row) =>
        String(row.team_id) === String(state.currentTeam.id)
        && closedRoundKeys.has(String(row.round_key || ''))
      )
      .sort((a, b) => Number(a.round_order || 0) - Number(b.round_order || 0));
    if (!rows.length){
      host.innerHTML = '<div class="empty">Aun no hay jornadas cerradas para pintar tu evolucion.</div>';
      return;
    }
    const derived = leagueDerived();
    const latestRoundKey = String(rows[rows.length - 1]?.round_key || '');
    const latestBreakdown = contributionRowsForTeamRound(state.currentTeam.id, latestRoundKey, derived.myRoster || []);
    const latestBreakdownText = latestBreakdown.map((row) => `${row.name}: ${formatPointsLabel(row.weeklyPoints)}`).join(' · ');
    const series = rows.map((row) => ({
      label: String(row.round_label || row.round_key || '').trim(),
      roundKey: String(row.round_key || ''),
      value: Number(row.weekly_points || 0),
      reward: Number(row.reward_coins || 0),
      breakdown: contributionBreakdownText(state.currentTeam.id, row.round_key, derived.myRoster || [])
    }));
    const width = 620;
    const height = 220;
    const padX = 28;
    const padTop = 20;
    const padBottom = 30;
    const plotWidth = width - padX * 2;
    const plotHeight = height - padTop - padBottom;
    const maxValue = Math.max(...series.map((item) => item.value), 1);
    const stepX = series.length > 1 ? plotWidth / (series.length - 1) : 0;
    const xFor = (index) => padX + index * stepX;
    const yFor = (value) => padTop + (plotHeight - (Number(value || 0) / maxValue) * plotHeight);
    const points = series.map((item, index) => `${xFor(index).toFixed(2)},${yFor(item.value).toFixed(2)}`).join(' ');
    const pointsSvg = series.map((item, index) => {
      const x = xFor(index).toFixed(2);
      const y = yFor(item.value).toFixed(2);
      const tooltip = `${item.label}: ${formatPointsLabel(item.value)} · ${formatCoins(item.reward)}${item.breakdown ? ` · ${item.breakdown}` : (index === series.length - 1 && latestBreakdownText ? ` · ${latestBreakdownText}` : '')}`;
      return `<line class="chartStem scoring" x1="${x}" y1="${height - padBottom}" x2="${x}" y2="${y}"></line><circle class="chartPoint scoring" cx="${x}" cy="${y}" r="8"><title>${escapeHtml(tooltip)}</title></circle>`;
    }).join('');
    const labelsSvg = series.map((item, index) => `<text x="${xFor(index).toFixed(2)}" y="${height - 8}" text-anchor="middle" font-size="10" font-weight="900" fill="#0f172a">${escapeHtml(item.label)}</text>`).join('');
    host.innerHTML = `<div class="chartCard"><div class="chartMeta"><span>Evolucion del manager</span><strong>${formatPointsLabel(series[series.length - 1]?.value || 0)} ultima jornada</strong></div><svg class="chartSvg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafica semanal del manager"><line class="chartAxis" x1="${padX}" y1="${height - padBottom}" x2="${width - padX}" y2="${height - padBottom}"></line><polyline class="chartLine" points="${points}"></polyline>${pointsSvg}${labelsSvg}</svg>${latestBreakdown.length ? `<div class="trendBreakdown"><div class="trendBreakdownHead">Ultimo cierre · pasa el raton por el punto para ver el resumen</div>${latestBreakdown.map((row) => `<span class="trendBreakdownChip"><strong>${escapeHtml(row.name)}</strong>${formatPointsLabel(row.weeklyPoints)}</span>`).join('')}</div>` : ''}</div>`;
  }

  function renderTeamBreakdown(){
    const host = $('teamBreakdownPanel');
    if (!host) return;
    if (!state.currentTeam){
      host.innerHTML = '<div class="empty">Cuando tengas equipo activo, aqui veras exactamente de donde salen tus puntos fantasy.</div>';
      return;
    }
    const derived = leagueDerived();
    const closedRound = latestClosedRound();
    if (!closedRound){
      host.innerHTML = '<div class="empty">Aun no hay un cierre fantasy sellado para desglosar tus puntos.</div>';
      return;
    }
    const rows = contributionRowsForTeamRound(state.currentTeam.id, closedRound.round_key, derived.myRoster || []);
    const total = Number(getTeamRound(state.currentTeam.id, closedRound.round_key)?.weekly_points || rows.reduce((sum, row) => sum + Number(row.weeklyPoints || 0), 0));
    const reward = Number(getTeamRound(state.currentTeam.id, closedRound.round_key)?.reward_coins || 0);
    host.innerHTML = `<div class="breakdownHero"><div><span>${escapeHtml(`Cierre ${closedRound.round_label || 'fantasy'}`)}</span><strong>${formatPointsLabel(total)}</strong><small>${formatCoins(reward)} generados en el cierre del lunes. Pasa el raton por cada barra para ver el peso real de cada ficha dentro del cierre congelado del sabado.</small></div><div class="pillRow"><span class="pill strong">${intFmt.format(rows.length)} piezas en snapshot</span><span class="pill">${rows.filter((row) => row.weeklyPoints > 0).length}/${rows.length} aportando</span></div></div>${renderContributionList(rows, { hidePrice: true, hideClause: true })}`;
  }

  function renderRosterTable(entries){
    if (!entries.length){
      return '<div class="empty">Todavia no tienes suficientes jugadores para montar la tabla de seguimiento.</div>';
    }
    return `<div class="rosterTable">${entries.map((entry) => {
      const player = entry.player;
      const portrait = playerPortraitUrl(player);
      const pulse = playerPulse(player);
      const weeklyPoints = Number(player.currentFantasyPoints || 0);
      const clausePrice = Number(entry.clause_price || player.clausePrice || defaultClauseForPrice(player.price || 0));
      return `<article class="rosterTableRow ${frameClass(player.tier)}" data-open-player="${escapeAttr(entry.player_slug || '')}" data-player-source="team">
        <div class="rosterTablePlayer">
          <div class="rosterTableAvatar">${portrait ? `<img src="${escapeAttr(portrait)}" alt="${escapeAttr(player.name || 'Jugador')}" loading="lazy" decoding="async" />` : ''}</div>
          <div class="rosterTableCopy">
            <strong>${escapeHtml(player.name || 'Jugador')}</strong>
            <span>#${intFmt.format(player.rank || 0)} · ${escapeHtml(tierLabel(player.tier))} · ${intFmt.format(player.wins || 0)} victorias</span>
          </div>
        </div>
        <div class="rosterTableMetric"><span>Valor</span><strong>${formatCoins(player.price || 0)}</strong></div>
        <div class="rosterTableMetric"><span>Clausula</span><strong>${formatCoins(clausePrice)}</strong></div>
        <div class="rosterTableMetric"><span>Ultimo sabado</span><strong>${weeklyPoints > 0 ? formatPointsLabel(weeklyPoints) : 'Sin puntos'}</strong></div>
        <div class="rosterTableMetric"><span>Lectura</span><strong>${escapeHtml(pulse.label)}</strong></div>
      </article>`;
    }).join('')}</div>`;
  }

  function renderScoutingPanel(){
    const host = $('scoutingPanel');
    if (!host) return;
    if (!state.currentTeam){
      host.innerHTML = '<div class="empty">Crea tu equipo para que el radar te sugiera fichajes reales segun tu dinero y tus huecos.</div>';
      return;
    }
    const targets = suggestedTargets(4);
    if (!targets.length){
      host.innerHTML = '<div class="empty">Todavia no tengo objetivos claros para mostrarte. Prueba a refrescar el fantasy cuando el pool tenga mas movimiento.</div>';
      return;
    }
    host.innerHTML = `<div class="scoutGrid">${targets.map((entry) => {
      const player = entry.player;
      const portrait = playerPortraitUrl(player);
      const pulse = playerPulse(player);
      const badge = entry.direct ? `Fichable por ${formatCoins(entry.cost)}` : `Clausula desde ${formatCoins(entry.cost)}`;
      return `<button class="scoutCard ${frameClass(player.tier)}" type="button" data-open-player="${escapeAttr(player.slug || '')}" data-player-source="market">
        <div class="scoutVisual">${portrait ? `<img src="${escapeAttr(portrait)}" alt="${escapeAttr(player.name || 'Jugador')}" loading="lazy" decoding="async" />` : ''}<div class="standingRosterShade"></div></div>
        <div class="scoutBody">
          <div class="scoutHead">
            <strong>${escapeHtml(player.name || 'Jugador')}</strong>
            <span class="signalTag ${escapeAttr(pulse.tone)}">${escapeHtml(pulse.label)}</span>
          </div>
          <div class="scoutMeta">${escapeHtml(entry.reason)}</div>
          <div class="scoutStats">
            <span><strong>${formatPointsLabel(player.currentFantasyPoints || 0)}</strong><small>ultimo sabado</small></span>
            <span><strong>#${intFmt.format(player.rank || 0)}</strong><small>ranking VBF</small></span>
          </div>
          <div class="scoutFoot">${escapeHtml(badge)}</div>
        </div>
      </button>`;
    }).join('')}</div>`;
  }

  function watchlistPlayers(limit){
    const slugs = Array.from(state.watchlistSlugs || []);
    const derived = leagueDerived();
    return slugs
      .map((slug) => state.playersBySlug.get(String(slug || '')))
      .filter(Boolean)
      .map((player) => marketDetailsForPlayer(player, derived))
      .sort((a, b) =>
        (b.currentFantasyPoints || 0) - (a.currentFantasyPoints || 0)
        || fantasyTrendDelta(b) - fantasyTrendDelta(a)
        || collator.compare(a.name, b.name)
      )
      .slice(0, Number(limit || 6));
  }

  function renderWatchButton(player, options){
    const opts = options || {};
    const active = isWatched(player?.slug);
    const label = active ? 'Siguiendo' : 'Seguir';
    return `<button class="watchButton ${active ? 'active' : ''} ${opts.compact ? 'compact' : ''}" type="button" data-toggle-watchlist="${escapeAttr(player?.slug || '')}" aria-pressed="${active ? 'true' : 'false'}" title="${active ? 'Quitar de la watchlist' : 'Anadir a la watchlist'}"><span aria-hidden="true">${active ? 'R' : '+'}</span><strong>${label}</strong></button>`;
  }

  function renderWatchlistPanel(){
    const host = $('watchlistPanel');
    if (!host) return;
    const rows = watchlistPlayers(8);
    if (!rows.length){
      host.innerHTML = '<div class="empty">Marca jugadores con "Seguir" para construir tu radar privado de mercado.</div>';
      return;
    }
    host.innerHTML = `<div class="watchGrid">${rows.map((player) => {
      const portrait = playerPortraitUrl(player);
      const pulse = playerPulse(player);
      const cost = player.canDirectBuy ? Number(player.price || 0) : Number(player.minClause || defaultClauseForPrice(player.price || 0));
      const availability = player.canDirectBuy ? 'Libre en pool' : 'Solo por clausula';
      return `<article class="watchCard ${frameClass(player.tier)}">
        <button class="watchMain" type="button" data-open-player="${escapeAttr(player.slug || '')}" data-player-source="market">
          <div class="watchAvatar">${portrait ? `<img src="${escapeAttr(portrait)}" alt="${escapeAttr(player.name || 'Jugador')}" loading="lazy" decoding="async" />` : ''}</div>
          <div class="watchCopy">
            <strong>${escapeHtml(player.name || 'Jugador')}</strong>
            <span>#${intFmt.format(player.rank || 0)} · ${escapeHtml(tierLabel(player.tier))}</span>
            <small class="signalTag ${escapeAttr(pulse.tone)}">${escapeHtml(pulse.label)}</small>
          </div>
        </button>
        <div class="watchSide">
          <span>${renderCoinInline(cost, true)}<small>${escapeHtml(availability)}</small></span>
          ${renderWatchButton(player, { compact: true })}
        </div>
      </article>`;
    }).join('')}</div>`;
  }

  function renderMarketQuickFilters(){
    const host = $('marketQuickFilters');
    if (!host) return;
    const items = [
      ['all', 'Todo'],
      ['watchlist', 'Watchlist'],
      ['free', 'Libres'],
      ['clause', 'Clausulables'],
      ['hot', 'En racha'],
      ['bargain', 'Gangas']
    ];
    host.innerHTML = items.map(([value, label]) => `<button class="marketFilterChip ${String(state.marketFilter || 'all') === value ? 'active' : ''}" type="button" data-market-filter="${escapeAttr(value)}">${escapeHtml(label)}</button>`).join('');
  }

  function renderStandings(){
    const wrap = $('standingsBoard');
    const empty = $('standingsEmpty');
    const meta = $('standingsMeta');
    if (!wrap || !empty || !meta) return;
    const derived = leagueDerived();
    meta.textContent = '';
    meta.classList.add('hidden');
    if (meta.parentElement) meta.parentElement.classList.add('hidden');
    if (!derived.standings.length){ wrap.classList.add('hidden'); empty.classList.remove('hidden'); empty.textContent = 'Todavia no hay equipos inscritos en el fantasy.'; return; }
    empty.classList.add('hidden');
    const standings = derived.standings.slice().sort((a, b) => {
      if (PAGE_VIEW === 'overview'){
        return (b.rewardCoins || 0) - (a.rewardCoins || 0)
          || (b.weeklyPoints || 0) - (a.weeklyPoints || 0)
          || (b.generalPoints || 0) - (a.generalPoints || 0)
          || collator.compare(a.teamName, b.teamName);
      }
      return (b.weeklyPoints || 0) - (a.weeklyPoints || 0)
        || (b.generalPoints || 0) - (a.generalPoints || 0)
        || collator.compare(a.teamName, b.teamName);
    }).map((row, index) => ({ ...row, displayRank: index + 1 }));
    wrap.classList.remove('hidden');
    wrap.innerHTML = standings.map((row) => {
      const mine = state.currentUser && String(row.userId) === String(state.currentUser.id);
      const rankClass = row.displayRank === 1 ? 'top1' : row.displayRank === 2 ? 'top2' : row.displayRank === 3 ? 'top3' : '';
      const slots = Array.from({ length: config().squadSize }, (_, index) => row.players[index] || null);
      const roster = slots.map((entry) => {
        if (!entry){
          return `<div class="standingRosterCard empty" aria-hidden="true"><div class="standingRosterVisual empty"></div><span class="standingRosterName">Hueco libre</span></div>`;
        }
        const portrait = playerPortraitUrl(entry.player);
        return `<button class="standingRosterCard ${frameClass(entry.player.tier)}" type="button" data-open-player="${escapeAttr(entry.player_slug || '')}" data-player-source="market" title="Ver ficha de ${escapeAttr(entry.player.name || entry.player_slug || 'Jugador')}"><div class="standingRosterVisual">${portrait ? `<img src="${escapeAttr(portrait)}" alt="${escapeAttr(entry.player.name || 'Jugador')}" loading="lazy" decoding="async" />` : ''}<div class="standingRosterShade"></div></div><span class="standingRosterName">${escapeHtml(entry.player.name || entry.player_slug || 'Jugador')}</span></button>`;
      }).join('');
      const secondary = PAGE_VIEW === 'overview'
        ? `${formatPointsLabel(row.weeklyPoints)} en la ultima jornada`
        : `Jornada ${formatPointsLabel(row.weeklyPoints)}`;
      return `<article class="standingRow ${mine ? 'isMine' : ''}" data-open-team="${escapeAttr(row.id)}">
        <div><span class="rankBadge ${rankClass}">#${row.displayRank}</span></div>
        <div class="standingIdentity">
          <div class="standingIdentityTop">
            <strong>${escapeHtml(row.teamName)}</strong>
            <span>${formatPointsLabel(row.generalPoints)} acumulados</span>
          </div>
          <div class="standingIdentityBottom">
            <strong>${escapeHtml(row.coachName || 'Manager')}</strong>
            <span>Manager fantasy</span>
          </div>
          <div class="standingWeekBar">
            <span>Berries de esta semana</span>
            <strong>${renderCoinInline(row.rewardCoins || 0, false)}</strong>
            <small>${secondary}</small>
          </div>
        </div>
        <div class="standingRoster">${roster}</div>
      </article>`;
    }).join('');
  }

  function renderTeam(){
    const empty = $('squadEmpty');
    const grid = $('squadGrid');
    const summary = $('teamSummary');
    const table = $('teamRosterTable');
    if (!empty || !grid || !summary) return;
    if (!state.currentTeam){
      summary.innerHTML = '';
      if (table){
        table.innerHTML = '';
        table.classList.add('hidden');
      }
      grid.classList.add('hidden');
      empty.classList.remove('hidden');
      empty.textContent = state.currentUser ? 'Crea tu equipo OP15 para empezar a comprar jugadores.' : 'Inicia sesion y crea tu equipo OP15 para entrar al fantasy.';
      return;
    }
    const derived = leagueDerived();
    const rosterValue = derived.squadCards.reduce((sum, entry) => sum + Number(entry.player?.price || entry.buy_price || 0), 0);
    const clauseValue = derived.squadCards.reduce((sum, entry) => sum + Number(entry.clause_price || entry.player?.clausePrice || defaultClauseForPrice(entry.player?.price || 0)), 0);
    const closedRound = latestClosedRound();
    const latestTeamRound = closedRound ? getTeamRound(state.currentTeam.id, closedRound.round_key) : null;
    const latestPoints = latestTeamRound
      ? Number(latestTeamRound.weekly_points || 0)
      : derived.squadCards.reduce((sum, entry) => sum + Number(entry.player?.currentFantasyPoints || 0), 0);
    summary.innerHTML = `<span class="pill strong" title="Jugadores ocupando ahora mismo tu roster fantasy.">${derived.squadCards.length}/${intFmt.format(config().squadSize)} jugadores</span><span class="pill" title="Valor actual combinado de tu plantilla.">${renderCoinInline(rosterValue, true)} valor</span><span class="pill" title="Exposicion total de clausulas vivas.">${renderCoinInline(clauseValue, true)} clausulas</span><span class="pill" title="Puntos de tu ultimo cierre fantasy.">${formatPointsLabel(latestPoints)} ultimo cierre</span>`;
    if (!derived.squadCards.length){
      if (table){
        table.innerHTML = '';
        table.classList.add('hidden');
      }
      grid.classList.add('hidden');
      empty.classList.remove('hidden');
      empty.textContent = 'Tu plantilla esta vacia. Compra jugadores en el pool para empezar.';
      return;
    }
    empty.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = derived.squadCards.map((entry) => {
      const player = entry.player;
      const overlay = `<div class="playerOverlayBottom"><div class="overlayNamePlain">${escapeHtml(player.name)}</div><div class="overlaySubtitle">#${intFmt.format(player.rank || 0)} - ${escapeHtml(tierLabel(player.tier))}</div></div>`;
      return `<article class="playerCard squadCard isInteractive ${frameClass(player.tier)}" data-open-player="${escapeAttr(entry.player_slug)}" data-player-source="team"><div class="playerHead">${renderPlayerVisual(player, overlay)}</div></article>`;
    }).join('');
    if (table){
      table.innerHTML = PAGE_VIEW === 'team' ? renderRosterTable(derived.squadCards) : '';
      table.classList.toggle('hidden', PAGE_VIEW !== 'team');
    }
  }

  function renderMarket(){
    const grid = $('marketGrid');
    const empty = $('marketEmpty');
    const meta = $('marketMeta');
    if (!grid || !empty || !meta) return;
    renderMarketQuickFilters();
    const derived = leagueDerived();
    meta.textContent = `${marketFilterLabel()} · ${intFmt.format(derived.marketPlayers.length)} visibles`;
    meta.classList.remove('hidden');
    if (meta.parentElement) meta.parentElement.classList.remove('hidden');
    if (!derived.marketPlayers.length){ grid.innerHTML = ''; empty.classList.remove('hidden'); empty.textContent = state.poolPlayers.length ? 'No hay jugadores que coincidan con este filtro.' : 'Todavia no se ha cargado el pool de jugadores.'; return; }
    const roster = derived.myRoster;
    empty.classList.add('hidden');
    grid.innerHTML = derived.marketPlayers.map((player) => {
      const overlay = `<div class="playerOverlayBottom"><div class="overlayNamePlain">${escapeHtml(player.name)}</div><div class="overlaySubtitle">#${intFmt.format(player.rank || 0)} - ${escapeHtml(tierLabel(player.tier))}</div></div>`;
      const blocked = buyBlockReason(player, roster);
      const badge = marketBadgeForPlayer(player);
      const price = Number(player.price || 0);
      const minClause = Number(player.minClause || defaultClauseForPrice(price));
      const pulse = playerPulse(player);
      const copiesLeft = Math.max(0, Number(player.copiesLeft || 0));
      const copiesLabel = player.canDirectBuy
        ? `${intFmt.format(copiesLeft)}/${intFmt.format(config().maxPlayerCopies)} libres`
        : 'Cupo completo';
      const availabilityTone = player.canDirectBuy ? 'good' : 'soft';
      const weeklyLabel = Number(player.currentFantasyPoints || 0) > 0 ? formatPointsLabel(player.currentFantasyPoints || 0) : 'Sin puntos';
      const buttonLabel = blocked
        ? escapeHtml(blocked)
        : player.canDirectBuy
          ? `Fichar · ${intFmt.format(price)}`
          : `Clausula · ${intFmt.format(minClause)}`;
      const badgeHtml = badge?.icon ? `<span class="marketBadge ${escapeAttr(badge.tone)}" title="${escapeAttr(badge.title || '')}" aria-label="${escapeAttr(badge.title || '')}">${escapeHtml(badge.icon)}</span>` : '';
      return `<article class="playerCard marketCard marketCardMinimal isInteractive ${frameClass(player.tier)} ${isWatched(player.slug) ? 'isWatched' : ''}" data-open-player="${escapeAttr(player.slug)}" data-player-source="market"><div class="playerHead marketCardHead">${badgeHtml}${renderWatchButton(player, { compact: true })}${renderPlayerVisual(player, overlay)}</div><div class="marketCardInfo"><span><strong>${renderCoinInline(player.canDirectBuy ? price : minClause, true)}</strong><small>${player.canDirectBuy ? 'precio' : 'clausula'}</small></span><span><strong>${weeklyLabel}</strong><small>ultimo sabado</small></span><span class="marketCardSignal ${escapeAttr(availabilityTone)}" title="${escapeAttr(pulse.label)}">${escapeHtml(copiesLabel)}</span></div><div class="actionRow compactActions single"><button class="btn btnPrimary compactBtn buyFullBtn" type="button" data-buy-confirm="${escapeAttr(player.slug)}" aria-label="Comprar ${escapeAttr(player.name)}" ${blocked ? 'disabled' : ''} title="${escapeAttr(blocked || (player.marketMode === 'buyout' ? `Pagar clausula de ${player.name}` : `Fichar a ${player.name}`))}">${buttonLabel}</button></div></article>`;
    }).join('');
  }

  function renderNotifications(){
    const host = $('marketNoticePanel');
    if (!host) return;
    const card = host.closest('.card');
    const clauseNotes = unreadClauseLostNotifications();
    const otherNotes = state.notifications.filter((note) => !(String(note?.kind || '') === 'clause_lost' && !note?.read_at));
    const visibleNotes = [
      ...clauseNotes,
      ...otherNotes.filter((note) => !note?.read_at).slice(0, Math.max(0, 4 - clauseNotes.length))
    ];
    if (!state.currentUser || !visibleNotes.length){
      host.classList.add('hidden');
      host.innerHTML = '';
      if (card) card.classList.add('hidden');
      return;
    }
    if (card) card.classList.remove('hidden');
    host.classList.remove('hidden');
    const badgeText = clauseNotes.length
      ? `${intFmt.format(clauseNotes.length)} clausulazo${clauseNotes.length === 1 ? '' : 's'}`
      : `${intFmt.format(visibleNotes.length)} aviso${visibleNotes.length === 1 ? '' : 's'}`;
    host.innerHTML = `<div class="subPanelHead"><div><h3>Avisos de mercado</h3><p>${clauseNotes.length ? 'Tienes clausulazos pendientes de revisar. Marcalos como vistos para limpiar el aviso de la navbar.' : 'Resumen rapido de starter pack, clausulas y recompensas semanales.'}</p></div><span class="pill ${clauseNotes.length ? 'danger' : ''}">${escapeHtml(badgeText)}</span></div><div class="noticeList">${visibleNotes.map((note) => {
      if (String(note.kind || '') === 'clause_lost' && !note.read_at) return renderClauseLostNotice(note);
      return `<article class="noticeItem"><span>${escapeHtml(String(note.kind || '').replace(/_/g, ' '))}</span><strong>${escapeHtml(note.title || 'Aviso')}</strong><p>${escapeHtml(note.body || '')}</p></article>`;
    }).join('')}</div>`;
  }

  async function markNotificationsRead(ids){
    const list = (Array.isArray(ids) ? ids : [ids]).map((id) => String(id || '').trim()).filter(Boolean);
    if (!list.length || !state.currentUser) return;
    try{
      const { error } = await rpcWithTimeout('fantasy_vbf_mark_notifications_read', { p_ids: list }, 'marcar avisos fantasy');
      if (error) throw error;
      const readAt = new Date().toISOString();
      const targetIds = new Set(list);
      state.notifications = state.notifications.map((note) => targetIds.has(String(note.id || '')) ? { ...note, read_at: note.read_at || readAt } : note);
      renderNotifications();
      if (App.refreshFantasyNavAlerts) void App.refreshFantasyNavAlerts({ force: true });
      showFantasyToast('Aviso marcado como visto', 'El badge de clausulazo se actualizara al momento.', 'ok');
    } catch (error){
      showPageMsg(`No pude marcar el aviso como visto: ${error?.message || error}`, 'err');
      showFantasyToast('No pude marcar el aviso', error?.message || String(error || ''), 'err');
    }
  }

  function renderAll(){
    renderHero();
    renderSeasonFacts();
    renderSetupPanel();
    renderStandings();
    renderOverviewPanels();
    renderRoundPulse();
    renderTeamInsights();
    renderTeam();
    renderManagerTrend();
    renderTeamBreakdown();
    renderScoutingPanel();
    renderWatchlistPanel();
    renderMarketActivity();
    renderMarket();
    renderNotifications();
    renderTeamModal();
    renderPlayerModal();
    renderBuyConfirm();
  }

  async function createTeam(event){
    event.preventDefault();
    const teamName = $('createTeamName')?.value.trim() || '';
    if (!state.currentUser) return showPageMsg('Necesitas sesion para crear tu equipo.', 'err');
    const submitButton = event.submitter || event.target?.querySelector?.('button[type="submit"]') || null;
    setActionBusy(submitButton, true, 'Creando equipo');
    try{
      await withActionLock(async () => {
        try{
          await ensureActionDataFresh();
          const { error } = await rpcWithTimeout('fantasy_vbf_create_team', { p_season: CURRENT_SEASON, p_team_name: teamName, p_initial_roster: [] }, 'crear equipo fantasy');
          if (error) throw error;
          showPageMsg('Equipo OP15 creado. Tu starter pack ya esta repartido y el mercado queda listo para ti.', 'ok');
          showFantasyToast('Equipo creado', 'Tu starter pack ya esta repartido.', 'ok');
          await loadLeagueContext();
          renderAll();
        } catch (error){
          if (isSchemaError(error)) markSchemaMissing(error);
          showPageMsg(`No pude crear tu equipo: ${error?.message || error}`, 'err');
          showFantasyToast('No pude crear el equipo', error?.message || String(error || ''), 'err');
        }
      });
    } finally {
      setActionBusy(submitButton, false);
    }
  }

  async function buyPlayer(playerSlug, targetTeamId, outgoingSlug){
    if (!state.currentTeam) return;
    await withActionLock(async () => {
      let playerName = 'ese jugador';
      try{
        await ensureActionDataFresh();
        const player = leagueDerived().marketPlayers.find((item) => String(item.slug) === String(playerSlug || ''));
        if (!player) throw new Error('El jugador ya no esta disponible en el pool actual.');
        playerName = player.name || playerName;
        const { error } = await rpcWithTimeout('fantasy_vbf_buy_player', {
          p_season: CURRENT_SEASON,
          p_round_key: state.currentRound?.key || state.sheetRound?.key || 'manual',
          p_player_slug: player.slug,
          p_outgoing_player_slug: outgoingSlug || state.confirmBuyOutgoingSlug || null,
          p_target_team_id: targetTeamId || null
        }, `comprar ${player.name}`);
        if (error) throw error;
        showPageMsg(targetTeamId ? `${player.name} llega por clausula.` : `${player.name} anadido a tu plantilla.`, 'ok');
        showFantasyToast(targetTeamId ? 'Clausulazo completado' : 'Fichaje completado', `${player.name} ya esta en tu plantilla.`, 'ok');
        await loadLeagueContext();
        renderAll();
      } catch (error){
        if (isSchemaError(error)) markSchemaMissing(error);
        showPageMsg(`No pude comprar a ${playerName}: ${error?.message || error}`, 'err');
        showFantasyToast('No pude completar el fichaje', error?.message || String(error || ''), 'err');
      }
    });
  }

  async function sellPlayer(playerSlug){
    await withActionLock(async () => {
      try{
        const { error } = await rpcWithTimeout('fantasy_vbf_sell_player', { p_season: CURRENT_SEASON, p_round_key: state.currentRound?.key || 'manual', p_player_slug: String(playerSlug || ''), p_market_price: 0 }, 'liberar jugador');
        if (error) throw error;
        showPageMsg('Operacion registrada.', 'ok');
        showFantasyToast('Operacion registrada', 'La plantilla se ha actualizado.', 'ok');
        await loadLeagueContext();
        renderAll();
      } catch (error){
        if (isSchemaError(error)) markSchemaMissing(error);
        showPageMsg(`No pude mover el jugador: ${error?.message || error}`, 'err');
        showFantasyToast('No pude mover el jugador', error?.message || String(error || ''), 'err');
      }
    });
  }

  async function syncCurrentRound(silent){
    if (state.syncingRound || state.schemaReady === false || !state.currentUser || !state.currentRound?.key) return;
    if (!state.seasonTeams.length) return;
    state.syncingRound = true;
    try{
      const { error } = await rpcWithTimeout('fantasy_vbf_sync_round', { p_season: CURRENT_SEASON, p_round_key: state.currentRound.key, p_round_label: state.currentRound.label, p_round_order: state.currentRound.order, p_results: [] }, 'sincronizar jornada fantasy', 12000);
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

  function isMonday(){
    return madridNowParts().weekday === 'Mon';
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
      showPageMsg(`Nueva jornada ${state.sheetRound.label} iniciada. La plantilla se mantiene, se recalculan precios y el mercado semanal vuelve a abrir.`, 'ok');
      return true;
    } catch (error){
      if (isSchemaError(error)) markSchemaMissing(error);
      else showPageMsg(`No pude abrir la nueva jornada: ${error?.message || error}`, 'err');
      return false;
    }
  }

  function needsImmediateWeekRoll(){
    if (!state.currentUser || state.schemaReady === false || !state.sheetRound?.key || !isMonday()) return false;
    const currentKey = String(state.currentRound?.key || state.seasonConfig?.current_round_key || '').trim();
    return currentKey !== state.sheetRound.key;
  }

  function shouldSyncPoolForAction(){
    if (!state.currentUser || state.schemaReady === false || !state.sheetRound?.key || !state.poolPlayers.length) return false;
    if (String(state.poolSyncedRoundKey || '') !== String(state.sheetRound.key || '')) return true;
    return (Date.now() - Number(state.poolSyncedAt || 0)) > (10 * 60 * 1000);
  }

  async function ensureActionDataFresh(){
    if (needsImmediateWeekRoll()) await maybeOpenNewWeek();
    if (shouldSyncPoolForAction()) await syncPlayerPoolToBackend();
  }

  async function ensureFantasyAccess(){
    if (fantasyAccessAllowed) return true;
    setLoading(true, 'Comprobando acceso fantasy...');
    const result = await App.enforcePageAccess(sb, {
      requirePrivileged: true,
      allowNonMember: true
    });
    if (!result?.allowed) return false;
    fantasyAccessAllowed = true;
    state.currentUser = result.accessState?.user || state.currentUser || null;
    await loadWatchlist();
    await loadCurrentProfile(state.currentUser);
    syncNavUser(state.currentUser);
    if (App.applyRestrictedNavVisibility) void App.applyRestrictedNavVisibility(sb);
    return true;
  }

  function startBackgroundHydration(){
    if (backgroundHydrationPromise) return backgroundHydrationPromise;
    backgroundHydrationPromise = (async () => {
      if (shouldSyncPoolForAction()) await syncPlayerPoolToBackend();
    })().catch((error) => {
      console.warn('fantasy background hydration:', error?.message || error);
    }).finally(() => {
      backgroundHydrationPromise = null;
    });
    return backgroundHydrationPromise;
  }

  async function refreshAllData(options){
    const opts = options || {};
    if (state.refreshPromise) return state.refreshPromise;
    setLoading(true, opts.loadingLabel || (state.initialized ? 'Actualizando fantasy...' : 'Cargando fantasy...'));
    const promise = (async () => {
      if (!opts.skipSession) await safeRefreshSession();
      await Promise.all([
        loadSeasonConfig(),
        loadPlayerPool(Boolean(opts.forceSheet))
      ]);
      await loadLeagueContext();
      renderAll();
      setLoading(false);
      void startBackgroundHydration();
    })().finally(() => {
      state.refreshPromise = null;
      state.initialized = true;
      setLoading(false);
    });
    state.refreshPromise = promise;
    await promise;
    return promise;
  }

  $('reloadPlayersButton')?.addEventListener('click', async () => {
    const button = $('reloadPlayersButton');
    setActionBusy(button, true, 'Refrescando');
    showPageMsg('Refrescando fantasy desde VBF...', 'ok');
    showFantasyToast('Refrescando datos', 'Sincronizando mercado y ranking.', 'info');
    try{
      await refreshAllData({ forceSheet: true, skipSession: true, loadingLabel: 'Refrescando fantasy...' });
      showFantasyToast('Datos actualizados', 'Fantasy queda al dia.', 'ok');
    } catch (error){
      showFantasyToast('No pude refrescar', error?.message || String(error || ''), 'err');
    } finally {
      setActionBusy(button, false);
    }
  });
  $('marketSearch')?.addEventListener('input', () => { state.marketSearch = $('marketSearch')?.value || ''; renderMarket(); });
  $('marketSort')?.addEventListener('change', () => { state.marketSort = $('marketSort')?.value || 'vbf_full_rank'; renderMarket(); });
  document.addEventListener('submit', async (event) => { if (event.target?.id === 'createTeamForm') await createTeam(event); });
  function handleOpenPlayerClick(event){
    const watchTrigger = event.target.closest('[data-toggle-watchlist]');
    if (watchTrigger){
      toggleWatchlist(watchTrigger.getAttribute('data-toggle-watchlist') || '');
      return true;
    }
    const buyTrigger = event.target.closest('[data-buy-confirm]');
    if (buyTrigger){
      openBuyConfirm(buyTrigger.getAttribute('data-buy-confirm') || '', buyTrigger.getAttribute('data-buy-target-team') || '');
      return true;
    }
    const trigger = event.target.closest('[data-open-player]');
    if (!trigger) return false;
    openPlayerModal(trigger.getAttribute('data-open-player') || '', trigger.getAttribute('data-player-source') || 'market');
    return true;
  }
  $('marketGrid')?.addEventListener('click', handleOpenPlayerClick);
  $('squadGrid')?.addEventListener('click', handleOpenPlayerClick);
  $('teamRosterTable')?.addEventListener('click', handleOpenPlayerClick);
  $('watchlistPanel')?.addEventListener('click', handleOpenPlayerClick);
  $('marketActivityPanel')?.addEventListener('click', handleOpenPlayerClick);
  $('roundPulsePanel')?.addEventListener('click', handleOpenPlayerClick);
  $('marketQuickFilters')?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-market-filter]');
    if (!trigger) return;
    state.marketFilter = trigger.getAttribute('data-market-filter') || 'all';
    renderMarket();
  });
  $('standingsBoard')?.addEventListener('click', (event) => {
    if (handleOpenPlayerClick(event)) return;
    const teamTrigger = event.target.closest('[data-open-team]');
    if (!teamTrigger) return;
    openTeamModal(teamTrigger.getAttribute('data-open-team') || '');
  });
  $('topPlayersList')?.addEventListener('click', handleOpenPlayerClick);
  $('surprisePlayersList')?.addEventListener('click', handleOpenPlayerClick);
  $('scoutingPanel')?.addEventListener('click', handleOpenPlayerClick);
  $('marketNoticePanel')?.addEventListener('click', async (event) => {
    const markButton = event.target.closest('[data-mark-notification-read]');
    if (markButton){
      const item = markButton.closest('.noticeItem');
      item?.classList.add('isDismissing');
      if (!prefersReducedMotion()) await sleep(170);
      await markNotificationsRead(markButton.getAttribute('data-mark-notification-read') || '');
      return;
    }
    handleOpenPlayerClick(event);
  });
  $('playerModalWrap')?.addEventListener('click', async (event) => {
    const closeTrigger = event.target.closest('[data-close-player-modal]');
    if (closeTrigger){ closePlayerModal(); return; }
    const confirmTrigger = event.target.closest('[data-buy-confirm]');
    if (confirmTrigger){
      openBuyConfirm(confirmTrigger.getAttribute('data-buy-confirm') || '', confirmTrigger.getAttribute('data-buy-target-team') || '');
      return;
    }
    const watchTrigger = event.target.closest('[data-toggle-watchlist]');
    if (watchTrigger){
      toggleWatchlist(watchTrigger.getAttribute('data-toggle-watchlist') || '');
      return;
    }
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
  });
  $('playerModalClose')?.addEventListener('click', closePlayerModal);
  $('teamModalWrap')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-team-modal]')){ closeTeamModal(); return; }
    const trigger = event.target.closest('[data-open-player]');
    if (!trigger) return;
    closeTeamModal();
    openPlayerModal(trigger.getAttribute('data-open-player') || '', trigger.getAttribute('data-player-source') || 'market');
  });
  $('teamModalClose')?.addEventListener('click', closeTeamModal);
  $('buyConfirmWrap')?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="buyReplacePlayer"]');
    if (!input) return;
    state.confirmBuyOutgoingSlug = input.value || '';
    renderBuyConfirm();
  });
  $('buyConfirmWrap')?.addEventListener('click', async (event) => {
    if (event.target.closest('[data-close-buy-confirm]')){ closeBuyConfirm(); return; }
    if (event.target.closest('#buyConfirmCancel')){ closeBuyConfirm(); return; }
    if (event.target.closest('#buyConfirmAccept')){
      const slug = state.confirmBuySlug;
      const targetTeamId = state.confirmBuyTargetTeamId;
      const outgoingSlug = state.confirmBuyOutgoingSlug;
      closeBuyConfirm();
      if (slug) await buyPlayer(slug, targetTeamId || null, outgoingSlug || null);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.modalPlayerSlug) closePlayerModal();
    if (event.key === 'Escape' && state.modalTeamId) closeTeamModal();
    if (event.key === 'Escape' && state.confirmBuySlug) closeBuyConfirm();
  });

  if (sb?.auth?.onAuthStateChange){
    sb.auth.onAuthStateChange(async (_event, session) => {
      if (_event === 'TOKEN_REFRESHED') return;
      App.clearAccessStateCache();
      if (!session?.user){
        fantasyAccessAllowed = false;
        state.currentUser = null;
        state.watchlistSlugs = new Set();
        syncNavUser(null);
        await App.enforcePageAccess(sb, { requirePrivileged: true, allowNonMember: true });
        return;
      }
      if (!fantasyAccessAllowed && !(await ensureFantasyAccess())) return;
      state.currentUser = session?.user || null;
      await loadWatchlist();
      syncNavUser(state.currentUser);
      await loadCurrentProfile(state.currentUser);
      if (state.actionInFlight) return;
      const pendingRefresh = state.refreshPromise;
      if (pendingRefresh){
        try { await pendingRefresh; } catch (_error) {}
      }
      await refreshAllData({ forceSheet: false, skipSession: true, loadingLabel: state.initialized ? 'Actualizando fantasy...' : 'Cargando fantasy...' });
    });
  }

  void (async () => {
    if (!(await ensureFantasyAccess())) return;
    await refreshAllData({ forceSheet: false, skipSession: true, loadingLabel: 'Cargando fantasy...' });
  })().catch((error) => {
    console.warn('fantasy init:', error?.message || error);
  });
})();
