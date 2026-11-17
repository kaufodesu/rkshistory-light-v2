/* wither: bounded temporal packs. Snapshot dates are not claims of independent surveys. */
(function(root){
 'use strict';
 class AtlasStore{
  constructor(manifest,normalize,options={}){
   this.maps=manifest.maps;this.normalize=normalize;
   const embedded=root.document?.querySelector?.('script#embedded-maps');this.embedded=embedded?JSON.parse(embedded.textContent):null;
   this.fetch=options.fetch||(this.embedded?async url=>{
    const encoded=this.embedded[url];if(!encoded)throw new Error('内蔵地図が見つかりません。');
    return new Response(Uint8Array.from(root.atob(encoded),c=>c.charCodeAt(0)));
   }:root.fetch.bind(root));
   this.maxEntries=options.maxEntries||3;this.maxBytes=options.maxBytes||24*1024*1024;
   this.cache=new Map();this.files=new Map();this.pending=new Map();this.filePending=new Map();this.estimatedBytes=0;this.fileBytes=0;
  }
  record(year){const r=this.maps[String(year)];if(!r?.url)throw new Error('この年代の地図は未登録です。');return r;}
  key(year){const r=this.record(year);return r.url+'@'+r.sourceYear+'#'+(r.snapshotKey||'');}
  cancelExcept(years){
   const urls=new Set(years.map(y=>this.record(y).url));
   for(const [url,job] of this.filePending)if(!urls.has(url)){this.filePending.delete(url);job.controller.abort();}
   for(const [key,promise] of this.pending)if(!urls.has(promise.url))this.pending.delete(key);
  }
  async loadFile(record){
   const url=record.url;
   if(this.files.has(url)){const file=this.files.get(url);this.files.delete(url);this.files.set(url,file);return file;}
   if(this.filePending.has(url))return this.filePending.get(url).promise;
   const controller=new AbortController(),job={controller,promise:null};
   job.promise=(async()=>{
    if(root.location?.protocol==='file:'&&!this.embedded)throw new Error('GitHub Pages等のURLで開いてください。この分割版はHTMLの直接起動では地図を取得できません。');
    const response=await this.fetch(url,{signal:controller.signal,cache:'default'});
    if(!response.ok)throw new Error('地図の取得に失敗しました（HTTP '+response.status+'）。mapsフォルダーの公開を確認してください。');
    const buffer=await response.arrayBuffer(),bytes=new Uint8Array(buffer);
    if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
    let text;
    if(bytes[0]===31&&bytes[1]===139){
     if(!root.DecompressionStream)throw new Error('このブラウザは地図の展開に未対応です。最新のブラウザをご利用ください。');
     text=await new Response(new Blob([buffer]).stream().pipeThrough(new root.DecompressionStream('gzip'))).text();
    }else text=new TextDecoder().decode(buffer);
    if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
    const data=JSON.parse(text);
    if(!['FeatureCollection','TemporalAtlas'].includes(data.type))throw new Error('地図データの形式が正しくありません。');
    const file={data,estimate:text.length*3};
    if(file.estimate<=this.maxBytes){
     this.files.set(url,file);this.fileBytes+=file.estimate;
     while(this.files.size>2||this.fileBytes>this.maxBytes){const oldest=this.files.keys().next().value;this.fileBytes-=this.files.get(oldest).estimate;this.files.delete(oldest);}
    }
    return file;
   })().finally(()=>{if(this.filePending.get(url)===job)this.filePending.delete(url);});
   this.filePending.set(url,job);return job.promise;
  }
  async get(year){
   const record=this.record(year),key=this.key(year);
   if(this.cache.has(key)){const item=this.cache.get(key);this.cache.delete(key);this.cache.set(key,item);return item.features;}
   if(this.pending.has(key))return this.pending.get(key);
   const promise=(async()=>{
    const file=await this.loadFile(record),data=file.data;
    let collection;
    if(data.type==='TemporalAtlas'){
     const ids=data.snapshots?.[record.snapshotKey];
     if(!Array.isArray(ids))throw new Error('指定年代が地図ファイル内にありません。');
     collection={type:'FeatureCollection',features:ids.map(id=>{
      const f=data.features[id],geometry=f&&data.geometries[f.geometry];
      if(!geometry)throw new Error('領域の参照先が見つかりません。');
      return {type:'Feature',properties:{...f.properties},geometry};
     })};
    }else collection={type:'FeatureCollection',features:data.features.map(f=>({...f,properties:{...f.properties}}))};
    const features=this.normalize(collection);
    for(const f of features)f.mapYear=record.sourceYear;
    // Conservative estimate includes shared geometry; actual retained heap is browser-dependent.
    const estimate=JSON.stringify(collection).length*3;
    if(estimate<=this.maxBytes){
     this.cache.set(key,{features,estimate});this.estimatedBytes+=estimate;
     while(this.cache.size>this.maxEntries||this.estimatedBytes>this.maxBytes){const oldest=this.cache.keys().next().value;this.estimatedBytes-=this.cache.get(oldest).estimate;this.cache.delete(oldest);}
    }
    return features;
   })().finally(()=>{if(this.pending.get(key)===promise)this.pending.delete(key);});
   promise.url=record.url;this.pending.set(key,promise);return promise;
  }
 }
 root.AtlasStore=AtlasStore;if(typeof module==='object'&&module.exports)module.exports=AtlasStore;
})(globalThis);
