// 第一回 ボカロP聞き耳模擬試験 公式解答サイト（受験者側）
// 正解データはこのファイルに含まれません。採点はサーバー側（Supabase RPC）でのみ行われます。
// 接続できない場合は登録・保存を停止します。
"use strict";
const CFG = window.EXAM_CONFIG;

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomSecret() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = new Uint8Array(20);
  crypto.getRandomValues(a);
  return Array.from(a).map((n) => chars[n % chars.length]).join("");
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const byName = (a, b) => a.name.localeCompare(b.name, "ja");

// ---------------- 設定・公開データ
let SETTINGS = {
  title: CFG.EXAM_TITLE, start_at: CFG.START_AT, deadline_at: CFG.DEADLINE_AT,
  reveal_at: CFG.REVEAL_AT, video_first_url: CFG.VIDEO_FIRST_URL,
  video_second_url: CFG.VIDEO_SECOND_URL,
};
let PARTICIPANTS = window.EXAM_DATA.participants.slice();
let QUESTIONS = window.EXAM_DATA.questions.slice();
const partOf = (qno) => (qno <= 12 ? "first" : "second");
const participantsOf = (part) => PARTICIPANTS.filter((p) => p.part === part).slice().sort(byName);
const participantById = (id) => PARTICIPANTS.find((p) => p.id === id);
const questionByNo = (qno) => QUESTIONS.find((q) => q.qno === qno) || { qno, title: "", start_sec: null };

async function sbFetch(path, opts = {}) {
  window.ExamAPI.checkConfig();
  const r = await fetch(CFG.SUPABASE_URL + path, {
    ...opts,
    headers: {
      apikey: CFG.SUPABASE_ANON_KEY,

      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* noop */ }
  if (!r.ok) throw new Error((data && data.message) || ("HTTP " + r.status));
  return data;
}

async function loadPublicData() {

  try {
    const [s, ps, qs] = await Promise.all([
      sbFetch("/rest/v1/exam_settings?select=*&id=eq.1"),
      sbFetch("/rest/v1/participants?select=*"),
      sbFetch('/rest/v1/rpc/get_public_questions',{method:'POST',body:'{}'}),
    ]);
    if (s && s[0]) {
      CFG.TURNSTILE_SITE_KEY=s[0].turnstile_site_key || CFG.TURNSTILE_SITE_KEY;
      SETTINGS = { title: s[0].exam_title, start_at: s[0].start_at,
        deadline_at: s[0].deadline_at, reveal_at: s[0].reveal_at,
        video_first_url: s[0].video_first_url, video_second_url: s[0].video_second_url };
    }
    if (ps && ps.length) {
      PARTICIPANTS = ps.map((p) => ({ id: p.id, name: p.name, part: p.part,
        x: p.x_id, niconico: p.niconico_url, other: p.other_url }));
    }
    if (qs && qs.length) {
      QUESTIONS = qs.map((q) => ({ qno: q.qno, part: q.part, title: q.title, start_sec: q.start_sec }));
    }
  } catch (e) { throw new Error("サーバーに接続できません。時間をおいて再読み込みしてください。"); }
}

// Participant operations go through the server gateway (CAPTCHA and rate limits).
const rpc = (fn, args) => window.ExamAPI.call(fn,args);
const Backend = {
  register: ({resumeHash,nameType,handle,ranking,orders}) => rpc('register_examinee',{
    p_resume_hash:resumeHash,p_name_type:nameType,p_handle:handle,p_ranking:ranking,p_orders:orders}),
  resume: (code,hash) => rpc('resume_examinee',{p_code:code,p_resume_hash:hash}),
  submit: ({code,resumeHash,answers,survey,ranking,orders}) => rpc('save_submission',{
    p_code:code,p_resume_hash:resumeHash,p_answers:answers,p_survey:survey,p_ranking:ranking,
    p_orders:orders,p_revision:state.revision || 0}),
  myResults: (code,hash) => rpc('get_my_results',{p_code:code,p_resume_hash:hash}),
  publicResults: () => sbFetch('/rest/v1/rpc/get_public_results',{method:'POST',body:'{}'})
};
// ---------------- 受験者ステート（この端末の下書き）
const SKEY = "kikimimi_state_v2";
let state = { code: null, secret: null, nameType: null, handle: "", ranking: false,
  orders: {}, answers: {}, survey: {}, submitted: false, updatedAt: null,
  currentPart: "first", currentQ: 1 };
try { Object.assign(state, JSON.parse(localStorage.getItem(SKEY)) || {}); } catch (e) { /* noop */ }
function saveState() {
  try { localStorage.setItem(SKEY, JSON.stringify(state)); }
  catch { const note=$('#draft-note'); if(note) note.textContent='端末への保存ができません。受験番号と再開コードを控え、サーバー保存を確認してください。'; }
}

function ensureOrders() {
  // 受験者×問題ごとの選択肢順（未作成の問題だけ生成し、以降は維持する）
  let changed = false;
  for (let q = 1; q <= 23; q++) {
    if (!state.orders[q]) {
      state.orders[q] = shuffle(participantsOf(partOf(q)).map((p) => p.id));
      changed = true;
    }
  }
  if (changed) saveState();
}
function answerOf(qno) {
  return state.answers[qno] || { author: "", confidence: "", reasons: [], comment: "" };
}
function answeredCount() {
  return Object.values(state.answers).filter((a) => a && a.author).length;
}

// ---------------- 画面遷移
const VIEWS = ["top", "register", "resume", "exam", "confirm", "directory", "results"];
function nav(view) {
  VIEWS.forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== view));
  if (view === 'register') window.ExamAPI.mountCaptcha();
  if (view === "exam") renderExam();
  if (view === "confirm") renderConfirm();
  if (view === "directory") renderDirectory(currentDirFilter);
  if (view === "results") renderResults();
  window.scrollTo({ top: 0 });
}

