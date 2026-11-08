const form=document.querySelector('#login-form'), status=document.querySelector('#login-status'), button=form.querySelector('button');
fetch('/auth/status').then(r=>r.json()).then(data=>{if(data.authenticated)location.replace('/');}).catch(()=>{});
form.addEventListener('submit',async event=>{
  event.preventDefault(); button.disabled=true; status.textContent='Signing in…';
  try{
    const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Receipt-Upload':'1'},body:JSON.stringify({username:form.elements.username.value,password:form.elements.password.value})});
    const result=await response.json(); if(!response.ok)throw new Error(result.error||'Sign-in failed.');
    location.replace('/');
  }catch(error){status.textContent=error.message||'Could not sign in. Please try again.';button.disabled=false;}
});
