"use strict";
window.ExamAPI = (() => {
  let widget, captcha = "", loading = false;
  const cfg = window.EXAM_CONFIG;
  function checkConfig() {
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(cfg.SUPABASE_URL) || !cfg.SUPABASE_ANON_KEY)
      throw new Error("現在準備中です。サーバー接続が設定されるまで登録・保存はできません。");
  }
  function mountCaptcha() {
    if (loading || widget!==undefined || !cfg.TURNSTILE_SITE_KEY || !document.querySelector('#registration-captcha')) return;
    loading=true;
    const status=document.querySelector('#captcha-status');
    if(status) status.textContent='本人確認を読み込んでいます…';
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => { widget = window.turnstile.render('#registration-captcha', {
      sitekey:cfg.TURNSTILE_SITE_KEY, action:'register', callback:t=>{captcha=t;if(status)status.textContent='本人確認が完了しました。';},
      'expired-callback':()=>{captcha='';if(status)status.textContent='本人確認の有効期限が切れました。もう一度確認してください。';},
      'error-callback':()=>{captcha='';if(status)status.textContent='本人確認を読み込めません。通信状況やブラウザーの設定を確認して再読み込みしてください。';}
    }); };
    script.onerror=()=>{loading=false;if(status)status.textContent='本人確認を読み込めません。ページを再読み込みしてください。';};
    document.head.appendChild(script);
  }
  async function call(fn,args={}) {
    checkConfig();
    if(fn==='register_examinee' && !captcha) throw new Error('CAPTCHAの確認を完了してください。');
    try {
      const res=await fetch(cfg.SUPABASE_URL+'/functions/v1/exam-api',{
        method:'POST',headers:{'Content-Type':'application/json',apikey:cfg.SUPABASE_ANON_KEY},
        body:JSON.stringify({fn,args,captcha:fn==='register_examinee'?captcha:undefined}),
        signal:AbortSignal.timeout(25000)
      });
      const data=await res.json();
      if(!res.ok) throw new Error(data.error || '通信に失敗しました。');
      if(!data || typeof data!=='object') throw new Error('サーバーの応答を確認できません。');
      return data;
    } finally {
      if(fn==='register_examinee') { captcha=''; if(widget!==undefined) window.turnstile.reset(widget); }
    }
  }
  return {checkConfig,call,mountCaptcha};
})();
