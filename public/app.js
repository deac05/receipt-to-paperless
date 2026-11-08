import { findReceipt } from './crop.js';
const form=document.querySelector('#form'), photo=document.querySelector('#photo');
const preview=document.querySelector('#preview'), image=document.querySelector('#image'), video=document.querySelector('#video');
const frame=document.querySelector('#scan-frame'), overlay=document.querySelector('#overlay'), rect=document.querySelector('#crop-rect');
const filename=document.querySelector('#filename'), status=document.querySelector('#status'), cropStatus=document.querySelector('#crop-status');
const toggle=document.querySelector('#toggle-crop'), detect=document.querySelector('#detect'), shutter=document.querySelector('#shutter'), submit=document.querySelector('#submit');
const cameraMessage=document.querySelector('#camera-message');
let stream, timer, objectUrl, file, bounds={left:.1,top:.1,right:.9,bottom:.9}, usingCrop=true, live=false, manual=false, generation=0;
function paint(){
  rect.setAttribute('x',bounds.left*1000); rect.setAttribute('y',bounds.top*1000);
  rect.setAttribute('width',(bounds.right-bounds.left)*1000); rect.setAttribute('height',(bounds.bottom-bounds.top)*1000);
  for(const node of overlay.querySelectorAll('circle')) {const c=node.dataset.corner; node.setAttribute('cx',(c.endsWith('l')?bounds.left:bounds.right)*1000); node.setAttribute('cy',(c.startsWith('t')?bounds.top:bounds.bottom)*1000);}
}
paint();
function stopCamera(){ if(timer) clearInterval(timer); timer=null; if(stream) stream.getTracks().forEach(t=>t.stop()); stream=null; video.srcObject=null; live=false; video.hidden=true; shutter.hidden=true; }
function clear(){generation++;stopCamera(); if(objectUrl) URL.revokeObjectURL(objectUrl); objectUrl=null; file=null; photo.value=''; preview.hidden=true; image.hidden=true; overlay.hidden=false; toggle.hidden=false; detect.hidden=false; submit.disabled=false;}
function autoDetect(source){
  const w=source.videoWidth||source.naturalWidth, h=source.videoHeight||source.naturalHeight; if(!w||!h)return false;
  const scale=Math.min(1,320/Math.max(w,h)), canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true}); context.drawImage(source,0,0,canvas.width,canvas.height);
  const found=findReceipt(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
  if(found){bounds={left:found.x/canvas.width,top:found.y/canvas.height,right:(found.x+found.width)/canvas.width,bottom:(found.y+found.height)/canvas.height};paint();return true;}
  return false;
}
function describe(found){cropStatus.textContent=found?'Outline found. Drag the corners to adjust it.':'Drag the green corners to fit the receipt.';}
async function loadImage(nextFile, initialBounds){
  clear(); const current=generation; file=nextFile; preview.hidden=false; filename.textContent=file.name;
  if(!file.type.startsWith('image/')){image.hidden=true;overlay.hidden=true;toggle.hidden=true;detect.hidden=true;cropStatus.textContent='PDF selected. It will be sent unchanged.';return;}
  objectUrl=URL.createObjectURL(file); image.src=objectUrl; image.hidden=false; submit.disabled=true;
  try{await image.decode(); if(current!==generation)return; usingCrop=true;toggle.textContent='Use original photo';
    if(initialBounds){bounds=initialBounds;paint();describe(true);}else{bounds={left:.1,top:.1,right:.9,bottom:.9};paint();describe(autoDetect(image));}
  }catch{if(current===generation){overlay.hidden=true;toggle.hidden=true;detect.hidden=true;usingCrop=false;cropStatus.textContent='Preview unavailable. The original file will be sent.';}}
  finally{if(current===generation)submit.disabled=false;}
}
photo.addEventListener('change',()=>{const selected=photo.files[0];if(selected)loadImage(selected);});
document.querySelector('#camera-start').addEventListener('click',async()=>{
  clear(); status.textContent=''; cameraMessage.textContent=''; const current=generation;
  if(!navigator.mediaDevices?.getUserMedia){cameraMessage.textContent='Live camera needs a secure HTTPS connection. Use “Take a photo or choose a file” to adjust a photo instead.';return;}
  try{
    const opened=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    if(current!==generation){opened.getTracks().forEach(t=>t.stop());return;}
    stream=opened;live=true;manual=false;usingCrop=true;video.srcObject=stream;video.hidden=false;image.hidden=true;preview.hidden=false;shutter.hidden=false;toggle.hidden=true;filename.textContent='Live camera';
    await video.play();if(current!==generation)return;
    bounds={left:.1,top:.1,right:.9,bottom:.9};paint();cropStatus.textContent='Position the receipt, then drag the corners if needed.';
    timer=setInterval(()=>{if(live&&!manual){try{if(autoDetect(video))describe(true);}catch{}}},1200);
  }catch{stopCamera();cameraMessage.textContent='Camera unavailable. Allow camera access, or take a photo using the file button.';}
});
shutter.addEventListener('click',async()=>{
  if(!live || !video.videoWidth)return;
  const current=generation, saved={...bounds}, canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0);shutter.disabled=true;
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));shutter.disabled=false;
  if(current!==generation)return;
  if(blob)loadImage(new File([blob],'receipt.jpg',{type:'image/jpeg'}),saved);else cameraMessage.textContent='Could not capture the photo. Try again.';
});
overlay.addEventListener('pointerdown',event=>{
  const corner=event.target.dataset.corner;if(!corner)return;event.preventDefault();manual=true;overlay.setPointerCapture(event.pointerId);
  const move=e=>{const box=frame.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y=Math.max(0,Math.min(1,(e.clientY-box.top)/box.height));
    if(corner.endsWith('l'))bounds.left=Math.min(x,bounds.right-.05);else bounds.right=Math.max(x,bounds.left+.05);
    if(corner.startsWith('t'))bounds.top=Math.min(y,bounds.bottom-.05);else bounds.bottom=Math.max(y,bounds.top+.05);paint();};
  const up=()=>{overlay.removeEventListener('pointermove',move);overlay.removeEventListener('pointerup',up);overlay.removeEventListener('pointercancel',up);};
  overlay.addEventListener('pointermove',move);overlay.addEventListener('pointerup',up);overlay.addEventListener('pointercancel',up);
});
detect.addEventListener('click',()=>{manual=false;usingCrop=true;overlay.hidden=false;toggle.textContent='Use original photo';try{describe(autoDetect(live?video:image));}catch{describe(false);}});
toggle.addEventListener('click',()=>{usingCrop=!usingCrop;overlay.hidden=!usingCrop;toggle.textContent=usingCrop?'Use original photo':'Crop photo';cropStatus.textContent=usingCrop?'Drag the green corners to fit the receipt.':'Original photo selected.';});
document.querySelector('#remove').addEventListener('click',()=>{clear();status.textContent='';});
window.addEventListener('pagehide',stopCamera);
form.addEventListener('submit',async event=>{
  event.preventDefault();if(live){status.textContent='Take a photo first.';return;}if(!file){status.textContent='Take or choose a photo first.';return;}
  submit.disabled=true;status.textContent='Preparing receipt…';
  try{
    let upload=file;
    if(usingCrop && file.type.startsWith('image/') && !image.hidden){
      const x=Math.floor(bounds.left*image.naturalWidth),y=Math.floor(bounds.top*image.naturalHeight),right=Math.ceil(bounds.right*image.naturalWidth),bottom=Math.ceil(bounds.bottom*image.naturalHeight);
      const canvas=document.createElement('canvas');canvas.width=right-x;canvas.height=bottom-y;canvas.getContext('2d').drawImage(image,x,y,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));if(!blob)throw new Error('Could not crop the photo.');upload=new File([blob],file.name.replace(/\.[^.]*$/,'')+'-cropped.jpg',{type:'image/jpeg'});
    }
    if(upload.size>19*1024*1024)throw new Error('Please choose a file under 19 MB.');
    status.textContent='Sending your receipt…';const data=new FormData(form);data.set('document',upload,upload.name);
    const response=await fetch('/upload',{method:'POST',headers:{'X-Receipt-Upload':'1'},body:data});if(!response.ok)throw new Error(await response.text());
    form.reset();clear();status.textContent='Sent! Paperless has queued your receipt for processing.';
  }catch(error){status.textContent=error.message||'Upload failed. Please try again.';}finally{submit.disabled=false;}
});