// ---------------- カウントダウン
function tickCountdown() {
  const now = new Date();
  const start = new Date(SETTINGS.start_at), dl = new Date(SETTINGS.deadline_at);
  let target, label;
  if (now < start) { target = start; label = "試験開始まで"; }
  else if (now <= dl) { target = dl; label = "解答締切まで"; }
  else { $("#countdown").textContent = "試験は終了しました"; $("#countdown-label").textContent = "答え合わせをお待ちください。"; return; }
  const ms = target - now;
  const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24,
        m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  $("#countdown").textContent = `${d}日 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  $("#countdown-label").textContent = label;
}

// ---------------- 登録
async function doRegister() {
  if($('#btn-register').disabled) return;
  if(state.code) { nav('exam'); return; }
  if (registerBusy || state.code) return; registerBusy=true; $("#btn-register").disabled=true;
  try { await registerInner(); } finally { registerBusy=false; $("#btn-register").disabled=!!state.code; }
}
let registerBusy=false;
async function registerInner() {
  const type = document.querySelector('input[name="reg-type"]:checked').value;
  const handle = $("#reg-handle").value.trim();
  const ranking = document.querySelector('input[name="reg-ranking"]:checked').value === "yes";
  const err = $("#register-error");
  err.innerHTML = "";
  if (type === "handle" && !handle) {
    err.innerHTML = '<p class="error">ハンドルネームを入力してください（匿名参加も選べます）。</p>'; return;
  }
  const secret = state.pendingSecret || randomSecret();
  state.pendingSecret=secret; saveState();
  $('#btn-register').disabled=true;
  const resumeHash = await sha256(secret);
  ensureOrders();
  try {
    const res = await Backend.register({ resumeHash, nameType: type, handle, ranking, orders: state.orders });
    delete state.pendingSecret; state.code = res.code; state.secret = secret; state.nameType = type;
    state.handle = handle; state.ranking = ranking; state.submitted = false; state.revision = res.revision || 0; state.answers = {}; state.survey = {};
    saveState();
    $("#issued-code").textContent = res.code;
    $("#issued-secret").textContent = secret;
    $("#issued-card").classList.remove("hidden");
    $("#issued-card").scrollIntoView({ behavior: "smooth" });
    updateMyStatus();
  } catch (e) {
    err.innerHTML = '<p class="error">登録に失敗しました：' + esc(e.message) + "</p>";
  } finally { $('#btn-register').disabled=false; }
}

// ---------------- 再開
async function doResume(code, secret) {
  const resumeHash = await sha256(secret);
  const data = await Backend.resume(code, resumeHash);
  state.code = data.code; state.secret = secret; state.nameType = data.name_type;
  state.handle = data.handle_name || ""; state.ranking = !!data.ranking_opt_in;
  state.orders = data.choice_orders || {}; state.answers = data.answers || {};
  state.survey = data.survey || {}; state.submitted = !!data.submitted;
  state.conflict=false; state.hasUnsubmittedChanges=!!data.has_draft; state.revision = data.revision || 0; state.updatedAt = data.updated_at || null; state.dirty = false;
  ensureOrders(); saveState(); updateMyStatus();
  return data;
}

// ---------------- 解答画面
let currentDirFilter = "all";
function nicoEmbed(url, startSec) {
  if (!url) return null;
  const m = url.match(/^https:\/\/www\.nicovideo\.jp\/watch\/(sm|nm|so)(\d+)$/);
  if (!m) return null;
  const id = (m[1] || "sm") + m[2];
  return "https://embed.nicovideo.jp/watch/" + id + (startSec ? "?from=" + startSec : "");
}
function renderExam() {
  const part = state.currentPart;
  $("#tab-first").classList.toggle("on", part === "first");
  $("#tab-second").classList.toggle("on", part === "second");
  const url = part === "first" ? SETTINGS.video_first_url : SETTINGS.video_second_url;
  const embed = nicoEmbed(url,questionByNo(state.currentQ).start_sec);
  const videoBox=$("#video-box");
  if(videoBox.dataset.source!==String(embed)) {
    videoBox.dataset.source=String(embed);
    videoBox.innerHTML=embed
      ? `<iframe title="${part==='first'?'前編':'後編'}の出題動画" src="${esc(embed)}" allowfullscreen allow="autoplay; fullscreen"></iframe>`
      : '<div class="video-ph">動画URLは準備中です<br>（公開後にここへ埋め込みプレイヤーが表示されます）</div>';
  }
  $("#video-note").textContent = url ? "" : "動画URLと曲名は公開準備中です。";
  // 問題チップ
  const range = part === "first" ? [1, 12] : [13, 23];
  $("#qchips").innerHTML = "";
  for (let q = range[0]; q <= range[1]; q++) {
    const b = document.createElement("button");
    b.className = "chip" + (answerOf(q).author ? " answered" : "") + (q === state.currentQ ? " current" : "");
    b.innerHTML = '<span>第'+q+'問</span><small>♪ '+esc(questionByNo(q).title || '公開前')+'</small>'; b.title = "第" + q + "問 ♪ " + (questionByNo(q).title || "公開前"); b.setAttribute("aria-label", b.title);
    b.addEventListener("click", () => { state.currentQ = q; saveState(); renderExam(); });
    $("#qchips").appendChild(b);
  }
  const n = answeredCount();
  $("#progress-text").textContent = `${n} / 23`;
  $("#progress-bar").style.width = (n / 23 * 100) + "%";
  renderQuestion();
}
function renderQuestion() {
  const q = state.currentQ;
  const a = answerOf(q);
  $("#q-no").textContent = q;
  const title = questionByNo(q).title;
  $("#q-title").textContent = title ? "♪ " + title : "♪ （曲名は準備中）";
  // 作者候補（この受験者・この問題専用の並び順）
  const box = $("#q-choices");
  box.innerHTML = "";
  const ids = state.orders[q] || participantsOf(partOf(q)).map((p) => p.id);
  ids.forEach((id) => {
    const p = participantById(id);
    if (!p) return;
    const lb = document.createElement("label");
    lb.className = "opt" + (a.author === id ? " sel" : "");
    const radio = document.createElement("input");
    radio.type = "radio"; radio.name = "author"; radio.value = id;
    radio.checked = a.author === id;
    radio.addEventListener("change", () => { setAnswer(q, { author: id }); renderExam(); });
    const span = document.createElement("span");
    span.textContent = p.name;
    lb.append(radio, span);
    box.appendChild(lb);
  });
  const clear = document.createElement("button");
  clear.className = "btn sub"; clear.textContent = "この問題の選択を解除（未解答にする）";
  clear.addEventListener("click", () => { setAnswer(q, { author: "" }); renderExam(); });
  box.appendChild(clear);
  // 自信度
  const conf = $("#q-confidence");
  conf.innerHTML = "";
  window.EXAM_DATA.confidences.forEach((c) => {
    const lb = document.createElement("label");
    lb.className = "opt" + (a.confidence === c ? " sel" : "");
    const radio = document.createElement("input");
    radio.type = "radio"; radio.name = "confidence"; radio.checked = a.confidence === c;
    radio.addEventListener("change", () => { setAnswer(q, { confidence: c }); renderQuestion(); });
    const span = document.createElement("span"); span.textContent = c;
    lb.append(radio, span); conf.appendChild(lb);
  });
  // 推理の決め手
  const rs = $("#q-reasons");
  rs.innerHTML = "";
  window.EXAM_DATA.reasons.forEach((r) => {
    const lb = document.createElement("label");
    lb.className = "opt" + (a.reasons.includes(r) ? " sel" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = a.reasons.includes(r);
    cb.addEventListener("change", () => {
      const cur = new Set(answerOf(q).reasons);
      if (cb.checked) cur.add(r); else cur.delete(r);
      setAnswer(q, { reasons: Array.from(cur) }); renderQuestion();
    });
    const span = document.createElement("span"); span.textContent = r;
    lb.append(cb, span); rs.appendChild(lb);
  });
  const ta = $("#q-comment");
  ta.value = a.comment || "";
  ta.oninput = () => setAnswer(q, { comment: ta.value });
  $("#btn-prev").disabled = q <= 1;
  $("#btn-next").disabled = q >= 23;
}
function setAnswer(qno, patch) {
  state.answers[qno] = { ...answerOf(qno), ...patch };
  state.hasUnsubmittedChanges=true; state.dirty = true; saveState(); scheduleDraft();
}

// ---------------- 確認・提出
function renderConfirm() {
  const rows = [];
  for (let q = 1; q <= 23; q++) {
    const a = answerOf(q);
    const p = a.author ? participantById(a.author) : null;
    rows.push(`<tr><th>第${q}問<br><span class="muted">♪ ${esc(questionByNo(q).title || "公開前")}</span></th><td>${p ? esc(p.name) : "（未解答）"}</td>
      <td class="muted">${esc(a.confidence || "")}</td></tr>`);
  }
  $("#confirm-list").innerHTML = "<table>" + rows.join("") + "</table>";
  const sv = state.survey || {};
  $("#sv-newfound").checked = !!sv.newfound;
  $("#sv-researched").checked = !!sv.researched;
  $("#sv-newfav").checked = !!sv.newfav;
  $("#sv-comment").value = sv.comment || "";
  const kl = $("#sv-keep-listening");
  kl.innerHTML = "";
  PARTICIPANTS.slice().sort(byName).forEach((p) => {
    const lb = document.createElement("label");
    lb.className = "opt";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = p.id;
    cb.checked = (sv.keep_listening || []).includes(p.id);
    const span = document.createElement("span");
    span.textContent = p.name + (p.part === "first" ? "（前編）" : "（後編）");
    lb.append(cb, span); kl.appendChild(lb);
  });
}
async function doSubmit() {
  if (writeBusy) { $('#submit-result').textContent='途中保存中です。数秒後にもう一度提出してください。'; return; }
  writeBusy=true; $('#btn-submit').disabled=true;
  try { await submitInner(); } finally { writeBusy=false; $('#btn-submit').disabled=false; }
}
async function submitInner() {
  const out = $("#submit-result");
  out.innerHTML = "";
  if (!state.code || !state.secret) {
    out.innerHTML = '<p class="error">受験者登録が確認できません。トップから登録または再開をしてください。</p>'; return;
  }
  state.survey = {
    newfound: $("#sv-newfound").checked,
    researched: $("#sv-researched").checked,
    newfav: $("#sv-newfav").checked,
    keep_listening: $$("#sv-keep-listening input:checked").map((i) => i.value),
    comment: $("#sv-comment").value,
  };
  saveState();
  try {
    const resumeHash = await sha256(state.secret);
    const submittedSnapshot=JSON.stringify(state.answers);
    const res = await Backend.submit({ code: state.code, resumeHash, answers: JSON.parse(submittedSnapshot),
      survey: state.survey, ranking: state.ranking, orders: state.orders });
    state.revision = res.revision; state.dirty = JSON.stringify(state.answers)!==submittedSnapshot; state.hasUnsubmittedChanges=state.dirty; state.submitted = true; state.updatedAt = res.updated_at || new Date().toISOString();
    saveState(); updateMyStatus();
    if(state.dirty) scheduleDraft();
    out.innerHTML = '<p class="success">提出が完了しました（サーバー保存を確認）。締切までは解答を直して再提出できます。</p>';
  } catch (e) {
    const map = { not_started: "まだ試験が開始していません。",
      closed: "締切を過ぎたため提出できません。",
      conflict: "別の画面から更新されています。下書きを控えてから再開してください。",
      invalid_credentials: "受験情報が確認できませんでした。再開手続きをやり直してください。" };
    out.innerHTML = '<p class="error">提出に失敗しました：' + esc(map[e.message] || e.message) +
      "<br>下書きはこの端末に保持されています。通信環境を確認して、もう一度提出してください。</p>";
  }
}

// ---------------- 名鑑
function renderDirectory(filter) {
  currentDirFilter = filter || "all";
  $$("#view-directory [data-dir]").forEach((b) =>
    b.classList.toggle("on", b.dataset.dir === currentDirFilter));
  const list = PARTICIPANTS.slice().sort(byName)
    .filter((p) => currentDirFilter === "all" || p.part === currentDirFilter);
  $("#directory-list").innerHTML = list.map((p) => {
    const links = [];
    if (p.x) links.push(`<a href="https://x.com/${esc(p.x)}" target="_blank" rel="noopener">X（@${esc(p.x)}）</a>`);
    if (safeUrl(p.niconico)) links.push(`<a href="${esc(p.niconico)}" target="_blank" rel="noopener">ニコニコ動画の作品一覧</a>`);
    if (safeUrl(p.other)) links.push(`<a href="${esc(p.other)}" target="_blank" rel="noopener">その他の作品一覧</a>`);
    return `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
      <strong>${esc(p.name)}</strong> <span class="pill ${p.part}">${p.part === "first" ? "前編" : "後編"}</span><br>
      <span class="muted">${links.join(" ／ ") || "リンク準備中"}</span></div>`;
  }).join("");
}

// ---------------- 成績発表
async function renderResults() {
  const body = $("#results-body");
  body.innerHTML = "<p>読み込み中…</p>";
  try {
    const res = await Backend.publicResults();
    if (!res.revealed) {
      body.innerHTML = `<p class="notice">正解発表はまだです。公開時刻：${esc(new Date(res.reveal_at).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"}))}</p>`;
      return;
    }
    const ans = (res.answers || []).map((a) => {
      const p = participantById(a.author_id);
      return `<tr><th>第${a.qno}問</th><td>${esc(a.song_title || "")}</td>
        <td><strong>${p ? esc(p.name) : ""}</strong></td>
        <td>${p && p.x ? `<a href="https://x.com/${esc(p.x)}" target="_blank" rel="noopener">@${esc(p.x)}</a>` : ""}</td></tr>`;
    }).join("");
    const rank = (res.ranking || []).map((r) =>
      `<tr><th>${r.rank}位</th><td>${esc(r.name)}</td><td>${r.score}点</td></tr>`).join("");
    body.innerHTML = `<h3>正解発表</h3><table>${ans}</table>
      <h3>ランキング（掲載希望者・上位10名）</h3>
      ${rank ? "<table>" + rank + "</table>" : "<p class='muted'>掲載対象者はまだいません。</p>"}`;
  } catch (e) {
    body.innerHTML = '<p class="error">取得に失敗しました：' + esc(e.message) + "</p>";
  }
  if (state.code) $("#my-code").value = state.code;
  if (state.secret) $("#my-secret").value = state.secret;
}
async function doMyResults() {
  const out = $("#my-results");
  out.innerHTML = "";
  const code = $("#my-code").value.trim();
  const secret = $("#my-secret").value;
  if (!code || !secret) { out.innerHTML = '<p class="error">受験番号と再開コードを入力してください。</p>'; return; }
  try {
    const res = await Backend.myResults(code, await sha256(secret));
    const rows = (res.details || []).map((d) => {
      const mine = d.my_author ? participantById(d.my_author) : null;
      const corr = participantById(d.correct_author);
      return `<tr><th>第${d.qno}問</th><td>${esc(d.song_title || "")}</td>
        <td>正解：${corr ? esc(corr.name) : ""}</td>
        <td>あなた：${mine ? esc(mine.name) : "（未解答）"}</td>
        <td>${d.is_correct ? "○" : "×"}</td></tr>`;
    }).join("");
    out.innerHTML = `<p class="success">あなたの得点：<strong>${res.score} / ${res.total}点</strong></p><table>${rows}</table>`;
  } catch (e) {
    const map = { not_revealed: "まだ公開時刻になっていません。",
      invalid_credentials: "受験番号または再開コードが違います。" };
    out.innerHTML = '<p class="error">' + esc(map[e.message] || e.message) + "</p>";
  }
}

