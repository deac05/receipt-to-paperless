const form = document.querySelector('#form');
const photo = document.querySelector('#photo');
const preview = document.querySelector('#preview');
const image = document.querySelector('#image');
const filename = document.querySelector('#filename');
const status = document.querySelector('#status');
const submit = document.querySelector('#submit');
let objectUrl;
function refresh() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  const file = photo.files[0];
  preview.hidden = !file;
  image.hidden = !file?.type.startsWith('image/');
  if (file) {filename.textContent = file.name; if (!image.hidden) {objectUrl = URL.createObjectURL(file); image.src = objectUrl;}}
}
photo.addEventListener('change',refresh);
document.querySelector('#remove').addEventListener('click',()=>{photo.value=''; refresh(); status.textContent='';});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const file=photo.files[0];
  if (!file) return;
  if (file.size > 19 * 1024 * 1024) {status.textContent='Please choose a file under 19 MB.'; return;}
  submit.disabled=true; status.textContent='Sending your receipt…';
  try {
    const response=await fetch('/upload',{method:'POST',headers:{'X-Receipt-Upload':'1'},body:new FormData(form)});
    if (!response.ok) throw new Error(await response.text());
    form.reset(); refresh(); status.textContent='Sent! Paperless has queued your receipt for processing.';
  } catch(error) {status.textContent=error.message || 'Upload failed. Please try again.';}
  finally {submit.disabled=false;}
});