const tagsList=document.querySelector('#tags-list'), tagsStatus=document.querySelector('#tags-status');
let tagRequest=0;
async function loadTags() {
  const request=++tagRequest; tagsList.replaceChildren(); tagsStatus.textContent='Loading tags…';
  try {
    const response=await fetch('/tags'); const data=await response.json();
    if(!response.ok) throw new Error(data.error || 'Could not load tags.');
    if(request!==tagRequest)return;
    if(!data.tags.length){tagsStatus.textContent='No tags found in Paperless.';return;}
    tagsStatus.textContent='Choose one or more tags.';
    for(const tag of data.tags){
      const label=document.createElement('label');label.className='tag-option';
      const input=document.createElement('input');input.type='checkbox';input.name='tags';input.value=String(tag.id);
      const text=document.createElement('span');text.textContent=tag.name;label.append(input,text);tagsList.append(label);
    }
  }catch(error){if(request===tagRequest)tagsStatus.textContent=error.message || 'Could not load tags.';}
}
document.querySelector('#tags-refresh').addEventListener('click',loadTags);
loadTags();

const connectionForm = document.querySelector('#connection-form');
const connectionLabel = document.querySelector('#connection-label');
const connectionStatus = document.querySelector('#connection-status');
const connectionUrl = document.querySelector('#paperless-url');
const connectionToken = document.querySelector('#paperless-token');
const connectButton = document.querySelector('#connect');
async function showConnection() {
  try {
    const response=await fetch('/connection');
    if (!response.ok) throw new Error();
    const data=await response.json();
    connectionLabel.textContent=data.connected?'Connected':'Not connected';
    connectionUrl.value=data.url || '';
    if (!data.connected) document.querySelector('#settings').open=true;
  } catch {connectionLabel.textContent='Unavailable';}
}
connectionForm.addEventListener('submit',async event=>{
  event.preventDefault(); connectButton.disabled=true; connectionStatus.textContent='Checking your connection…';
  try {
    const response=await fetch('/connection',{method:'POST',headers:{'Content-Type':'application/json','X-Receipt-Upload':'1'},body:JSON.stringify({url:connectionUrl.value.trim(),token:connectionToken.value.trim()})});
    const result=await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save the connection.');
    connectionToken.value=''; connectionUrl.value=result.url; connectionLabel.textContent='Connected';
    connectionStatus.textContent='Connected to Paperless. You can now send receipts.'; loadTags();
  } catch(error) {connectionStatus.textContent=error.message || 'Could not connect. Please try again.';}
  finally {connectButton.disabled=false;}
});
showConnection();

const logout=document.querySelector('#logout');
fetch('/auth/status').then(r=>r.json()).then(info=>{logout.hidden=!info.required; if(info.required&&!info.authenticated)location.replace('/login');}).catch(()=>{});
logout.addEventListener('click',async()=>{await fetch('/auth/logout',{method:'POST',headers:{'X-Receipt-Upload':'1'}});location.replace('/login');});
