
  // ===== CONFIG =====


  const USE_MOCK = false;
  
  const sb = window.BarateamApp.createClient();
  const $ = window.BarateamApp.byId;
  window.BarateamApp.bindProtectedNavLinks(sb);

  function withTimeout(promise, ms = 8000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout auth")), ms))
    ]);
  }

  // ===== NAV auth =====
  const navController = window.BarateamApp.initUserNav({
    onLogout: async () => { await doLogout(); },
    formatLabel: (user) => (user?.email || "Usuario").split("@")[0] || "Usuario",
    formatEmail: (user) => user?.email || "user"
  });

  function setNavAuthUI(user){
    navController.setUser(user || null);
    void syncNavAvatar(user || null);
  }

  async function refreshSession(){
    try{
      const accessState = await window.BarateamApp.resolveAccessState(sb);
      const user = accessState?.user || null;
      currentAccessState = accessState || null;
      currentUser = user;
      window.__barateamCurrentUser = user;
      setNavAuthUI(user);
      applyMemberHomeState();
      return user;
    }catch(e){
      console.warn("refreshSession:", e.message);
      // No forzamos logout visual por un fallo/transitorio de red
      return currentUser;
    }
  }

  async function doLogout(){
    try{
      await withTimeout(sb.auth.signOut(), 8000);
    }catch(e){
      console.warn("signOut:", e.message);
      // aunque falle, redirigimos para "salir" visualmente
    }finally{
      setNavAuthUI(null);
      navController.closeMenu();
      location.href = "login.html";
    }
  }

  // ===== POSTS =====
  let currentUser = null;
  let currentAccessState = null;
  let featuredRefreshLoading = false;
  let postEditorOpen = false;
  const profileNameCache = new Map();
  const navProfileCache = new Map();
  const POSTS_PAGE_SIZE = 3;
  let visiblePosts = [];
  let visiblePostsOffset = 0;
  let hasMorePosts = true;
  let loadingMorePosts = false;

  function showFeedbackMsg(text, type){
    const el = $("feedbackMsg");
    if (!el) return;
    if (!text){
      el.className = "msg feedbackMsg";
      el.style.display = "none";
      el.textContent = "";
      return;
    }
    el.textContent = text;
    el.className = `msg feedbackMsg ${type === "ok" ? "ok" : "err"}`;
    el.style.display = "block";
  }

  function renderFeedbackBar(){
    const card = $("feedbackCard");
    if (!card) return;
    const visible = !!currentUser;
    card.style.display = visible ? "block" : "none";
    if (!visible){
      const input = $("feedbackInput");
      if (input) input.value = "";
      showFeedbackMsg("", "ok");
    }
  }

  function setPostEditorOpen(open){
    postEditorOpen = open === true;
    const editor = $("postEditor");
    const toggle = $("postEditorToggle");
    const chev = $("postEditorChevron");
    if (editor) editor.classList.toggle("open", postEditorOpen);
    if (toggle) toggle.setAttribute("aria-expanded", postEditorOpen ? "true" : "false");
    if (chev) chev.textContent = postEditorOpen ? "^" : "v";
  }

  function applyMemberHomeState(){
    const isMember = currentAccessState?.isMember === true;
    const isAdmin = currentAccessState?.isAdmin === true;
    const postsCard = $("postsCard");
    const featuredCard = $("featuredCard");
    const pendingCard = $("memberPendingCard");
    const postEditor = $("postEditor");
    if (postsCard) postsCard.style.display = isMember ? "block" : "none";
    if (featuredCard) featuredCard.style.display = isMember ? "block" : "none";
    if (pendingCard) pendingCard.style.display = isMember ? "none" : "block";
    if (postEditor) postEditor.style.display = isAdmin ? "block" : "none";
    if (!isAdmin) setPostEditorOpen(false);
  }

  async function syncNavAvatar(user){
    const img = $("navAvatarImg");
    const fb = $("navAvatarFallback");
    if (!img || !fb) return;

    if (!user){
      img.style.display = "none";
      img.removeAttribute("src");
      fb.style.display = "flex";
      fb.textContent = "?";
      return;
    }

    let profile = navProfileCache.get(user.id);
    if (!profile){
      const { data } = await sb
        .from("profiles")
        .select("avatar_url,display_name,username")
        .eq("id", user.id)
        .maybeSingle();
      profile = data || {};
      navProfileCache.set(user.id, profile);
    }

    const name = profile.display_name || profile.username || user.email || "U";
    const initial = String(name).trim().slice(0, 1).toUpperCase() || "U";
    if (profile.avatar_url){
      img.src = profile.avatar_url;
      img.style.display = "block";
      fb.style.display = "none";
    } else {
      img.style.display = "none";
      img.removeAttribute("src");
      fb.style.display = "flex";
      fb.textContent = initial;
    }
  }

  function showPostMsg(text, type){
    const el = $("postMsg");
    el.className = "msg " + (type || "");
    el.textContent = text;
    el.style.display = "block";
  }

  function showEventMsg(text, type){
    const el = $("eventMsg");
    if (!el) return;
    el.className = "msg " + (type || "");
    el.textContent = text;
    el.style.display = "block";
  }

  const escapeHtml = window.BarateamApp.escapeHtml;
  const escapeAttr = window.BarateamApp.escapeAttr;

  function linkifyPostBody(value){
    const text = String(value || "");
    const escaped = escapeHtml(text);
    const urlRegex = /(https?:\/\/[^\s<]+)/gi;
    return escaped.replace(urlRegex, (rawUrl) => {
      const safeUrl = rawUrl.replace(/[),.;!?]+$/g, "");
      const trailing = rawUrl.slice(safeUrl.length);
      return `<a href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>${trailing}`;
    });
  }

  function userLabelById(userId){
    if (!userId) return "Usuario";
    if (profileNameCache.has(userId)) return profileNameCache.get(userId);
    return "usuario";
  }

  function profileHrefById(userId){
    if (!userId) return "";
    return `user.html?id=${encodeURIComponent(userId)}`;
  }

  function profileLinkById(userId, label){
    const safeLabel = label || "Usuario";
    if (!userId) return escapeHtml(safeLabel);
    return `<a class="userLink" href="${escapeAttr(profileHrefById(userId))}">${escapeHtml(safeLabel)}</a>`;
  }

  async function fillProfileCache(userIds){
    const ids = Array.from(new Set((userIds || []).filter(Boolean)));
    const missing = ids.filter(id => !profileNameCache.has(id));
    if (!missing.length) return;

    const { data, error } = await sb
      .from("profiles")
      .select("id,username,display_name")
      .in("id", missing);

    if (error){
      console.warn("profiles:", error.message);
      for (const id of missing){
        if (!profileNameCache.has(id)) profileNameCache.set(id, "usuario");
      }
      return;
    }

    for (const row of (data || [])){
      const label = row.username || row.display_name || "usuario";
      profileNameCache.set(row.id, label);
    }
    for (const id of missing){
      if (!profileNameCache.has(id)) profileNameCache.set(id, "usuario");
    }
  }

  async function fetchPostSocial(postIds){
    const ids = (postIds || []).filter(Boolean);
    const commentsByPost = new Map();
    const likesByPost = new Map();
    const likedPostIds = new Set();

    if (!ids.length) return { commentsByPost, likesByPost, likedPostIds };

    const [commentsRes, likesRes] = await Promise.all([
      sb.from("comments")
        .select("id,created_at,autor,body,post,parent_comment")
        .in("post", ids)
        .order("created_at", { ascending: false }),
      sb.from("likes")
        .select("id,created_at,autor,post")
        .in("post", ids)
    ]);

    if (commentsRes.error) console.warn("comments:", commentsRes.error.message);
    if (likesRes.error) console.warn("likes:", likesRes.error.message);

    const comments = commentsRes.data || [];
    const likes = likesRes.data || [];

    const authorIds = [
      ...comments.map(c => c.autor),
      ...likes.map(l => l.autor)
    ];
    await fillProfileCache(authorIds);

    for (const c of comments){
      const key = c.post;
      if (!commentsByPost.has(key)) commentsByPost.set(key, []);
      commentsByPost.get(key).push(c);
    }

    for (const l of likes){
      const key = l.post;
      if (!likesByPost.has(key)) likesByPost.set(key, []);
      likesByPost.get(key).push(l);
      if (currentUser && l.autor === currentUser.id) likedPostIds.add(key);
    }

    return { commentsByPost, likesByPost, likedPostIds };
  }

  function buildCommentThreads(comments){
    const roots = [];
    const repliesByParent = new Map();

    for (const comment of comments || []){
      if (comment.parent_comment){
        const key = String(comment.parent_comment);
        if (!repliesByParent.has(key)) repliesByParent.set(key, []);
        repliesByParent.get(key).push(comment);
      } else {
        roots.push(comment);
      }
    }

    for (const replies of repliesByParent.values()){
      replies.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    }

    return { roots, repliesByParent };
  }

  function renderRepliesHtml(postId, parentId, replies){
    if (!replies.length) return "";
    return replies.map(reply => {
      const cDate = (reply.created_at || "").slice(0,16).replace("T", " ");
      return `
        <div class="commentItem replyItem">
          <div class="commentHead">
            <span class="commentUser">${profileLinkById(reply.autor, userLabelById(reply.autor))}</span>
            <span>${escapeHtml(cDate || "-")}</span>
          </div>
          <p class="commentBody">${escapeHtml(reply.body || "")}</p>
        </div>
      `;
    }).join("");
  }

  function renderCommentThreadHtml(postId, comment, replies){
    const cDate = (comment.created_at || "").slice(0,16).replace("T", " ");
    const replyCount = replies.length;
    const replyToggleHtml = replyCount
      ? `<button class="commentActionBtn btnToggleReplies" data-post-id="${escapeAttr(postId)}" data-parent-id="${escapeAttr(comment.id)}" type="button">Respuestas (${replyCount})</button>`
      : "";
    const replyComposerHtml = currentUser
      ? `
        <div class="replyComposer" data-post-id="${escapeAttr(postId)}" data-parent-id="${escapeAttr(comment.id)}">
          <textarea class="replyInput" data-post-id="${escapeAttr(postId)}" data-parent-id="${escapeAttr(comment.id)}" placeholder="Escribe una respuesta..."></textarea>
          <div>
            <button class="btn btnDark btnSendReply" data-post-id="${escapeAttr(postId)}" data-parent-id="${escapeAttr(comment.id)}" type="button">Responder</button>
            <button class="btn btnCancelReply" data-post-id="${escapeAttr(postId)}" data-parent-id="${escapeAttr(comment.id)}" type="button">Cancelar</button>
          </div>
        </div>
      `
      : "";

    return `
      <div class="commentThread">
        <div class="commentItem">
          <div class="commentHead">
            <span class="commentUser">${profileLinkById(comment.autor, userLabelById(comment.autor))}</span>
            <span>${escapeHtml(cDate || "-")}</span>
          </div>
          <p class="commentBody">${escapeHtml(comment.body || "")}</p>
          <div class="commentActions">
            ${replyToggleHtml}
            ${currentUser ? `<button class="commentActionBtn btnReplyComment" data-post-id="${escapeAttr(postId)}" data-parent-id="${escapeAttr(comment.id)}" type="button">Responder</button>` : ""}
          </div>
          ${replyComposerHtml}
        </div>
        ${replyCount ? `<div class="commentReplies" data-post-id="${escapeAttr(postId)}" data-parent-id="${escapeAttr(comment.id)}">${renderRepliesHtml(postId, comment.id, replies)}</div>` : ""}
      </div>
    `;
  }

  function renderPosts(posts, social){
    const root = $("postsList");
    root.innerHTML = "";

    if (!posts || posts.length === 0){
      root.innerHTML = `<div class="muted">No hay posts todavia.</div>`;
      return;
    }

    for (const p of posts){
      const date = (p.created_at || "").slice(0,10) || "-";
      const tag = p.tag || "General";
      const title = p.title || "Sin titulo";
      const body = p.body || "";
      const bodyHtml = linkifyPostBody(body);
      const comments = social.commentsByPost.get(p.id) || [];
      const threads = buildCommentThreads(comments);
      const likes = social.likesByPost.get(p.id) || [];
      const likedByMe = social.likedPostIds.has(p.id);

      const likeUsersHtml = likes.length
        ? likes.map(l => `<div class="u">${profileLinkById(l.autor, userLabelById(l.autor))}</div>`).join("")
        : `<div class="u">Sin likes todavia.</div>`;

      const commentsHtml = threads.roots.length
        ? threads.roots.map(c => renderCommentThreadHtml(p.id, c, threads.repliesByParent.get(String(c.id)) || [])).join("")
        : `<div class="muted">No hay comentarios.</div>`;

      const composerHtml = currentUser
        ? `
          <div class="commentComposer">
            <textarea class="commentInput" data-post-id="${escapeAttr(p.id)}" placeholder="Escribe un comentario..."></textarea>
            <div>
              <button class="btn btnDark btnSendComment" data-post-id="${escapeAttr(p.id)}" type="button">Comentar</button>
            </div>
          </div>
        `
        : `<div class="muted">Inicia sesion para comentar.</div>`;

      const imgHtml = p.image_url
        ? `<img class="postImg" src="${escapeAttr(p.image_url)}" alt="">`
        : "";

      const div = document.createElement("div");
      div.className = "post";
      div.innerHTML = `
        <h3>${escapeHtml(title)}</h3>
        <div class="meta">
          <span>${escapeHtml(date)}</span>
          <span>${escapeHtml(tag)}</span>
        </div>
        ${imgHtml}
        <p>${bodyHtml}</p>

        <div class="socialRow">
          <div class="likeWrap">
            <button class="iconBtn btnLikePost ${likedByMe ? "active" : ""}" data-post-id="${escapeAttr(p.id)}" type="button">&#128077; ${likes.length}</button>
            <div class="hoverUsers">${likeUsersHtml}</div>
          </div>
          <button class="iconBtn btnToggleComments" data-post-id="${escapeAttr(p.id)}" type="button">Comentarios (${comments.length})</button>
        </div>

        <div class="commentsPanel" data-post-id="${escapeAttr(p.id)}">
          ${composerHtml}
          <div class="commentList">${commentsHtml}</div>
        </div>
      `;
      root.appendChild(div);
    }

    for (const btn of root.querySelectorAll(".btnToggleComments")){
      btn.addEventListener("click", () => {
        const postId = btn.getAttribute("data-post-id");
        const panel = root.querySelector(`.commentsPanel[data-post-id="${postId}"]`);
        if (!panel) return;
        panel.classList.toggle("open");
      });
    }

    for (const btn of root.querySelectorAll(".btnLikePost")){
      btn.addEventListener("click", async () => {
        const postId = btn.getAttribute("data-post-id");
        await togglePostLike(postId);
      });
    }

    for (const btn of root.querySelectorAll(".btnSendComment")){
      btn.addEventListener("click", async () => {
        const postId = btn.getAttribute("data-post-id");
        await submitPostComment(postId);
      });
    }

    for (const btn of root.querySelectorAll(".btnToggleReplies")){
      btn.addEventListener("click", () => {
        const postId = btn.getAttribute("data-post-id");
        const parentId = btn.getAttribute("data-parent-id");
        const panel = root.querySelector(`.commentReplies[data-post-id="${postId}"][data-parent-id="${parentId}"]`);
        if (!panel) return;
        const open = panel.classList.toggle("open");
        const count = panel.children.length;
        btn.textContent = `${open ? "Ocultar respuestas" : "Respuestas"} (${count})`;
      });
    }

    for (const btn of root.querySelectorAll(".btnReplyComment")){
      btn.addEventListener("click", () => {
        const postId = btn.getAttribute("data-post-id");
        const parentId = btn.getAttribute("data-parent-id");
        const composer = root.querySelector(`.replyComposer[data-post-id="${postId}"][data-parent-id="${parentId}"]`);
        if (!composer) return;
        composer.classList.toggle("open");
        if (composer.classList.contains("open")){
          composer.querySelector(".replyInput")?.focus();
        }
      });
    }

    for (const btn of root.querySelectorAll(".btnCancelReply")){
      btn.addEventListener("click", () => {
        const postId = btn.getAttribute("data-post-id");
        const parentId = btn.getAttribute("data-parent-id");
        const composer = root.querySelector(`.replyComposer[data-post-id="${postId}"][data-parent-id="${parentId}"]`);
        const input = root.querySelector(`.replyInput[data-post-id="${postId}"][data-parent-id="${parentId}"]`);
        if (input) input.value = "";
        composer?.classList.remove("open");
      });
    }

    for (const btn of root.querySelectorAll(".btnSendReply")){
      btn.addEventListener("click", async () => {
        const postId = btn.getAttribute("data-post-id");
        const parentId = btn.getAttribute("data-parent-id");
        await submitPostComment(postId, parentId);
      });
    }
  }

  function updateLoadMorePostsUI(){
    const wrap = $("postsMoreWrap");
    const btn = $("btnLoadMorePosts");
    if (!wrap || !btn) return;

    const shouldShow = visiblePosts.length > 0 && hasMorePosts;
    wrap.style.display = shouldShow ? "flex" : "none";
    btn.disabled = loadingMorePosts;
    btn.textContent = loadingMorePosts ? "Cargando..." : "Cargar mas antiguos";
  }

  async function fetchPostsPage(offset = 0, limit = POSTS_PAGE_SIZE){
    if (USE_MOCK){
      const sample = [
        {
          id: 1,
          title: "Nuevo hub con login",
          tag: "Web",
          body: "Ya tenemos auth y perfil. Proximo: publicaciones en BBDD.",
          image_url: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1200&q=60",
          created_at: new Date().toISOString()
        },
      ];
      return sample.slice(offset, offset + limit);
    }

    const { data, error } = await sb
      .from("posts")
      .select("id,title,tag,body,image_url,created_at")
      .order("created_at", { ascending:false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.warn("posts:", error.message);
      return [];
    }
    return data || [];
  }

  async function loadMorePosts({ reset = false } = {}){
    if (loadingMorePosts) return;
    loadingMorePosts = true;
    updateLoadMorePostsUI();

    try{
      if (reset){
        visiblePosts = [];
        visiblePostsOffset = 0;
        hasMorePosts = true;
      }

      const nextPosts = await fetchPostsPage(visiblePostsOffset, POSTS_PAGE_SIZE);
      if (reset){
        visiblePosts = nextPosts;
      } else {
        visiblePosts = visiblePosts.concat(nextPosts);
      }
      visiblePostsOffset += nextPosts.length;
      hasMorePosts = nextPosts.length === POSTS_PAGE_SIZE;

      const social = await fetchPostSocial(visiblePosts.map(p => p.id));
      renderPosts(visiblePosts, social);
    } finally {
      loadingMorePosts = false;
      updateLoadMorePostsUI();
    }
  }

  async function refreshPostsSection(){
    await loadMorePosts({ reset: true });
  }

  function parseMatchWin(result){
    const value = String(result || "").trim().toLowerCase();
    return value === "won" || value === "win" || value === "victoria" || value === "w";
  }

  function percentText(wins, games){
    if (!games) return "0.0%";
    return `${((wins / games) * 100).toFixed(1)}%`;
  }

  function wilsonScore(wins, games, z = 1.96){
    if (!games) return 0;
    const p = wins / games;
    const z2 = z * z;
    const denominator = 1 + (z2 / games);
    const centre = p + (z2 / (2 * games));
    const margin = z * Math.sqrt((p * (1 - p) / games) + (z2 / (4 * games * games)));
    return (centre - margin) / denominator;
  }

  function eloFromWilson(wilson){
    return 1000 + (wilson * 1000);
  }

  const FEATURED_RANKING_MIN_GAMES = 40;

  function featuredTopPlayerPool(rows){
    const list = Array.isArray(rows) ? rows : [];
    const eligible = list.filter((p) => p.games >= FEATURED_RANKING_MIN_GAMES);
    return eligible.length ? eligible : list;
  }

  function playerLabel(profile, playerRow, playerId){
    if (profile?.username) return profile.username;
    if (profile?.display_name) return profile.display_name;
    if (playerRow?.name) return playerRow.name;
    if (!playerId) return "usuario";
    return `user-${String(playerId).slice(0, 8)}`;
  }

  function featuredPlayerProfileId(playersMap, playerId){
    return playersMap?.get(playerId)?.profile_id || null;
  }

  function isRankedTeamName(teamName){
    const t = String(teamName || "").trim().toLowerCase();
    if (!t) return false;
    if (t === "sin equipo" || t === "sinequipo") return false;
    if (t === "no team" || t === "none" || t === "-") return false;
    return true;
  }

  function featuredPlayerLabelHtml(playersMap, playerId, label){
    const profileId = featuredPlayerProfileId(playersMap, playerId);
    if (profileId) return profileLinkById(profileId, label);
    return escapeHtml(label);
  }

  function memberFeaturedPlayerIds(playersMap, profileMap){
    const allowed = new Set();
    for (const [playerId, player] of (playersMap || new Map()).entries()){
      const profileId = player?.profile_id || null;
      const profile = profileId ? profileMap.get(profileId) : null;
      if (profile?.member === true) allowed.add(playerId);
    }
    return allowed;
  }

  function leaderImageHtml(leader){
    const source = String(leader?.parallel_image_url || leader?.image_url || "").trim();
    if (source){
      const src = escapeAttr(source);
      const alt = escapeAttr(leader.name || "leader");
      return `
        <span class="leaderZoom">
          <img class="leaderImg" src="${src}" alt="${alt}" />
          <span class="leaderZoomPreview">
            <img src="${src}" alt="${alt}" />
          </span>
        </span>
      `;
    }
    return `<div class="leaderFallback">N/A</div>`;
  }

  function chooseLeaderMostPlayed(leaderMap){
    const arr = Array.from(leaderMap.values());
    if (!arr.length) return null;
    arr.sort((a, b) => {
      if (b.games !== a.games) return b.games - a.games;
      return b.wins - a.wins;
    });
    return arr[0];
  }

  function chooseLeaderBestWr(leaderMap){
    const arr = Array.from(leaderMap.values());
    if (!arr.length) return null;
    const withSample = arr.filter((x) => x.games >= 3);
    const pool = withSample.length ? withSample : arr;
    pool.sort((a, b) => {
      const awr = a.games ? (a.wins / a.games) : 0;
      const bwr = b.games ? (b.wins / b.games) : 0;
      if (bwr !== awr) return bwr - awr;
      if (b.games !== a.games) return b.games - a.games;
      return b.wins - a.wins;
    });
    return pool[0];
  }

  async function fetchCurrentExpansion(){
    const { data, error } = await sb
      .from("expansions")
      .select("id,name,start_date,end_date")
      .order("start_date", { ascending: true });

    if (error) throw error;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return (data || []).find((exp) => {
      const start = new Date(exp.start_date);
      const end = new Date(exp.end_date);
      const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const dayEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      return today >= dayStart && today <= dayEnd;
    }) || null;
  }

  async function fetchFeaturedMatches(){
    const pageSize = 1000;
    const maxRows = 20000;
    let from = 0;
    const rows = [];

    while (from < maxRows){
      const to = from + pageSize - 1;
      const { data, error } = await sb
        .rpc("get_global_featured_matches_v1", {
          p_start_at: null,
          p_end_at: null
        })
        .range(from, to);

      if (error){
        const message = String(error.message || error.details || "");
        if (
          message.toLowerCase().includes("get_global_featured_matches_v1") ||
          message.toLowerCase().includes("schema cache")
        ){
          throw new Error("Falta desplegar la SQL global del jugador destacado en Supabase.");
        }
        throw error;
      }

      const batch = Array.isArray(data) ? data : [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
    return rows.map((row) => ({
      id: row.match_id,
      player_id: row.player_id,
      profile_id: row.profile_id,
      player_name: row.player_name,
      profile_username: row.profile_username,
      profile_display_name: row.profile_display_name,
      profile_avatar_url: row.profile_avatar_url,
      profile_team: row.profile_team,
      profile_member: row.profile_member === true,
      player_leader: row.player_leader,
      opponent_leader: row.opponent_leader,
      result: row.result,
      match_date: row.match_date,
      created_at: row.created_at,
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
    }));
  }

  function buildFeaturedProfileMap(matches){
    const map = new Map();
    for (const row of (matches || [])){
      const profileId = row?.profile_id || null;
      if (!profileId || map.has(profileId)) continue;
      map.set(profileId, {
        id: profileId,
        username: row?.profile_username || "",
        display_name: row?.profile_display_name || "",
        avatar_url: row?.profile_avatar_url || "",
        team: row?.profile_team || "SIN EQUIPO",
        member: row?.profile_member === true
      });
    }
    return map;
  }

  function buildFeaturedPlayersMap(matches){
    const map = new Map();
    for (const row of (matches || [])){
      const playerId = row?.player_id || null;
      if (!playerId || map.has(playerId)) continue;
      map.set(playerId, {
        id: playerId,
        name: row?.player_name || "",
        profile_id: row?.profile_id || null
      });
    }
    return map;
  }

  function filterFeaturedMatchesByExpansion(matches, expansion){
    let filtered = Array.isArray(matches) ? [...matches] : [];
    if (!expansion) return filtered;

    const start = new Date(expansion.start_date);
    const end = new Date(expansion.end_date);
    filtered = filtered.filter((m) => {
      const matchDate = new Date(m.match_date);
      return matchDate >= start && matchDate <= end;
    });
    return filtered;
  }

  function buildFeaturedRanking(matches){
    const players = new Map();

    for (const row of (matches || [])){
      const playerId = row?.player_id || null;
      if (!playerId) continue;

      if (!players.has(playerId)){
        players.set(playerId, {
          playerId,
          games: 0,
          wins: 0,
          losses: 0,
          leaders: new Map()
        });
      }

      const p = players.get(playerId);
      const won = parseMatchWin(row?.result);
      p.games += 1;
      if (won) p.wins += 1;
      else p.losses += 1;

      const leaderCode = String(row?.player_leader || row?.player?.code || "unknown").trim();
      if (!p.leaders.has(leaderCode)){
        p.leaders.set(leaderCode, {
          code: leaderCode,
          name: row?.player?.name || leaderCode || "Leader",
          parallel_image_url: row?.player?.parallel_image_url || "",
          image_url: row?.player?.image_url || "",
          games: 0,
          wins: 0
        });
      }
      const leader = p.leaders.get(leaderCode);
      leader.games += 1;
      if (won) leader.wins += 1;
      if (!leader.parallel_image_url && row?.player?.parallel_image_url) leader.parallel_image_url = row.player.parallel_image_url;
      if (!leader.image_url && row?.player?.image_url) leader.image_url = row.player.image_url;
      if ((!leader.name || leader.name === leader.code) && row?.player?.name) leader.name = row.player.name;
    }

    const ranking = Array.from(players.values())
      .map((p) => {
        const wilson = wilsonScore(p.wins, p.games);
        return {
          ...p,
          wr: p.games ? (p.wins / p.games) : 0,
          wilson,
          elo: eloFromWilson(wilson),
          topLeaderByGames: chooseLeaderMostPlayed(p.leaders),
          topLeaderByWr: chooseLeaderBestWr(p.leaders)
        };
      });

    ranking.sort((a, b) => {
      if (b.wilson !== a.wilson) return b.wilson - a.wilson;
      if (b.games !== a.games) return b.games - a.games;
      return b.wins - a.wins;
    });

    return ranking;
  }

  function buildLeaderRankings(matches){
    const leaders = new Map();

    for (const row of (matches || [])){
      const leaderCode = String(row?.player_leader || row?.player?.code || "").trim();
      if (!leaderCode) continue;

      if (!leaders.has(leaderCode)){
        leaders.set(leaderCode, {
          code: leaderCode,
          name: row?.player?.name || leaderCode,
          parallel_image_url: row?.player?.parallel_image_url || "",
          image_url: row?.player?.image_url || "",
          games: 0,
          wins: 0,
          matchups: new Map()
        });
      }

      const entry = leaders.get(leaderCode);
      const won = parseMatchWin(row?.result);
      entry.games += 1;
      if (won) entry.wins += 1;
      if (!entry.parallel_image_url && row?.player?.parallel_image_url) entry.parallel_image_url = row.player.parallel_image_url;
      if (!entry.image_url && row?.player?.image_url) entry.image_url = row.player.image_url;
      if ((!entry.name || entry.name === entry.code) && row?.player?.name) entry.name = row.player.name;

      const oppCode = String(row?.opponent_leader || row?.opponent?.code || "").trim();
      if (!oppCode) continue;

      if (!entry.matchups.has(oppCode)){
        entry.matchups.set(oppCode, {
          code: oppCode,
          name: row?.opponent?.name || oppCode,
          parallel_image_url: row?.opponent?.parallel_image_url || "",
          image_url: row?.opponent?.image_url || "",
          games: 0,
          wins: 0
        });
      }
      const mu = entry.matchups.get(oppCode);
      mu.games += 1;
      if (won) mu.wins += 1;
      if (!mu.parallel_image_url && row?.opponent?.parallel_image_url) mu.parallel_image_url = row.opponent.parallel_image_url;
      if (!mu.image_url && row?.opponent?.image_url) mu.image_url = row.opponent.image_url;
      if ((!mu.name || mu.name === mu.code) && row?.opponent?.name) mu.name = row.opponent.name;
    }

    const rows = Array.from(leaders.values()).map((x) => {
      const wr = x.games ? (x.wins / x.games) : 0;
      const muRows = Array.from(x.matchups.values())
        .map((m) => ({ ...m, wr: m.games ? (m.wins / m.games) : 0 }));
      const withSample = muRows.filter((m) => m.games >= 2);
      const pool = withSample.length ? withSample : muRows;
      pool.sort((a, b) => {
        if (b.wr !== a.wr) return b.wr - a.wr;
        return b.games - a.games;
      });
      const best = pool[0] || null;
      const worst = pool.length ? [...pool].sort((a, b) => {
        if (a.wr !== b.wr) return a.wr - b.wr;
        return b.games - a.games;
      })[0] : null;
      return { ...x, wr, best, worst };
    });

    const byPlayed = [...rows].sort((a, b) => {
      if (b.games !== a.games) return b.games - a.games;
      return b.wr - a.wr;
    }).slice(0, 3);

    const minGames = 3;
    const wrPool = rows.filter((x) => x.games >= minGames);
    const byWr = (wrPool.length ? wrPool : rows)
      .sort((a, b) => {
        if (b.wr !== a.wr) return b.wr - a.wr;
        return b.games - a.games;
      })
      .slice(0, 3);

    return { byWr, byPlayed };
  }

  function matchupHtml(item, cls){
    if (!item){
      return `<div class="lrMu ${cls}"><span class="featuredMuted">â€”</span></div>`;
    }
    return `
      <div class="lrMu ${cls}" title="${escapeAttr(item.name || item.code || "-")}">
        ${leaderImageHtml(item)}
      </div>
    `;
  }

  function leaderRowHtml(item){
    return `
      <div class="lrRow">
        <div class="lrLeader" title="${escapeAttr(item.name || item.code || "-")}">
          ${leaderImageHtml(item)}
        </div>
        <div class="lrVal games">${item.games}</div>
        <div class="lrVal wr">${percentText(item.wins, item.games)}</div>
        ${matchupHtml(item.best, "best")}
        ${matchupHtml(item.worst, "worst")}
      </div>
    `;
  }

  function leaderRankCardHtml(title, rows){
    const content = rows.length
      ? rows.map((r) => leaderRowHtml(r)).join("")
      : `<div class="lrRow"><span class="featuredMuted">Sin datos suficientes.</span></div>`;
    return `
      <div class="leaderRankCard">
        <p class="leaderRankTitle">${escapeHtml(title)}</p>
        <div class="lrHead">
          <span>Lider</span>
          <span>Partidas</span>
          <span>WR</span>
          <span>Mejor WR</span>
          <span>Peor WR</span>
        </div>
        ${content}
      </div>
    `;
  }

  function featuredRefreshButtonHtml(disabled = false){
    return `<button class="featuredRefreshBtn" id="btnRefreshFeatured" type="button" aria-label="Recargar jugador destacado" title="Recargar jugador destacado"${disabled ? " disabled" : ""}>&#10227;</button>`;
  }

  function renderFeaturedPlayer(topPlayers, profileMap, playersMap, expansion, leaderRankings){
    const root = $("featuredPlayerBody");
    const sectionTitle = $("featuredSectionTitle");
    if (!root) return;

    if (!topPlayers || !topPlayers.length){
      if (sectionTitle) sectionTitle.textContent = "Jugador destacado";
      root.innerHTML = `${featuredRefreshButtonHtml()}<div class="featuredMuted">Aun no hay suficientes partidas en matches para generar el ranking.</div>`;
      return;
    }

    const featuredPool = featuredTopPlayerPool(topPlayers);
    const featuredTopPlayers = featuredPool.slice(0, 5);
    const main = featuredTopPlayers[0];
    const mainPlayer = playersMap.get(main.playerId);
    const mainProfile = profileMap.get(featuredPlayerProfileId(playersMap, main.playerId));
    const mainLabel = playerLabel(mainProfile, mainPlayer, main.playerId);
    const mainAvatar = mainProfile?.avatar_url || "";
    const mainInitial = String(mainLabel || "U").trim().charAt(0) || "U";
    const topGamesLeader = main.topLeaderByGames;
    const topWrLeader = main.topLeaderByWr;
    const spotlightLeaderBg = String(topGamesLeader?.parallel_image_url || topGamesLeader?.image_url || "").trim();
    const spotlightClass = spotlightLeaderBg ? "featuredSpotlight withLeaderBg" : "featuredSpotlight";
    const spotlightStyle = spotlightLeaderBg
      ? ` style="--featured-leader-bg: url('${escapeAttr(spotlightLeaderBg)}');"`
      : "";

    if (sectionTitle){
      sectionTitle.textContent = expansion?.name
        ? `Jugador destacado - ${expansion.name}`
        : "Jugador destacado";
    }

    const topListHtml = featuredTopPlayers
      .map((p, idx) => {
        const profile = profileMap.get(featuredPlayerProfileId(playersMap, p.playerId));
        const playerRow = playersMap.get(p.playerId);
        const label = playerLabel(profile, playerRow, p.playerId);
        return `<li><strong>#${idx + 1} ${featuredPlayerLabelHtml(playersMap, p.playerId, label)}</strong> · ${percentText(p.wins, p.games)} · ${p.games} partidas</li>`;
      })
      .join("");
    const rookiePlayers = topPlayers
      .filter((p) => p.games < FEATURED_RANKING_MIN_GAMES)
      .slice(0, 5);
    const rookieListHtml = rookiePlayers.length
      ? rookiePlayers
          .map((p, idx) => {
            const profile = profileMap.get(featuredPlayerProfileId(playersMap, p.playerId));
            const playerRow = playersMap.get(p.playerId);
            const label = playerLabel(profile, playerRow, p.playerId);
            return `<li><strong>#${idx + 1} ${featuredPlayerLabelHtml(playersMap, p.playerId, label)}</strong> · ${percentText(p.wins, p.games)} · ${p.games} partidas</li>`;
          })
          .join("")
      : `<li>Sin rookies disponibles en esta expansion.</li>`;

    const teams = new Map();
    for (const p of topPlayers){
      const pid = featuredPlayerProfileId(playersMap, p.playerId);
      const profile = profileMap.get(pid);
      const rawTeam = String(profile?.team || "").trim();
      if (!isRankedTeamName(rawTeam)) continue;
      const teamKey = rawTeam.toLowerCase();
      const playerRow = playersMap.get(p.playerId);
      const label = playerLabel(profile, playerRow, p.playerId);
      if (!teams.has(teamKey)){
        teams.set(teamKey, {
          team: rawTeam,
          games: 0,
          wins: 0,
          losses: 0,
          memberCount: 0,
          rankingCount: 0,
          rankingEloSum: 0,
          players: [],
          rankingPlayers: []
        });
      }
      const t = teams.get(teamKey);
      t.games += p.games;
      t.wins += p.wins;
      t.losses += p.losses;
      t.memberCount += 1;
      t.players.push({ p, label });
      if (p.games >= FEATURED_RANKING_MIN_GAMES){
        t.rankingCount += 1;
        t.rankingEloSum += p.elo || 0;
        t.rankingPlayers.push({ p, label });
      }
    }

    const teamRows = Array.from(teams.values())
      .map((t) => {
        const rankingPool = t.rankingPlayers.length ? [...t.rankingPlayers] : [...t.players];
        const playersByElo = [...rankingPool].sort((a, b) => {
          if (b.p.elo !== a.p.elo) return b.p.elo - a.p.elo;
          if (b.p.games !== a.p.games) return b.p.games - a.p.games;
          return b.p.wins - a.p.wins;
        });
        const playersByGames = [...t.players].sort((a, b) => {
          if (b.p.games !== a.p.games) return b.p.games - a.p.games;
          if (b.p.elo !== a.p.elo) return b.p.elo - a.p.elo;
          return b.p.wins - a.p.wins;
        });
        const topByElo = playersByElo[0] || null;
        const topByGames = playersByGames[0] || null;
        const avgElo = t.rankingCount ? (t.rankingEloSum / t.rankingCount) : 0;
        const weightedWr = t.games ? (t.wins / t.games) : 0;
        return { ...t, avgElo, weightedWr, topByElo, topByGames };
      })
      .filter((t) => t.rankingCount > 0)
      .sort((a, b) => {
        if (b.avgElo !== a.avgElo) return b.avgElo - a.avgElo;
        if (b.games !== a.games) return b.games - a.games;
        return b.wins - a.wins;
      });

    const featuredTeam = teamRows[0] || null;
    const topByTeamHtml = teamRows.length
      ? teamRows.map((t) => {
          const top = t.topByElo;
          if (!top) return "";
          return `
            <li class="teamTopItem">
              <div class="teamTopMain">
                <div class="teamTopTeam">${escapeHtml(t.team)}</div>
                <div class="teamTopPlayer">${featuredPlayerLabelHtml(playersMap, top.p.playerId, top.label)}</div>
              </div>
              <div class="teamTopMeta">
                <span class="wr">${percentText(top.p.wins, top.p.games)}</span>
                <span>${top.p.games} partidas</span>
              </div>
            </li>
          `;
        }).join("")
      : `<li class="featuredMuted">Sin equipos con datos suficientes.</li>`;

    const featuredTeamHtml = featuredTeam
      ? `
        <div class="featuredTeamCard">
          <div class="featuredTeamHead">
            <div>
              <p class="featuredListTitle" style="margin-bottom:4px;">Equipo destacado</p>
              <h4 class="featuredTeamName">${escapeHtml(featuredTeam.team)}</h4>
              <p class="featuredTeamSub">Equipo con mejor rendimiento global en el ranking</p>
            </div>
          </div>
          <div class="featuredTeamStats">
            <div class="featuredStat">
              <div class="k">WR promedio</div>
              <div class="v">${featuredTeam.memberCount ? ((featuredTeam.players.reduce((sum, item) => sum + item.p.wr, 0) / featuredTeam.memberCount) * 100).toFixed(1) : "0.0"}%</div>
            </div>
            <div class="featuredStat">
              <div class="k">Jugadores</div>
              <div class="v">${featuredTeam.memberCount}</div>
            </div>
            <div class="featuredStat">
              <div class="k">Partidas</div>
              <div class="v">${featuredTeam.games}</div>
            </div>
            <div class="featuredStat">
              <div class="k">Victorias</div>
              <div class="v">${featuredTeam.wins}</div>
            </div>
          </div>
          <div class="featuredTeamMeta">
            <div class="featuredTeamStats tight">
              <div class="featuredStat">
                <div class="k">Top jugador</div>
                <div class="v">${featuredPlayerLabelHtml(playersMap, featuredTeam.topByElo?.p?.playerId || "", featuredTeam.topByElo?.label || "-")}</div>
                <div class="featuredTeamMetaLine">WR ${featuredTeam.topByElo ? percentText(featuredTeam.topByElo.p.wins, featuredTeam.topByElo.p.games) : "0.0%"} · ${featuredTeam.topByElo?.p?.wins || 0}/${featuredTeam.topByElo?.p?.losses || 0}</div>
              </div>
              <div class="featuredStat">
                <div class="k">Mas jugado</div>
                <div class="v">${featuredPlayerLabelHtml(playersMap, featuredTeam.topByGames?.p?.playerId || "", featuredTeam.topByGames?.label || "-")}</div>
                <div class="featuredTeamMetaLine">${featuredTeam.topByGames?.p?.games || 0} partidas</div>
              </div>
            </div>
            <div class="featuredTeamMetaLine center"><strong>Miembros:</strong> ${featuredTeam.memberCount} / <strong>En ranking:</strong> ${featuredTeam.rankingCount}</div>
          </div>
        </div>
      `
      : `
        <div class="featuredTeamCard">
          <p class="featuredListTitle">Equipo destacado</p>
          <div class="featuredMuted">Sin equipos con datos suficientes.</div>
        </div>
      `;

    root.innerHTML = `
      ${featuredRefreshButtonHtml()}
      <div class="featuredMain">
        <div class="${spotlightClass}"${spotlightStyle}>
          <div class="featuredHero">
            ${mainAvatar
              ? `<img class="featuredAvatar" src="${escapeAttr(mainAvatar)}" alt="${escapeAttr(mainLabel)}">`
              : `<div class="featuredAvatarFallback">${escapeHtml(mainInitial)}</div>`}
            <div class="featuredIdentity">
              <div class="featuredNameLine">
                <h3 class="featuredTitle">${featuredPlayerLabelHtml(playersMap, main.playerId, mainLabel)}</h3>
                <span class="featuredRankNo">#1</span>
              </div>
              <p class="featuredSub">Mejor winrate con volumen de partidas</p>
            </div>
          </div>
          <div class="featuredStats">
            <div class="featuredStat">
              <div class="k">Partidas</div>
              <div class="v">${main.games}</div>
            </div>
            <div class="featuredStat">
              <div class="k">Winrate</div>
              <div class="v">${percentText(main.wins, main.games)}</div>
            </div>
            <div class="featuredStat">
              <div class="k">Victorias</div>
              <div class="v">${main.wins}</div>
            </div>
            <div class="featuredStat">
              <div class="k">Derrotas</div>
              <div class="v">${main.losses}</div>
            </div>
          </div>
          <div class="featuredLeaders">
            <div class="leaderBox">
              <div class="leaderLbl">Lider mas jugado</div>
              <div class="leaderLine">
                ${leaderImageHtml(topGamesLeader)}
                <div>
                  <p class="leaderName">${escapeHtml(topGamesLeader?.name || "â€”")}</p>
                  <p class="leaderMeta">${topGamesLeader ? `${topGamesLeader.games} partidas` : "Sin datos"}</p>
                </div>
              </div>
            </div>
            <div class="leaderBox">
              <div class="leaderLbl">Lider con mayor WR</div>
              <div class="leaderLine">
                ${leaderImageHtml(topWrLeader)}
                <div>
                  <p class="leaderName">${escapeHtml(topWrLeader?.name || "â€”")}</p>
                  <p class="leaderMeta">${topWrLeader ? `${percentText(topWrLeader.wins, topWrLeader.games)} en ${topWrLeader.games} partidas` : "Sin datos"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="featuredBottomLists">
        <div class="featuredTeamRow">
          ${featuredTeamHtml}
          <div class="featuredListCard">
            <p class="featuredListTitle">Top 1 por equipo</p>
            <ul class="teamTopList">${topByTeamHtml}</ul>
          </div>
        </div>
        <div class="featuredPlayerLists">
          <div class="featuredListCard">
            <p class="featuredListTitle">Top 5 jugadores</p>
            <ul class="topList">${topListHtml}</ul>
          </div>
          <div class="featuredListCard">
            <p class="featuredListTitle">Top 5 rookies</p>
            <ul class="topList">${rookieListHtml}</ul>
          </div>
        </div>
      </div>
      <div class="leaderRanks">
        ${leaderRankCardHtml("Top 3 lideres por WR", leaderRankings?.byWr || [])}
        ${leaderRankCardHtml("Top 3 lideres mas jugados", leaderRankings?.byPlayed || [])}
      </div>
    `;
  }

  async function refreshFeaturedPlayerSection(){
    const root = $("featuredPlayerBody");
    const sectionTitle = $("featuredSectionTitle");
    if (!root) return;
    if (featuredRefreshLoading) return;
    featuredRefreshLoading = true;
    if (sectionTitle) sectionTitle.textContent = "Jugador destacado";
    root.innerHTML = `<div class="featuredMuted">Calculando jugador destacado...</div>`;

    try{
      const expansion = await withTimeout(fetchCurrentExpansion(), 12000);
      if (!expansion){
        root.innerHTML = `${featuredRefreshButtonHtml()}<div class="featuredMuted">No hay expansion activa para la fecha actual.</div>`;
        return;
      }
      const allMatches = await withTimeout(fetchFeaturedMatches(), 12000);
      const matches = filterFeaturedMatchesByExpansion(allMatches, expansion);
      const playersMap = buildFeaturedPlayersMap(matches);
      const profileMap = buildFeaturedProfileMap(matches);
      const topPlayers = buildFeaturedRanking(matches);
      const leaderRankings = buildLeaderRankings(matches);
      renderFeaturedPlayer(topPlayers, profileMap, playersMap, expansion, leaderRankings);
    }catch(e){
      console.warn("featured:", e.message || e);
      root.innerHTML = `${featuredRefreshButtonHtml()}<div class="featuredMuted">${escapeHtml(e?.message || "No se pudo cargar el jugador destacado.")}</div>`;
    } finally {
      featuredRefreshLoading = false;
    }
  }

  async function togglePostLike(postId){
    if (!currentUser) return showPostMsg("Inicia sesion para dar like.", "err");
    if (!postId) return;

    const { data: existing, error: exErr } = await sb
      .from("likes")
      .select("id")
      .eq("post", postId)
      .eq("autor", currentUser.id)
      .limit(1);

    if (exErr) return showPostMsg("Error en likes: " + exErr.message, "err");

    if (existing && existing.length){
      const { error } = await sb
        .from("likes")
        .delete()
        .eq("post", postId)
        .eq("autor", currentUser.id);
      if (error) return showPostMsg("No pude quitar el like: " + error.message, "err");
    } else {
      const { error } = await sb.from("likes").insert({ autor: currentUser.id, post: postId });
      if (error) return showPostMsg("No pude dar like: " + error.message, "err");
    }

    await refreshPostsSection();
  }

  async function submitPostComment(postId, parentCommentId = null){
    if (!currentUser) return showPostMsg("Inicia sesion para comentar.", "err");
    if (!postId) return;

    const input = parentCommentId
      ? document.querySelector(`.replyInput[data-post-id="${postId}"][data-parent-id="${parentCommentId}"]`)
      : document.querySelector(`.commentInput[data-post-id="${postId}"]`);
    const body = input?.value?.trim() || "";
    if (!body) return showPostMsg("Escribe un comentario.", "err");

    const { error } = await sb.from("comments").insert({
      autor: currentUser.id,
      post: postId,
      body,
      parent_comment: parentCommentId || null
    });

    if (error) return showPostMsg("No pude guardar el comentario: " + error.message, "err");

    if (input) input.value = "";
    await refreshPostsSection();
  }

  async function uploadPostImage(file, userId){
    if (!file) return null;

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";
    const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExt}`;
    const path = `${userId}/${fileName}`;

    const { error: upErr } = await sb
      .storage
      .from("post-images")
      .upload(path, file, { upsert: false, contentType: file.type });

    if (upErr) throw upErr;

    const { data } = sb.storage.from("post-images").getPublicUrl(path);
    return data?.publicUrl || null;
  }

  async function publishPost(){
    const title = $("post_title").value.trim();
    const tag = $("post_tag").value.trim();
    const body = $("post_body").value.trim();
    const file = $("post_image_file").files?.[0] || null;
    const btn = $("btnPublish");

    try{
      if (btn) btn.disabled = true;
      const user = currentUser || null;
      if (!user){
        showPostMsg("No hay sesion activa.", "err");
        return;
      }

      let image_url = null;
      if (file){
        image_url = await uploadPostImage(file, user.id);
      }

      const payload = {
        title,
        tag: tag || null,
        body,
        image_url: image_url || null
      };

      const { error } = await sb.from("posts").insert(payload);
      if (error) throw error;

      showPostMsg("Post publicado", "ok");

      $("post_title").value = "";
      $("post_tag").value = "";
      $("post_body").value = "";
      $("post_image_file").value = "";

      await refreshPostsSection();
    }catch(e){
      console.error(e);
      showPostMsg("Error publicando: " + (e.message || "unknown"), "err");
    }finally{
      if (btn) btn.disabled = false;
    }
  }

  $("btnPublish")?.addEventListener("click", async () => {
    await publishPost();
  });

  $("postEditorToggle")?.addEventListener("click", () => {
    setPostEditorOpen(!postEditorOpen);
  });

  $("btnLoadMorePosts")?.addEventListener("click", async () => {
    await loadMorePosts();
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("#btnRefreshFeatured");
    if (!btn) return;
    await refreshFeaturedPlayerSection();
  });

  async function submitFeedback(){
    if (!currentUser) return;

    const input = $("feedbackInput");
    const btn = $("btnSendFeedback");
    const body = input?.value?.trim() || "";
    if (!body) return showFeedbackMsg("Escribe algun feedback.", "err");

    try{
      if (btn) btn.disabled = true;
      const { error } = await sb.from("feedback").insert({
        autor: currentUser.id,
        body,
        estado: 0
      });
      if (error) throw error;

      if (input) input.value = "";
      showFeedbackMsg("Feedback enviado. Gracias.", "ok");
    }catch(e){
      console.error(e);
      showFeedbackMsg("No pude guardar el feedback: " + (e.message || "unknown"), "err");
    }finally{
      if (btn) btn.disabled = false;
    }
  }

  $("btnSendFeedback")?.addEventListener("click", async () => {
    await submitFeedback();
  });

  async function createEvent(){
    const title = $("event_title")?.value?.trim() || null;
    const startLocal = $("event_start_at")?.value || "";
    const location = $("event_location")?.value?.trim() || null;
    const description = $("event_description")?.value?.trim() || null;
    const start_at = startLocal ? new Date(startLocal).toISOString() : null;

    const btn = $("btnCreateEvent");

    try{
      if (btn?.disabled) return;
      if (btn) btn.disabled = true;
      const user = currentUser || null;
      if (!user){
        showEventMsg("No hay sesion activa.", "err");
        return;
      }
      const payload = {
        title,
        start_at,
        location,
        description,
        author_id: user.id
      };
      const { error } = await sb.from("events").insert(payload);
      if (error) throw error;

      $("event_title").value = "";
      $("event_start_at").value = "";
      $("event_location").value = "";
      $("event_description").value = "";
      showEventMsg("Evento guardado", "ok");
      // Refresco en background para no bloquear el boton de guardar
      void refreshCalendarOnly();
    }catch(e){
      console.error(e);
      showEventMsg("Error guardando evento: " + (e.message || "unknown"), "err");
    }finally{
      if (btn) btn.disabled = false;
    }
  }

  $("btnCreateEvent")?.addEventListener("click", async () => {
    await createEvent();
  });

  // ===== EVENTS (lo dejamos como lo tenias, mock/real) =====
  function ymd(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const da = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${da}`;
  }

  function eventRawDate(e){
    return String(e?.start_at || "").trim();
  }

  function eventDateObj(e){
    const raw = eventRawDate(e);
    if (!raw) return null;
    let normalized = raw.trim();
    normalized = normalized.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += "T00:00:00";
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  async function fetchEventsForMonth(viewDate){
    if (USE_MOCK){
      const base = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
      const e1 = new Date(base.getFullYear(), base.getMonth(), 5, 19, 0);
      const e2 = new Date(base.getFullYear(), base.getMonth(), 12, 20, 0);
      return [
        { id: 1, title: "Liga local", start_at: e1.toISOString(), location: "Tienda" },
        { id: 2, title: "Testing night", start_at: e2.toISOString(), location: "Casa" },
      ];
    }

    const { data, error } = await sb
      .from("events")
      .select("id,title,start_at,location")
      .order("start_at", { ascending: true })
      .limit(1000);

    if (error){
      console.warn("events:", error.message);
      return [];
    }
    console.log("[calendar] query", {
      user: currentUser?.id || null,
      month: `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, "0")}`,
      totalRows: (data || []).length
    });
    const all = (data || []).filter((e) => !!eventDateObj(e));
    const filtered = all;
    console.log("[calendar] filtered", {
      parseableRows: all.length,
      monthRows: filtered.length,
      sample: filtered.slice(0, 3).map((e) => ({ id: e.id, title: e.title, start_at: e.start_at }))
    });
    return filtered;
  }

  function groupEventsByDay(events){
    const map = new Map();
    for (const e of events){
      const d = eventDateObj(e);
      if (!d) continue;
      const key = ymd(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    for (const [k, arr] of map.entries()){
      arr.sort((a,b)=> {
        const ad = eventDateObj(a);
        const bd = eventDateObj(b);
        return (ad?.getTime() || 0) - (bd?.getTime() || 0);
      });
    }
    return map;
  }

  function renderCalendar(viewDate, dayEventsMap){
    const title = $("calTitle");
    const dowRoot = $("calDow");
    const grid = $("calGrid");
    if (!title || !dowRoot || !grid) return;

    const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    title.textContent = `${monthNames[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

    const dow = ["L","M","X","J","V","S","D"];
    dowRoot.innerHTML = "";
    for (const d of dow){
      const el = document.createElement("div");
      el.className = "dow";
      el.textContent = d;
      dowRoot.appendChild(el);
    }

    grid.innerHTML = "";

    const todayKey = ymd(new Date());
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const last = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 0);
    const firstDow = (first.getDay() + 6) % 7; // lunes=0
    const totalDays = last.getDate();

    for (let i=0;i<firstDow;i++){
      const blank = document.createElement("div");
      blank.className = "day muted";
      grid.appendChild(blank);
    }

    for (let day=1; day<=totalDays; day++){
      const d = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
      const key = ymd(d);

      const cell = document.createElement("div");
      cell.className = "day" + (key === todayKey ? " today" : "");

      const events = dayEventsMap.get(key) || [];
      if (events.length) cell.classList.add("hasEvents");

      cell.innerHTML = `
        <span>${day}</span>
        <span class="dot"></span>
        ${events.length ? `
          <div class="tooltip">
            <div class="tipTitle">${events.length} evento(s)</div>
            ${events.slice(0,5).map(ev => {
              const dt = eventDateObj(ev);
              if (!dt) return "";
              const hh = String(dt.getHours()).padStart(2,"0");
              const mm = String(dt.getMinutes()).padStart(2,"0");
              const loc = ev.location ? ` · ${escapeHtml(ev.location)}` : "";
              return `<div class="tipItem">&#128197; ${hh}:${mm} · <strong>${escapeHtml(ev.title)}</strong>${loc}</div>`;
            }).join("")}
          </div>
        ` : ""}
      `;
      grid.appendChild(cell);
    }
  }

  function renderUpcoming(events){
    const root = $("upcomingList");
    if (!root) return;
    root.innerHTML = "";

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const upcoming = (events || [])
      .filter(e => {
        const d = eventDateObj(e);
        return !!d && d >= todayStart;
      })
      .slice()
      .sort((a,b)=> {
        const ad = eventDateObj(a);
        const bd = eventDateObj(b);
        return (ad?.getTime() || 0) - (bd?.getTime() || 0);
      })
      .slice(0, 6);

    if (!upcoming.length){
      root.innerHTML = `<div class="muted">No hay eventos proximos.</div>`;
      return;
    }

    for (const e of upcoming){
      const dt = eventDateObj(e);
      if (!dt) continue;
      const d = ymd(dt);
      const hh = String(dt.getHours()).padStart(2,"0");
      const mm = String(dt.getMinutes()).padStart(2,"0");

      const div = document.createElement("div");
      div.className = "event";
      div.innerHTML = `
        <p class="t">${escapeHtml(e.title || "Evento")}</p>
        <p class="s">
          <span>&#128197; ${escapeHtml(d)}</span>
          <span>&#128338; ${hh}:${mm}</span>
          ${e.location ? `<span>&#128205; ${escapeHtml(e.location)}</span>` : ``}
        </p>
      `;
      root.appendChild(div);
    }
  }

  // ===== Init =====
  let viewDate = new Date();
  let monthEvents = [];

  async function refreshCalendarOnly(){
    // Navegacion instantanea aunque Supabase tarde/falle.
    renderCalendar(viewDate, new Map());
    renderUpcoming([]);

    try{
      monthEvents = await fetchEventsForMonth(viewDate);
      const map = groupEventsByDay(monthEvents);
      renderCalendar(viewDate, map);
      renderUpcoming(monthEvents);
    }catch(e){
      console.warn("calendar:", e.message || e);
      try{
        renderCalendar(viewDate, new Map());
      }catch(_){
        // evitamos romper el init por errores puntuales de render
      }
      renderUpcoming([]);
    }
  }

  async function refreshHome(options = {}){
    const opts = options || {};
    await refreshSession();
    renderFeedbackBar();
    applyMemberHomeState();

    if (!currentAccessState?.isMember){
      return;
    }

    try{
      await refreshPostsSection();
    }catch(e){
      console.warn("refreshPostsSection:", e.message || e);
    }

    if (opts.refreshFeatured !== false){
      try{
        await refreshFeaturedPlayerSection();
      }catch(e){
        console.warn("refreshFeaturedPlayerSection:", e.message || e);
      }
    }

    // Eventos/calendario ocultos por decision de producto.
  }

  $("btnPrev")?.addEventListener("click", async () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth()-1, 1);
    await refreshCalendarOnly();
  });
  $("btnNext")?.addEventListener("click", async () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 1);
    await refreshCalendarOnly();
  });
  $("btnToday")?.addEventListener("click", async () => {
    const d = new Date();
    viewDate = new Date(d.getFullYear(), d.getMonth(), 1);
    await refreshCalendarOnly();
  });

  const labsLauncher = $("labsLauncher");
  const labsMenu = $("labsMenu");

  function setLabsMenuOpen(open){
    if (!labsLauncher || !labsMenu) return;
    $("adminModeDock")?.classList.remove("open");
    $("adminModeToggle")?.setAttribute("aria-expanded", "false");
    labsLauncher.setAttribute("aria-expanded", open ? "true" : "false");
    labsMenu.hidden = !open;
    $("labsDock")?.classList.toggle("open", open);
    labsMenu.classList.toggle("open", open);
  }

  labsLauncher?.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = labsLauncher.getAttribute("aria-expanded") === "true";
    setLabsMenuOpen(!isOpen);
  });

  labsMenu?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    setLabsMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape"){
      setLabsMenuOpen(false);
    }
  });

  (async function(){
    let first = true;
    sb.auth.onAuthStateChange(async (event, session) => {
      window.BarateamApp.clearAccessStateCache(session?.user?.id || null);
      currentUser = session?.user || null;
      window.__barateamCurrentUser = currentUser;
      setNavAuthUI(currentUser);
      renderFeedbackBar();
      applyMemberHomeState();

      if (first) return;           // evita el doble disparo inicial
      if (event === "TOKEN_REFRESHED"){
        return;
      }
      await refreshHome({ refreshFeatured: false });
    });
    await refreshHome({ refreshFeatured: true });
    first = false;
  })();