// ---------------- トップ表示
function updateMyStatus() {
  $('#forget-session').classList.toggle('hidden',!state.code);
  const el = $("#my-status");
  if (state.code) {
    el.textContent = `あなたの受験番号：${state.code}` +
      (state.nameType === "handle" ? `（${state.handle}）` : "（匿名参加）") +
      (state.submitted ? (state.hasUnsubmittedChanges ? "／提出後の変更あり（再提出してください）" : "／提出済み（締切まで修正できます）") : "／未提出") +
      `／解答済み ${answeredCount()} / 23問`;
    $("#btn-start").textContent = "試験を続ける";
  } else {
    el.textContent = "";
    $("#btn-start").textContent = "試験を始める";
  }
}
function renderTopParticipants() {
  $("#top-participants").innerHTML = ["first", "second"].map((part) =>
    `<p><span class="pill ${part}">${part === "first" ? "前編" : "後編"}</span><br>` +
    participantsOf(part).map((p) => esc(p.name)).join("、") + "</p>").join("");
}

// ---------------- 初期化
document.addEventListener("DOMContentLoaded", async () => {
  try { window.ExamAPI.checkConfig(); await loadPublicData(); }
  catch(e) { $('#connection-banner').textContent=e.message; $('#connection-banner').classList.remove('hidden');
    $$('button').forEach(b=>b.disabled=true); return; }
  setInterval(() => loadPublicData().then(()=>{if(!$('#view-register').classList.contains('hidden'))window.ExamAPI.mountCaptcha();if(!$('#view-exam').classList.contains('hidden')) renderExam();}).catch(()=>{}),60000);
  ensureOrders();
  renderTopParticipants();
  updateMyStatus();
  tickCountdown();
  setInterval(tickCountdown, 1000);
  setInterval(saveDraft,15000);
  window.addEventListener('online',saveDraft);
  $('#download-draft').addEventListener('click',()=>{
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify({code:state.code,answers:state.answers,survey:state.survey},null,2)],{type:'application/json'}));
    a.download='聞き耳試験_下書き.json'; a.click(); URL.revokeObjectURL(a.href);
  });
  $('#forget-session').addEventListener('click',()=>{
    if(confirm('受験番号と秘密の再開コードを控えましたか？ この端末の受験情報と下書きを消去します。サーバー保存済みの解答は削除されません。未保存の変更は先にダウンロードしてください。')) {
      localStorage.removeItem(SKEY); state.dirty=false; location.reload();
    }
  });
  $$("[data-nav]").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.nav;
    if ((v === "exam" || v === "confirm") && !state.code) { nav("register"); return; }
    nav(v);
  }));
  $("#btn-start").addEventListener("click", () => nav(state.code ? "exam" : "register"));
  $("#btn-resume-open").addEventListener("click", () => nav("resume"));
  $("#btn-register").addEventListener("click", doRegister);
  $("#btn-to-exam").addEventListener("click", () => nav("exam"));
  $("#copy-code").addEventListener("click", () => navigator.clipboard.writeText($("#issued-code").textContent));
  $("#copy-secret").addEventListener("click", () => navigator.clipboard.writeText($("#issued-secret").textContent));
  $("#btn-resume").addEventListener("click", async () => {
    const err = $("#resume-error");
    err.innerHTML = "";
    try {
      await doResume($("#resume-code").value.trim(), $("#resume-secret").value);
      nav("exam");
    } catch (e) {
      err.innerHTML = '<p class="error">再開できませんでした。受験番号と再開コードを確認してください。</p>';
    }
  });
  $("#tab-first").addEventListener("click", () => { state.currentPart = "first"; if (state.currentQ > 12) state.currentQ = 1; saveState(); renderExam(); });
  $("#tab-second").addEventListener("click", () => { state.currentPart = "second"; if (state.currentQ < 13) state.currentQ = 13; saveState(); renderExam(); });
  $("#btn-prev").addEventListener("click", () => {
    if (state.currentQ > 1) { state.currentQ--; state.currentPart = partOf(state.currentQ); saveState(); renderExam(); }
  });
  $("#btn-next").addEventListener("click", () => {
    if (state.currentQ < 23) { state.currentQ++; state.currentPart = partOf(state.currentQ); saveState(); renderExam(); }
  });
  $("#btn-to-confirm").addEventListener("click", () => nav("confirm"));
  $("#btn-submit").addEventListener("click", doSubmit);
  $$("#view-directory [data-dir]").forEach((b) =>
    b.addEventListener("click", () => renderDirectory(b.dataset.dir)));
  $("#btn-my-results").addEventListener("click", doMyResults);
  $$('input[name="reg-type"]').forEach((r) => r.addEventListener("change", () => {
    $$('input[name="reg-type"]').forEach((x) => x.closest("label.opt").classList.toggle("sel", x.checked));
  }));
});

