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
  const revokeTimer = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const clampOffset = (value: number) => Math.max(-240, Math.min(240, value));
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

  const finish = async () => {
    const image = imageRef.current;
    if (!image?.naturalWidth) return;
    const outputWidth = aspect >= 1 ? 1200 : 800;
    const outputHeight = Math.round(outputWidth / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth; canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    const sourceAspect = image.naturalWidth / image.naturalHeight;
    let sourceWidth = sourceAspect > aspect ? image.naturalHeight * aspect : image.naturalWidth;
    let sourceHeight = sourceAspect > aspect ? image.naturalHeight : image.naturalWidth / aspect;
    sourceWidth /= zoom; sourceHeight /= zoom;
    const maxX = (image.naturalWidth - sourceWidth) / 2;
    const maxY = (image.naturalHeight - sourceHeight) / 2;
    const sourceX = Math.max(0, Math.min(image.naturalWidth - sourceWidth, maxX - (offset.x / 240) * maxX));
    const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceHeight, maxY - (offset.y / 240) * maxY));
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
      <div className="mt-4 flex h-[42vh] max-h-96 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 touch-none" style={{ aspectRatio: String(aspect) }}
        onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (drag.current) setOffset({ x: clampOffset(drag.current.ox + event.clientX - drag.current.x), y: clampOffset(drag.current.oy + event.clientY - drag.current.y) }); }}
        onPointerUp={stopDragging} onPointerCancel={stopDragging}>
        {url && <img ref={imageRef} src={url} alt="Crop preview" draggable={false} className="h-full w-full select-none object-cover" style={{ transform: `translate(${offset.x}px,${offset.y}px) scale(${zoom})` }} />}
      </div>
      <label className="mt-4 block text-xs font-bold text-slate-600">Zoom
        <input className="mt-2 block w-full touch-pan-x" style={{ touchAction: "pan-x" }} type="range" min="1" max="3" step="0.05" value={zoom} onInput={(event) => setZoom(Number(event.currentTarget.value))} onChange={(event) => setZoom(Number(event.target.value))} />
      </label>
      {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
      <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={onCancel} className="rounded-xl bg-slate-100 py-3 text-sm font-black">Cancel</button><button type="button" onClick={finish} className="rounded-xl bg-[#0c9de8] py-3 text-sm font-black text-white">Use cropped image</button></div>
    </div>
  </div>;
}
