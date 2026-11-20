'use strict';

function evidenceDropZone(onFiles) {
  const t=accessText;
  const picker=h('input',{type:'file',multiple:true,hidden:true,accept:evidenceFormats,onchange:()=>{const files=Array.from(picker.files); picker.value=''; if(files.length) onFiles(files);}});
  const zone=h('div',{class:'evidence-drop',ondragover:e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';zone.classList.add('over');}},
    ondragleave:e=>{if(!zone.contains(e.relatedTarget))zone.classList.remove('over');},
    ondrop:e=>{e.preventDefault();zone.classList.remove('over');const files=Array.from(e.dataTransfer.files);if(files.length)onFiles(files);}},
    h('div',{},h('strong',{text:t('拖入项目依据','Drop project sources')}),h('p',{class:'muted',text:t('文档、表格、图片或设计文件 · 在本机读取','Documents, spreadsheets, images or design files · Read locally')})),
    picker,antButton(t('选择文件','Choose files'),()=>picker.click()));
  return zone;
}
for (const type of ['dragover','drop']) window.addEventListener(type,event=>{
  if(event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
function evidencePanel(endpoint,active,suites,items,round,refresh) {
  const t=accessText;
  const filtered=items.filter(i=>i.suites.includes(active.id));
  const open=files=>editProjectEvidence(endpoint,active,suites,refresh,files);
  return h('section',{class:'stack-tight evidence-panel'},evidenceDropZone(open),
    h('div',{class:'quality-actions'},antButton(t('添加链接或仓库','Add link or repository'),()=>open([]))),
    filtered.length ? h('details',{},h('summary',{text:t('本类检查依据','Sources for this check')+' ('+filtered.length+')'}),
      filtered.map(item=>h('article',{class:'evidence-item'},h('strong',{text:item.name}),
        h('p',{class:'muted',text:[item.format,item.revision?.slice(0,12),item.kind==='link'?t('仅关联链接，待取证','Linked only · awaiting evidence'):item.kind==='image'?t('画面已保存，待比对','Frame saved · awaiting comparison'):t('原文片段 ','Passages ')+item.count].filter(Boolean).join(' · ')}),
        item.gaps?.length ? h('details',{},h('summary',{text:t('读取详情','Read details')}),item.gaps.map(g=>h('p',{text:g}))) : null,
        item.diagnostics?.length ? h('details',{},h('summary',{text:t('源码规则观察','Source rule observations')+' ('+item.diagnostics.length+')'}),item.diagnostics.map(d=>h('p',{text:t(d.zh,d.en)+' · '+d.location+' · '+d.rule}))) : null,
        h('div',{class:'quality-actions'},item.url ? h('a',{href:item.url,target:'_blank',rel:'noreferrer',text:t('访问来源（联网）','Visit source (network)')}):null,
          item.count ? antButton(t('选择原文','Select passage'),()=>chooseEvidencePassage(endpoint,active,suites,item,refresh)):null,
          item.image && round ? antButton(t('与本轮画面比对','Compare with round capture'),()=>compareAssuranceFrame(endpoint,round,refresh,item)):null,
          item.kind==='link'?antButton(t('关联导出或读取画板','Attach export or read board'),()=>editProjectEvidence(endpoint,active,suites,refresh,[],item.url)):null)))) : null);
}
function chooseEvidencePassage(endpoint,active,suites,item,refresh) {
  const t=accessText;
  openOverlay((panel,close)=>{
    const query=h('input',{class:'input',type:'search','aria-label':t('搜索原文','Search passages')});
    const rows=h('div',{class:'assurance-source-list stack-tight','aria-live':'polite'});
    async function show(offset=0){
      try{
        const data=await api(endpoint+'/document',{method:'POST',body:{evidenceId:item.id,query:query.value,offset}});
        fill(rows,data.candidates.length?data.candidates.map(p=>h('button',{class:'btn evidence-passage',type:'button',text:p.locator+' · '+p.quote.slice(0,170),onclick:()=>{
          close(true);editAssuranceSource(endpoint,active,suites,refresh,{...p,evidenceId:item.id,name:item.name,observation:item.kind==='repository'||item.format==='URL'});
        }})):h('p',{text:t('没有匹配原文。','No matching passages.')}),
        offset>0?antButton(t('上一组','Previous passages'),()=>show(Math.max(offset-25,0))):null,
        data.next!==null?antButton(t('下一组原文','Next passages'),()=>show(data.next)):null);
      }catch(e){rows.textContent=e.message;}
    }
    append(panel,[h('h2',{text:item.name}),h('form',{class:'quality-actions',onsubmit:e=>{e.preventDefault();show();}},query,h('button',{class:'btn',type:'submit',text:t('搜索','Search')})),rows,antButton(t('关闭','Close'),()=>close(false))]);show();
  },{label:t('选择原文','Select passage')});
}
function editProjectEvidence(endpoint,active,suites,refresh,initialFiles=[],initialUrl='') {
  const t=accessText;
  openOverlay((panel,close)=>{
    const boxes=suites.map(s=>h('input',{type:'checkbox',value:s.id,checked:s.id===active.id}));
    const selected=()=>boxes.filter(b=>b.checked).map(b=>b.value);
    const results=h('div',{class:'stack-tight','aria-live':'polite'});
    const url=h('input',{class:'input',type:'url',value:initialUrl,placeholder:'https://…'});
    const branch=h('input',{class:'input',placeholder:t('默认分支','Default branch')});
    const key=h('input',{class:'input',type:'password',autocomplete:'off'});
    const number=h('input',{class:'input',type:'number',min:1,value:1});
    const field=(name,control)=>h('label',{class:'workflow-field'},name,control);
    let processing=false;
    function row(label){
      const status=h('p',{class:'muted',text:t('正在读取…','Reading…')});
      results.prepend(h('article',{class:'evidence-item'},h('strong',{text:label}),status));
      return status;
    }
    async function readFiles(files){
      if(processing){toast(t('请等当前批次完成。','Wait for the current batch.'), 'error');return;}
      if(!selected().length){toast(t('请选择检测类别。','Select applicable checks.'),'error');return;}
      processing=true; const categories=selected(), origin=url.value.trim();
      try{
        for(const file of files){
          const status=row(file.name);
          try{
            const payload=await readSourceFile(file,categories,origin);
            const item=await api(endpoint+'/import',{method:'POST',body:payload});
            fill(status,t('已保存','Saved')+' · '+item.format+' · '+(item.image?t('画面','Frame'):t('原文片段 ','Passages ')+item.count),
              item.gaps.length?h('span',{text:' · '+item.gaps.slice(0,3).join(' / ')}):null,
              item.count?antButton(t('选择原文','Select passage'),()=>{close(true);chooseEvidencePassage(endpoint,active,suites,item,refresh);}):null);
          }catch(e){status.textContent=t('未导入 · ','Import failed · ')+e.message;}
        }
        await refresh();
      }finally{processing=false;}
    }
    const mode=h('select',{class:'input','aria-label':t('链接用途','Link action')},
      h('option',{value:'link',text:t('保存链接或关联本地导出','Save link or pair a local export')}),
      h('option',{value:'repository',text:t('从 Git 仓库读取代码','Read code from a Git repository')}),
      h('option',{value:'code-link',text:t('读取代码文件或原始文本链接','Read a code file or raw text URL')}),
      h('option',{value:'board-export',text:t('从 Figma 或 Canva 读取画面','Fetch a Figma or Canva frame')}));
    const fields=h('div',{class:'stack-tight'});
    const action=h('button',{class:'btn',type:'submit'});
    function change(){
      const repo=mode.value==='repository', board=mode.value==='board-export', file=mode.value==='code-link';
      fill(fields,repo?field(t('分支或标签','Branch or tag'),branch):null,board?field(t('Figma 个人令牌或 Canva 访问令牌（仅本次）','Figma personal token or Canva access token (this read only)'),key):null,
        board&&/canva\.com/i.test(url.value)?field(t('可画页码','Canva page'),number):null,
        h('p',{class:'muted',text:repo?t('将连接仓库主机并下载源码到本机。使用现有 Git 凭据；在本地静态扫描。','Connects to the repository host and downloads code. Uses existing Git credentials and scans locally.'):
          board?t('将设计编号和凭据发送给对应的官方 API，并下载选定画面。可画中国站等其他画板请配对本地导出。','Sends the design ID and credential to the official provider API and downloads the frame. Pair other boards, including Canva China, with a local export.'):
          file?t('将向来源主机请求所选文件。支持 GitHub、GitLab 文件页及原始文本地址。','Requests the selected file from its host. Accepts GitHub and GitLab file pages or raw text URLs.'):t('仅在本机保存链接。可在下方拖入对应导出图。','Saves the URL locally. Drop its exported image below to pair them.')}));
      action.textContent=repo?t('联网读取并扫描','Fetch and scan'):board?t('联网获取画面','Fetch frame online'):file?t('读取远程文件','Fetch remote file'):t('保存链接','Save link');
    }
    mode.onchange=change; url.onchange=change;change();
    const form=h('form',{class:'stack-tight',onsubmit:async e=>{
      e.preventDefault(); if(!selected().length || !url.value.trim()){toast(t('填写链接并选择类别。','Enter a URL and select checks.'),'error');return;}
      action.disabled=true;const status=row(mode.selectedOptions[0].textContent);
      const endpointName=mode.value==='link'?'import':mode.value;
      const credential=key.value;key.value='';
      try{
        const data=await api(endpoint+'/'+endpointName,{method:'POST',body:{kind:'link',url:url.value.trim(),name:url.value.trim(),suites:selected(),ref:branch.value.trim(),...(endpointName==='board-export'?{credential,page:Number(number.value)}:{})}});
        status.textContent=t('已保存','Saved')+' · '+data.name+' · '+(data.revision?.slice(0,12)||t('仅关联','Link only'))+(data.kind==='repository'?' · '+data.gaps[0]:'');await refresh();
      }catch(err){status.textContent=t('未读取 · ','Read failed · ')+err.message;}finally{action.disabled=false;}
    }},field(t('来源链接','Source URL'),url),mode,fields,action);
    append(panel,[h('h2',{text:t('添加检查依据','Add check sources')}),h('fieldset',{},h('legend',{text:t('适用检测（可多选）','Applicable checks (select all that apply)')}),h('div',{class:'filters'},boxes.map((b,i)=>h('label',{},b,' ',suites[i].title)))),
      h('details',{open:!initialFiles.length},h('summary',{text:t('链接与在线读取','Links and online reads')}),form),evidenceDropZone(readFiles),results,antButton(t('完成','Done'),()=>close(true))]);
    if(initialFiles.length) readFiles(initialFiles);
  },{label:t('添加检查依据','Add check sources')});
}
