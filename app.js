(function(window){
  "use strict";

  const SUPABASE_URL = "https://ceunhkqhskwnsoqyunze.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldW5oa3Foc2t3bnNvcXl1bnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDQ0ODcsImV4cCI6MjA4ODAyMDQ4N30.qBGXYYQXlyQwFGeyaeMOtLPHrjBy-eU05AO37yLvi5o";
  const VDBF_ALLOWED_USERS = new Set(["estereo", "coquito"]);

  function createClient(options){
    if (!window.supabase || typeof window.supabase.createClient !== "function"){
      throw new Error("Supabase client is not available.");
    }
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options || undefined);
    window.__barateamLastSupabaseClient = client;
    return client;
  }

  function byId(id){
    return document.getElementById(id);
  }

  function escapeHtml(value){
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value){
    return String(value ?? "").replace(/"/g, "&quot;");
  }

  function showMessage(target, text, options){
    const node = typeof target === "string" ? byId(target) : target;
    if (!node) return;
    const opts = options || {};
    const type = opts.type || "";
    if (opts.baseClass){
      node.className = type ? `${opts.baseClass} ${type}` : opts.baseClass;
    }
    if (opts.display !== false){
      node.style.display = opts.display || "block";
    }
    node.textContent = text;
  }

  function formatDate(value, fallback){
    const emptyFallback = fallback === undefined ? "-" : fallback;
    if (!value) return emptyFallback;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10) || emptyFallback;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatDateTime(value, fallback){
    const emptyFallback = fallback === undefined ? "-" : fallback;
    if (!value) return emptyFallback;
    const raw = String(value);
    if (raw.includes("T")) return raw.slice(0, 16).replace("T", " ");
    return raw.slice(0, 16) || emptyFallback;
  }

  function formatRelativeTime(value, fallback){
    const emptyFallback = fallback === undefined ? "-" : fallback;
    if (!value) return emptyFallback;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return emptyFallback;

    const now = Date.now();
    const diffMs = now - d.getTime();
    const absMs = Math.abs(diffMs);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (absMs < minute) return "justo ahora";
    if (absMs < hour){
      const m = Math.floor(absMs / minute);
      return diffMs >= 0 ? `hace ${m}m` : `en ${m}m`;
    }
    if (absMs < day){
      const h = Math.floor(absMs / hour);
      return diffMs >= 0 ? `hace ${h}h` : `en ${h}h`;
    }
    const dd = Math.floor(absMs / day);
    return diffMs >= 0 ? `hace ${dd}d` : `en ${dd}d`;
  }

  function isNonNegativeNumber(value){
    return Number.isFinite(value) && value >= 0;
  }

  function eventTitle(eventRow){
    return eventRow?.title || eventRow?.name || eventRow?.event_name || "-";
  }

  function eventDate(eventRow){
    return formatDate(eventRow?.start_at || eventRow?.date || eventRow?.event_date, "-");
  }

  function leaderLabel(leaderRow){
    const name = leaderRow?.name || leaderRow?.leader || leaderRow?.title || "";
    const code = leaderRow?.code || leaderRow?.expansion || "";
    const label = [name, code].filter(Boolean).join(" ").trim();
    return label || "-";
  }

  async function getSessionUser(sb){
    const timeoutMs = 8000;
    const authPromise = sb.auth.getSession();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Auth timeout")), timeoutMs);
    });
    const { data } = await Promise.race([authPromise, timeoutPromise]);
    return data?.session?.user || null;
  }

  async function protectedNavClick(e, sb, options){
    if (e.defaultPrevented) return;
    if (e.button && e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    e.preventDefault();

    const href = e.currentTarget.getAttribute("href");
    const message = options?.message || "Para acceder a este apartado tienes que registrarte.";
    if (!href) return;

    const cachedUser = window.__barateamCurrentUser;
    if (cachedUser && cachedUser.id){
      window.location.href = href;
      return;
    }
    if (cachedUser === null){
      window.alert(message);
      return;
    }

    try{
      const user = await getSessionUser(sb);
      if (!user){
        window.alert(message);
        return;
      }
      window.location.href = href;
    }catch(_err){
      // Si falla el check, navegamos: la pagina destino ya valida sesion si toca.
      window.location.href = href;
    }
  }

  function normalizeHandle(value){
    return String(value || "").trim().toLowerCase();
  }

  function appPageHref(fileName){
    const path = String(window.location.pathname || "").replace(/\\/g, "/");
    if (path.includes("/sim-stats/frontend/")) return `../../${fileName}`;
    return fileName;
  }

  function publicProfileHref(username, userId){
    const trimmed = String(username || "").trim();
    const base = appPageHref("user.html");
    if (trimmed) return `${base}?u=${encodeURIComponent(trimmed)}`;
    if (userId) return `${base}?id=${encodeURIComponent(userId)}`;
    return "";
  }

  function currentPageName(){
    const path = String(window.location.pathname || "").replace(/\\/g, "/");
    const parts = path.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1].toLowerCase() : "index.html";
  }

  function isIndexPage(){
    return currentPageName() === "index.html";
  }

  function isAccessGuardExemptPage(){
    const page = currentPageName();
    return page === "login.html" || page === "reset-password.html";
  }

  function isMembersPage(){
    return currentPageName() === "members.html";
  }

  function isProfilePage(){
    return currentPageName() === "profile.html";
  }

  const _accessStateCache = new Map();
  async function resolveAccessState(sb){
    const user = sb ? await getSessionUser(sb) : null;
    if (!user?.id){
      const anonState = {
        user: null,
        profile: null,
        isLoggedIn: false,
        isMember: false,
        isAdmin: false,
        isPrivileged: false
      };
      window.__barateamAccessState = anonState;
      return anonState;
    }

    let profile = _accessStateCache.get(user.id);
    if (!profile && sb){
      const { data } = await sb
        .from("profiles")
        .select("id,username,display_name,avatar_url,app_role,member")
        .eq("id", user.id)
        .maybeSingle();
      profile = data || null;
      _accessStateCache.set(user.id, profile);
    }

    const accessState = {
      user,
      profile: profile || null,
      isLoggedIn: true,
      isMember: profile?.member === true,
      isAdmin: profile?.app_role === "admin",
      isPrivileged: profile?.app_role === "admin" || profile?.app_role === "vdj"
    };
    window.__barateamAccessState = accessState;
    return accessState;
  }

  function clearAccessStateCache(userId){
    if (userId) _accessStateCache.delete(String(userId));
    else _accessStateCache.clear();
  }

  async function enforcePageAccess(sb, options){
    const opts = options || {};
    if (!sb || opts.skipGuard || isAccessGuardExemptPage()){
      return { allowed: true, redirected: false, accessState: window.__barateamAccessState || null };
    }

    const loginHref = opts.loginHref || appPageHref("login.html");
    const indexHref = opts.indexHref || appPageHref("index.html");
    const allowNonMember = opts.allowNonMember === true || isIndexPage() || isProfilePage();
    const requireAdmin = opts.requireAdmin === true;

    try{
      const accessState = await resolveAccessState(sb);
      if (!accessState.isLoggedIn){
        window.location.replace(loginHref);
        return { allowed: false, redirected: true, accessState };
      }
      if (requireAdmin && !accessState.isAdmin){
        window.location.replace(indexHref);
        return { allowed: false, redirected: true, accessState };
      }
      if (!accessState.isMember && !allowNonMember && !(isMembersPage() && accessState.isPrivileged)){
        window.location.replace(indexHref);
        return { allowed: false, redirected: true, accessState };
      }
      return { allowed: true, redirected: false, accessState };
    }catch(_err){
      console.warn("enforcePageAccess:", _err?.message || _err);
      return {
        allowed: true,
        redirected: false,
        accessState: window.__barateamAccessState || null
      };
    }
  }

  function initGlobalAccessGuard(sb, options){
    if (!sb || isAccessGuardExemptPage()) return;
    if (window.__barateamAccessGuardBound === "1") return;
    window.__barateamAccessGuardBound = "1";

    void enforcePageAccess(sb, options);
    if (sb.auth && typeof sb.auth.onAuthStateChange === "function"){
      sb.auth.onAuthStateChange((_event, session) => {
        clearAccessStateCache(session?.user?.id || null);
        void enforcePageAccess(sb, options);
      });
    }
  }

  function ensureModeDock(mode){
    const dockId = mode === "vdj" ? "vdjModeDock" : "adminModeDock";
    const panelId = mode === "vdj" ? "vdjModePanel" : "adminModePanel";
    const toggleId = mode === "vdj" ? "vdjModeToggle" : "adminModeToggle";
    let dock = document.getElementById(dockId);
    if (dock) return dock;

    dock = document.createElement("div");
    dock.id = dockId;
    dock.className = `adminModeDock ${mode}ModeDock`;
    dock.innerHTML = mode === "vdj"
      ? `
        <div class="adminModePanel" id="${panelId}"></div>
        <button class="adminModeToggle vdjModeToggle" id="${toggleId}" type="button" aria-label="Abrir modo VDJ" aria-expanded="false" title="Modo VDJ">
          <img class="vdjModeToggleImg" src="${escapeAttr(appPageHref("VDJ.png"))}" alt="VDJ" />
        </button>
      `
      : `
        <div class="adminModePanel" id="${panelId}"></div>
        <button class="adminModeToggle" id="${toggleId}" type="button" aria-label="Abrir modo admin" aria-expanded="false" title="Modo admin">
          &#9881;
        </button>
      `;
    document.body.appendChild(dock);

    const toggle = dock.querySelector(`#${toggleId}`);
    toggle?.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = dock.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", (e) => {
      if (!dock || !dock.classList.contains("open")) return;
      if (dock.contains(e.target)) return;
      dock.classList.remove("open");
      toggle?.setAttribute("aria-expanded", "false");
    });

    return dock;
  }

  function renderModeDock(mode, actions){
    const dock = ensureModeDock(mode);
    const panel = dock.querySelector(mode === "vdj" ? "#vdjModePanel" : "#adminModePanel");
    const toggle = dock.querySelector(mode === "vdj" ? "#vdjModeToggle" : "#adminModeToggle");
    const items = Array.isArray(actions) ? actions : [];

    if (!items.length){
      dock.style.display = "none";
      dock.classList.remove("open");
      if (panel) panel.innerHTML = "";
      if (toggle) toggle.setAttribute("aria-expanded", "false");
      return;
    }

    if (panel){
      panel.innerHTML = items.map((item) => {
        const isActive = item.href && window.location.pathname.replace(/\\/g, "/").endsWith(item.href.replace(/^\.\.\//g, "").replace(/^\.\//g, ""));
        return `
          <a class="adminModeLink${isActive ? " active" : ""}" href="${escapeAttr(item.href)}" title="${escapeAttr(item.label)}">
            <span>${item.icon}</span>
            <span>${escapeHtml(item.label)}</span>
          </a>
        `;
      }).join("");
    }

    dock.style.display = "flex";
  }

  function renderAdminModeDock(actions){
    renderModeDock("admin", actions);
  }

  function renderVdjModeDock(actions){
    renderModeDock("vdj", actions);
  }

  async function syncPublicProfileMenuLink(sb, userMenu, user){
    if (!userMenu) return;

    let link = userMenu.querySelector('[data-public-profile-link="1"]');
    if (!link){
      link = document.createElement("a");
      link.setAttribute("data-public-profile-link", "1");
      link.textContent = "Ver perfil";
      const profileLink = Array.from(userMenu.querySelectorAll("a")).find((a) => {
        const href = String(a.getAttribute("href") || "").toLowerCase();
        return href.endsWith("profile.html") || href.endsWith("../../profile.html");
      });
      if (profileLink && profileLink.parentNode){
        profileLink.insertAdjacentElement("afterend", link);
      } else {
        userMenu.insertBefore(link, userMenu.firstChild);
      }
    }

    if (!user?.id || !sb){
      link.style.display = "none";
      link.removeAttribute("href");
      return;
    }

    try{
      const accessState = await resolveAccessState(sb);
      const profile = accessState?.profile || null;
      const href = publicProfileHref(profile?.username || "", user.id);
      const visible = profile?.member === true && !!href;
      link.style.display = visible ? "" : "none";
      if (visible) link.setAttribute("href", href);
      else link.removeAttribute("href");
    }catch(_err){
      link.style.display = "none";
      link.removeAttribute("href");
    }
  }

  async function applyRestrictedNavVisibility(sb){
    const restrictedLinks = Array.from(document.querySelectorAll('a[data-vdbf-only="1"]'));
    const adminLinks = Array.from(document.querySelectorAll('a[data-admin-only="1"]'));
    const privilegedLinks = Array.from(document.querySelectorAll('a[data-privileged-only="1"]'));

    restrictedLinks.forEach((a) => {
      a.style.display = "none";
    });
    adminLinks.forEach((a) => {
      a.style.display = "none";
    });
    privilegedLinks.forEach((a) => {
      a.style.display = "none";
    });

    if (!sb) return;

    try{
      const accessState = await resolveAccessState(sb);
      const user = accessState.user;
      if (!user){
        renderAdminModeDock([]);
        renderVdjModeDock([]);
        return;
      }

      const isAdmin = accessState.isAdmin;
      const isPrivileged = accessState.isPrivileged === true;

      privilegedLinks.forEach((a) => {
        a.style.display = isPrivileged ? "" : "none";
      });

      if (isAdmin){
        renderAdminModeDock([
          {
            href: restrictedLinks[0]?.getAttribute("href") || appPageHref("vade-back-fight.html"),
            label: "VDBF",
            icon: "V"
          },
          {
            href: appPageHref("packs.html"),
            label: "Packs",
            icon: "P"
          },
          {
            href: appPageHref("liga.html"),
            label: "Liga",
            icon: "L"
          },
          {
            href: adminLinks[0]?.getAttribute("href") || appPageHref("feedback.html"),
            label: "Feedback",
            icon: "F"
          },
          {
            href: privilegedLinks[0]?.getAttribute("href") || appPageHref("members.html"),
            label: "Members",
            icon: "M"
          }
        ]);
        renderVdjModeDock([]);
      } else if (isPrivileged){
        renderAdminModeDock([]);
        renderVdjModeDock([
          {
            href: restrictedLinks[0]?.getAttribute("href") || appPageHref("vade-back-fight.html"),
            label: "VDBF",
            icon: "V"
          },
          {
            href: privilegedLinks[0]?.getAttribute("href") || appPageHref("members.html"),
            label: "Members",
            icon: "M"
          }
        ]);
      } else {
        renderAdminModeDock([]);
        renderVdjModeDock([]);
      }
    } catch (_err){
      renderAdminModeDock([]);
      renderVdjModeDock([]);
      // Si falla cualquier check, por defecto permanece oculto.
    }
  }

  function bindProtectedNavLinks(sb, options){
    if (!sb) return;
    initGlobalAccessGuard(sb, options);
    const selector = options?.selector || 'a[data-requires-auth="1"]';
    document.querySelectorAll(selector).forEach((a) => {
      if (a.dataset.authBound === "1") return;
      a.dataset.authBound = "1";
      a.addEventListener("click", (e) => protectedNavClick(e, sb, options));
    });

    void applyRestrictedNavVisibility(sb);
    if (!window.__barateamVdbfAuthBound && sb.auth && typeof sb.auth.onAuthStateChange === "function"){
      window.__barateamVdbfAuthBound = true;
      sb.auth.onAuthStateChange(() => {
        void applyRestrictedNavVisibility(sb);
      });
    }
  }

  function setTopbarDate(target, options){
    const node = typeof target === "string" ? document.getElementById(target) : target;
    if (!node) return;
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const prefix = options?.prefix || "";
    node.textContent = `${prefix}${y}-${m}-${day}`;
  }

  function initMobileTopbarToggle(){
    const bars = document.querySelectorAll(".topbar .bar");
    if (!bars.length) return;

    let autoId = 0;
    bars.forEach((bar) => {
      if (!bar || bar.dataset.mobileNavBound === "1") return;
      const nav = bar.querySelector(".nav");
      if (!nav) return;
      bar.dataset.mobileNavBound = "1";

      autoId += 1;
      if (!nav.id) nav.id = `topbarNav${autoId}`;

      let toggle = bar.querySelector(".mobileNavToggle");
      if (!toggle){
        toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "btn mobileNavToggle";
        toggle.innerHTML = '<span class="mobileNavToggleBars" aria-hidden="true"><span></span><span></span><span></span></span>';
        toggle.setAttribute("aria-label", "Abrir menu");
        bar.insertBefore(toggle, nav);
      }

      toggle.setAttribute("aria-controls", nav.id);
      toggle.setAttribute("aria-expanded", "false");

      const close = () => {
        nav.classList.remove("open");
        toggle.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Abrir menu");
      };

      toggle.addEventListener("click", () => {
        const open = !nav.classList.contains("open");
        nav.classList.toggle("open", open);
        toggle.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.setAttribute("aria-label", open ? "Cerrar menu" : "Abrir menu");
      });

      document.addEventListener("click", (e) => {
        if (!nav.classList.contains("open")) return;
        if (bar.contains(e.target)) return;
        close();
      });

      nav.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => close());
      });

      const mq = window.matchMedia("(min-width: 761px)");
      const onMq = () => { if (mq.matches) close(); };
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);
      else if (typeof mq.addListener === "function") mq.addListener(onMq);
    });
  }

  function initUserNav(options){
    const cfg = options || {};
    const getById = cfg.getById || ((id) => document.getElementById(id));

    const ids = {
      login: cfg.loginId || "navLogin",
      userWrap: cfg.userWrapId || "navUser",
      userBtn: cfg.userBtnId || "userBtn",
      userMenu: cfg.userMenuId || "userMenu",
      userEmail: cfg.userEmailId === undefined ? "userEmail" : cfg.userEmailId,
      userLabel: cfg.userLabelId === undefined ? "userLabel" : cfg.userLabelId,
      logoutBtn: cfg.logoutBtnId === undefined ? "menuLogout" : cfg.logoutBtnId
    };

    const navLogin = getById(ids.login);
    const userWrap = getById(ids.userWrap);
    const userBtn = getById(ids.userBtn);
    const userMenu = getById(ids.userMenu);
    const userEmail = ids.userEmail ? getById(ids.userEmail) : null;
    const userLabel = ids.userLabel ? getById(ids.userLabel) : null;
    const logoutBtn = ids.logoutBtn ? getById(ids.logoutBtn) : null;
    const userDisplay = cfg.userDisplay || "flex";

    const formatLabel = cfg.formatLabel || ((user) => {
      const email = user?.email || "Usuario";
      return email.includes("@") ? (email.split("@")[0] || "Usuario") : email;
    });
    const formatEmail = cfg.formatEmail || ((user) => user?.email || "user");

    function closeMenu(){
      if (userMenu) userMenu.classList.remove("open");
    }

    function toggleMenu(){
      if (userMenu) userMenu.classList.toggle("open");
    }

    function setUser(user){
      if (navLogin){
        navLogin.style.display = user ? "none" : "inline-flex";
      }
      if (userWrap){
        userWrap.style.display = user ? userDisplay : "none";
      }
      if (userEmail && user){
        userEmail.textContent = formatEmail(user);
      }
      if (userLabel && user){
        userLabel.textContent = formatLabel(user);
      }
      void syncPublicProfileMenuLink(cfg.supabase || window.__barateamLastSupabaseClient || null, userMenu, user || null);
      if (!user){
        closeMenu();
      }
    }

    if (userBtn && !userBtn.dataset.navBound){
      userBtn.dataset.navBound = "1";
      userBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (cfg.stopPropagationOnToggle) e.stopPropagation();
        toggleMenu();
      });
    }

    if (logoutBtn && typeof cfg.onLogout === "function" && !logoutBtn.dataset.navBound){
      logoutBtn.dataset.navBound = "1";
      logoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        closeMenu();
        await cfg.onLogout();
      });
    }

    if (!document.body.dataset.navDocBound){
      document.body.dataset.navDocBound = "1";
      document.addEventListener("click", (e) => {
        document.querySelectorAll('[data-nav-user-wrap]').forEach((wrapEl) => {
          const menuEl = document.getElementById(wrapEl.dataset.navUserMenu || "");
          if (!menuEl) return;
          if (wrapEl.style.display === "none") return;
          if (!wrapEl.contains(e.target)) menuEl.classList.remove("open");
        });
      });
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        document.querySelectorAll('[data-nav-user-menu]').forEach((menuEl) => menuEl.classList.remove("open"));
      });
    }

    if (userWrap){
      userWrap.dataset.navUserWrap = "1";
      userWrap.dataset.navUserMenu = ids.userMenu || "";
    }
    if (userMenu){
      userMenu.dataset.navUserMenu = "1";
    }

    return {
      setUser,
      closeMenu,
      toggleMenu
    };
  }

  const _topbarAvatarCache = new Map();
  async function syncTopbarAvatar(sb, user, options){
    const opts = options || {};
    const img = document.getElementById(opts.imgId || "navAvatarImg");
    const fallback = document.getElementById(opts.fallbackId || "navAvatarFallback");
    if (!img || !fallback) return;

    if (!user){
      img.style.display = "none";
      img.removeAttribute("src");
      fallback.style.display = "flex";
      fallback.textContent = "?";
      return;
    }

    const cacheKey = String(user.id || "");
    let profile = _topbarAvatarCache.get(cacheKey);
    if (!profile && sb){
      const { data } = await sb
        .from("profiles")
        .select("avatar_url,display_name,username")
        .eq("id", user.id)
        .maybeSingle();
      profile = data || {};
      _topbarAvatarCache.set(cacheKey, profile);
    }
    profile = profile || {};

    const name = profile.display_name || profile.username || user.email || "U";
    const initial = String(name).trim().slice(0,1).toUpperCase() || "U";
    if (profile.avatar_url){
      img.src = profile.avatar_url;
      img.style.display = "block";
      fallback.style.display = "none";
    } else {
      img.style.display = "none";
      img.removeAttribute("src");
      fallback.style.display = "flex";
      fallback.textContent = initial;
    }
  }

  window.BarateamApp = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    createClient,
    byId,
    escapeHtml,
    escapeAttr,
    showMessage,
    formatDate,
    formatDateTime,
    formatRelativeTime,
    isNonNegativeNumber,
    eventTitle,
    eventDate,
    leaderLabel,
    getSessionUser,
    resolveAccessState,
    enforcePageAccess,
    initGlobalAccessGuard,
    clearAccessStateCache,
    applyRestrictedNavVisibility,
    bindProtectedNavLinks,
    initMobileTopbarToggle,
    setTopbarDate,
    initUserNav,
    syncTopbarAvatar
  };

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", () => {
      initMobileTopbarToggle();
      try{
        initGlobalAccessGuard(createClient());
      }catch(_err){
        // Si supabase no esta listo en esta pagina, el propio script de pagina lo iniciara.
      }
    });
  } else {
    initMobileTopbarToggle();
    try{
      initGlobalAccessGuard(createClient());
    }catch(_err){
      // Si supabase no esta listo en esta pagina, el propio script de pagina lo iniciara.
    }
  }
})(window);


