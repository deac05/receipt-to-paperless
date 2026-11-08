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
