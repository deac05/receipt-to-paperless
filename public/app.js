import { findReceipt } from './crop.js';
const form = document.querySelector('#form');
const photo = document.querySelector('#photo');
const preview = document.querySelector('#preview');
const image = document.querySelector('#image');
const filename = document.querySelector('#filename');
const status = document.querySelector('#status');
const cropStatus = document.querySelector('#crop-status');
const toggleCrop = document.querySelector('#toggle-crop');
const submit = document.querySelector('#submit');
let objectUrl, croppedFile, useCrop = false, generation = 0;
function showFile(file) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file); image.src = objectUrl;
}
function clearPreview() {
  generation++; croppedFile = null; useCrop = false; submit.disabled = false;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null; preview.hidden = true; image.hidden = true; toggleCrop.hidden = true; cropStatus.textContent = '';
}
photo.addEventListener('change', async () => {
  clearPreview(); status.textContent = '';
  const file = photo.files[0]; if (!file) return;
  const current = generation;
  preview.hidden = false; filename.textContent = file.name;
  if (!file.type.startsWith('image/')) { cropStatus.textContent = 'PDF selected; the original file will be sent.'; return; }
  image.hidden = false; showFile(file); submit.disabled = true; cropStatus.textContent = 'Looking for receipt edges…';
  try {
    const source = new Image(); source.src = URL.createObjectURL(file);
    try { await source.decode(); } finally { URL.revokeObjectURL(source.src); }
    if (current !== generation) return;
    const scale = Math.min(1, 512 / Math.max(source.naturalWidth, source.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const ctx = canvas.getContext('2d', {willReadFrequently:true}); ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const bounds = findReceipt(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
    if (!bounds) {cropStatus.textContent = 'Could not confidently find the edges. The original photo will be sent.'; return;}
    const sx=source.naturalWidth/canvas.width, sy=source.naturalHeight/canvas.height;
    const output=document.createElement('canvas');
    const left=Math.floor(bounds.x*sx), top=Math.floor(bounds.y*sy);
    const right=Math.min(source.naturalWidth,Math.ceil((bounds.x+bounds.width)*sx)), bottom=Math.min(source.naturalHeight,Math.ceil((bounds.y+bounds.height)*sy));
    output.width=right-left; output.height=bottom-top;
    output.getContext('2d').drawImage(source,left,top,output.width,output.height,0,0,output.width,output.height);
    const blob=await new Promise(resolve=>output.toBlob(resolve,'image/jpeg',.93));
    if (current !== generation) return;
    if (!blob) throw new Error('Image conversion failed');
    croppedFile=new File([blob],file.name.replace(/\.[^.]*$/, '')+'-cropped.jpg',{type:'image/jpeg'}); useCrop=true;
    showFile(croppedFile); toggleCrop.hidden=false; toggleCrop.textContent='Use original photo';
    cropStatus.textContent='Automatically cropped. Check that the whole receipt is visible.';
  } catch { if(current===generation) cropStatus.textContent='Could not crop this image. The original photo will be sent.'; }
  finally {if(current===generation) submit.disabled=false;}
});
toggleCrop.addEventListener('click',()=>{
  useCrop=!useCrop; showFile(useCrop ? croppedFile : photo.files[0]);
  toggleCrop.textContent=useCrop?'Use original photo':'Use automatic crop';
  cropStatus.textContent=useCrop?'Automatically cropped. Check that the whole receipt is visible.':'Original photo selected.';
});
document.querySelector('#remove').addEventListener('click',()=>{photo.value=''; clearPreview(); status.textContent='';});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const file=useCrop ? croppedFile : photo.files[0]; if (!file) return;
  if (file.size > 19 * 1024 * 1024) {status.textContent='Please choose a file under 19 MB.'; return;}
  submit.disabled=true; status.textContent='Sending your receipt…';
  try {
    const data=new FormData(form); data.set('document',file,file.name);
    const response=await fetch('/upload',{method:'POST',headers:{'X-Receipt-Upload':'1'},body:data});
    if (!response.ok) throw new Error(await response.text());
    form.reset(); clearPreview(); status.textContent='Sent! Paperless has queued your receipt for processing.';
  } catch(error) {status.textContent=error.message || 'Upload failed. Please try again.';}
  finally {submit.disabled=false;}
});