let writeBusy=false, draftTimer;
function safeUrl(s) { try { return new URL(s).protocol==='https:'; } catch { return false; } }
function scheduleDraft() { clearTimeout(draftTimer); draftTimer=setTimeout(saveDraft,5000); }
async function saveDraft() {
  if(writeBusy || state.conflict || !state.code || !state.dirty) return;
  writeBusy=true;
  const snapshot=JSON.stringify(state.answers);
  $('#draft-note').textContent='サーバーに途中保存中…';
  try {
    const res=await rpc('save_draft',{p_code:state.code,p_resume_hash:await sha256(state.secret),
      p_answers:JSON.parse(snapshot),p_orders:state.orders,p_revision:state.revision || 0});
    state.revision=res.revision;
    state.dirty=JSON.stringify(state.answers)!==snapshot; saveState();
    $('#draft-note').textContent='サーバーに途中保存しました（提出はまだ完了していません）。';
  } catch(e) { if(e.message==='conflict') state.conflict=true; $('#draft-note').textContent='サーバーへの途中保存に失敗：'+e.message+'。端末内の下書きを保持しています。'; }
  finally { writeBusy=false; }
}
window.addEventListener('beforeunload', e=>{ if(state.dirty){ e.preventDefault(); e.returnValue=''; } });
