import{t as e}from"./regulatoryFooter-B-fdGJ7I.js";var t=document.querySelector(`#admin-app`);if(!t)throw Error(`Admin root #admin-app not found`);e(),r();async function n(e,t){let n=await fetch(e,{credentials:`same-origin`,...t,headers:{"Content-Type":`application/json`,...t?.headers??{}}});if(!n.ok){let e=await n.json().catch(()=>({}));throw Error(e.error??`请求失败（${n.status}）`)}return await n.json()}async function r(){try{let e=await n(`/api/admin/session`);if(e.authenticated&&e.username){a(e.username),await c();return}i(e.configured?``:`后台尚未配置管理员账号，请先完成服务器环境变量配置。`)}catch{i(`无法连接研究数据服务，请稍后重试。`)}}function i(e){t.innerHTML=`
    <main class="admin-shell admin-shell--login">
      <section class="admin-card admin-login-card">
        <p class="admin-eyebrow">研究人员专用</p>
        <h1>研究数据后台</h1>
        <p class="admin-lead">登录后可查看收数状态并下载正式数据。</p>
        <form id="admin-login-form" class="admin-form">
          <label>
            <span>用户名</span>
            <input name="username" autocomplete="username" required />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <p id="admin-feedback" class="admin-feedback" role="alert">${d(e)}</p>
          <button class="admin-button admin-button--primary" type="submit">登录</button>
        </form>
      </section>
    </main>
  `;let r=document.querySelector(`#admin-login-form`),i=document.querySelector(`#admin-feedback`);r?.addEventListener(`submit`,async e=>{e.preventDefault();let t=r.querySelector(`button`),o=new FormData(r),s=String(o.get(`username`)??``),l=String(o.get(`password`)??``);t&&(t.disabled=!0,t.textContent=`正在登录…`);try{await n(`/api/admin/login`,{method:`POST`,body:JSON.stringify({username:s,password:l})}),a(s),await c()}catch(e){i&&(i.textContent=e instanceof Error?e.message:`登录失败`),t&&(t.disabled=!1,t.textContent=`登录`)}})}function a(e){t.innerHTML=`
    <main class="admin-shell">
      <header class="admin-header">
        <div>
          <p class="admin-eyebrow">研究人员专用</p>
          <h1>研究数据后台</h1>
        </div>
        <div class="admin-account">
          <span>${d(e)}</span>
          <button id="admin-logout" class="admin-button admin-button--quiet" type="button">退出</button>
        </div>
      </header>

      <section class="admin-card">
        <div class="admin-section-heading">
          <div>
            <h2>收数状态</h2>
            <p>页面仅显示汇总数量，不展示参与者答案。</p>
          </div>
          <button id="refresh-stats" class="admin-button admin-button--secondary" type="button">刷新</button>
        </div>
        <p id="admin-dashboard-feedback" class="admin-feedback" role="status"></p>
        <div class="admin-stat-grid" aria-live="polite">
          ${o(`正式提交`,`stat-formal`)}
          ${o(`Table分配`,`stat-table`)}
          ${o(`Graph分配`,`stat-graph`)}
          ${o(`Video分配`,`stat-video`)}
        </div>
        <div id="release-gate-status" class="admin-gate"></div>
      </section>

      <section class="admin-card">
        <h2>正式数据下载</h2>
        <p>默认下载仅包含正式数据，不包含预览和测试记录。</p>
        <div class="admin-download-grid">
          ${s(`正式完整JSON`,`formal`,`json`)}
          ${s(`正式逐题CSV`,`formal`,`trials.csv`)}
          ${s(`正式参与者CSV`,`formal`,`participants.csv`)}
        </div>
      </section>

      <details class="admin-card admin-audit-panel">
        <summary>审计数据下载</summary>
        <p>包含测试及历史分类，仅用于核查，不应并入正式分析。</p>
        <div class="admin-download-grid">
          ${s(`全部完整JSON`,`all`,`json`)}
          ${s(`全部逐题CSV`,`all`,`trials.csv`)}
          ${s(`全部参与者CSV`,`all`,`participants.csv`)}
        </div>
      </details>
    </main>
  `,document.querySelector(`#refresh-stats`)?.addEventListener(`click`,()=>void c()),document.querySelector(`#admin-logout`)?.addEventListener(`click`,async()=>{try{await n(`/api/admin/logout`,{method:`POST`,body:`{}`})}finally{i(``)}});for(let e of document.querySelectorAll(`[data-export-scope][data-export-format]`))e.addEventListener(`click`,()=>void l(e))}function o(e,t){return`
    <article class="admin-stat">
      <span>${e}</span>
      <strong id="${t}">—</strong>
    </article>
  `}function s(e,t,n){return`
    <button
      class="admin-button admin-button--secondary"
      type="button"
      data-export-scope="${t}"
      data-export-format="${n}"
    >${e}</button>
  `}async function c(){let e=document.querySelector(`#admin-dashboard-feedback`);e&&(e.textContent=`正在读取最新状态…`);try{let t=await n(`/api/admin/stats`);u(`stat-formal`,t.dataset_classification.formal),u(`stat-table`,t.table),u(`stat-graph`,t.graph),u(`stat-video`,t.video);let r=document.querySelector(`#release-gate-status`);r&&(r.className=`admin-gate ${t.release_gate.formal_collection_allowed?`admin-gate--open`:`admin-gate--closed`}`,r.textContent=t.release_gate.formal_collection_allowed?`正式收数门槛：已开放`:`正式收数门槛：未开放（${t.release_gate.reason}）`),e&&(e.textContent=`更新时间：${new Date().toLocaleString(`zh-CN`)}`)}catch(t){if(t instanceof Error&&/Authentication/.test(t.message)){i(`登录已失效，请重新登录。`);return}e&&(e.textContent=t instanceof Error?t.message:`状态读取失败`)}}async function l(e){let t=e.dataset.exportScope,n=e.dataset.exportFormat,r=e.textContent;e.disabled=!0,e.textContent=`正在生成…`;try{let e=await fetch(`/api/admin/export?scope=${encodeURIComponent(t??``)}&format=${encodeURIComponent(n??``)}`,{credentials:`same-origin`});if(!e.ok)throw Error(`导出失败（${e.status}）`);let r=await e.blob(),i=(e.headers.get(`content-disposition`)??``).match(/filename="?([^";]+)"?/i)?.[1]??`mmq-export-${Date.now()}`,a=URL.createObjectURL(r),o=document.createElement(`a`);o.href=a,o.download=i,document.body.appendChild(o),o.click(),o.remove(),window.setTimeout(()=>URL.revokeObjectURL(a),0)}catch(e){let t=document.querySelector(`#admin-dashboard-feedback`);t&&(t.textContent=e instanceof Error?e.message:`导出失败`)}finally{e.disabled=!1,e.textContent=r}}function u(e,t){let n=document.querySelector(`#${e}`);n&&(n.textContent=t.toLocaleString(`zh-CN`))}function d(e){return e.replaceAll(`&`,`&amp;`).replaceAll(`"`,`&quot;`).replaceAll(`<`,`&lt;`).replaceAll(`>`,`&gt;`)}