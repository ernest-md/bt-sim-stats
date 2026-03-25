
    const sb = window.BarateamApp.createClient();
    const $ = window.BarateamApp.byId;
    const escapeHtml = window.BarateamApp.escapeHtml;
    const escapeAttr = window.BarateamApp.escapeAttr;
    const RANKING_MIN_GAMES = 40;
    const rankingViewTabs = Array.from(document.querySelectorAll("#rankingViewTabs .viewTab"));
    let allRankingRows = [];
    let rankingView = "principal";

    window.BarateamApp.bindProtectedNavLinks(sb);
    const navController = window.BarateamApp.initUserNav({
      onLogout: async () => {
        await sb.auth.signOut();
        location.href = "login.html";
      },
      formatLabel: (user) => (user?.email || "Usuario").split("@")[0] || "Usuario",
      formatEmail: (user) => user?.email || "user"
    });

    function parseMatchWin(result){
      const v = String(result || "").trim().toLowerCase();
      return v === "won" || v === "win" || v === "victoria" || v === "w";
    }

    function wrText(wins, games){
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

    function initRankingInfo(){
      const openBtn = $("eloInfoBtn");
      const heroOpenBtn = $("heroEloInfoBtn");
      const modal = $("eloInfoModal");
      const closeBtn = $("eloInfoClose");
      if (!openBtn || !heroOpenBtn || !modal || !closeBtn) return;

      function openModal(){
        modal.removeAttribute("hidden");
        openBtn.setAttribute("aria-expanded", "true");
      }

      function closeModal(){
        modal.setAttribute("hidden", "");
        openBtn.setAttribute("aria-expanded", "false");
      }

      openBtn.addEventListener("click", openModal);
      heroOpenBtn.addEventListener("click", openModal);
      closeBtn.addEventListener("click", closeModal);
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !modal.hasAttribute("hidden")) closeModal();
      });
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

        function leaderCellHtml(leader, mode){
      if (!leader) return `<div class="leaderCell"><div class="leaderFallback">N/A</div><span class="leaderTxt">Sin datos</span></div>`;
      const name = escapeHtml(leader.name || leader.code || "-");
      const meta = mode === "wr"
        ? `${wrText(leader.wins, leader.games)} en ${leader.games}`
        : `${leader.games} partidas`;
      const src = escapeAttr(leader.parallel_image_url || leader.image_url || "");
      const alt = escapeAttr(leader.name || "leader");
      return `
        <div class="leaderCell">
          <span class="leaderZoom" data-preview-src="${src}">
            <img class="leaderImg" src="${src}" alt="${alt}" />
          </span>
          <span class="leaderTxt">${name} · ${escapeHtml(meta)}</span>
        </div>
      `;
    }

    function initLeaderHoverPreview(){
      const preview = document.createElement("div");
      preview.className = "leaderGlobalPreview";
      preview.innerHTML = `<img alt=""><div class="caption"></div>`;
      document.body.appendChild(preview);

      const img = preview.querySelector("img");
      const cap = preview.querySelector(".caption");
      let activeAnchor = null;

      function place(anchor){
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        const margin = 12;
        const pw = preview.offsetWidth || 196;
        const ph = preview.offsetHeight || 250;
        let x = rect.right + 10;
        let y = rect.top + ((rect.height - ph) / 2);
        if (x + pw > window.innerWidth - margin) x = rect.left - pw - 10;
        if (y < margin) y = margin;
        if (y + ph > window.innerHeight - margin) y = Math.max(margin, window.innerHeight - ph - margin);
        preview.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      }

      function show(anchor){
        const src = anchor?.dataset?.previewSrc || "";
        if (!src){ hide(); return; }
        activeAnchor = anchor;
        img.src = src;
        cap.textContent = "";
        preview.style.opacity = "1";
        place(anchor);
      }

      function hide(){
        activeAnchor = null;
        preview.style.opacity = "0";
        preview.style.transform = "translate3d(-9999px,-9999px,0)";
      }

      document.addEventListener("mouseover", (e) => {
        const anchor = e.target.closest(".leaderZoom[data-preview-src]");
        if (!anchor){
          if (activeAnchor && !preview.contains(e.target)) hide();
          return;
        }
        show(anchor);
      });
      document.addEventListener("mouseout", (e) => {
        const from = e.target.closest(".leaderZoom[data-preview-src]");
        if (!from) return;
        const to = e.relatedTarget;
        if (to && (from.contains(to) || preview.contains(to))) return;
        hide();
      });
      window.addEventListener("scroll", () => { if (activeAnchor) place(activeAnchor); }, true);
      window.addEventListener("resize", () => { if (activeAnchor) place(activeAnchor); });
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

    async function fetchRankingMatches(){
      const pageSize = 1000;
      const maxRows = 20000;
      let from = 0;
      const rows = [];

      while (from < maxRows){
        const to = from + pageSize - 1;
        const { data, error } = await sb
          .rpc("get_global_ranking_matches_v2", {
            p_start_at: null,
            p_end_at: null
          })
          .range(from, to);

        if (error){
          const message = String(error.message || error.details || "");
          if (
            message.toLowerCase().includes("get_global_ranking_matches") ||
            message.toLowerCase().includes("get_global_ranking_matches_v2") ||
            message.toLowerCase().includes("schema cache")
          ){
            throw new Error("Falta desplegar la SQL del ranking global en Supabase.");
          }
          throw error;
        }

        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }

      return rows;
    }

    function filterMatchesByExpansion(matches, expansion){
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

    function rankingPlayerName(row){
      return row?.profile_username ||
        row?.profile_display_name ||
        row?.player_name ||
        `user-${String(row?.player_id || "").slice(0, 8)}`;
    }

    function profileHrefById(userId){
      if (!userId) return "";
      return `user.html?id=${encodeURIComponent(userId)}`;
    }

    function buildRanking(matches){
      const players = new Map();

      for (const row of (matches || [])){
        const playerId = row?.player_id || null;
        if (!playerId) continue;

        if (!players.has(playerId)){
          players.set(playerId, {
            playerId,
            profileId: row?.profile_id || null,
            member: row?.profile_member === true,
            name: rankingPlayerName(row),
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

        const code = String(row?.player_leader || row?.leader_code || "unknown").trim();
        if (!p.leaders.has(code)){
          p.leaders.set(code, {
            code,
            name: row?.leader_name || code || "Leader",
            parallel_image_url: row?.leader_parallel_image_url || "",
            image_url: row?.leader_image_url || "",
            games: 0,
            wins: 0
          });
        }
        const l = p.leaders.get(code);
        l.games += 1;
        if (won) l.wins += 1;
        if (!l.parallel_image_url && row?.leader_parallel_image_url) l.parallel_image_url = row.leader_parallel_image_url;
        if (!l.image_url && row?.leader_image_url) l.image_url = row.leader_image_url;
      }

      const ranking = Array.from(players.values()).map((p) => {
        const wilson = wilsonScore(p.wins, p.games);
        return {
          ...p,
          wr: p.games ? (p.wins / p.games) : 0,
          isRankEligible: p.games >= RANKING_MIN_GAMES,
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

    function applyRankingFilters(){
      if (!allRankingRows.length){
        renderRanking([], rankingView);
        return;
      }
      if (rankingView === "rookies"){
        renderRanking(allRankingRows.filter((row) => !row.isRankEligible), rankingView);
        return;
      }
      const eligible = allRankingRows.filter((row) => row.isRankEligible);
      renderRanking(eligible.length ? eligible : allRankingRows, rankingView);
    }

    function renderRanking(rows, view = "principal"){
      const body = $("rankingBody");
      if (!body) return;
      if (!rows.length){
        const emptyText = view === "rookies"
          ? "No hay rookies para este filtro."
          : "No hay datos para la expansion activa.";
        body.innerHTML = `<tr><td colspan="9" class="muted">${emptyText}</td></tr>`;
        return;
      }
      body.innerHTML = rows.map((r, idx) => `
        <tr class="rankRow rank-${idx + 1}">
          <td class="rankPos">${idx + 1}</td>
          <td class="playerName">${r.profileId ? `<a class="userLink" href="${escapeAttr(profileHrefById(r.profileId))}">${escapeHtml(r.name)}</a>` : escapeHtml(r.name)}</td>
          <td class="statStrong">${r.games}</td>
          <td class="statStrong">${Math.round(r.elo)}</td>
          <td class="statStrong">${wrText(r.wins, r.games)}</td>
          <td>${r.wins}</td>
          <td>${r.losses}</td>
          <td>${leaderCellHtml(r.topLeaderByGames, "games")}</td>
          <td>${leaderCellHtml(r.topLeaderByWr, "wr")}</td>
        </tr>
      `).join("");
    }

    async function initRanking(){
      try{
        const expansion = await fetchCurrentExpansion();
        if (!expansion){
          $("expansionInfo").textContent = "No hay expansion activa para la fecha actual.";
          renderRanking([]);
          return;
        }
        $("expansionInfo").textContent = `Expansion activa: ${expansion.name} (${expansion.start_date} - ${expansion.end_date})`;

        const matches = await fetchRankingMatches();
        const filteredMatches = filterMatchesByExpansion(matches, expansion);
        allRankingRows = buildRanking(filteredMatches);
        applyRankingFilters();
      }catch(e){
        console.warn("ranking:", e.message || e);
        $("expansionInfo").textContent = e?.message || "No se pudo cargar el ranking.";
        allRankingRows = [];
        renderRanking([], rankingView);
      }
    }

    (async function init(){
      initRankingInfo();
      initLeaderHoverPreview();
      rankingViewTabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          const nextView = tab.dataset.view || "principal";
          if (nextView === rankingView) return;
          rankingView = nextView;
          rankingViewTabs.forEach((btn) => btn.classList.toggle("active", btn === tab));
          applyRankingFilters();
        });
      });
      const { data } = await sb.auth.getSession();
      if (!data?.session?.user){
        location.replace("login.html");
        return;
      }
      navController.setUser(data?.session?.user || null);
      void window.BarateamApp.syncTopbarAvatar(sb, data?.session?.user || null);
      sb.auth.onAuthStateChange((_event, session) => {
        if (!session?.user){
          location.replace("login.html");
          return;
        }
        navController.setUser(session?.user || null);
        void window.BarateamApp.syncTopbarAvatar(sb, session?.user || null);
      });
      await initRanking();
    })();
  
