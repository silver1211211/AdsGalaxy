"use client";
/* eslint-disable @next/next/no-img-element -- local blob preview is never a remotely optimized application image */

import { useEffect, useRef, useState } from "react";

const MAX_BYTES = 1024 * 1024;
const PRESETS = [{ label: "Square", aspect: 1 }, { label: "Portrait", aspect: 4 / 5 }, { label: "Landscape", aspect: 1200 / 628 }];

export default function ImageCropDialog({ file, onCancel, onConfirm }: { file: File; onCancel: () => void; onConfirm: (file: File) => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [aspect, setAspect] = useState(PRESETS[0].aspect);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSize,setFrameSize]=useState({width:0,height:0});
  const [imageSize,setImageSize]=useState({width:0,height:0});
  const revokeTimer = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const layout=(zoomValue=zoom)=>{
    if(!frameSize.width||!frameSize.height||!imageSize.width||!imageSize.height)return {width:0,height:0,maxX:0,maxY:0,scale:1};
    const cover=Math.max(frameSize.width/imageSize.width,frameSize.height/imageSize.height);
    const scale=cover*zoomValue;
    const width=imageSize.width*scale;
    const height=imageSize.height*scale;
    return {width,height,maxX:Math.max(0,(width-frameSize.width)/2),maxY:Math.max(0,(height-frameSize.height)/2),scale};
  };
  const clamp=(next:{x:number;y:number},zoomValue=zoom)=>{const bounds=layout(zoomValue);return{x:Math.max(-bounds.maxX,Math.min(bounds.maxX,next.x)),y:Math.max(-bounds.maxY,Math.min(bounds.maxY,next.y))};};
  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    if (revokeTimer.current !== null) window.clearTimeout(revokeTimer.current);
    return () => {
      revokeTimer.current = window.setTimeout(() => URL.revokeObjectURL(url), 0);
    };
  }, [url]);
  useEffect(()=>{
    const frame=frameRef.current;if(!frame)return;
    const update=()=>{setFrameSize({width:frame.clientWidth,height:frame.clientHeight});setOffset({x:0,y:0});};
    update();const observer=new ResizeObserver(update);observer.observe(frame);return()=>observer.disconnect();
  },[aspect]);

  const finish = async () => {
    const image = imageRef.current;
    if (!image?.naturalWidth) return;
    const outputWidth = aspect >= 1 ? 1200 : 800;
    const outputHeight = Math.round(outputWidth / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth; canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    const current=layout();
    const sourceWidth=frameSize.width/current.scale;
    const sourceHeight=frameSize.height/current.scale;
    const sourceX=Math.max(0,Math.min(image.naturalWidth-sourceWidth,(image.naturalWidth-sourceWidth)/2-offset.x/current.scale));
    const sourceY=Math.max(0,Math.min(image.naturalHeight-sourceHeight,(image.naturalHeight-sourceHeight)/2-offset.y/current.scale));
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
    let quality = 0.9; let blob: Blob | null = null;
    do { blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality)); quality -= 0.1; } while (blob && blob.size > MAX_BYTES && quality >= 0.4);
    if (!blob || blob.size > MAX_BYTES) { setError("Crop could not be reduced below 1 MB. Choose a simpler image."); return; }
    onConfirm(new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-crop.jpg`, { type: "image/jpeg" }));
  };

  return <div className="fixed inset-0 z-[900] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
    <div className="w-full max-w-xl rounded-t-3xl bg-white p-4 sm:rounded-3xl sm:p-6">
      <h2 className="text-lg font-black text-slate-900">Crop ad image</h2>
      <p className="mt-1 text-xs text-slate-500">Drag to reposition, zoom, then confirm. Landscape 1200×628 is recommended.</p>
      <div className="mt-4 flex gap-2">{PRESETS.map((preset) => <button type="button" key={preset.label} onClick={() => { setAspect(preset.aspect); setOffset({ x: 0, y: 0 }); }} className={`rounded-full px-3 py-2 text-xs font-bold ${aspect === preset.aspect ? "bg-[#0c9de8] text-white" : "bg-slate-100 text-slate-600"}`}>{preset.label}</button>)}</div>
      <div ref={frameRef} className="relative mx-auto mt-4 flex w-full items-center justify-center overflow-hidden rounded-2xl bg-slate-950 touch-none" style={{ aspectRatio: String(aspect), maxWidth: `min(100%, calc(42vh * ${aspect}))` }}
        onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (drag.current) setOffset(clamp({ x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y })); }}
        onPointerUp={stopDragging} onPointerCancel={stopDragging}>
        {url && <img ref={imageRef} src={url} alt="Crop preview" draggable={false} onLoad={(event)=>setImageSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} className="pointer-events-none absolute max-w-none select-none" style={{width:layout().width||"100%",height:layout().height||"100%",left:`calc(50% + ${offset.x}px)`,top:`calc(50% + ${offset.y}px)`,transform:"translate(-50%,-50%)"}} />}
      </div>
      <label className="mt-4 block text-xs font-bold text-slate-600">Zoom
        <input className="mt-2 block w-full touch-pan-x" style={{ touchAction: "pan-x" }} type="range" min="1" max="3" step="0.05" value={zoom} onInput={(event) => {const value=Number(event.currentTarget.value);setZoom(value);setOffset((current)=>clamp(current,value));}} onChange={(event) => {const value=Number(event.target.value);setZoom(value);setOffset((current)=>clamp(current,value));}} />
      </label>
      {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
      <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={onCancel} className="rounded-xl bg-slate-100 py-3 text-sm font-black">Cancel</button><button type="button" onClick={finish} className="rounded-xl bg-[#0c9de8] py-3 text-sm font-black text-white">Use cropped image</button></div>
    </div>
  </div>;
}
