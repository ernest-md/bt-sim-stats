
    const sb = window.BarateamApp.createClient();

    const $ = window.BarateamApp.byId;

    let currentUser = null;
    let deckId = null;
    let currentDeck = null;
    let isDeckOwner = false;
    let profileCache = new Map();
    let socialState = { comments: [], likes: [], likedByMe: false };
    let editLeaders = [];
    let editLeaderByLabel = new Map();

    const escapeHtml = window.BarateamApp.escapeHtml;
    const escapeAttr = window.BarateamApp.escapeAttr;
    const showError = (text) => window.BarateamApp.showMessage("msg", text, { baseClass: "msg" });
    const formatDate = window.BarateamApp.formatDate;
    const formatDateTime = window.BarateamApp.formatDateTime;

    function setImage(el, url){
      if (url){
        el.src = url;
        el.style.display = "block";
      } else {
        el.removeAttribute("src");
        el.style.display = "none";
      }
    }

    function userLabel(userId){
      if (!userId) return "Usuario";
      if (profileCache.has(userId)) return profileCache.get(userId);
      return "usuario";
    }

    function norm(value){
      return String(value || "").trim();
    }

    function leaderLabelFromRow(row){
      const name = norm(row?.name);
      const code = norm(row?.code);
      return [name, code].filter(Boolean).join(" ").trim();
    }

    function leaderImageFromRow(row){
      return norm(row?.parallel_image_url || row?.image_url);
    }

    function resolveLeaderForDeck(leaderLabel){
      const normalized = norm(leaderLabel);
      if (!normalized) return null;
      const lower = normalized.toLowerCase();
      const direct = editLeaderByLabel.get(normalized);
      if (direct) return direct;
      return editLeaders.find((l) => (
        l.searchLabel === lower ||
        l.searchName === lower ||
        l.searchCode === lower ||
        l.searchLabel.startsWith(lower) ||
        lower.startsWith(l.searchName)
      )) || null;
    }

    function deckLeaderImage(deck){
      const byLeader = resolveLeaderForDeck(deck?.leader || "");
      const fromLeaders = norm(byLeader?.image || "");
      if (fromLeaders) return fromLeaders;
      return norm(deck?.leader_image_url);
    }

    function normalizeCardCode(value){
      const raw = String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
        .replace(/\s+/g, "");
      if (!raw) return "";

      const normalized = raw.replace(/_/g, "-");
      const promoMatch = normalized.match(/^P-?0*(\d{1,3})$/);
      if (promoMatch){
        return `P-${promoMatch[1].padStart(3, "0")}`;
      }

      return normalized;
    }

    function buildDotggCardImageUrl(value){
      const code = normalizeCardCode(value);
      if (!code) return "";
      return `https://static.dotgg.gg/onepiece/card/${encodeURIComponent(code)}.webp`;
    }

    function parseSimPasteItems(text){
      return String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^(\d+)\s*x\s*(.+)$/i);
          if (!match) return null;
          const qty = Number(match[1] || 0);
          const code = normalizeCardCode(match[2]);
          if (!qty || !code) return null;
          return { qty, code };
        })
        .filter(Boolean);
    }

    function renderSimPasteCard(item){
      const label = item?.code || "Carta";
      const badgeText = `${item?.qty || 0}x`;
      const src = buildDotggCardImageUrl(label);
      if (!src){
        return `<div class="simCard" title="${escapeAttr(label)}"><div class="simCardFallback">${escapeHtml(label)}</div><div class="simCardBadge">${escapeHtml(badgeText)}</div></div>`;
      }
      return `<div class="simCard cardZoom" title="${escapeAttr(label)}" data-preview-src="${escapeAttr(src)}" data-preview-label="${escapeAttr(label)}"><img src="${escapeAttr(src)}" alt="${escapeAttr(label)}" loading="lazy" data-sim-card-label="${escapeAttr(label)}"><div class="simCardBadge">${escapeHtml(badgeText)}</div></div>`;
    }

    function renderSimPasteVisual(text){
      const host = $("simPasteVisual");
      if (!host) return;

      const rawText = String(text || "");
      const trimmed = rawText.trim();
      if (!trimmed || trimmed === "-"){
        host.innerHTML = '<div class="muted">-</div>';
        return;
      }

      const items = parseSimPasteItems(rawText);
      if (!items.length){
        host.innerHTML = `<pre class="simPasteInlineText">${escapeHtml(trimmed)}</pre>`;
        return;
      }

      host.innerHTML = items.map((item) => renderSimPasteCard(item)).join("");
    }

    function handleSimPasteImageError(event){
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      const card = target.closest(".simCard");
      const host = target.closest("#simPasteVisual");
      if (!card || !host) return;
      if (card.querySelector(".simCardFallback")) return;

      const fallback = document.createElement("div");
      fallback.className = "simCardFallback";
      fallback.textContent = target.dataset.simCardLabel || target.alt || "Carta";
      card.classList.remove("cardZoom");
      delete card.dataset.previewSrc;
      delete card.dataset.previewLabel;
      target.remove();
      card.prepend(fallback);
    }

    function initCardHoverPreview(){
      const preview = document.createElement("div");
      preview.className = "cardPreview";
      preview.innerHTML = `<img alt="">`;
      document.body.appendChild(preview);

      const img = preview.querySelector("img");
      let activeAnchor = null;

      function place(anchor){
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        const margin = 12;
        const pw = preview.offsetWidth || 236;
        const ph = preview.offsetHeight || 336;
        let x = rect.right + 12;
        let y = rect.top + ((rect.height - ph) / 2);
        if (x + pw > window.innerWidth - margin) x = rect.left - pw - 12;
        if (y < margin) y = margin;
        if (y + ph > window.innerHeight - margin) y = Math.max(margin, window.innerHeight - ph - margin);
        preview.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      }

      function show(anchor){
        const src = anchor?.dataset?.previewSrc || "";
        if (!src){ hide(); return; }
        activeAnchor = anchor;
        img.src = src;
        img.alt = anchor?.dataset?.previewLabel || "Carta";
        preview.style.opacity = "1";
        place(anchor);
      }

      function hide(){
        activeAnchor = null;
        preview.style.opacity = "0";
        preview.style.transform = "translate3d(-9999px,-9999px,0)";
      }

      document.addEventListener("mouseover", (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const anchor = target ? target.closest(".cardZoom[data-preview-src]") : null;
        if (!anchor){
          if (activeAnchor && target && !preview.contains(target)) hide();
          return;
        }
        show(anchor);
      });

      document.addEventListener("mouseout", (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const from = target ? target.closest(".cardZoom[data-preview-src]") : null;
        if (!from) return;
        const to = e.relatedTarget;
        if (to instanceof Node && (from.contains(to) || preview.contains(to))) return;
        hide();
      });

      window.addEventListener("scroll", () => { if (activeAnchor) place(activeAnchor); }, true);
      window.addEventListener("resize", () => { if (activeAnchor) place(activeAnchor); });
    }

    function fillEditLeaderSelect(){
      const sel = $("editLeader");
      sel.innerHTML = '<option value="">(Selecciona lider)</option>';
      for (const l of editLeaders){
        const opt = document.createElement("option");
        opt.value = l.label;
        opt.textContent = l.label;
        sel.appendChild(opt);
      }
    }

    function ensureEditLeaderOption(label){
      const normalized = norm(label);
      if (!normalized) return;
      if (editLeaderByLabel.has(normalized)) return;
      const sel = $("editLeader");
      const opt = document.createElement("option");
      opt.value = normalized;
      opt.textContent = normalized;
      sel.appendChild(opt);
    }

    async function initEditLeaders(){
      const { data, error } = await sb
        .from("leaders")
        .select("*")
        .order("name", { ascending: true })
        .limit(500);

      if (error){
        console.warn("leaders:", error.message);
        editLeaders = [];
        editLeaderByLabel = new Map();
        fillEditLeaderSelect();
        return;
      }

      const mapped = (data || [])
        .map((row) => {
          const label = leaderLabelFromRow(row);
          if (!label) return null;
          const name = norm(row?.name);
          const code = norm(row?.code);
          return {
            label,
            image: leaderImageFromRow(row) || null,
            name,
            code,
            searchLabel: label.toLowerCase(),
            searchName: name.toLowerCase(),
            searchCode: code.toLowerCase()
          };
        })
        .filter(Boolean);

      const uniq = new Map();
      for (const l of mapped){
        if (!uniq.has(l.label)) uniq.set(l.label, l);
      }

      editLeaders = Array.from(uniq.values());
      editLeaderByLabel = new Map(editLeaders.map((l) => [l.label, l]));
      fillEditLeaderSelect();
    }

    async function uploadDeckImage(file, userId){
      if (!file) return null;

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";
      const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExt}`;
      const path = `${userId}/${fileName}`;

      const { error: upErr } = await sb
        .storage
        .from("deck-images")
        .upload(path, file, { upsert: false, contentType: file.type });

      if (upErr) throw upErr;
      const { data } = sb.storage.from("deck-images").getPublicUrl(path);
      return data?.publicUrl || null;
    }

    function profileHref(userId){
      if (!userId) return "";
      return `user.html?id=${encodeURIComponent(userId)}`;
    }

    function profileLink(userId, label){
      const safeLabel = label || "Usuario";
      if (!userId) return escapeHtml(safeLabel);
      return `<a class="userLink" href="${escapeAttr(profileHref(userId))}">${escapeHtml(safeLabel)}</a>`;
    }

    async function fillProfiles(userIds){
      const ids = Array.from(new Set((userIds || []).filter(Boolean)));
      const missing = ids.filter(id => !profileCache.has(id));
      if (!missing.length) return;

      const { data, error } = await sb
        .from("profiles")
        .select("id,username")
        .in("id", missing);

      if (error){
        console.warn("profiles:", error.message);
        for (const id of missing){
          if (!profileCache.has(id)) profileCache.set(id, "usuario");
        }
        return;
      }

      for (const row of (data || [])){
        const label = row.username || row.id?.slice(0, 8) || "usuario";
        profileCache.set(row.id, label);
      }
      for (const id of missing){
        if (!profileCache.has(id)) profileCache.set(id, "usuario");
      }
    }

    async function refreshSession(){
      const { data } = await sb.auth.getSession();
      currentUser = data?.session?.user || null;
    }

    function renderDeck(deck){
      $("deckName").textContent = deck.name || "Deck";
      const authorLabel = userLabel(deck.autor);
      $("deckAuthor").innerHTML = `Autor: ${profileLink(deck.autor, authorLabel)}`;
      $("deckCreated").textContent = `Creado: ${formatDate(deck.created_at)}`;

      const resolvedLeaderImage = deckLeaderImage(deck);
      $("leaderName").textContent = deck.leader || "-";
      setImage($("leaderImage"), resolvedLeaderImage || "");
      const leaderPanel = $("leaderPanel");
      if (leaderPanel){
        const bg = resolvedLeaderImage
          ? `url("${String(resolvedLeaderImage).replace(/"/g, '\\"')}")`
          : "none";
        leaderPanel.style.setProperty("--leader-bg-image", bg);
      }

      const deckImage = deck.image_url || "";
      if (deckImage){
        setImage($("deckImage"), deckImage);
        $("deckImageEmpty").style.display = "none";
      } else {
        $("deckImage").style.display = "none";
        $("deckImageEmpty").style.display = "block";
      }

      $("description").textContent = deck.description || "-";
      const simPasteText = deck.sim_paste || "-";
      $("simPaste").textContent = simPasteText;
      renderSimPasteVisual(simPasteText);
    }

    function computeDeckOwner(){
      isDeckOwner = !!(currentUser && currentDeck && currentDeck.autor === currentUser.id);
    }

    function renderDeckOwnerUI(){
      const btn = $("btnEditDeck");
      if (!btn) return;
      btn.style.display = isDeckOwner ? "inline-flex" : "none";
      if (!isDeckOwner){
        $("editPanel").classList.remove("open");
      }
    }

    function fillEditForm(deck){
      $("editName").value = deck?.name || "";
      ensureEditLeaderOption(deck?.leader || "");
      $("editLeader").value = deck?.leader || "";
      $("editImageUrl").value = deck?.image_url || "";
      $("editImageFile").value = "";
      $("editDescription").value = deck?.description || "";
      $("editSimPaste").value = deck?.sim_paste || "";
    }

    function openEditPanel(){
      if (!isDeckOwner || !currentDeck) return;
      fillEditForm(currentDeck);
      $("editPanel").classList.add("open");
    }

    function closeEditPanel(){
      $("editPanel").classList.remove("open");
    }

    async function saveDeckEdits(){
      if (!isDeckOwner || !currentDeck || !deckId){
        showError("No tienes permisos para editar este deck.");
        return;
      }

      try{
        const selectedLeader = norm($("editLeader").value);
        const leaderData = editLeaderByLabel.get(selectedLeader) || null;
        let nextImageUrl = norm($("editImageUrl").value) || null;
        const editFile = $("editImageFile").files?.[0] || null;
        if (editFile){
          nextImageUrl = await uploadDeckImage(editFile, currentUser.id);
        }

        const payload = {
          name: $("editName").value.trim() || null,
          leader: selectedLeader || null,
          leader_image_url: leaderData?.image || null,
          image_url: nextImageUrl,
          description: $("editDescription").value.trim() || null,
          sim_paste: $("editSimPaste").value.trim() || null
        };

        const { data, error } = await sb
          .from("decks")
          .update(payload)
          .eq("id", deckId)
          .eq("autor", currentUser.id)
          .select("id, name, created_at, autor, leader, leader_image_url, image_url, description, sim_paste")
          .maybeSingle();

        if (error){
          showError("No pude guardar los cambios: " + error.message);
          return;
        }
        if (!data){
          showError("No se pudo actualizar el deck (permisos o registro).");
          return;
        }

        currentDeck = data;
        renderDeck(currentDeck);
        closeEditPanel();
        window.BarateamApp.showMessage("msg", "Deck actualizado", { baseClass: "msg", type: "ok" });
      }catch(e){
        showError("No pude guardar los cambios: " + (e.message || "unknown"));
      }
    }
    async function deleteDeck(){
      if (!isDeckOwner || !currentDeck || !deckId || !currentUser){
        showError("No tienes permisos para eliminar este deck.");
        return;
      }

      const ok = window.confirm("¿Seguro que quieres eliminar este deck? Esta accion no se puede deshacer.");
      if (!ok) return;

      try{
        const { error } = await sb
          .from("decks")
          .delete()
          .eq("id", deckId)
          .eq("autor", currentUser.id);

        if (error){
          showError("No pude eliminar el deck: " + error.message);
          return;
        }

        window.location.href = "decks.html";
      }catch(e){
        showError("No pude eliminar el deck: " + (e.message || "unknown"));
      }
    }
