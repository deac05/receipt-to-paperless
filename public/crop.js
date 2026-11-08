// Estimate an axis-aligned receipt outline. Several colour and brightness
// thresholds let the detector handle shadows, textured tables and low contrast.
// Return null when no plausible, fully visible rectangle can be found.
export function findReceipt(data, width, height) {
  if (width < 16 || height < 16) return null;
  const size=width*height, lum=new Uint8Array(size), smooth=new Uint8Array(size);
  for(let i=0;i<size;i++) lum[i]=Math.round(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2]);
  // Blur isolated printing and surface texture before grouping foreground areas.
  for(let y=1;y<height-1;y++) for(let x=1;x<width-1;x++){
    let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=lum[(y+dy)*width+x+dx];
    smooth[y*width+x]=Math.round(sum/9);
  }
  const border=[];
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)if(x<width*.05||x>width*.95||y<height*.05||y>height*.95)border.push(smooth[y*width+x]);
  border.sort((a,b)=>a-b);const background=border[Math.floor(border.length/2)];
  const queue=new Int32Array(size);
  let best=null;
  const thresholds=[...new Set([Math.max(60,background+12),Math.max(75,background+25),Math.max(95,background+40),145,175,200,220].filter(v=>v<250))];
  for(const threshold of thresholds){
    const mask=new Uint8Array(size);
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x;if(smooth[i]>=threshold)mask[i]=1;}
    // A small closing joins interrupted paper regions without filling large gaps.
    const dilated=new Uint8Array(size), closed=new Uint8Array(size);
    for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){const i=y*width+x;dilated[i]=mask[i]||mask[i-1]||mask[i+1]||mask[i-width]||mask[i+width]?1:0;}
    for(let y=3;y<height-3;y++)for(let x=3;x<width-3;x++){const i=y*width+x;closed[i]=dilated[i]&&dilated[i-1]&&dilated[i+1]&&dilated[i-width]&&dilated[i+width]?1:0;}
    for(let start=0;start<size;start++){
      if(!closed[start])continue;
      let head=0,tail=0,minX=width,maxX=0,minY=height,maxY=0,count=0;
      queue[tail++]=start;closed[start]=0;
      while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(const n of [i-1,i+1,i-width,i+width])if(n>=0&&n<size&&closed[n]){closed[n]=0;queue[tail++]=n;}}
      const w=maxX-minX+1,h=maxY-minY+1,area=w*h,fraction=area/size,density=count/area;
      if(fraction<.035||fraction>.88||density<.43||w<width*.12||h<height*.12)continue;
      if(minX<=3||minY<=3||maxX>=width-4||maxY>=height-4)continue;
      if(minX>width*.65||maxX<width*.35||minY>height*.65||maxY<height*.35)continue;
      // Real paper has a visible change across its boundary. Compare samples
      // along all four edges, avoiding text in the middle of the receipt.
      let contrast=0,n=0;const gap=Math.max(3,Math.round(Math.min(width,height)*.015));
      for(let k=1;k<10;k++){
        const x=Math.round(minX+w*k/10),y=Math.round(minY+h*k/10);
        for(const [ix,iy,ox,oy] of [[x,Math.min(height-1,minY+gap),x,Math.max(0,minY-gap)],[x,Math.max(0,maxY-gap),x,Math.min(height-1,maxY+gap)],[Math.min(width-1,minX+gap),y,Math.max(0,minX-gap),y],[Math.max(0,maxX-gap),y,Math.min(width-1,maxX+gap),y]]){contrast+=Math.abs(smooth[iy*width+ix]-smooth[oy*width+ox]);n++;}
      }
      contrast/=n;if(contrast<7)continue;
      const center=Math.hypot((minX+maxX)/2/width-.5,(minY+maxY)/2/height-.5);
      const score=Math.sqrt(fraction)*density*(1+Math.min(contrast,80)/80)-center*.35;
      if(!best||score>best.score)best={minX,minY,maxX,maxY,score};
    }
  }
  if(!best)return null;
  const pad=Math.max(3,Math.round(Math.min(width,height)*.015));
  const x=Math.max(0,best.minX-pad),y=Math.max(0,best.minY-pad),right=Math.min(width,best.maxX+1+pad),bottom=Math.min(height,best.maxY+1+pad);
  return {x,y,width:right-x,height:bottom-y};
}
