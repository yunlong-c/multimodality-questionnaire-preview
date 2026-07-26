const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/buildExperiment-CaEqqwN_.js","assets/stimulus-catalog-C-pLEACp.js"])))=>i.map(i=>d[i]);
import{t as e}from"./regulatoryFooter-B-fdGJ7I.js";var t=`mmq-stimuli-2026-07-r1`,n=`e435368f72846b356aa2f5106b47dfe1c35dbc65012125eefa199ed53e93a7ec`,r=`/api`,i=`multimodality_client_token`,a=`multimodality_github_preview_participant_id`,o=`multimodality_github_preview_format_assignment`,s=`multimodality_github_preview_submission_`;function c(){try{return localStorage.getItem(i)}catch{return null}}function l(e){try{localStorage.setItem(i,e)}catch{}}function u(){return!0}function d(e){return`${e}-${typeof crypto<`u`&&typeof crypto.randomUUID==`function`?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`}`}function f(e,t){try{let n=localStorage.getItem(e);if(n)return n;let r=t();return localStorage.setItem(e,r),r}catch{return t()}}function p(){let e=[`table`,`graph`,`video`],t=f(o,()=>{let t=Math.floor(Math.random()*e.length);return e[t]});return t===`table`||t===`graph`||t===`video`?t:`table`}async function m(e){if(u()){let r=f(i,()=>d(`preview-client`)),o=f(a,()=>d(`preview-participant`));return l(r),{participant_id:o,client_token:r,format_assignment:p(),session_id:d(`preview-session`),is_returning:!0,dataset_classification:e??`test`,formal_collection_allowed:!1,stimulus_set_version:t,catalog_hash:n}}let o=c(),s=await fetch(`${r}/bootstrap`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({client_token:o,dataset_classification:e})});if(!s.ok)throw Error(`Bootstrap failed: ${s.status}`);let m=await s.json();return l(m.client_token),m}async function h(e,t,n){if(u()){try{localStorage.setItem(`${s}${e}`,JSON.stringify({session_id:e,participant_id:t,payload:n,saved_at:new Date().toISOString()}))}catch{}return}let i=await fetch(`${r}/submit`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({session_id:e,participant_id:t,payload:n})});if(!i.ok)throw Error(`Submit failed: ${i.status}`)}var g={eyebrow:`学术研究`,title:`时间序列预测研究`,lead:`欢迎参与本项学术研究。接下来，您将查看若干组历史数值，并对下一期数值作出预测。`,detail:`每道题都会呈现前 20 期数据。请根据所呈现的信息，填写您对第 21 期数值的预测。`,duration:`约 5–10 分钟`,questionCount:`共 5 道预测题`,continueButton:`查看参与说明`},_={eyebrow:`步骤与说明`,title:`参与说明`,intro:`在本次研究中，您将经历以下步骤：`,viewLabel:`查看数据：`,viewText:`您将看到一组前 20 期历史数值信息。`,pointLabel:`预测数值：`,pointText:`根据这 20 期数据，请填写您对第 21 期数值的预测。`,distributionLabel:`最后一题：`,distributionText:`除了预测数值，您还需要填写 5 个您认为可能出现的数值，并为每个数值分配概率（总和为 100%）。`,backgroundLabel:`背景信息：`,backgroundText:`完成预测后，请填写一份简短的背景问卷。`,durationAndMethod:`整个过程大约需要 5 到 10 分钟。请根据自己的判断独立作答。`,backButton:`返回`,consentButton:`继续到参与确认`},v={title:`预测第 21 期`,helper:`请查看前 20 期历史数据并填写第 21 期预测值。`,pointLabel:`第 21 期预测值`},y=[`最低`,`较低`,`中等`,`较高`,`最高`],b={title:`可能结果与概率`,helper:`请按从小到大的顺序填写 5 个可能值（可相等），并为每个值分配概率；5 个概率之和须为 100%。`,guideSummary:`查看填写示例`,guideItems:[`从“最低”到“最高”依次填写 5 个可能值；相邻数值可以相等，但不能递减。`,`为每个可能值填写对应概率，5 个概率合计须为 100%。`],exampleNote:`以下数值仅用于说明填写格式，与本题答案无关，请勿照抄。`,exampleTableAriaLabel:`可能数值与概率填写示例`,exampleTotalLabel:`合计`,tableAriaLabel:`五个可能数值及对应概率`,levelHeader:`水平`,valueHeader:`可能数值`,probabilityHeader:`对应概率`,initialProbabilityTotal:`概率合计：0%（需为100%）`,initialOrder:`可能数值需按从小到大填写。`},x=[{level:`最低`,value:1,probability:10},{level:`较低`,value:2,probability:20},{level:`中等`,value:3,probability:40},{level:`较高`,value:4,probability:20},{level:`最高`,value:5,probability:10}];[...Object.values(g),...Object.values(_),...Object.values(v),b.title,b.helper,b.guideSummary,...b.guideItems,b.exampleNote,b.exampleTableAriaLabel,b.exampleTotalLabel,b.tableAriaLabel,b.levelHeader,b.valueHeader,b.probabilityHeader,b.initialProbabilityTotal,b.initialOrder,...x.flatMap(({level:e,value:t,probability:n})=>[e,String(t),`${n}%`]),...y];function S(e){let t=new URLSearchParams(e);return t.get(`preview`)===`1`||t.get(`debug`)===`1`?`test`:void 0}function C(e){let t=new URLSearchParams(e);if(!(t.get(`preview`)===`1`||t.get(`debug`)===`1`))return;let n=t.get(`format`);return n===`table`||n===`graph`||n===`video`?n:void 0}function w(e,t){return C(e)??t}async function T(e){try{return await e(),`success`}catch{return`unconfirmed`}}function E(e,t){let n=e===`success`;return`
    <main class="shell shell--success" data-completion-status="${e}">
      <section class="card">
        <p class="eyebrow">${n?`研究完成`:`提交状态尚未确认`}</p>
        <h1>${n?`感谢您的参与`:`请重新提交作答`}</h1>
        <p class="lead">${n?`您的作答已成功提交并保存。感谢您对本研究的支持。`:`我们暂时无法确认您的作答是否已保存。请保持本页面打开，检查网络后重新提交。重新提交不会产生重复记录。`}</p>
        <p>${n?`您现在可以关闭此页面。`:`在页面显示“已保存”前，请勿关闭此页面。若多次重试仍失败，可先下载本地备份并联系研究人员。`}</p>
        ${n?``:`
        <div class="submission-actions">
          <button id="retry-submit" class="button button--primary" type="button">重新提交</button>
          <p id="submission-feedback" class="helper-text" aria-live="polite"></p>
        </div>
      `}
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">已完成题目</span>
            <strong>${t} 题</strong>
          </div>
          <div class="summary-item">
            <span class="summary-label">提交状态</span>
            <strong>${n?`已保存`:`尚未确认`}</strong>
          </div>
        </div>

        <details class="export-panel text-left">
          <summary>研究人员下载入口</summary>
          <div class="export-panel__content">
            <p class="helper-text">${n?`以下文件仅用于本地留存或内部核查，不影响您已完成本次作答。`:`如需保留本地备份，可下载以下文件；下载不会替代服务器提交。`}</p>
            <div class="download-actions">
              <button id="download-json" class="button button--secondary" type="button">下载作答记录（JSON）</button>
              <button id="download-csv" class="button button--secondary" type="button">下载试次记录（CSV）</button>
            </div>
          </div>
        </details>
      </section>
    </main>
  `}var D=`modulepreload`,O=function(e){return`/multimodality-questionnaire-preview/`+e},k={},A=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href}r=o(t.map(t=>{if(t=O(t,n),t=s(t),t in k)return;k[t]=!0;let r=t.endsWith(`.css`);for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}let i=document.createElement(`link`);if(i.rel=r?`stylesheet`:D,r||(i.as=`script`),i.crossOrigin=``,i.href=t,a&&i.setAttribute(`nonce`,a),document.head.appendChild(i),r)return new Promise((e,n)=>{i.addEventListener(`load`,e),i.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},j=document.querySelector(`#app`);if(!j)throw Error(`App root #app not found.`);M(j),e();function M(e){e.innerHTML=`
    <main class="shell shell--landing">
      <section class="card hero">
        <p class="eyebrow">${g.eyebrow}</p>
        <h1>${g.title}</h1>
        <p class="lead">
          ${g.lead}
        </p>
        <p>
          ${g.detail}
        </p>
        <div class="research-meta" aria-label="研究概况">
          <span>${g.duration}</span>
          <span>${g.questionCount}</span>
        </div>
        <div class="page-actions">
          <button id="next-instructions" class="button button--primary">${g.continueButton}</button>
        </div>
      </section>
    </main>
  `,e.querySelector(`#next-instructions`)?.addEventListener(`click`,()=>N(e))}function N(e){e.innerHTML=`
    <main class="shell shell--landing">
      <section class="card hero">
        <p class="eyebrow">${_.eyebrow}</p>
        <h1>${_.title}</h1>
        <div class="instructions-content text-left">
          <p>${_.intro}</p>
          <ul class="bullet-list">
            <li><strong>${_.viewLabel}</strong> ${_.viewText}</li>
            <li><strong>${_.pointLabel}</strong> ${_.pointText}</li>
            <li><strong>${_.distributionLabel}</strong> ${_.distributionText}</li>
            <li><strong>${_.backgroundLabel}</strong> ${_.backgroundText}</li>
          </ul>
          <p>${_.durationAndMethod}</p>
        </div>
        <div class="button-row page-actions page-actions--split">
          <button id="back-landing" class="button button--secondary">${_.backButton}</button>
          <button id="next-consent" class="button button--primary">${_.consentButton}</button>
        </div>
      </section>
    </main>
  `,e.querySelector(`#back-landing`)?.addEventListener(`click`,()=>M(e)),e.querySelector(`#next-consent`)?.addEventListener(`click`,()=>P(e))}function P(e){e.innerHTML=`
    <main class="shell shell--landing">
      <section class="card hero">
        <p class="eyebrow">参与研究</p>
        <h1>参与确认</h1>
        <div class="consent-content consent-box text-left">
          <dl class="consent-list">
            <div><dt>参与时长</dt><dd>约 5–10 分钟。</dd></div>
            <div><dt>自愿参与及退出</dt><dd>您的参与完全自愿。您有权在任何时候中止参与，不会产生任何不利后果。</dd></div>
            <div><dt>数据保密性</dt><dd>本研究所收集的所有数据将仅用于学术分析，完全匿名化处理，不会包含或泄露您的任何个人身份信息。</dd></div>
          </dl>
          <div class="consent-check-wrap">
            <label class="consent-check">
              <input type="checkbox" id="consent-checkbox" />
              <span>我已阅读并理解上述内容，同意参与本研究</span>
            </label>
          </div>
        </div>
        <div class="button-row page-actions page-actions--split">
          <button id="back-instructions" class="button button--secondary">返回</button>
          <button id="start-experiment" class="button button--primary" disabled>开始答题</button>
        </div>
      </section>
    </main>
  `;let t=e.querySelector(`#consent-checkbox`),n=e.querySelector(`#start-experiment`),r=e.querySelector(`#back-instructions`),i=e.querySelector(`.page-actions--split`),a=window.matchMedia(`(max-width: 720px)`),o=()=>{!i||!n||!r||(a.matches?i.append(n,r):i.append(r,n))},s=()=>{a.removeEventListener(`change`,o)};o(),a.addEventListener(`change`,o),t?.addEventListener(`change`,e=>{n&&(n.disabled=!e.target.checked)}),r?.addEventListener(`click`,()=>{s(),N(e)}),n?.addEventListener(`click`,()=>{n.disabled=!0,n.textContent=`正在连接服务器…`,Promise.all([m(S(window.location.search)),A(()=>import(`./buildExperiment-CaEqqwN_.js`),__vite__mapDeps([0,1]))]).then(([t,{startExperiment:n}])=>{let r=t.catalog_hash===`e435368f72846b356aa2f5106b47dfe1c35dbc65012125eefa199ed53e93a7ec`&&t.stimulus_set_version===`mmq-stimuli-2026-07-r1`,i=t.formal_collection_allowed===!0&&t.dataset_classification===`formal`&&r;n({mount:e,formatAssignment:w(window.location.search,t.format_assignment),participantId:t.participant_id,sessionId:t.session_id,datasetClassification:i?`formal`:`test`,formalCollectionAllowed:i,onComplete:n=>{F(e),I(e,n,()=>h(t.session_id,t.participant_id,n))}}),s()}).catch(e=>{console.error(`Bootstrap failed:`,e),n.disabled=!1,n.textContent=`开始答题`,alert(`无法连接到服务器，请确保后端已启动后重试。`)})})}function F(e){e.innerHTML=`
    <main class="shell shell--success">
      <section class="card submission-status" role="status" aria-live="polite">
        <p class="eyebrow">正在提交</p>
        <h1>正在保存您的作答</h1>
        <p class="lead">请保持此页面打开，提交完成后页面会自动更新。</p>
      </section>
    </main>
  `}async function I(e,t,n){L(e,t,await T(n),n)}function L(e,t,n,r){e.innerHTML=E(n,t.trials.length);let i=e.querySelector(`#retry-submit`),a=e.querySelector(`#submission-feedback`);i?.addEventListener(`click`,async()=>{if(i.dataset.pending===`true`)return;i.dataset.pending=`true`,i.disabled=!0,i.textContent=`正在重新提交…`,a&&(a.textContent=`正在确认提交状态，请保持页面打开。`);let n=await T(r);if(n===`success`){L(e,t,n,r);return}i.dataset.pending=`false`,i.disabled=!1,i.textContent=`重新提交`,a&&(a.textContent=`仍未能确认提交状态。请检查网络后再次尝试，或下载本地备份并联系研究人员。`)}),e.querySelector(`#download-json`)?.addEventListener(`click`,()=>{B(JSON.stringify(t,null,2),`experiment_data_${t.session.session_id}.json`,`application/json;charset=utf-8`)}),e.querySelector(`#download-csv`)?.addEventListener(`click`,async()=>{let{trialCsvHeaders:e}=await A(async()=>{let{trialCsvHeaders:e}=await import(`./buildExperiment-CaEqqwN_.js`);return{trialCsvHeaders:e}},__vite__mapDeps([0,1]));B(R(t,e),`experiment_trials_${t.session.session_id}.csv`,`text/csv;charset=utf-8`)})}function R(e,t){let n=e.trials.map(e=>t.map(t=>z(e[t])).join(`,`));return[t.join(`,`),...n].join(`\r
`)}function z(e){if(e==null)return``;let t=String(e).replaceAll(`"`,`""`);return/[",\n\r]/.test(t)?`"${t}"`:t}function B(e,t,n){let r=n.includes(`text/csv`)?`\uFEFF${e}`:e,i=new Blob([r],{type:n}),a=URL.createObjectURL(i),o=document.createElement(`a`);o.href=a,o.download=t,document.body.appendChild(o),o.click(),o.remove(),window.setTimeout(()=>URL.revokeObjectURL(a),0)}export{v as i,x as n,y as r,b as t};