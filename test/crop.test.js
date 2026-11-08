import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findReceipt } from '../public/crop.js';
function photo(width,height,rect) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const p=(y*width+x)*4, inside=rect && x>=rect.x && x<rect.x+rect.width && y>=rect.y && y<rect.y+rect.height;
    data[p]=data[p+1]=data[p+2]=inside?240:40; data[p+3]=255;
  }
  return data;
}
test('finds a contrasting receipt and preserves a margin',()=>{
  const box=findReceipt(photo(200,300,{x:55,y:30,width:90,height:235}),200,300);
  assert.ok(box); assert.ok(box.x < 55 && box.y < 30); assert.ok(box.x+box.width > 145 && box.y+box.height > 265);
  assert.ok(box.width < 120 && box.height < 270);
});
test('keeps the original when no reliable edges are visible',()=>{
  assert.equal(findReceipt(photo(200,300,null),200,300),null);
  assert.equal(findReceipt(photo(200,300,{x:0,y:20,width:100,height:250}),200,300),null);
});

test('detects a receipt with printing and uneven lighting on a textured surface',()=>{
  const w=240,h=320,data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=(y*w+x)*4,inside=x>=57&&x<181&&y>=34&&y<288;
    let v=inside?190+Math.floor(35*x/w)+Math.floor(15*y/h):118+((x*17+y*13)%31);
    if(inside && y>68 && y<255 && y%22<3 && x>75 && x<160)v=45;
    data[p]=data[p+1]=data[p+2]=v;data[p+3]=255;
  }
  const box=findReceipt(data,w,h);assert.ok(box);assert.ok(box.x<=57 && box.y<=34);assert.ok(box.x+box.width>=181 && box.y+box.height>=288);
});
test('detects a slightly rotated receipt without clipping its corners',()=>{
  const w=240,h=320,data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=(y*w+x)*4,shift=(y-160)*.08,inside=x>=58+shift&&x<180+shift&&y>=40&&y<280;
    const v=inside?225:110+((x*7+y*11)%20);data[p]=data[p+1]=data[p+2]=v;data[p+3]=255;
  }
  const box=findReceipt(data,w,h);assert.ok(box);assert.ok(box.x<=50 && box.y<=40);assert.ok(box.x+box.width>=188 && box.y+box.height>=280);
});
