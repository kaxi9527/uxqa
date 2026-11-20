'use strict';

const evidenceFormats = '.pdf,.docx,.pptx,.xlsx,.md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.png,.jpg,.jpeg,.webp,.svg,.sketch,.fig,.xd,.psd';
function packageParts(bytes, allow) {
  let total = 0;
  return fflate.unzipSync(bytes, {filter: item => {
    if (!allow(item.name)) return false;
    total += item.originalSize;
    if (total > 32_000_000) throw new Error(accessText('解压后的内容超过 32 MB，请拆分文件。','Extracted content exceeds 32 MB. Split the file.'));
    return true;
  }});
}
function officePassages(bytes, format, add) {
  const t=accessText;
  const patterns={docx:/^word\/document\.xml$/,pptx:/^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml)$/,xlsx:/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/};
  const parts=packageParts(bytes,name=>patterns[format].test(name));
  const nodes=(root,name)=>Array.from(root.getElementsByTagNameNS('*',name));
  const xml=name=>{
    if (!parts[name]) throw new Error(t('缺少文档内容或引用。','A document part or reference is missing.'));
    const parsed=new DOMParser().parseFromString(new TextDecoder().decode(parts[name]),'application/xml');
    if (nodes(parsed,'parsererror').length) throw new Error(t('文档 XML 损坏。','Invalid document XML.'));
    return parsed;
  };
  const runs=node=>nodes(node,'t').map(r=>r.textContent).join('');
  if(format==='docx'){
    nodes(xml('word/document.xml'),'p').forEach((p,i)=>add('¶ '+(i+1),Array.from(p.getElementsByTagNameNS('*','*')).map(n=>n.localName==='t'?n.textContent:n.localName==='tab'?'\t':['br','cr'].includes(n.localName)?'\n':'').join('')));
    return;
  }
  const book=format==='pptx'?'ppt/presentation.xml':'xl/workbook.xml';
  const relFile=book.replace('/','/_rels/')+'.rels';
  const targets=new Map(nodes(xml(relFile),'Relationship').filter(n=>n.getAttribute('TargetMode')!=='External').map(n=>[n.getAttribute('Id'),new URL(n.getAttribute('Target'),'https://package.invalid/'+book).pathname.slice(1)]));
  const references=nodes(xml(book),format==='pptx'?'sldId':'sheet');
  const shared=parts['xl/sharedStrings.xml']?nodes(xml('xl/sharedStrings.xml'),'si').map(runs):[];
  references.forEach((ref,i)=>{
    const id=Array.from(ref.attributes).find(a=>a.localName==='id' && a.namespaceURI)?.value;
    const part=xml(targets.get(id));
    if(format==='pptx') nodes(part,'p').forEach((p,n)=>add('Slide '+(i+1)+' · ¶ '+(n+1),runs(p)));
    else for(const row of nodes(part,'row')) {
      const cells=nodes(row,'c').map(c=>{
        const type=c.getAttribute('t'), raw=nodes(c,'v')[0]?.textContent;
        const value=type==='s'?shared[Number(raw)]:type==='inlineStr'?runs(c):raw ?? nodes(c,'f')[0]?.textContent;
        return value ? c.getAttribute('r')+' '+value : '';
      }).filter(Boolean);
      add(ref.getAttribute('name')+' · '+row.getAttribute('r'),cells.join(' | '));
    }
  });
}
async function readSourceFile(file, suites, origin) {
  const t=accessText, format=(file.name.split('.').pop() || '').toLowerCase();
  if (!evidenceFormats.split(',').includes('.'+format)) throw new Error(t('格式暂不支持，请导出为 PDF、Office Open XML、图片或文本。','Unsupported format. Export as PDF, modern Office, image or text.'));
  if (file.size>32_000_000) throw new Error(t('单个文件上限为 32 MB。','The file limit is 32 MB.'));
  const bytes=new Uint8Array(await file.arrayBuffer());
  const revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const passages=[], gaps=[];
  const add=(locator,raw)=>{
    const content=String(raw || '').trim();
    for(let start=0;start<content.length;start+=4000) passages.push({locator:locator+(content.length>4000?' · '+(1+start/4000):''),text:content.slice(start,start+4000)});
  };
  let kind='text';
  if (['png','jpg','jpeg','webp','svg'].includes(format)) {
    const uri=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>resolve(reader.result);reader.readAsDataURL(new Blob([bytes],{type:format==='svg'?'image/svg+xml':'image/'+(format==='jpg'?'jpeg':format)}));});
    const img=new Image(); img.src=uri; await img.decode();
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth*img.naturalHeight>16_000_000) throw new Error(t('画布最多 16 MP，请导出单帧。','Frame limit is 16 MP. Export a single frame.'));
    let png=uri;
    if(format!=='png'){
      const canvas=document.createElement('canvas'); canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
      canvas.getContext('2d').drawImage(img,0,0); png=canvas.toDataURL('image/png');
    }
    return {kind:'image',name:file.name,suites,png:png.split(',')[1],url:origin || undefined};
  }
  if(format==='pdf'){
    const pdfjs=await import('/vendor/pdfjs/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';
    const task=pdfjs.getDocument({data:bytes,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,isEvalSupported:false,useWasm:false,disableFontFace:true,useSystemFonts:false});
    try {
      const pdf=await task.promise;
      for(let n=1;n<=pdf.numPages;n++){
        const page=await pdf.getPage(n);
        const {items}=await page.getTextContent();
        const text=items.filter(item=>typeof item.str==='string').map(item=>item.str+(item.hasEOL?'\n':' ')).join('');
        if (!text.trim()) gaps.push('p. '+n+' · '+t('没有可提取文字','No extractable text'));
        else add('p. '+n,text);
        page.cleanup();
      }
    } finally { await task.destroy(); }
  } else if(['docx','pptx','xlsx'].includes(format)) officePassages(bytes,format,add);
  else if (format==='sketch'){
    kind='design';
    const parts=packageParts(bytes,n=>/^pages\/[^/]+\.json$/.test(n));
    for(const page of Object.values(parts)){
      const data=JSON.parse(new TextDecoder().decode(page));
      const walk=(layer,path)=>{
        const location=[...path,layer.name || layer.do_objectID];
        if(layer._class==='text') add(location.join(' / ').slice(-480),layer.attributedString?.string);
        else if(['artboard','symbolMaster','frame'].includes(layer._class)) add(('Node '+layer.do_objectID).slice(0,480),location.join(' / ')+' · '+layer.frame?.width+' × '+layer.frame?.height);
        (layer.layers || []).forEach(child=>walk(child,location));
      };
      walk(data,[]);
    }
    gaps.push(t('已读取画板结构。像素核验需要导出的单帧图片。','Board structure imported. Attach a frame export to compare pixels.'));
  } else if(['fig','xd','psd'].includes(format)){
    kind='design'; gaps.push(t('已记录文件名和版本指纹。请附单帧导出图以核验画面。','File name and fingerprint recorded. Attach a frame export for visual verification.'));
  } else {
    const encoding=bytes[0]===255 && bytes[1]===254?'utf-16le':bytes[0]===254 && bytes[1]===255?'utf-16be':'utf-8';
    const source=new TextDecoder(encoding,{fatal:true}).decode(bytes);
    if (source.includes('\u0000')) throw new Error(t('无法读取文本编码，请导出为 UTF-8。','Unsupported text encoding. Export as UTF-8.'));
    if(['html','htm'].includes(format)){
      const template=document.createElement('template');template.innerHTML=source;
      template.content.querySelectorAll('script,style,template,noscript').forEach(n=>n.remove());
      template.content.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,br,tr').forEach(n=>n.append('\n'));
      template.content.textContent.split(/\r?\n/).forEach((line,i)=>add('¶ '+(i+1),line));
    } else source.split(/\r\n|\n|\r/).forEach((line,i)=>add('L'+(i+1),line));
  }
  if(!passages.length && !gaps.length) gaps.push(t('没有可提取的原文。','No extractable passages.'));
  const payload={name:file.name,format,kind,suites,revision,passages,gaps};
  if(new Blob([JSON.stringify(payload)]).size>8_000_000) throw new Error(t('提取文本超过 8 MB，请按章节拆分。','Extract exceeds 8 MB. Split the document into chapters.'));
  return payload;
}
