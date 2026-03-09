(function(window){
  "use strict";

  const SUPABASE_URL = "https://ceunhkqhskwnsoqyunze.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldW5oa3Foc2t3bnNvcXl1bnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDQ0ODcsImV4cCI6MjA4ODAyMDQ4N30.qBGXYYQXlyQwFGeyaeMOtLPHrjBy-eU05AO37yLvi5o";
  const VDBF_ALLOWED_USERS = new Set(["estereo", "coquito"]);

  function createClient(options){
    if (!window.supabase || typeof window.supabase.createClient !== "function"){
      throw new Error("Supabase client is not available.");
    }
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options || undefined);
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
    return eventRow?.title || eventRow?.name || eventRow?.event_name || "—";
  }

  function eventDate(eventRow){
    return formatDate(eventRow?.start_at || eventRow?.date || eventRow?.event_date, "—");
  }

  function leaderLabel(leaderRow){
    const name = leaderRow?.name || leaderRow?.leader || leaderRow?.title || "";
    const code = leaderRow?.code || leaderRow?.expansion || "";
    const label = [name, code].filter(Boolean).join(" ").trim();
    return label || "—";
  }

  async function getSessionUser(sb){
    const timeoutMs = 2500;
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
      // Si falla el check, navegamos: la página destino ya valida sesión si toca.
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

  function ensureAdminModeDock(){
    let dock = document.getElementById("adminModeDock");
    if (dock) return dock;

    dock = document.createElement("div");
    dock.id = "adminModeDock";
    dock.className = "adminModeDock";
    dock.innerHTML = `
      <div class="adminModePanel" id="adminModePanel"></div>
      <button class="adminModeToggle" id="adminModeToggle" type="button" aria-label="Abrir modo admin" aria-expanded="false" title="Modo admin">
        &#9881;
      </button>
    `;
    document.body.appendChild(dock);

    const toggle = dock.querySelector("#adminModeToggle");
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

  function renderAdminModeDock(actions){
    const dock = ensureAdminModeDock();
    const panel = dock.querySelector("#adminModePanel");
    const toggle = dock.querySelector("#adminModeToggle");
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

  async function applyRestrictedNavVisibility(sb){
    const restrictedLinks = Array.from(document.querySelectorAll('a[data-vdbf-only="1"]'));
    const adminLinks = Array.from(document.querySelectorAll('a[data-admin-only="1"]'));

    restrictedLinks.forEach((a) => {
      a.style.display = "none";
    });
    adminLinks.forEach((a) => {
      a.style.display = "none";
    });

    if (!sb) return;

    try{
      const user = await getSessionUser(sb);
      if (!user){
        renderAdminModeDock([]);
        return;
      }

      let profile = null;
      const handles = new Set();
      const emailHandle = normalizeHandle((user.email || "").split("@")[0]);
      if (emailHandle) handles.add(emailHandle);

      const meta = user.user_metadata || {};
      ["username", "display_name", "name", "nickname"].forEach((key) => {
        const v = normalizeHandle(meta[key]);
        if (v) handles.add(v);
      });

      if (user.id){
        const { data } = await sb
          .from("profiles")
          .select("username,display_name,app_role")
          .eq("id", user.id)
          .maybeSingle();
        profile = data || null;
        if (profile){
          const username = normalizeHandle(profile.username);
          const displayName = normalizeHandle(profile.display_name);
          if (username) handles.add(username);
          if (displayName) handles.add(displayName);
        }
      }

      const isAdmin = profile?.app_role === "admin";

      if (isAdmin){
        renderAdminModeDock([
          {
            href: restrictedLinks[0]?.getAttribute("href") || appPageHref("vade-back-fight.html"),
            label: "VDBF",
            icon: "🔥"
          },
          {
            href: adminLinks[0]?.getAttribute("href") || appPageHref("feedback.html"),
            label: "Feedback",
            icon: "💬"
          }
        ]);
      } else {
        renderAdminModeDock([]);
      }
    } catch (_err){
      renderAdminModeDock([]);
      // Si falla cualquier check, por defecto permanece oculto.
    }
  }

  function bindProtectedNavLinks(sb, options){
    if (!sb) return;
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
        toggle.textContent = "☰";
        toggle.setAttribute("aria-label", "Abrir menu");
        bar.insertBefore(toggle, nav);
      }

      toggle.setAttribute("aria-controls", nav.id);
      toggle.setAttribute("aria-expanded", "false");

      const close = () => {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "☰";
        toggle.setAttribute("aria-label", "Abrir menu");
      };

      toggle.addEventListener("click", () => {
        const open = !nav.classList.contains("open");
        nav.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.textContent = open ? "✕" : "☰";
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
    applyRestrictedNavVisibility,
    bindProtectedNavLinks,
    initMobileTopbarToggle,
    setTopbarDate,
    initUserNav,
    syncTopbarAvatar
  };

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initMobileTopbarToggle);
  } else {
    initMobileTopbarToggle();
  }
})(window);
