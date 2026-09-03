const CACHE='bsd7-community-v1.3.11';
const SHELL=['./','./index.html','./app-v1311.js','./supabase-lite.js','./config.js','./update.js','./install.js','./install-ui.css','./manifest.json','./icons/app-192.svg','./icons/app-512.svg','./icons/apple-touch-icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.origin!==location.origin||u.pathname.endsWith('/version.txt'))return;
  const network=()=>fetch(new Request(r,{cache:'no-cache'})).then(async res=>{
    if(res.ok)await (await caches.open(CACHE)).put(r,res.clone());
    return res;
  });
  if(r.mode==='navigate'){
    e.respondWith(network().catch(()=>caches.match('./index.html')));
    return;
  }
  const refresh=network();
  e.waitUntil(refresh.catch(()=>{}));
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(cached=>cached||refresh));
});
self.addEventListener('push',e=>{
  let data={};
  try{data=e.data?.json()||{}}catch{data={body:e.data?.text()||''}}
  e.waitUntil(self.registration.showNotification(data.title||'BSD #7 Community Alert',{
    body:data.body||'A new verified community alert is available.',
    icon:'icons/app-192.svg',
    tag:data.alertId?`bsd7-alert-${data.alertId}`:'bsd7-alert',
    renotify:true,
    vibrate:[100,60,100],
    data:{url:'./',alertId:data.alertId||null}
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const target=new URL(e.notification.data?.url||'./',self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    const current=clients.find(client=>new URL(client.url).origin===new URL(target).origin);
    if(current){await current.focus();return current.navigate(target)}
    return self.clients.openWindow(target);
  }));
});