async function loadDeck(){
      const params = new URLSearchParams(window.location.search);
      deckId = params.get("id");

      if (!deckId){
        showError("Falta el id del deck en la URL.");
        return false;
      }

      try{
        const { data, error } = await sb
          .from("decks")
          .select("id, name, created_at, autor, leader, leader_image_url, image_url, description, sim_paste")
          .eq("id", deckId)
          .maybeSingle();

        if (error) throw error;
        if (!data){
          showError("No se encontro el deck solicitado.");
          return false;
        }

        await fillProfiles([data.autor]);
        currentDeck = data;
        renderDeck(currentDeck);
        computeDeckOwner();
        renderDeckOwnerUI();
        return true;
      }catch(e){
        console.error(e);
        showError("Error cargando deck: " + (e.message || "unknown"));
        return false;
      }
    }

    async function loadDeckSocial(){
      if (!deckId) return;

      const [commentsRes, likesRes] = await Promise.all([
        sb.from("comments")
          .select("id,created_at,autor,body,deck,parent_comment")
          .eq("deck", deckId)
          .order("created_at", { ascending: false }),
        sb.from("likes")
          .select("id,created_at,autor,deck")
          .eq("deck", deckId)
      ]);

      if (commentsRes.error) console.warn("comments:", commentsRes.error.message);
      if (likesRes.error) console.warn("likes:", likesRes.error.message);

      const comments = commentsRes.data || [];
      const likes = likesRes.data || [];

      await fillProfiles([
        ...comments.map(c => c.autor),
        ...likes.map(l => l.autor)
      ]);

      socialState = {
        comments,
        likes,
        likedByMe: !!(currentUser && likes.some(l => l.autor === currentUser.id))
      };

      renderSocial();
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

    function renderRepliesHtml(replies){
      return replies.map(reply => `
        <div class="commentItem replyItem">
          <div class="commentHead">
            <span class="commentUser">${profileLink(reply.autor, userLabel(reply.autor))}</span>
            <span>${escapeHtml(formatDateTime(reply.created_at))}</span>
          </div>
          <p class="commentBody">${escapeHtml(reply.body || "")}</p>
        </div>
      `).join("");
    }

    function renderCommentThreadHtml(comment, replies){
      const replyCount = replies.length;
      const replyToggleHtml = replyCount
        ? `<button class="commentActionBtn btnToggleReplies" data-parent-id="${escapeAttr(comment.id)}" type="button">Respuestas (${replyCount})</button>`
        : "";
      const replyComposerHtml = currentUser
        ? `
          <div class="replyComposer" data-parent-id="${escapeAttr(comment.id)}">
            <textarea class="replyInput" data-parent-id="${escapeAttr(comment.id)}" placeholder="Escribe una respuesta..."></textarea>
            <div>
              <button class="iconBtn btnSendReply" data-parent-id="${escapeAttr(comment.id)}" type="button">Responder</button>
              <button class="iconBtn btnCancelReply" data-parent-id="${escapeAttr(comment.id)}" type="button">Cancelar</button>
            </div>
          </div>
        `
        : "";

      return `
        <div class="commentThread">
          <div class="commentItem">
            <div class="commentHead">
              <span class="commentUser">${profileLink(comment.autor, userLabel(comment.autor))}</span>
              <span>${escapeHtml(formatDateTime(comment.created_at))}</span>
            </div>
            <p class="commentBody">${escapeHtml(comment.body || "")}</p>
            <div class="commentActions">
              ${replyToggleHtml}
              ${currentUser ? `<button class="commentActionBtn btnReplyComment" data-parent-id="${escapeAttr(comment.id)}" type="button">Responder</button>` : ""}
            </div>
            ${replyComposerHtml}
          </div>
          ${replyCount ? `<div class="commentReplies" data-parent-id="${escapeAttr(comment.id)}">${renderRepliesHtml(replies)}</div>` : ""}
        </div>
      `;
    }

    function renderSocial(){
      const likes = socialState.likes || [];
      const comments = socialState.comments || [];
      const threads = buildCommentThreads(comments);

      const likeBtn = $("btnLike");
      likeBtn.innerHTML = `&#128077; ${likes.length}`;
      likeBtn.classList.toggle("active", !!socialState.likedByMe);

      const likeUsersHover = $("likeUsersHover");
      likeUsersHover.innerHTML = likes.length
        ? likes.map(l => `<div class="u">${profileLink(l.autor, userLabel(l.autor))}</div>`).join("")
        : `<div class="u">Sin likes todavia.</div>`;

      $("btnToggleComments").textContent = `Comentarios (${comments.length})`;

      const composer = $("commentComposer");
      if (currentUser){
        composer.innerHTML = `
          <textarea id="commentInput" placeholder="Escribe un comentario..."></textarea>
          <div><button class="iconBtn" id="btnSendComment" type="button">Comentar</button></div>
        `;
        $("btnSendComment").addEventListener("click", () => submitDeckComment());
      } else {
        composer.innerHTML = `<div class="muted">Inicia sesion para comentar.</div>`;
      }

      const list = $("commentsList");
      if (!threads.roots.length){
        list.innerHTML = `<div class="muted">No hay comentarios.</div>`;
      } else {
        list.innerHTML = threads.roots.map(c => renderCommentThreadHtml(c, threads.repliesByParent.get(String(c.id)) || [])).join("");
      }

      for (const btn of list.querySelectorAll(".btnToggleReplies")){
        btn.addEventListener("click", () => {
          const parentId = btn.getAttribute("data-parent-id");
          const panel = list.querySelector(`.commentReplies[data-parent-id="${parentId}"]`);
          if (!panel) return;
          const open = panel.classList.toggle("open");
          const count = panel.children.length;
          btn.textContent = `${open ? "Ocultar respuestas" : "Respuestas"} (${count})`;
        });
      }

      for (const btn of list.querySelectorAll(".btnReplyComment")){
        btn.addEventListener("click", () => {
          const parentId = btn.getAttribute("data-parent-id");
          const composer = list.querySelector(`.replyComposer[data-parent-id="${parentId}"]`);
          if (!composer) return;
          composer.classList.toggle("open");
          if (composer.classList.contains("open")){
            composer.querySelector(".replyInput")?.focus();
          }
        });
      }

      for (const btn of list.querySelectorAll(".btnCancelReply")){
        btn.addEventListener("click", () => {
          const parentId = btn.getAttribute("data-parent-id");
          const composer = list.querySelector(`.replyComposer[data-parent-id="${parentId}"]`);
          const input = list.querySelector(`.replyInput[data-parent-id="${parentId}"]`);
          if (input) input.value = "";
          composer?.classList.remove("open");
        });
      }

      for (const btn of list.querySelectorAll(".btnSendReply")){
        btn.addEventListener("click", async () => {
          const parentId = btn.getAttribute("data-parent-id");
          await submitDeckComment(parentId);
        });
      }
    }

    async function toggleDeckLike(){
      if (!currentUser){
        showError("Inicia sesion para dar like.");
        return;
      }
      if (!deckId) return;

      const { data: existing, error: exErr } = await sb
        .from("likes")
        .select("id")
        .eq("deck", deckId)
        .eq("autor", currentUser.id)
        .limit(1);

      if (exErr){
        showError("Error en likes: " + exErr.message);
        return;
      }

      if (existing && existing.length){
        const { error } = await sb
          .from("likes")
          .delete()
          .eq("deck", deckId)
          .eq("autor", currentUser.id);
        if (error) return showError("No pude quitar el like: " + error.message);
      } else {
        const { error } = await sb.from("likes").insert({ autor: currentUser.id, deck: deckId });
        if (error) return showError("No pude dar like: " + error.message);
      }

      await loadDeckSocial();
    }

    async function submitDeckComment(parentCommentId = null){
      if (!currentUser){
        showError("Inicia sesion para comentar.");
        return;
      }
      if (!deckId) return;

      const input = parentCommentId
        ? document.querySelector(`.replyInput[data-parent-id="${parentCommentId}"]`)
        : $("commentInput");
      const body = input?.value?.trim() || "";
      if (!body) return showError("Escribe un comentario.");

      const { error } = await sb.from("comments").insert({
        autor: currentUser.id,
        deck: deckId,
        body,
        parent_comment: parentCommentId || null
      });

      if (error) return showError("No pude guardar el comentario: " + error.message);

      input.value = "";
      await loadDeckSocial();
    }

    async function copyDeckLink(){
      const button = $("btnCopyDeckLink");
      try{
        await navigator.clipboard.writeText(window.location.href);
        if (button){
          button.innerHTML = copyIconSvg("check");
          button.classList.add("isCopied");
          button.setAttribute("aria-label", "Enlace copiado");
          button.setAttribute("title", "Enlace copiado");
          window.setTimeout(() => {
            button.innerHTML = copyIconSvg("share");
            button.classList.remove("isCopied");
            button.setAttribute("aria-label", "Copiar enlace para compartir");
            button.setAttribute("title", "Copiar enlace para compartir");
          }, 1400);
        }
      }catch(_e){
        showError("No pude copiar el enlace.");
      }
    }

    function copyIconSvg(state = "copy"){
      if (state === "check"){
        return `
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 10.5l4 4 8-9"></path>
          </svg>
        `;
      }
      if (state === "share"){
        return `
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 4h4v4"></path>
            <path d="M8 12 16 4"></path>
            <rect x="4" y="8" width="8" height="8" rx="2"></rect>
          </svg>
        `;
      }
      return `
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="7" y="3.5" width="9" height="11" rx="2"></rect>
          <path d="M5 7.5H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1"></path>
        </svg>
      `;
    }

    async function copySimPaste(){
      const text = String($("simPaste")?.textContent || "").trim();
      if (!text || text === "-"){
        showError("No hay lista para copiar.");
        return;
      }
      const button = $("btnCopySimPaste");
      try{
        await navigator.clipboard.writeText(text);
        if (button){
          button.innerHTML = copyIconSvg("check");
          button.classList.add("isCopied");
          button.setAttribute("aria-label", "Lista copiada");
          button.setAttribute("title", "Lista copiada");
          window.setTimeout(() => {
            button.innerHTML = copyIconSvg("copy");
            button.classList.remove("isCopied");
            button.setAttribute("aria-label", "Copiar lista");
            button.setAttribute("title", "Copiar lista");
          }, 1400);
        }
      }catch(_e){
        showError("No pude copiar la lista.");
      }
    }

    $("btnLike").addEventListener("click", toggleDeckLike);
    $("btnToggleComments").addEventListener("click", () => {
      $("commentsPanel").classList.toggle("open");
    });
    $("btnEditDeck").addEventListener("click", openEditPanel);
    $("btnCopyDeckLink").addEventListener("click", copyDeckLink);
    $("btnCopySimPaste").addEventListener("click", copySimPaste);
    $("btnCancelEditDeck").addEventListener("click", closeEditPanel);
    $("btnSaveEditDeck").addEventListener("click", saveDeckEdits);
    $("btnDeleteDeck").addEventListener("click", deleteDeck);
    document.addEventListener("error", handleSimPasteImageError, true);
    initCardHoverPreview();

    (async function init(){
      await refreshSession();
      await initEditLeaders();
      const ok = await loadDeck();
      if (!ok) return;
      await loadDeckSocial();

      sb.auth.onAuthStateChange(async (_event, session) => {
        currentUser = session?.user || null;
        computeDeckOwner();
        renderDeckOwnerUI();
        await loadDeckSocial();
      });
    })();
  
