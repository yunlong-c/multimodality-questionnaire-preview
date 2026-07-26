import{i as e,n as t,r as n,t as r}from"./questionnaire-BEL6Msi2.js";import{n as i,r as a,t as o}from"./stimulus-catalog-C-pLEACp.js";var s=`html-table-v4-unified-dual-panel`;function c(e){if(e.length!==20)throw Error(`HTML table renderer expected 20 values, found ${e.length}.`);return`
    <div
      class="series-table-grid"
      role="group"
      aria-label="第 1 至第 20 期历史数据"
    >
      ${l(e.slice(0,10),1,10)}
      ${l(e.slice(10,20),11,20)}
    </div>
  `}function l(e,t,n){let r=`series-table-range-${t}-${n}`;return`
    <div
      class="series-table-panel"
      data-period-start="${t}"
      data-period-end="${n}"
    >
      <div class="series-table-range" id="${r}">
        第${t}–${n}期
      </div>
      <table class="series-table" aria-labelledby="${r}">
        <thead>
          <tr>
            <th scope="col">时期</th>
            <th scope="col">数值</th>
          </tr>
        </thead>
        <tbody>${e.map((e,n)=>`
        <tr data-period="${t+n}">
          <th scope="row">${t+n}</th>
          <td><span class="series-table-number">${u(e)}</span></td>
        </tr>
      `).join(``)}</tbody>
      </table>
    </div>
  `}function u(e){if(!Number.isFinite(e))throw Error(`HTML table renderer received a non-finite value.`);return e.toFixed(2)}var d={Pool_1:80,Pool_2:64,Pool_3:64,Pool_4:64};function f(e,t,n){if(t!==`mmq-stimuli-2026-07-r1`)throw Error(`Unexpected stimulus set version '${t}'.`);if(!/^[a-f0-9]{64}$/i.test(n))throw Error(`Catalog hash is missing or is not a SHA-256 digest.`);let r=Object.values(d).reduce((e,t)=>e+t,0);if(e.length!==r)throw Error(`Catalog release gate failed: expected ${r} sequences, found ${e.length}.`);let i=new Set,a=new Set,o=new Set,s=new Map,c=new Map,l=new Map;for(let n of e){if(n.stimulus_set_version!==t)throw Error(`${n.sequence_uid} has a mismatched stimulus set version.`);if(i.has(n.sequence_uid))throw Error(`Duplicate sequence_uid '${n.sequence_uid}'.`);if(a.has(n.canonical_key))throw Error(`Duplicate canonical_key '${n.canonical_key}'.`);if(i.add(n.sequence_uid),a.add(n.canonical_key),!Number.isInteger(n.source_id)||!Number.isInteger(n.display_index)||!Number.isInteger(n.legacy_asset_no))throw Error(`${n.sequence_uid} has a non-integer catalog identifier.`);p(n);let e=`${n.pool}:${n.variant}`;if(m(s,e,n.source_id,`source_id`),m(c,e,n.display_index,`display_index`),m(l,e,n.legacy_asset_no,`legacy_asset_no`),n.values.length!==20||n.values.some(e=>!Number.isFinite(e)))throw Error(`${n.sequence_uid} must contain exactly 20 finite values.`);if(!/^[a-f0-9]{64}$/i.test(n.values_sha256))throw Error(`${n.sequence_uid} has an invalid values_sha256.`);v(n);for(let e of[`table`,`graph`,`video`]){let t=n.presentations[e];y(n,t,e,o)}}for(let[t,n]of Object.entries(d)){let r=e.filter(e=>e.pool===t).length;if(r!==n)throw Error(`Catalog release gate failed for ${t}: expected ${n}, found ${r}.`)}}function p(e){let t=e.pool===`Pool_2`;if(t&&e.variant!==`fast`&&e.variant!==`slow`)throw Error(`${e.sequence_uid} has an invalid Pool 2 variant.`);if(!t&&e.variant!==`base`)throw Error(`${e.sequence_uid} must use the base variant.`);let n=t&&e.variant===`fast`?e.source_id:e.display_index;if(e.legacy_asset_no!==n)throw Error(`${e.sequence_uid} violates the frozen legacy asset-number rule.`)}function m(e,t,n,r){let i=e.get(t)??new Set;if(i.has(n))throw Error(`Duplicate ${r} '${n}' in catalog scope '${t}'.`);i.add(n),e.set(t,i)}function h(e,t,n,r){f(e,n,r);let i=b(g(e,`Pool_1`,`point_only`)),a=b(g(e,`Pool_2`,`point_only`)),o=b(g(e,`Pool_3`,`point_only`)),s=b(g(e,`Pool_4`,`point_only`)),c=b(g(e,`Pool_1`,`point_spd`).filter(e=>e.sequence_uid!==i.sequence_uid));return[_(i,t,`point_only`,1,r),_(a,t,`point_only`,2,r),_(o,t,`point_only`,3,r),_(s,t,`point_only`,4,r),_(c,t,`point_spd`,5,r)]}function g(e,t,n){let r=e.filter(e=>e.pool===t&&e.response_eligibility.includes(n));if(r.length===0)throw Error(`No ${t} sequence is eligible for '${n}'.`);return r}function _(e,t,n,r,i){let a=e.presentations[t],o=t!==`table`;return{trial_no:r,stimulus_set_version:e.stimulus_set_version,catalog_hash:i,sequence_uid:e.sequence_uid,canonical_key:e.canonical_key,presentation_uid:a.presentation_uid,pool:e.pool,variant:e.variant,source_id:e.source_id,display_index:e.display_index,legacy_asset_no:e.legacy_asset_no,pair_uid:e.pair_uid,response_type:n,format:t,values:e.values,values_sha256:e.values_sha256,legacy_path:a.legacy_path,legacy_asset_sha256:a.asset_sha256,asset_sha256:o?a.asset_sha256:null,renderer_version:o?null:s,terminal_frame_path:a.terminal_frame_path??null,terminal_frame_sha256:a.terminal_frame_sha256??null,reveal_duration_ms:a.reveal_duration_ms??null,pool2_speed:e.pool===`Pool_2`&&e.variant!==`base`?e.variant:null,source_data_file:e.source_data_file,metadata:e.metadata??{}}}function v(e){let t=e.pool===`Pool_1`?[`point_only`,`point_spd`]:[`point_only`],n=[...e.response_eligibility].sort();if(n.length!==t.length||t.some(e=>!n.includes(e)))throw Error(`${e.sequence_uid} has invalid response eligibility: ${n.join(`, `)}.`)}function y(e,t,n,r){if(!t||t.format!==n)throw Error(`${e.sequence_uid} is missing its ${n} presentation.`);if(r.has(t.presentation_uid))throw Error(`Duplicate presentation_uid '${t.presentation_uid}'.`);if(r.add(t.presentation_uid),!t.legacy_path||!/^[a-f0-9]{64}$/i.test(t.asset_sha256))throw Error(`${t.presentation_uid} has incomplete legacy asset provenance.`);if(n===`table`&&!t.renderer_version)throw Error(`${t.presentation_uid} has no HTML renderer version.`)}function b(e){if(e.length===0)throw Error(`Cannot sample from an empty sequence set.`);return e[Math.floor(Math.random()*e.length)]}function x(e){return h(i,e,a,o)}var S=[`s1`,`s2`,`s3`,`s4`,`s5`],C=[`p1`,`p2`,`p3`,`p4`,`p5`],w=[`point`,...S,...C];function T(){return{point:``,s1:``,s2:``,s3:``,s4:``,s5:``,p1:``,p2:``,p3:``,p4:``,p5:``}}function ee(){return{draft:T(),finalAnswer:null,finalAnswerSignature:null,firstStartedAt:null,finalSubmittedAt:null,durationMs:0,visitCount:0,revisionCount:0,fullscreenOpenCount:0,fullscreenDurationMs:0,videoRevealCompleted:!1,videoReplayUsed:!1}}function E(e,t){e.visitCount+=1,e.firstStartedAt??=t}function te(e,t){!Number.isFinite(t)||t<=0||(e.durationMs+=t)}function D(e,t,n){Number.isInteger(t)&&t>0&&(e.fullscreenOpenCount+=t),Number.isFinite(n)&&n>0&&(e.fullscreenDurationMs+=n)}function O(e,t){let n=A(t.point,`point`);if(e===`point_only`)return{point:n,s1:null,s2:null,s3:null,s4:null,s5:null,p1:null,p2:null,p3:null,p4:null,p5:null,sumS:null,sumP:null};let r=S.map(e=>A(t[e],e)),i=C.map(e=>A(t[e],e));return{point:n,s1:r[0],s2:r[1],s3:r[2],s4:r[3],s5:r[4],p1:i[0],p2:i[1],p3:i[2],p4:i[3],p5:i[4],sumS:r.reduce((e,t)=>e+t,0),sumP:i.reduce((e,t)=>e+t,0)}}function k(e,t,n){let r=JSON.stringify(t);e.finalAnswerSignature!==null&&e.finalAnswerSignature!==r&&(e.revisionCount+=1),e.finalAnswer=t,e.finalAnswerSignature=r,e.finalSubmittedAt=n}function A(e,t){let n=Number(e);if(e.trim()===``||!Number.isFinite(n))throw Error(`Cannot finalize invalid trial field: ${t}`);return n}function j(){return`https://raw.githubusercontent.com/yunlong-c/multimodality-questionnaire-preview/main/frontend/public`.replace(/\/+$/,``)}function M(e){if(/^(?:https?:|data:|blob:)/i.test(e))return e;let t=e.replace(/^\/+/,``),n=j();return n?`${n}/${t}`:`${`/multimodality-questionnaire-preview/`.replace(/\/+$/,``)}/${t}`}async function N({preload:e,present:t,onReady:n}){await e(),await t(),n()}function P(e,t,n={}){if(!t.trim())return Promise.reject(Error(`Video asset URL is empty.`));let{signal:r,clearOnAbort:i=!1}=n;return new Promise((n,a)=>{let o=!1,s=()=>{e.removeEventListener(`load`,l),e.removeEventListener(`error`,u),r?.removeEventListener(`abort`,d)},c=e=>{o||(o=!0,s(),e())},l=()=>{c(n)},u=()=>{c(()=>a(Error(`Unable to load video asset: ${t}`)))},d=()=>{i&&e.removeAttribute(`src`);let t=Error(`Video asset loading was cancelled.`);t.name=`AbortError`,c(()=>a(t))};if(r?.aborted){d();return}e.addEventListener(`load`,l,{once:!0}),e.addEventListener(`error`,u,{once:!0}),r?.addEventListener(`abort`,d,{once:!0}),e.src=t,e.complete&&queueMicrotask(()=>{e.naturalWidth>0?l():u()})})}function ne(e,t){return P(new Image,e,{signal:t,clearOnAbort:!0})}function F(e,t=`${Date.now()}`){return`${e}${e.includes(`#`)?`&`:`#`}playback=${encodeURIComponent(t)}`}function I(t){let n=K()?`<div class="stimulus-debug-label">${J(q(t))}</div>`:``,r=t.trial_no/5*100;return`
    <div class="trial-header">
      <div class="trial-progress">
        <span>第 ${t.trial_no} / 5 题</span>
        <div class="trial-progress__track" aria-hidden="true">
          <span style="width: ${r}%"></span>
        </div>
      </div>
      <h2>${e.title}</h2>
      <p class="helper-text">${e.helper}</p>
      ${n}
    </div>
  `}function L(i){let a=V(i),o=`
    <label class="field field--point" for="point-prediction">
      <span class="field-label">${e.pointLabel}</span>
      <input
        id="point-prediction"
        type="number"
        step="0.1"
        inputmode="decimal"
        name="point"
        autocomplete="off"
        required
      />
    </label>
  `,s=i.response_type===`point_spd`?`
        <section class="field-group field-group--distribution" aria-labelledby="distribution-title">
          <div class="section-heading">
            <h3 id="distribution-title">${r.title}</h3>
            <p class="helper-text">${r.helper}</p>
          </div>
          <details class="example-panel">
            <summary>${r.guideSummary}</summary>
            <div class="example-panel__content">
              <ul class="bullet-list">
                ${r.guideItems.map(e=>`<li>${e}</li>`).join(``)}
              </ul>
              <p class="distribution-example-note">${r.exampleNote}</p>
              <table class="distribution-example-table" aria-label="${r.exampleTableAriaLabel}">
                <thead>
                  <tr>
                    <th scope="col">${r.levelHeader}</th>
                    <th scope="col">${r.valueHeader}</th>
                    <th scope="col">${r.probabilityHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  ${t.map(({level:e,value:t,probability:n})=>`
                      <tr>
                        <th scope="row">${e}</th>
                        <td>${t}</td>
                        <td>${n}%</td>
                      </tr>
                    `).join(``)}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">${r.exampleTotalLabel}</th>
                    <td>—</td>
                    <td>100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>
          <div class="distribution-table" role="group" aria-label="${r.tableAriaLabel}">
            <div class="distribution-row distribution-row--header" aria-hidden="true">
              <div>${r.levelHeader}</div>
              <div>${r.valueHeader}</div>
              <div>${r.probabilityHeader}</div>
            </div>
            ${n.map((e,t)=>({label:e,supportName:`s${t+1}`,probabilityName:`p${t+1}`})).map(({label:e,supportName:t,probabilityName:n})=>`
                  <div class="distribution-row">
                    <div class="distribution-level">${e}</div>
                    <div>
                      <label class="sr-only" for="${t}">${e}可能数值</label>
                      <input
                        id="${t}"
                        type="number"
                        step="0.1"
                        inputmode="decimal"
                        name="${t}"
                        aria-label="${e}可能数值"
                        autocomplete="off"
                        required
                      />
                    </div>
                    <div class="probability-input">
                      <label class="sr-only" for="${n}">${e}对应概率</label>
                      <input
                        id="${n}"
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        inputmode="decimal"
                        name="${n}"
                        aria-label="${e}对应概率"
                        autocomplete="off"
                        required
                      />
                      <span aria-hidden="true">%</span>
                    </div>
                  </div>
                `).join(``)}
          </div>
          <div class="distribution-feedback" aria-live="polite">
            <p data-probability-total>${r.initialProbabilityTotal}</p>
            <p data-support-order>${r.initialOrder}</p>
          </div>
        </section>
      `:``;return`
    <div class="trial-shell" data-response-type="${i.response_type}">
      ${a}
      <section class="field-group field-group--point">
        ${o}
      </section>
      ${s}
    </div>
  `}function R(){return`
    <div class="demographics-container demographics-panel">
      <section class="demographic-row">
        <fieldset class="field fieldset-reset demographic-field">
          <legend class="demo-label">您的性别</legend>
          <div class="choice-row">
            <label class="radio-label"><input type="radio" name="gender" value="男" required /> <span>男</span></label>
            <label class="radio-label"><input type="radio" name="gender" value="女" required /> <span>女</span></label>
          </div>
        </fieldset>
      </section>
      <section class="demographic-row">
        <label class="field demographic-field">
          <span class="demo-label">您的年龄</span>
          <input type="number" step="1" min="1" inputmode="numeric" name="age" required />
        </label>
      </section>
      <section class="demographic-row">
        <label class="field demographic-field">
          <span class="demo-label">您的受教育程度</span>
          <select name="education" required>
            <option value="">请选择</option>
            <option value="高中及以下">高中及以下</option>
            <option value="大专/高职">大专 / 高职</option>
            <option value="本科">本科</option>
            <option value="硕士">硕士</option>
            <option value="博士">博士</option>
          </select>
        </label>
      </section>
      <section class="demographic-row">
        <label class="field demographic-field">
          <span class="demo-label">您在数据分析或数值判断方面的经验如何？</span>
          <select name="experience" required>
            <option value="">请选择</option>
            <option value="毫无经验">毫无经验</option>
            <option value="有一些经验">有一些经验</option>
            <option value="中等经验">中等经验</option>
            <option value="非常丰富的经验">非常丰富的经验</option>
          </select>
        </label>
      </section>
      <section class="demographic-row">
        <label class="field demographic-field">
          <span class="demo-label">您是否修读过统计学或相关课程？</span>
          <select name="stat_course" required>
            <option value="">请选择</option>
            <option value="是">是</option>
            <option value="否">否</option>
          </select>
        </label>
      </section>
    </div>
  `}function z(e,t,n){let r=H(),i=[r.cleanup];if(e.format===`video`){let r=document.querySelector(`[data-video-stimulus]`),a=r?.querySelector(`[data-video-image]`),o=r?.querySelector(`[data-video-replay]`),s=r?.querySelector(`[data-video-retry]`),c=r?.querySelector(`[data-video-loading]`),l=r?.querySelector(`[data-video-loading-text]`),u=r?.querySelector(`[data-video-status]`);if(a&&o&&s){let r=a.dataset.gifSrc,d=a.dataset.terminalFrameSrc,f=e.reveal_duration_ms,p=null,m=null,h=0,g=null,_=()=>{d&&a.isConnected&&(a.src=d),a.hidden=!1,a.removeAttribute(`aria-busy`)},v=()=>{_(),n(!1),g=null,s.hidden=!0,s.disabled=!0,c&&(c.hidden=!0),t.videoReplayUsed?(o.hidden=!1,o.disabled=!0,o.textContent=`重播已使用`,u&&(u.textContent=`本题的重播机会已使用。`)):(o.hidden=!1,o.disabled=!1,o.textContent=`重播一次`,u&&(u.textContent=`历史数据已完整呈现，可选择重播一次。`))},y=()=>{t.videoRevealCompleted=!0,v()},b=e=>{p!==null&&window.clearTimeout(p),f!==null&&f>0?p=window.setTimeout(()=>{p=null,e()},f):e()},x=e=>{g=e,a.hidden=!0,a.removeAttribute(`src`),a.setAttribute(`aria-busy`,`false`),c&&(c.hidden=!1),l&&(l.textContent=`动画加载失败`),s.hidden=!1,s.disabled=!1,s.textContent=`重新加载`,o.hidden=e===`initial`,o.disabled=!0,u&&(u.textContent=e===`initial`?`动画未能加载。请检查网络后重新加载；完成呈现前不能翻页。`:`重播未能加载。请检查网络后重新加载，或继续作答。`)},S=async e=>{if(!r){x(e);return}m?.abort(),m=new AbortController;let{signal:t}=m;h+=1,g=null,p!==null&&(window.clearTimeout(p),p=null),e===`initial`?(n(!0),o.hidden=!0):(o.hidden=!1,o.disabled=!0,o.textContent=`重播已使用`),a.hidden=!0,a.setAttribute(`aria-busy`,`true`),s.hidden=!0,s.disabled=!0,c&&(c.hidden=!1),l&&(l.textContent=e===`initial`?`动画正在加载`:`正在准备重播`),u&&(u.textContent=e===`initial`?`动画正在加载，加载完成后将自动开始。`:`正在准备重播；您可以继续作答或离开本题。`);try{let n=F(r,`${Date.now()}-${h}`);await N({preload:()=>ne(r,t),present:async()=>{t.aborted||!a.isConnected||await P(a,n,{signal:t,clearOnAbort:!0})},onReady:()=>{t.aborted||!a.isConnected||(a.hidden=!1,a.setAttribute(`aria-busy`,`false`),c&&(c.hidden=!0),u&&(u.textContent=e===`initial`?`历史数据正在呈现，请完整查看。`:`历史数据正在重新呈现；您可以继续作答或离开本题。`),b(e===`initial`?y:v))}})}catch(n){if(t.aborted||n instanceof Error&&n.name===`AbortError`)return;x(e)}},C=()=>{t.videoReplayUsed||!r||(t.videoReplayUsed=!0,o.hidden=!1,o.disabled=!0,o.textContent=`重播已使用`,u&&(u.textContent=`正在准备重播；您可以继续作答或离开本题。`),S(`replay`))},w=()=>{g&&S(g)};t.videoRevealCompleted?v():(n(!0),o.hidden=!0,o.disabled=!0,u&&(u.textContent=`动画正在加载，加载完成后将自动开始。`),S(`initial`)),o.addEventListener(`click`,C),s.addEventListener(`click`,w),i.push(()=>{o.removeEventListener(`click`,C),s.removeEventListener(`click`,w),m?.abort(),p!==null&&window.clearTimeout(p)})}}else n(!1);return{snapshot:r.snapshot,cleanup:()=>{for(let e of i.reverse())e()}}}function B(e,t){let n=S.map(e=>t.elements.namedItem(e)).filter(e=>e!==null),r=C.map(e=>t.elements.namedItem(e)).filter(e=>e!==null),i=t.querySelector(`[data-probability-total]`),a=t.querySelector(`[data-support-order]`),o=()=>n.map(e=>G(e.value)),s=()=>r.map(e=>G(e.value)),c=()=>{if(e.response_type!==`point_spd`)return;let t=o(),n=s(),r=n.reduce((e,t)=>e+(t??0),0),c=n.every(e=>e!==null),l=c&&Math.abs(r-100)<=.001;i&&(i.textContent=`概率合计：${W(r)}%（需为100%）`,i.dataset.state=l?`valid`:c?`invalid`:`neutral`);let u=t.every(e=>e!==null),d=u&&t.every((e,n)=>n===0||t[n-1]<=e);a&&(a.textContent=u?d?`数值顺序符合从小到大的要求。`:`请检查数值顺序：后一个数值不能小于前一个。`:`可能数值需按从小到大填写。`,a.dataset.state=d?`valid`:u?`invalid`:`neutral`)},l=()=>{let i=U(t);if(i.textContent=``,!t.reportValidity())return!1;if(e.response_type!==`point_spd`)return!0;let a=o(),c=s();if(a.some(e=>e===null)||c.some(e=>e===null))return i.textContent=`请先完成所有可能数值和概率值的填写，再继续下一步。`,[...n,...r].find(e=>e.value.trim()===``)?.focus(),!1;for(let e=1;e<a.length;e+=1)if(a[e-1]>a[e])return i.textContent=`请确保 5 个可能数值按从小到大的顺序填写，可相等但不能递减。`,n[e]?.focus(),!1;let l=c.reduce((e,t)=>e+(t??0),0);return Math.abs(l-100)>.001?(i.textContent=`请确保 5 个概率值的总和正好为 100%。当前合计为 ${W(l)}%。`,r[0]?.focus(),!1):!0};for(let e of[...n,...r])e.addEventListener(`input`,c);return c(),{validate:l,refresh:c,cleanup:()=>{for(let e of[...n,...r])e.removeEventListener(`input`,c)}}}function V(e){let t=`历史数据`;if(e.format===`table`)return`
      <section class="stimulus stimulus--table">
        <div class="stimulus-caption">${t}</div>
        ${c(e.values)}
      </section>
    `;let n=M(e.legacy_path);if(e.format===`graph`)return`
      <section class="stimulus stimulus--graph stimulus--media">
        <div class="stimulus-caption">${t}</div>
        <div class="stimulus-media-frame">
          <img
            src="${J(n)}"
            alt="前 20 期历史数据折线图"
            class="series-image"
            role="button"
            tabindex="0"
            aria-label="全屏查看前 20 期历史数据折线图"
            data-fullscreen-media
            data-fullscreen-label="历史数据折线图"
          />
        </div>
        <p class="media-hint">点击图像可全屏查看</p>
      </section>
    `;let r=e.terminal_frame_path?M(e.terminal_frame_path):``,i=e.reveal_duration_ms!==null&&e.reveal_duration_ms>0;return`
    <section
      class="stimulus stimulus--video stimulus--media"
      data-video-stimulus
      data-reveal-duration-ms="${e.reveal_duration_ms??``}"
    >
      <div class="stimulus-caption">${t}</div>
      <div class="stimulus-media-frame video-card">
        <div class="video-loading-panel" data-video-loading>
          <span class="video-loading-spinner" aria-hidden="true"></span>
          <span data-video-loading-text>动画正在加载</span>
        </div>
        <img
          alt="逐步呈现前 20 期历史数据的动画"
          class="series-image"
          role="button"
          tabindex="0"
          aria-label="全屏查看逐步呈现的历史数据动画"
          data-fullscreen-media
          data-fullscreen-label="历史数据动画"
          data-video-image
          data-gif-src="${J(n)}"
          data-terminal-frame-src="${J(r)}"
          aria-busy="true"
          hidden
        />
      </div>
      <p class="media-hint">点击动画可全屏查看</p>
      <button
        type="button"
        class="video-replay-button"
        data-video-replay
        ${i?`hidden`:``}
      >
        重播一次
      </button>
      <button
        type="button"
        class="video-replay-button"
        data-video-retry
        hidden
        disabled
      >
        重新加载
      </button>
      <p class="video-replay-status helper-text" data-video-status aria-live="polite">
        ${i?`动画正在加载，加载完成后将自动开始。`:``}
      </p>
    </section>
  `}function H(){let e=document.querySelector(`[data-fullscreen-media]`);if(!e)return{snapshot:()=>({fullscreenOpenCount:0,fullscreenDurationMs:0}),cleanup:()=>void 0};let t=0,n=0,r=null,i=null,a=null,o=null,s=!1,c=()=>r===null?n:n+Math.max(0,performance.now()-r),l=()=>{i&&(r!==null&&(n+=Math.max(0,performance.now()-r),r=null),a?.isConnected&&a.replaceWith(e),e.classList.remove(`series-image--fullscreen`),i.remove(),i=null,a=null,document.body.classList.remove(`media-lightbox-open`),window.removeEventListener(`keydown`,d),window.removeEventListener(`popstate`,f),o?.focus({preventScroll:!0}))},u=e=>{i&&(l(),e&&s?(s=!1,window.history.back()):s=!1)},d=e=>{e.key===`Escape`&&(e.preventDefault(),u(!0))},f=()=>{i&&u(!1)},p=()=>{if(i||!e.parentElement)return;t+=1,r=performance.now(),o=document.activeElement instanceof HTMLElement?document.activeElement:e;let n=e.getBoundingClientRect();a=document.createElement(`div`),a.className=`media-placeholder`,a.style.height=`${n.height}px`,e.parentElement.insertBefore(a,e),i=document.createElement(`div`),i.className=`media-lightbox`,i.setAttribute(`role`,`dialog`),i.setAttribute(`aria-modal`,`true`),i.setAttribute(`aria-label`,e.dataset.fullscreenLabel?`全屏查看${e.dataset.fullscreenLabel}`:`全屏查看历史数据`),i.innerHTML=`
      <button type="button" class="media-lightbox__close" aria-label="关闭全屏查看">
        关闭
      </button>
      <div class="media-lightbox__stage"></div>
      <p class="media-lightbox__hint">可使用双指缩放查看细节</p>
    `;let c=i.querySelector(`.media-lightbox__stage`),l=i.querySelector(`.media-lightbox__close`);if(!c||!l){i.remove(),i=null,a.remove(),a=null,r=null;return}e.classList.add(`series-image--fullscreen`),c.appendChild(e),document.body.appendChild(i),document.body.classList.add(`media-lightbox-open`),l.addEventListener(`click`,()=>u(!0),{once:!0}),i.addEventListener(`click`,e=>{(e.target===i||e.target===c)&&u(!0)}),window.addEventListener(`keydown`,d),window.addEventListener(`popstate`,f),window.history.pushState({mmq_media_lightbox:!0},document.title,window.location.href),s=!0,l.focus()},m=()=>p(),h=e=>{(e.key===`Enter`||e.key===` `)&&(e.preventDefault(),p())};return e.addEventListener(`click`,m),e.addEventListener(`keydown`,h),{snapshot:()=>({fullscreenOpenCount:t,fullscreenDurationMs:Math.round(c())}),cleanup:()=>{e.removeEventListener(`click`,m),e.removeEventListener(`keydown`,h),i&&u(!0)}}}function U(e){let t=e.querySelector(`#trial-validation-message`);if(t)return t;let n=document.createElement(`div`);n.id=`trial-validation-message`,n.className=`validation-error`,n.setAttribute(`role`,`alert`);let r=e.querySelector(`[data-questionnaire-navigation]`);return r?r.before(n):e.appendChild(n),n}function W(e){return Number.isInteger(e)?String(e):e.toFixed(1).replace(/\.0$/,``)}function G(e){if(e==null||e.trim()===``)return null;let t=Number(e);return Number.isFinite(t)?t:null}function K(){let e=new URLSearchParams(window.location.search).get(`debug`);return e===`1`||e===`true`}function q(e){return`${e.pool===`Pool_2`?e.variant===`fast`?`P2-F`:`P2-S`:e.pool.replace(`Pool_`,`P`)} / ID${String(e.source_id).padStart(3,`0`)} / 顺序${String(e.display_index).padStart(3,`0`)} / 文件${String(e.legacy_asset_no).padStart(3,`0`)}`}function J(e){return e.replaceAll(`&`,`&amp;`).replaceAll(`"`,`&quot;`).replaceAll(`<`,`&lt;`).replaceAll(`>`,`&gt;`)}function Y(e,t=5){if(!Number.isInteger(e)||!Number.isInteger(t)||t<=0||e<0||e>=t)throw Error(`Trial navigation index is out of range.`);return{showPrevious:e>0,forwardLabel:e===t-1?`下一页`:`下一题`}}function X({mount:e,formatAssignment:t,participantId:n,sessionId:r,datasetClassification:i,formalCollectionAllowed:a,onComplete:o}){let s=new Date().toISOString(),c=x(t),l=c.map(()=>ee()),u=a&&i===`formal`?`formal`:`test`;e.innerHTML=`
    <main class="shell">
      <section class="card card--experiment">
        <div id="questionnaire-host" class="questionnaire-host"></div>
      </section>
    </main>
  `;let d=e.querySelector(`#questionnaire-host`);if(!d)throw Error(`Questionnaire display element not found.`);let f=null,p=null,m=null,h=null,g=!1,_=null,v=0,y=!1,b=()=>{if(h===null)return;let e=Math.max(0,performance.now()-h);f===null?g&&(v+=e):te(l[f],e),h=null},S=()=>{h===null&&document.visibilityState===`visible`&&(f!==null||g)&&(h=performance.now())},C=()=>{document.visibilityState===`hidden`?b():S()};document.addEventListener(`visibilitychange`,C);let w=e=>{if(f===null)return;l[f].draft=Z(e),b();let t=p?.snapshot();t&&D(l[f],t.fullscreenOpenCount,t.fullscreenDurationMs),p?.cleanup(),m?.cleanup(),p=null,m=null,f=null},T=()=>{_=new Date().toISOString(),g=!0,h=null,d.innerHTML=`
      <div class="jspsych-content-wrapper">
        <div class="jspsych-content">
          <div class="jspsych-survey-html-form-preamble">
            <div class="demographic-header">
              <p class="eyebrow">背景问卷</p>
              <h2>基本信息</h2>
            </div>
          </div>
          <form id="jspsych-survey-html-form">
            ${R()}
            <div class="questionnaire-navigation questionnaire-navigation--single" data-questionnaire-navigation>
              <button id="jspsych-survey-html-form-next" class="button button--primary" type="submit">
                提交并完成
              </button>
            </div>
          </form>
        </div>
      </div>
    `;let e=d.querySelector(`#jspsych-survey-html-form`),i=d.querySelector(`#jspsych-survey-html-form-next`);if(!e||!i)throw Error(`Demographic form failed to render.`);let f=!1;e.addEventListener(`submit`,d=>{if(d.preventDefault(),f||!e.reportValidity())return;f=!0,i.disabled=!0,b(),g=!1,y=!0,document.removeEventListener(`visibilitychange`,C);let p=new Date().toISOString(),m=se(e,_,p,Math.round(v));o(re({stimuli:c,trialStates:l,demographics:m,sessionId:r,participantId:n,formatAssignment:t,datasetClassification:u,formalCollectionAllowed:a,startedAt:s,submittedAt:p}))}),S(),$()},A=e=>{let t=c[e],n=l[e];if(!t||!n)throw Error(`Questionnaire trial ${e+1} is unavailable.`);E(n,new Date().toISOString()),f=e,h=null;let r=Y(e,c.length);d.innerHTML=`
      <div class="jspsych-content-wrapper">
        <div class="jspsych-content">
          <div class="jspsych-survey-html-form-preamble">
            ${I(t)}
          </div>
          <form id="jspsych-survey-html-form">
            ${L(t)}
            <div class="questionnaire-navigation${r.showPrevious?``:` questionnaire-navigation--single`}" data-questionnaire-navigation>
              ${r.showPrevious?`
                    <button id="questionnaire-previous" class="button button--secondary" type="button">
                      上一题
                    </button>
                  `:``}
              <button id="jspsych-survey-html-form-next" class="button button--primary" type="submit">
                ${r.forwardLabel}
              </button>
            </div>
          </form>
        </div>
      </div>
    `;let i=d.querySelector(`#jspsych-survey-html-form`),a=d.querySelector(`#questionnaire-previous`),o=d.querySelector(`#jspsych-survey-html-form-next`);if(!i||!o)throw Error(`Questionnaire trial ${e+1} failed to render.`);oe(i,n.draft),m=B(t,i),m.refresh();let s=!1;p=z(t,n,e=>{s=e,o.disabled=e,a&&(a.disabled=e)}),a?.addEventListener(`click`,()=>{s||y||(w(i),A(e-1))}),i.addEventListener(`submit`,r=>{if(r.preventDefault(),s||y||(n.draft=Z(i),!m?.validate()))return;let a=O(t.response_type,n.draft);k(n,a,new Date().toISOString()),w(i),e<c.length-1?A(e+1):T()}),S(),$()};A(0)}function re({stimuli:e,trialStates:t,demographics:n,sessionId:r,participantId:i,formatAssignment:s,datasetClassification:c,formalCollectionAllowed:l,startedAt:u,submittedAt:d}){return ae(e,t),{session:{session_id:r,participant_id:i,format_assignment:s,stimulus_set_version:a,catalog_hash:o,dataset_classification:c,formal_collection_allowed:l,started_at:u,submitted_at:d,duration_ms:new Date(d).getTime()-new Date(u).getTime()},trials:e.map((e,i)=>ie({stimulus:e,state:t[i],demographics:n,sessionId:r,formatAssignment:s,datasetClassification:c})),demographics:n}}function ie({stimulus:e,state:t,demographics:n,sessionId:r,formatAssignment:i,datasetClassification:a}){let o=t.finalAnswer;if(!o)throw Error(`Trial ${e.trial_no} has no final answer.`);return{session_id:r,format_assignment:i,stimulus_set_version:e.stimulus_set_version,catalog_hash:e.catalog_hash,dataset_classification:a,trial_no:e.trial_no,pool:e.pool,sequence_uid:e.sequence_uid,canonical_key:e.canonical_key,presentation_uid:e.presentation_uid,source_id:e.source_id,stimulus_id:String(e.source_id),display_index:e.display_index,legacy_asset_no:e.legacy_asset_no,pair_uid:e.pair_uid,format:e.format,variant:e.variant,response_type:e.response_type,legacy_path:e.legacy_path,legacy_asset_path:e.legacy_path,stimulus_path:e.legacy_path,legacy_asset_sha256:e.legacy_asset_sha256,asset_sha256:e.asset_sha256,renderer_version:e.renderer_version,values_sha256:e.values_sha256,pool2_speed:e.pool2_speed,source_data_file:e.source_data_file,rho:e.metadata.rho??null,trend:e.metadata.trend??null,beta:e.metadata.beta??null,condition:e.metadata.condition??null,tau_obs:e.metadata.tau_obs??null,beta1:e.metadata.beta1??null,beta2:e.metadata.beta2??null,structure:e.metadata.structure??null,direction:e.metadata.direction??null,sigma1:e.metadata.sigma1??null,sigma2:e.metadata.sigma2??null,point:o.point,trial_started_at:t.firstStartedAt,trial_submitted_at:t.finalSubmittedAt,trial_duration_ms:Math.round(t.durationMs),visit_count:t.visitCount,revision_count:t.revisionCount,fullscreen_open_count:e.format===`table`?null:t.fullscreenOpenCount,fullscreen_duration_ms:e.format===`table`?null:Math.round(t.fullscreenDurationMs),s1:o.s1,s2:o.s2,s3:o.s3,s4:o.s4,s5:o.s5,p1:o.p1,p2:o.p2,p3:o.p3,p4:o.p4,p5:o.p5,gender:n.gender,age:n.age,education:n.education,experience:n.experience,stat_course:n.stat_course,sumS:o.sumS,sumP:o.sumP}}function ae(e,t){if(e.length!==5||t.length!==5)throw Error(`A completed questionnaire must contain exactly 5 trials.`);let n=new Set(e.map(e=>e.trial_no));if(n.size!==5||![1,2,3,4,5].every(e=>n.has(e)))throw Error(`Final questionnaire trials must be unique and numbered 1–5.`);if(t.some(e=>e.finalAnswer===null))throw Error(`Every questionnaire trial must have one final answer.`)}function Z(e){let t={};for(let n of w){let r=e.elements.namedItem(n);t[n]=r instanceof HTMLInputElement?r.value:``}return t}function oe(e,t){for(let n of w){let r=e.elements.namedItem(n);r instanceof HTMLInputElement&&(r.value=t[n])}}function se(e,t,n,r){let i=new FormData(e);return{gender:Q(i.get(`gender`)),age:ce(Q(i.get(`age`))),education:Q(i.get(`education`)),experience:Q(i.get(`experience`)),stat_course:Q(i.get(`stat_course`)),started_at:t,submitted_at:n,duration_ms:r}}function Q(e){return typeof e==`string`&&e!==``?e:null}function ce(e){if(e===null||e.trim()===``)return null;let t=Number(e);return Number.isFinite(t)?t:null}function $(){window.scrollTo({top:0,left:0,behavior:`auto`})}var le=`session_id.format_assignment.stimulus_set_version.catalog_hash.dataset_classification.trial_no.pool.sequence_uid.canonical_key.presentation_uid.source_id.stimulus_id.display_index.legacy_asset_no.pair_uid.format.variant.response_type.legacy_path.legacy_asset_path.stimulus_path.legacy_asset_sha256.asset_sha256.renderer_version.values_sha256.pool2_speed.source_data_file.rho.trend.beta.condition.tau_obs.beta1.beta2.structure.direction.sigma1.sigma2.point.trial_started_at.trial_submitted_at.trial_duration_ms.visit_count.revision_count.fullscreen_open_count.fullscreen_duration_ms.s1.s2.s3.s4.s5.p1.p2.p3.p4.p5.gender.age.education.experience.stat_course.sumS.sumP`.split(`.`);function ue(){let e=[`table`,`graph`,`video`];return e[Math.floor(Math.random()*e.length)]}function de(e){X(e)}export{ue as assignFormat,L as buildTrialHtml,de as startExperiment,le as trialCsvHeaders};