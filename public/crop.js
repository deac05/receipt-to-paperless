// Find a rectangular, contrasting object against the colour at the photo's edges.
// Conservative bounds deliberately leave a small margin around the detected object.
export function findReceipt(data, width, height) {
  if (width < 16 || height < 16) return null;
  const samples = [[], [], []];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= width * .04 && x < width * .96 && y >= height * .04 && y < height * .96) continue;
    const p = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) samples[c].push(data[p + c]);
  }
  const background = samples.map(a => { a.sort((a,b) => a-b); return a[Math.floor(a.length / 2)]; });
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4;
    const distance = Math.hypot(data[p] - background[0], data[p+1] - background[1], data[p+2] - background[2]);
    mask[i] = distance > 42 ? 1 : 0;
  }
  const queue = new Int32Array(mask.length);
  let best = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    let head=0, tail=0, minX=width, maxX=0, minY=height, maxY=0, count=0;
    queue[tail++]=start; mask[start]=0;
    while (head < tail) {
      const i=queue[head++], x=i%width, y=Math.floor(i/width);
      count++; minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y);
      for (const n of [x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1]) {
        if(n>=0 && mask[n]) {mask[n]=0;queue[tail++]=n;}
      }
    }
    const w=maxX-minX+1, h=maxY-minY+1, area=w*h;
    if (area < width*height*.04 || area > width*height*.90 || count/area < .55) continue;
    if (minX < 2 || minY < 2 || maxX >= width-2 || maxY >= height-2) continue;
    if (minX > width*.65 || maxX < width*.35 || minY > height*.65 || maxY < height*.35) continue;
    if (!best || count > best.count) best={minX,minY,maxX,maxY,count};
  }
  if (!best) return null;
  const pad = Math.max(3, Math.round(Math.min(width,height)*.015));
  const x=Math.max(0,best.minX-pad), y=Math.max(0,best.minY-pad);
  const right=Math.min(width,best.maxX+1+pad), bottom=Math.min(height,best.maxY+1+pad);
  return {x,y,width:right-x,height:bottom-y};
}
