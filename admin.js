// 管理者画面（要 Supabase Auth ログイン＋ admins 登録／デモモード時はこの端末のデモデータで動作）
"use strict";
const CFG = window.EXAM_CONFIG;

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byName = (a, b) => a.name.localeCompare(b.name, "ja");
const partOf = (qno) => (qno <= 12 ? "first" : "second");
let PARTICIPANTS = window.EXAM_DATA.participants.slice();
let QUESTIONS = window.EXAM_DATA.questions.slice();
const participantById = (id) => PARTICIPANTS.find((p) => p.id === id);
const participantsOf = (part) => PARTICIPANTS.filter((p) => p.part === part).slice().sort(byName);
const questionByNo = (qno) => QUESTIONS.find((q) => q.qno === qno) || { qno, title: "", start_sec: null };
const pname = (id) => (participantById(id) ? participantById(id).name : (id || "（未解答）"));

let TOKEN = sessionStorage.getItem("kikimimi_admin_token") || "";
let OVERVIEW = null, EXAMINEES = [], ANSWERS_KEY = {}; // ANSWERS_KEY: qno -> {author_id, song_title}

async function sb(path, opts = {}, auth) {
  window.ExamAPI.checkConfig();
  const r = await fetch(CFG.SUPABASE_URL + path, {
    ...opts,
    headers: { apikey: CFG.SUPABASE_ANON_KEY,
      ...(auth ? {Authorization: "Bearer " + auth} : {}),
      "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) throw new Error((d && (d.message || d.error_description)) || ("HTTP " + r.status));
  return d;
}
const rpcAdmin = (fn, args) => sb("/rest/v1/rpc/" + fn,
  { method: "POST", body: JSON.stringify(args || {}) }, TOKEN);

async function loadAdminData() {
  const [ov, ex, ak, ps, qs] = await Promise.all([
    rpcAdmin("admin_overview"), rpcAdmin("admin_examinees"), rpcAdmin("admin_get_answers"),
    sb("/rest/v1/participants?select=*"), rpcAdmin("admin_get_questions"),
  ]);
  OVERVIEW = ov; EXAMINEES = ex || [];
  ANSWERS_KEY = {};
  (ak || []).forEach((a) => { ANSWERS_KEY[a.qno] = { author_id: a.author_id, song_title: a.song_title }; });
  if (ps && ps.length) PARTICIPANTS = ps.map((p) => ({ id: p.id, name: p.name, part: p.part, x: p.x_id, niconico: p.niconico_url, other: p.other_url }));
  if (qs && qs.length) QUESTIONS = qs.map((q) => ({ qno: q.qno, part: q.part, title: q.title, start_sec: q.start_sec }));
}

// ---------------- 表示
function showAdmin() {
  $("#admin-login").classList.add("hidden");
  $("#admin-main").classList.remove("hidden");
  renderDash(); renderExaminees(); renderReports(); renderSettingsForms();
}
function stat(label, val) { return `<div style="display:inline-block;min-width:130px;margin:6px 12px 6px 0">
  <div class="muted">${label}</div><div style="font-size:22px;font-weight:800">${val}</div></div>`; }
function renderDash() {
  const o = OVERVIEW; if (!o) return;
  const dist = Object.entries(o.score_dist || {}).sort((a, b) => b[0] - a[0])
    .map(([s, c]) => `${s}点：${c}名`).join(" ／ ") || "—";
  const perQ = (o.per_question || []).map((q) =>
    `<tr><th>第${q.qno}問<br>♪ ${esc(questionByNo(q.qno).title)}</th><td class="num">${q.answered}</td><td class="num">${q.correct}</td>
     <td class="num">${Math.round((q.rate || 0) * 100)}%</td>
     <td>${Object.entries(q.wrong || {}).map(([id, c]) => esc(pname(id)) + "：" + c).join("、") || "—"}</td></tr>`).join("");
  const top = (o.top10 || []).map((t, i) => `${i + 1}. ${esc(t.name)}（${t.score}点）`).join("<br>") || "—";
  const reasons = Object.entries(o.reasons_agg || {}).sort((a, b) => b[1] - a[1])
    .map(([r, c]) => `${esc(r)}：${c}`).join(" ／ ") || "—";
  // アンケート集計
  const subs = EXAMINEES.filter((e) => e.first_submitted_at);
  const sv = { newfound: 0, researched: 0, newfav: 0, comments: [] };
  const keep = {};
  subs.forEach((e) => { const s = e.survey || {};
    if (s.newfound) sv.newfound++; if (s.researched) sv.researched++; if (s.newfav) sv.newfav++;
    (s.keep_listening || []).forEach((id) => { keep[id] = (keep[id] || 0) + 1; });
    if (s.comment) sv.comments.push(s.comment); });
  const keepStr = Object.entries(keep).sort((a, b) => b[1] - a[1])
    .map(([id, c]) => `${esc(pname(id))}：${c}名`).join(" ／ ") || "—";
  $("#dash-body").innerHTML =
    stat("受験者数", o.examinees) + stat("提出済み", o.submitted) +
    stat("匿名参加者", o.anonymous) + stat("解答率（平均）", Math.round((o.avg_answered_rate || 0) * 100) + "%") +
    stat("満点者", o.perfect) +
    (o.avg_score_after_deadline != null ? stat("平均点（締切後）", o.avg_score_after_deadline) : "") +
    `<h3>得点分布</h3><p>${dist}</p>
     <h3>上位10名（全提出者）</h3><p>${top}</p>
     <h3>推理の決め手 集計</h3><p>${reasons}</p>
     <h3>問題別 正答率・誤答内訳</h3>
     <div style="overflow-x:auto"><table><tr><th>問題</th><th class="num">解答者</th><th class="num">正答者</th><th class="num">正答率</th><th>誤答内訳</th></tr>${perQ}</table></div>
     <h3>アンケート集計</h3>
     <p>初めて知ったPがいた：${sv.newfound}名 ／ 過去作品を調べた：${sv.researched}名 ／ 新しく好きになったPがいた：${sv.newfav}名</p>
     <p>今後も聴きたい：${keepStr}</p>
     <p>全体への感想：${sv.comments.length}件</p>` +
    sv.comments.map((c) => `<p class="muted">・${esc(c)}</p>`).join("");
}
function displayName(e) {
  return e.name_type === "handle" && e.handle_name ? e.handle_name : "匿名（" + e.code + "）";
}
function renderExaminees() {
  const head = Array.from({ length: 23 }, (_, i) => `<th>Q${i + 1}<br>♪ ${esc(questionByNo(i+1).title)}</th>`).join("");
  const rows = EXAMINEES.map((e) => {
    const cells = Array.from({ length: 23 }, (_, i) => {
      const a = e.answers[i + 1];
      return `<td>${a && a.author ? esc(pname(a.author)) : ""}</td>`;
    }).join("");
    return `<tr><th>${esc(displayName(e))}<br><span class="muted">${esc(e.code)}</span></th>
      <td class="num">${e.score}</td><td>${e.first_submitted_at ? "提出済" : "未提出"}</td>${cells}</tr>`;
  }).join("");
  $("#examinees-body").innerHTML =
    `<table><tr><th>受験者</th><th class="num">得点</th><th>状態</th>${head}</tr>${rows}</table>`;
}

// ---------------- CSV
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(s)) s = "'" + s; // 数式インジェクション対策
  return '"' + s.replace(/"/g, '""') + '"';
}
function downloadCsv(name, rows) {
  const text = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function exportCsv(kind) {
  const subs = EXAMINEES.filter((e) => e.first_submitted_at);
  if (kind === "answers") {
    const rows = [["受験番号", "表示名", "種別", ...Array.from({ length: 23 }, (_, i) => "第" + (i + 1) + "問 ♪ " + questionByNo(i+1).title)]];
    EXAMINEES.forEach((e) => rows.push([e.code, displayName(e), e.name_type,
      ...Array.from({ length: 23 }, (_, i) => { const a = e.answers[i + 1]; return a && a.author ? pname(a.author) : ""; })]));
    downloadCsv("受験者別解答一覧.csv", rows);
  } else if (kind === "scores") {
    const rows = [["受験番号", "表示名", "得点", "初回提出", "最終更新",...QUESTIONS.map(q=>"第"+q.qno+"問 ♪ "+q.title)]];
    subs.forEach((e) => rows.push([e.code, displayName(e), e.score, e.first_submitted_at || "", e.updated_at || "",...QUESTIONS.map(q=>e.answers[q.qno]?.author===ANSWERS_KEY[q.qno]?.author_id?"○":"×")]));
    downloadCsv("受験者別採点結果.csv", rows);
  } else if (kind === "questions") {
    const rows = [["問題", "曲名", "正解者", "解答者数", "正答者数", "正答率", "誤答内訳"]];
    (OVERVIEW.per_question || []).forEach((q) => rows.push([q.qno,
      questionByNo(q.qno).title || "",
      pname(ANSWERS_KEY[q.qno] && ANSWERS_KEY[q.qno].author_id), q.answered, q.correct,
      Math.round((q.rate || 0) * 100) + "%",
      Object.entries(q.wrong || {}).map(([id, c]) => pname(id) + ":" + c).join(" / ")]));
    downloadCsv("問題別集計.csv", rows);
  } else if (kind === "comments") {
    const rows = [["問題", "曲名", "感想"]];
    subs.forEach((e) => { for (let q = 1; q <= 23; q++) { const a = e.answers[q];
      if (a && a.comment) rows.push([q, questionByNo(q).title || "", a.comment]); } });
    downloadCsv("感想一覧.csv", rows);
  } else if (kind === "survey") {
    const keep = {};
    let nf = 0, rs = 0, nfv = 0; const comments = [];
    subs.forEach((e) => { const s = e.survey || {};
      if (s.newfound) nf++; if (s.researched) rs++; if (s.newfav) nfv++;
      (s.keep_listening || []).forEach((id) => { keep[id] = (keep[id] || 0) + 1; });
      if (s.comment) comments.push(s.comment); });
    const rows = [["項目", "値"],
      ["初めて知ったPがいた（名）", nf], ["過去作品を調べた（名）", rs], ["新しく好きになったPがいた（名）", nfv],
      ...Object.entries(keep).map(([id, c]) => ["今後も聴きたい：" + pname(id), c]),
      ...comments.map((c) => ["全体への感想", c])];
    downloadCsv("アンケート集計.csv", rows);
  } else if (kind === "ranking") {
    const rows = [["順位", "表示名", "受験番号", "得点"]];
    const sorted = subs.filter((e) => e.ranking_opt_in).sort((a, b) => b.score - a.score);
    let rank = 0, prev = -1;
    sorted.forEach((e, i) => { if (e.score !== prev) { rank = i + 1; prev = e.score; }
      rows.push([rank, displayName(e), e.code, e.score]); });
    downloadCsv("ランキング希望者の成績一覧.csv", rows);
  }
}

// ---------------- 個別レポート
const EXCLUDED_KEY = "kikimimi_admin_excluded_comments";
let excluded=new Set();
try { excluded=new Set(JSON.parse(localStorage.getItem(EXCLUDED_KEY)||'[]')); } catch {}
function saveExcluded() { localStorage.setItem(EXCLUDED_KEY, JSON.stringify(Array.from(excluded))); }
function reportData() {
  // 作者ごとのレポートデータを組み立てる
  const subs = EXAMINEES.filter((e) => e.first_submitted_at);
  const keep = {};
  subs.forEach((e) => (e.survey && e.survey.keep_listening || []).forEach((id) => { keep[id] = (keep[id] || 0) + 1; }));
  const out = [];
  for (let q = 1; q <= 23; q++) {
    const key = ANSWERS_KEY[q];
    if (!key) continue;
    const author = participantById(key.author_id);
    let answered = 0, correct = 0, unanswered = 0;
    const wrong = {}, reasons = {}, conf = {}, comments = [];
    subs.forEach((e) => {
      const a = e.answers[q];
      if (!a || !a.author) { unanswered++; }
      else { answered++; if (a.author === key.author_id) correct++; else wrong[a.author] = (wrong[a.author] || 0) + 1; }
      if (a) {
        (a.reasons || []).forEach((r) => { reasons[r] = (reasons[r] || 0) + 1; });
        if (a.confidence) conf[a.confidence] = (conf[a.confidence] || 0) + 1;
        if (a.comment) comments.push({ q, idx: comments.length, text: a.comment });
      }
    });
    out.push({ qno: q, author, title: questionByNo(q).title || "",
      total: subs.length, answered, correct, unanswered,
      rate: answered ? Math.round(correct / answered * 1000) / 10 : 0,
      wrong, reasons, conf, comments, keepListening: keep[key.author_id] || 0 });
  }
  return out;
}
function reportHtml(r, forPrint) {
  const kv = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])
    .map(([k, c]) => `${esc(k)}：${c}`).join(" ／ ") || "—";
  const wrongStr = Object.entries(r.wrong).sort((a, b) => b[1] - a[1])
    .map(([id, c]) => `${esc(pname(id))}：${c}`).join(" ／ ") || "—";
  const comments = r.comments.filter((c) => !excluded.has(r.qno + ":" + c.idx + ":" + c.text));
  const commentHtml = forPrint
    ? comments.map((c) => `<p>・${esc(c.text)}</p>`).join("") || "<p>（なし）</p>"
    : r.comments.map((c) => {
        const id = r.qno + ":" + c.idx + ":" + c.text;
        return `<label class="opt"><input type="checkbox" data-exclude="${esc(id)}" ${excluded.has(id) ? "checked" : ""}>
          <span>${esc(c.text)} <span class="muted">（チェックで除外）</span></span></label>`;
      }).join("") || "<p class='muted'>（なし）</p>";
  return `<div class="report-page">
    <h3>第${r.qno}問　${r.author ? esc(r.author.name) : ""}</h3>
    <p>出題楽曲：${esc(r.title || "（曲名未設定）")}<br>
    解答者数：${r.total}名 ／ 正答者数：${r.correct}名 ／ 正答率：${r.rate}% ／ 未解答：${r.unanswered}名<br>
    誤答の内訳：${wrongStr}<br>
    推理の決め手：${kv(r.reasons)}<br>
    自信度の分布：${kv(r.conf)}<br>
    今後も聴きたいと回答した人数：${r.keepListening}名</p>
    <h4>楽曲への感想</h4>${commentHtml}
    ${forPrint ? "" : `<div class="btnrow"><button class="btn sub" data-report-dl="${r.qno}">この作者のレポートをダウンロード（HTML）</button></div>`}
  </div>`;
}
function renderReports() {
  const data = reportData();
  $("#reports-body").innerHTML = data.length
    ? data.map((r) => reportHtml(r, false)).join("")
    : "<p class='muted'>正解が登録されるとレポートが生成されます。</p>";
  $$("#reports-body [data-exclude]").forEach((cb) => cb.addEventListener("change", () => {
    if (cb.checked) excluded.add(cb.dataset.exclude); else excluded.delete(cb.dataset.exclude);
    saveExcluded();
  }));
  $$("#reports-body [data-report-dl]").forEach((b) => b.addEventListener("click", () => {
    const r = reportData().find((x) => x.qno === Number(b.dataset.reportDl));
    const html = "<!DOCTYPE html><html lang='ja'><head><meta charset='utf-8'><title>出題者レポート 第" +
      r.qno + "問</title></head><body>" + reportHtml(r, true) + "</body></html>";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `レポート_第${r.qno}問_${r.author ? r.author.name : ""}.html`;
    a.click(); URL.revokeObjectURL(a.href);
  }));
}

// ---------------- 設定フォーム
function toLocalInput(iso) {
  if (!iso) return "";
  return new Date(new Date(iso).getTime()+9*3600000).toISOString().slice(0,16);

}
async function renderSettingsForms() {
  try {
    const g=await rpcAdmin('admin_gateway_status');
    $('#gateway-origins').value=g.origins.join('\n'); $('#gateway-hostname').value=g.hostname;
    $('#gateway-sitekey').value=g.site_key; $('#gateway-enabled').checked=g.enabled;
    $('#gateway-secret').placeholder=g.secret_configured?'登録済み（変更する場合だけ入力）':'未登録';
  } catch(e) { $('#gateway-result').textContent='保護設定の取得失敗：'+e.message; }
  // 現在値の反映
  let s = { start_at: CFG.START_AT, deadline_at: CFG.DEADLINE_AT, reveal_at: CFG.REVEAL_AT,
            video_first_url: CFG.VIDEO_FIRST_URL, video_second_url: CFG.VIDEO_SECOND_URL };
  {
    try { const rows = await sb("/rest/v1/exam_settings?select=*&id=eq.1", {}, TOKEN);
      if (rows && rows[0]) s = rows[0]; } catch (e) {}
  }
  $('#titles-first').checked=!!s.titles_first;
  $('#titles-second').checked=!!s.titles_second;
  $('#results-enabled').checked=!!s.results_enabled;
  $("#set-start").value = toLocalInput(s.start_at);
  $("#set-deadline").value = toLocalInput(s.deadline_at);
  $("#set-reveal").value = toLocalInput(s.reveal_at);
  $("#set-vfirst").value = s.video_first_url || "";
  $("#set-vsecond").value = s.video_second_url || "";
  // 正解登録フォーム
  $("#answer-form").innerHTML = Array.from({ length: 23 }, (_, i) => {
    const q = i + 1;
    const opts = participantsOf(partOf(q)).map((p) =>
      `<option value="${p.id}" ${ANSWERS_KEY[q] && ANSWERS_KEY[q].author_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    return `<p>第${q}問 <select id="ans-author-${q}"><option value="">（未登録）</option>${opts}</select>
      <input type="text" id="ans-title-${q}" placeholder="曲名" value="${esc(questionByNo(q).title || "")}" style="width:220px;display:inline-block">
      <button class="btn sub" data-set-answer="${q}">登録</button></p>`;
  }).join("");
  $$("#answer-form [data-set-answer]").forEach((b) => b.addEventListener("click", async () => {
    const q = Number(b.dataset.setAnswer);
    const author = $("#ans-author-" + q).value;
    const title = $("#ans-title-" + q).value;
    const out = $("#answer-result");
    if (!author) { out.innerHTML = '<p class="error">作者を選んでください。</p>'; return; }
    try {
      { await rpcAdmin("admin_set_answer", { p_qno: q, p_author: author, p_title: title });
        ANSWERS_KEY[q] = { author_id: author, song_title: title };
        questionByNo(q).title=title;
        $('#results-enabled').checked=false;
        out.innerHTML = '<p class="success">第' + q + '問の正解を登録しました。</p>'; }
      renderReports();
    } catch (e) { out.innerHTML = '<p class="error">' + esc(e.message) + "</p>"; }
  }));
  // 問題フォーム
  $("#question-form").innerHTML = QUESTIONS.map((q) =>
    `<p>第${q.qno}問 <input type="text" id="qt-${q.qno}" value="${esc(q.title || "")}" placeholder="曲名" style="width:220px;display:inline-block">
     <input type="text" id="qs-${q.qno}" value="${q.start_sec ?? ""}" placeholder="開始秒" style="width:90px;display:inline-block">
     <button class="btn sub" data-set-q="${q.qno}">保存</button></p>`).join("");
  $$("#question-form [data-set-q]").forEach((b) => b.addEventListener("click", async () => {
    const q = Number(b.dataset.setQ);
    const title = $("#qt-" + q).value, sec = $("#qs-" + q).value;
    try {
      await rpcAdmin("admin_set_question",
        { p_qno: q, p_title: title, p_start_sec: sec === "" ? null : Number(sec) });
      const t = questionByNo(q); t.title = title; t.start_sec = sec === "" ? null : Number(sec);
      b.textContent = "保存しました";
    } catch (e) { alert(e.message); }
  }));
  // 参加者リンク
  $("#participant-form").innerHTML = PARTICIPANTS.slice().sort(byName).map((p) =>
    `<p>${esc(p.name)} <input type="text" id="pn-${p.id}" value="${esc(p.niconico || "")}" placeholder="ニコニコ作品一覧URL" style="width:250px;display:inline-block">
     <input type="text" id="po-${p.id}" value="${esc(p.other || "")}" placeholder="その他URL" style="width:200px;display:inline-block">
     <button class="btn sub" data-set-p="${p.id}">保存</button></p>`).join("");
  $$("#participant-form [data-set-p]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.setP;
    try {
      await rpcAdmin("admin_set_participant_links",
        { p_id: id, p_niconico: $("#pn-" + id).value, p_other: $("#po-" + id).value });
      const p = participantById(id); p.niconico = $("#pn-" + id).value; p.other = $("#po-" + id).value;
      b.textContent = "保存しました";
    } catch (e) { alert(e.message); }
  }));
}

// ---------------- 初期化
document.addEventListener("DOMContentLoaded", () => {

  $("#adm-login-btn").addEventListener("click", async () => {
    const err = $("#adm-login-error");
    err.innerHTML = "";
    try {
      const d = await sb("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email: $("#adm-email").value.trim(), password: $("#adm-pass").value }),
      });
      $("#adm-pass").value=""; TOKEN = d.access_token;
      sessionStorage.setItem("kikimimi_admin_token", TOKEN);
      await loadAdminData();
      showAdmin();
    } catch (e) {
      err.innerHTML = '<p class="error">ログインできませんでした：' + esc(e.message) +
        "<br>（admins テーブルに未登録の場合も集計データは取得できません）</p>";
    }
  });
  if (TOKEN) loadAdminData().then(showAdmin).catch(()=>{TOKEN='';sessionStorage.removeItem('kikimimi_admin_token');});
});

document.addEventListener('DOMContentLoaded',()=>{
  $('#gateway-save').addEventListener('click',async()=>{
    try {
      await rpcAdmin('admin_configure_gateway',{
        p_origins:$('#gateway-origins').value.split(/\s+/).filter(Boolean),
        p_secret:$('#gateway-secret').value,p_hostname:$('#gateway-hostname').value.trim(),
        p_enabled:$('#gateway-enabled').checked,p_site_key:$('#gateway-sitekey').value.trim()});
      $('#gateway-secret').value=''; $('#gateway-result').textContent='保護設定を保存しました。';
    } catch(e){$('#gateway-result').textContent='保存失敗：'+e.message;}
  });
  try { window.ExamAPI.checkConfig(); } catch(e){$('#adm-login-error').textContent=e.message; $('#adm-login-btn').disabled=true;}
  $$('[data-atab]').forEach(b=>b.addEventListener('click',()=>{
    $$('[id^="atab-"]').forEach(s=>s.classList.toggle('hidden',s.id!=='atab-'+b.dataset.atab));
  }));
  $$('[data-csv]').forEach(b=>b.addEventListener('click',()=>exportCsv(b.dataset.csv)));
  $('#adm-logout').addEventListener('click',async()=>{
    try { await sb('/auth/v1/logout',{method:'POST'},TOKEN); } catch {}
    TOKEN=''; sessionStorage.removeItem('kikimimi_admin_token'); location.reload();
  });
  $('#set-save').addEventListener('click',async()=>{
    try {
      await rpcAdmin('admin_set_settings',{
        p_start: new Date($('#set-start').value+'+09:00').toISOString(),
        p_deadline: new Date($('#set-deadline').value+'+09:00').toISOString(),
        p_reveal: new Date($('#set-reveal').value+'+09:00').toISOString(),
        p_video_first:$('#set-vfirst').value.trim(), p_video_second:$('#set-vsecond').value.trim()});
      await rpcAdmin('admin_set_visibility',{p_titles_first:$('#titles-first').checked,
        p_titles_second:$('#titles-second').checked,p_results:$('#results-enabled').checked});
      $('#set-result').textContent='設定を保存しました。日時は日本時間です。';
    } catch(e){$('#set-result').textContent='保存失敗：'+e.message;}
  });
  $('#report-all-print').addEventListener('click',()=>{
    $('#report-print').innerHTML=reportData().map(r=>reportHtml(r,true)).join('');
    $('#report-print').classList.remove('hidden'); window.print(); $('#report-print').classList.add('hidden');
  });
});
