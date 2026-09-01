let deferredInstallPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);

function show(el){ el?.classList.remove('hidden'); }
function hide(el){ el?.classList.add('hidden'); }
function dismissedRecently(){
  try { return Date.now() - Number(localStorage.getItem('bsd7.installDismissedAt') || 0) < 7*24*60*60*1000; }
  catch { return false; }
}
function rememberDismiss(){ try { localStorage.setItem('bsd7.installDismissedAt', String(Date.now())); } catch {} }

function showInstallCard(mode){
  if(isStandalone() || dismissedRecently()) return;
  const card=document.querySelector('#install-card');
  const title=document.querySelector('#install-title');
  const text=document.querySelector('#install-text');
  const action=document.querySelector('#install-action');
  if(!card || !title || !text || !action) return;
  action.classList.remove('hidden');
  if(mode==='native'){
    title.textContent='Install BSD #7 Assist';
    text.textContent='Add this app to your home screen for a full-screen, app-like experience.';
    action.textContent='Install app';
  } else if(mode==='ios'){
    title.textContent='Add BSD #7 Assist to Home Screen';
    text.innerHTML='Tap the <strong>Share</strong> button in your browser, then choose <strong>Add to Home Screen</strong>.';
    action.classList.add('hidden');
  } else {
    return;
  }
  show(card);
}

async function installNow(){
  if(!deferredInstallPrompt) return;
  const prompt=deferredInstallPrompt;
  deferredInstallPrompt=null;
  await prompt.prompt();
  await prompt.userChoice.catch(()=>null);
  hide(document.querySelector('#install-card'));
}

export function setupInstall(){
  const action=document.querySelector('#install-action');
  const close=document.querySelector('#install-close');
  action?.addEventListener('click', installNow);
  close?.addEventListener('click',()=>{ rememberDismiss(); hide(document.querySelector('#install-card')); });

  if(isStandalone()) return;
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    deferredInstallPrompt=e;
    showInstallCard('native');
  });
  window.addEventListener('appinstalled',()=>{
    deferredInstallPrompt=null;
    hide(document.querySelector('#install-card'));
    try { localStorage.removeItem('bsd7.installDismissedAt'); } catch {}
  });

  // iOS/iPadOS does not expose the Chromium beforeinstallprompt event.
  if(isIOS()) setTimeout(()=>showInstallCard('ios'),900);
  // On Android Chromium, wait for beforeinstallprompt so the button always opens a real browser prompt.
  if(isAndroid()) return;
}
