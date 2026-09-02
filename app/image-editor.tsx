"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bold,
  BringToFront,
  Circle,
  Copy,
  Download,
  FlipHorizontal2,
  FlipVertical2,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Maximize2,
  Minus,
  Palette,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Square,
  Star,
  Sticker,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Upload,
  WandSparkles,
} from "lucide-react";
import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type BusinessId = "feed" | "ip";
type ElementKind = "text" | "image" | "shape";
type ImageFit = "cover" | "contain";
type ShapeKind = "rectangle" | "circle" | "star" | "triangle" | "arrow" | "burst" | "line";
type TextAlign = "left" | "center" | "right";

type EditorElement = {
  id: string;
  kind: ElementKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  locked?: boolean;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  align?: TextAlign;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  backgroundColor?: string;
  radius?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetY?: number;
  src?: string;
  fit?: ImageFit;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  flipX?: boolean;
  flipY?: boolean;
  positionX?: number;
  positionY?: number;
  shape?: ShapeKind;
  fill?: string;
  borderColor?: string;
  borderWidth?: number;
};

type FontRecord = {
  id: string;
  name: string;
  family: string;
};

type SeedImage = {
  src: string;
  name: string;
};

type ImageEditorProps = {
  business: BusinessId;
  runnerOnline: boolean;
  runnerUrl: string;
  seedImage?: SeedImage | null;
  onSeedConsumed?: () => void;
  onUseImage: (localPath: string) => void;
  onOpenDraft: () => void;
  showToast: (message: string) => void;
};

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1440;
const HISTORY_LIMIT = 60;
const builtinFonts = ["PingFang SC", "Microsoft YaHei", "SimHei", "STKaiti", "Arial Black"];

function uid() {
  return crypto.randomUUID();
}

function copyElements(elements: EditorElement[]) {
  return structuredClone(elements);
}

function textElement(patch: Partial<EditorElement> = {}): EditorElement {
  return {
    id: uid(),
    kind: "text",
    name: "文字",
    x: 110,
    y: 100,
    width: 860,
    height: 180,
    opacity: 1,
    text: "双击右侧修改文字",
    fontFamily: "PingFang SC",
    fontSize: 82,
    fontWeight: 800,
    lineHeight: 1.15,
    align: "center",
    color: "#ffffff",
    strokeColor: "#111111",
    strokeWidth: 7,
    backgroundColor: "transparent",
    radius: 22,
    shadowColor: "rgba(0,0,0,.35)",
    shadowBlur: 12,
    shadowOffsetY: 9,
    ...patch,
  };
}

function shapeElement(patch: Partial<EditorElement> = {}): EditorElement {
  return {
    id: uid(),
    kind: "shape",
    name: "色块",
    x: 160,
    y: 560,
    width: 760,
    height: 140,
    opacity: 1,
    shape: "rectangle",
    fill: "#ff1818",
    borderColor: "transparent",
    borderWidth: 0,
    radius: 34,
    ...patch,
  };
}

function imageElement(src: string, name: string, patch: Partial<EditorElement> = {}): EditorElement {
  return {
    id: uid(),
    kind: "image",
    name,
    x: 80,
    y: 240,
    width: 920,
    height: 980,
    opacity: 1,
    src,
    fit: "cover",
    radius: 26,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    blur: 0,
    flipX: false,
    flipY: false,
    positionX: 50,
    positionY: 50,
    borderColor: "transparent",
    borderWidth: 0,
    ...patch,
  };
}

function initialElements(): EditorElement[] {
  return [
    shapeElement({ name: "图片占位区", x: 0, y: 0, width: 1080, height: 1440, fill: "#cfc5b8", radius: 0 }),
    shapeElement({ name: "底部渐变替代", x: 0, y: 1030, width: 1080, height: 410, fill: "rgba(17,17,17,.68)", radius: 0 }),
    textElement({ name: "主标题", text: "装修不敢随便定？", x: 45, y: 62, width: 990, height: 210, fontSize: 104 }),
    textElement({ name: "权益标签", text: "免费上门量房", x: 620, y: 380, width: 390, height: 88, fontSize: 44, strokeWidth: 0, backgroundColor: "#ff1818", radius: 34, shadowBlur: 0, shadowOffsetY: 0 }),
    textElement({ name: "底部卖点", text: "免费体验 满意再定", x: 55, y: 1110, width: 970, height: 190, fontSize: 88, color: "#ffffff", strokeWidth: 8 }),
  ];
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safe = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, safe);
}

function wrapText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number) {
  const output: string[] = [];
  for (const paragraph of value.split("\n")) {
    if (!paragraph) {
      output.push("");
      continue;
    }
    let line = "";
    for (const character of Array.from(paragraph)) {
      const candidate = line + character;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        output.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    output.push(line);
  }
  return output;
}

function loadImage(src: string, cache: Map<string, HTMLImageElement>) {
  const existing = cache.get(src);
  if (existing?.complete && existing.naturalWidth) return Promise.resolve(existing);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = existing || new Image();
    if (!existing) {
      image.crossOrigin = "anonymous";
      image.src = src;
      cache.set(src, image);
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
  });
}

function drawImageElement(ctx: CanvasRenderingContext2D, element: EditorElement, image?: HTMLImageElement) {
  ctx.save();
  ctx.globalAlpha = element.opacity;
  roundedPath(ctx, element.x, element.y, element.width, element.height, element.radius || 0);
  ctx.clip();
  if (!image?.complete || !image.naturalWidth) {
    ctx.fillStyle = "#ddd7ce";
    ctx.fillRect(element.x, element.y, element.width, element.height);
    ctx.fillStyle = "#766f67";
    ctx.font = "600 34px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("图片载入中", element.x + element.width / 2, element.y + element.height / 2);
    ctx.restore();
    return;
  }
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = element.width / element.height;
  let drawWidth = element.width;
  let drawHeight = element.height;
  if (element.fit === "contain") {
    if (sourceRatio > targetRatio) drawHeight = drawWidth / sourceRatio;
    else drawWidth = drawHeight * sourceRatio;
    ctx.fillStyle = "#f3f1ed";
    ctx.fillRect(element.x, element.y, element.width, element.height);
  } else if (sourceRatio > targetRatio) {
    drawWidth = element.height * sourceRatio;
  } else {
    drawHeight = element.width / sourceRatio;
  }
  const drawX = element.x + (element.width - drawWidth) * ((element.positionX ?? 50) / 100);
  const drawY = element.y + (element.height - drawHeight) * ((element.positionY ?? 50) / 100);
  ctx.filter = `brightness(${element.brightness ?? 100}%) contrast(${element.contrast ?? 100}%) saturate(${element.saturation ?? 100}%) blur(${element.blur ?? 0}px)`;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  ctx.translate(centerX, centerY);
  ctx.scale(element.flipX ? -1 : 1, element.flipY ? -1 : 1);
  ctx.translate(-centerX, -centerY);
  ctx.drawImage(
    image,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );
  ctx.restore();
  if ((element.borderWidth || 0) > 0 && element.borderColor !== "transparent") {
    ctx.save();
    ctx.globalAlpha = element.opacity;
    ctx.strokeStyle = element.borderColor || "#ffffff";
    ctx.lineWidth = element.borderWidth || 0;
    roundedPath(ctx, element.x, element.y, element.width, element.height, element.radius || 0);
    ctx.stroke();
    ctx.restore();
  }
}

function drawShapeElement(ctx: CanvasRenderingContext2D, element: EditorElement) {
  ctx.save();
  ctx.globalAlpha = element.opacity;
  ctx.fillStyle = element.fill || "#ff1818";
  if (element.shape === "circle") {
    ctx.beginPath();
    ctx.ellipse(element.x + element.width / 2, element.y + element.height / 2, element.width / 2, element.height / 2, 0, 0, Math.PI * 2);
  } else if (element.shape === "star" || element.shape === "burst") {
    const points = element.shape === "star" ? 10 : 28;
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const outer = Math.min(element.width, element.height) / 2;
    const inner = outer * (element.shape === "star" ? .43 : .77);
    ctx.beginPath();
    for (let index = 0; index < points; index += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / points;
      const radius = index % 2 ? inner : outer;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else if (element.shape === "triangle") {
    ctx.beginPath();
    ctx.moveTo(element.x + element.width / 2, element.y);
    ctx.lineTo(element.x + element.width, element.y + element.height);
    ctx.lineTo(element.x, element.y + element.height);
    ctx.closePath();
  } else if (element.shape === "arrow") {
    const notch = element.width * .62;
    ctx.beginPath();
    ctx.moveTo(element.x, element.y + element.height * .28);
    ctx.lineTo(element.x + notch, element.y + element.height * .28);
    ctx.lineTo(element.x + notch, element.y);
    ctx.lineTo(element.x + element.width, element.y + element.height / 2);
    ctx.lineTo(element.x + notch, element.y + element.height);
    ctx.lineTo(element.x + notch, element.y + element.height * .72);
    ctx.lineTo(element.x, element.y + element.height * .72);
    ctx.closePath();
  } else if (element.shape === "line") {
    ctx.beginPath();
    const waves = 8;
    ctx.moveTo(element.x, element.y + element.height / 2);
    for (let index = 0; index < waves; index += 1) {
      const startX = element.x + (element.width / waves) * index;
      const endX = element.x + (element.width / waves) * (index + 1);
      ctx.quadraticCurveTo((startX + endX) / 2, element.y + (index % 2 ? element.height : 0), endX, element.y + element.height / 2);
    }
    ctx.lineWidth = Math.max(8, element.borderWidth || 18);
    ctx.lineCap = "round";
    ctx.strokeStyle = element.fill || "#ff1818";
    ctx.stroke();
    ctx.restore();
    return;
  } else {
    roundedPath(ctx, element.x, element.y, element.width, element.height, element.radius || 0);
  }
  ctx.fill();
  if ((element.borderWidth || 0) > 0 && element.borderColor !== "transparent") {
    ctx.lineWidth = element.borderWidth || 0;
    ctx.strokeStyle = element.borderColor || "#000000";
    ctx.stroke();
  }
  ctx.restore();
}

function drawTextElement(ctx: CanvasRenderingContext2D, element: EditorElement) {
  ctx.save();
  ctx.globalAlpha = element.opacity;
  if (element.backgroundColor && element.backgroundColor !== "transparent") {
    ctx.fillStyle = element.backgroundColor;
    roundedPath(ctx, element.x, element.y, element.width, element.height, element.radius || 0);
    ctx.fill();
  }
  const padding = element.backgroundColor && element.backgroundColor !== "transparent" ? 24 : 6;
  const fontSize = element.fontSize || 64;
  const lineHeight = fontSize * (element.lineHeight || 1.15);
  ctx.font = `${element.fontWeight || 700} ${fontSize}px "${element.fontFamily || "PingFang SC"}", sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = element.align || "left";
  ctx.lineJoin = "round";
  const lines = wrapText(ctx, element.text || "", Math.max(10, element.width - padding * 2));
  const totalHeight = lines.length * lineHeight;
  let y = element.y + Math.max(padding, (element.height - totalHeight) / 2);
  const x = element.align === "center"
    ? element.x + element.width / 2
    : element.align === "right"
      ? element.x + element.width - padding
      : element.x + padding;
  for (const line of lines) {
    ctx.shadowColor = element.shadowColor || "transparent";
    ctx.shadowBlur = element.shadowBlur || 0;
    ctx.shadowOffsetY = element.shadowOffsetY || 0;
    if ((element.strokeWidth || 0) > 0) {
      ctx.lineWidth = (element.strokeWidth || 0) * 2;
      ctx.strokeStyle = element.strokeColor || "#000000";
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = element.color || "#ffffff";
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  ctx.restore();
}

function drawScene(
  canvas: HTMLCanvasElement,
  elements: EditorElement[],
  background: string,
  selectedId: string | null,
  cache: Map<string, HTMLImageElement>,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  for (const element of elements) {
    if (element.kind === "image") drawImageElement(ctx, element, element.src ? cache.get(element.src) : undefined);
    if (element.kind === "shape") drawShapeElement(ctx, element);
    if (element.kind === "text") drawTextElement(ctx, element);
  }
  const selected = elements.find((element) => element.id === selectedId);
  if (!selected) return;
  ctx.save();
  ctx.strokeStyle = "#4f78ff";
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 9]);
  ctx.strokeRect(selected.x - 3, selected.y - 3, selected.width + 6, selected.height + 6);
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#4f78ff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(selected.x + selected.width, selected.y + selected.height, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function templateElements(kind: "poster" | "grid" | "detail" | "cinematic" | "comparison", existing: EditorElement[]) {
  const images = existing.filter((element) => element.kind === "image");
  if (kind === "grid") {
    const laidOut = images.slice(0, 4).map((element, index) => ({
      ...element,
      x: 70 + (index % 2) * 475,
      y: 260 + Math.floor(index / 2) * 465,
      width: 465,
      height: 450,
      radius: 18,
      fit: "cover" as ImageFit,
    }));
    const placeholders = Array.from({ length: Math.max(0, 4 - laidOut.length) }, (_, index) => {
      const slot = laidOut.length + index;
      return shapeElement({ name: `图片位置 ${slot + 1}`, x: 70 + (slot % 2) * 475, y: 260 + Math.floor(slot / 2) * 465, width: 465, height: 450, fill: "#d8d0c5", radius: 18 });
    });
    return [
      ...laidOut,
      ...placeholders,
      textElement({ name: "权益标题", text: "粉丝免费权益", x: 70, y: 60, width: 720, height: 130, align: "left", fontSize: 76, color: "#ffffff", strokeWidth: 0, shadowBlur: 0 }),
      textElement({ name: "CTA", text: "戳左下方【立即咨询】领取权益", x: 210, y: 1235, width: 660, height: 105, fontSize: 40, strokeWidth: 0, backgroundColor: "#ff1818", radius: 40, shadowBlur: 0 }),
    ];
  }
  if (kind === "detail") {
    const image = images[0]
      ? { ...images[0], x: 50, y: 50, width: 980, height: 1340, radius: 28, fit: "cover" as ImageFit }
      : shapeElement({ name: "主图位置", x: 50, y: 50, width: 980, height: 1340, fill: "#cec6bd", radius: 28 });
    return [
      image,
      shapeElement({ name: "说明遮罩", x: 50, y: 210, width: 980, height: 360, fill: "rgba(28,25,23,.72)", radius: 28 }),
      textElement({ name: "红色标签", text: "免费上门量房", x: 85, y: 125, width: 420, height: 96, align: "left", fontSize: 48, strokeWidth: 0, backgroundColor: "#ff1818", radius: 0, shadowBlur: 0 }),
      textElement({ name: "说明文字", text: "设计师实地勘测，评估各空间布局、动线规划及采光条件。", x: 90, y: 260, width: 900, height: 260, align: "left", fontSize: 49, strokeWidth: 5, shadowBlur: 0 }),
    ];
  }
  if (kind === "cinematic") {
    const image = images[0]
      ? { ...images[0], x: 0, y: 0, width: 1080, height: 1440, radius: 0, fit: "cover" as ImageFit, brightness: 78, saturation: 72 }
      : shapeElement({ name: "案例主图位置", x: 0, y: 0, width: 1080, height: 1440, fill: "#b79974", radius: 0 });
    return [
      image,
      shapeElement({ name: "暖色电影滤镜", x: 0, y: 0, width: 1080, height: 1440, fill: "rgba(122,75,37,.25)", radius: 0 }),
      textElement({ name: "电影感标题", text: "电影质感\n复古家", x: 65, y: 80, width: 760, height: 390, align: "left", fontSize: 120, strokeWidth: 0, shadowBlur: 0 }),
      textElement({ name: "项目地址", text: "闵行区  东苑利景花苑", x: 65, y: 480, width: 520, height: 86, align: "left", fontSize: 42, strokeWidth: 0, backgroundColor: "#ff1818", radius: 10, shadowBlur: 0 }),
      textElement({ name: "品牌标", text: "印匠鑫", x: 805, y: 1185, width: 210, height: 86, fontSize: 45, strokeWidth: 0, backgroundColor: "#ff1818", radius: 12, shadowBlur: 0 }),
      textElement({ name: "项目信息", text: "120平  3房  中古风", x: 600, y: 1300, width: 415, height: 82, fontSize: 42, color: "#111111", strokeWidth: 0, backgroundColor: "#ffffff", radius: 12, shadowBlur: 0 }),
    ];
  }
  if (kind === "comparison") {
    const slots = [0, 1].map((index) => images[index]
      ? { ...images[index], x: 0, y: index * 720, width: 1080, height: 720, radius: 0, fit: "cover" as ImageFit }
      : shapeElement({ name: `上下拼接图片 ${index + 1}`, x: 0, y: index * 720, width: 1080, height: 720, fill: index ? "#c9b18f" : "#d8cdbb", radius: 0 }));
    return [
      ...slots,
      textElement({ name: "上图标签", text: "厨房细节", x: 55, y: 55, width: 260, height: 72, fontSize: 34, strokeWidth: 0, backgroundColor: "#ff1818", radius: 28, shadowBlur: 0 }),
      textElement({ name: "下图标签", text: "客餐厅全景", x: 55, y: 775, width: 290, height: 72, fontSize: 34, strokeWidth: 0, backgroundColor: "#ff1818", radius: 28, shadowBlur: 0 }),
    ];
  }
  const image = images[0]
    ? { ...images[0], x: 0, y: 0, width: 1080, height: 1440, radius: 0, fit: "cover" as ImageFit }
    : shapeElement({ name: "主图位置", x: 0, y: 0, width: 1080, height: 1440, fill: "#cbc1b4", radius: 0 });
  return [
    image,
    shapeElement({ name: "底部遮罩", x: 0, y: 1030, width: 1080, height: 410, fill: "rgba(12,12,12,.68)", radius: 0 }),
    textElement({ name: "主标题", text: "装修不敢随便定？", x: 45, y: 65, width: 990, height: 200, fontSize: 105 }),
    textElement({ name: "权益 1", text: "免费上门量房", x: 620, y: 380, width: 390, height: 88, fontSize: 43, strokeWidth: 0, backgroundColor: "#ff1818", radius: 34, shadowBlur: 0 }),
    textElement({ name: "权益 2", text: "免费平面规划", x: 620, y: 485, width: 390, height: 88, fontSize: 43, strokeWidth: 0, backgroundColor: "#ff1818", radius: 34, shadowBlur: 0 }),
    textElement({ name: "底部卖点", text: "免费体验 满意再定", x: 55, y: 1120, width: 970, height: 190, fontSize: 86 }),
  ];
}

export default function ImageEditor({
  business,
  runnerOnline,
  runnerUrl,
  seedImage,
  onSeedConsumed,
  onUseImage,
  onOpenDraft,
  showToast,
}: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const imageCache = useRef(new Map<string, HTMLImageElement>());
  const loadedFontIds = useRef(new Set<string>());
  const history = useRef<EditorElement[][]>([]);
  const future = useRef<EditorElement[][]>([]);
  const drag = useRef<null | {
    mode: "move" | "resize";
    id: string;
    startX: number;
    startY: number;
    original: EditorElement;
    before: EditorElement[];
  }>(null);
  const [elements, setElements] = useState<EditorElement[]>(initialElements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [background, setBackground] = useState("#e7ddcf");
  const [assetVersion, setAssetVersion] = useState(0);
  const [customFonts, setCustomFonts] = useState<FontRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [removingBackground, setRemovingBackground] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState("正在读取自动保存…");
  const [zoom, setZoom] = useState(45);

  const selected = useMemo(() => elements.find((element) => element.id === selectedId) || null, [elements, selectedId]);

  const remember = useCallback((snapshot: EditorElement[]) => {
    history.current.push(copyElements(snapshot));
    if (history.current.length > HISTORY_LIMIT) history.current.shift();
    future.current = [];
  }, []);

  const commit = useCallback((updater: EditorElement[] | ((current: EditorElement[]) => EditorElement[])) => {
    setElements((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      remember(current);
      return next;
    });
  }, [remember]);

  const updateSelected = useCallback((patch: Partial<EditorElement>) => {
    if (!selectedId) return;
    commit((current) => current.map((element) => element.id === selectedId ? { ...element, ...patch } : element));
  }, [commit, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setHydrated(false);
      setSaveStatus(runnerOnline ? "正在读取自动保存…" : "本地服务离线，暂未自动保存");
      history.current = [];
      future.current = [];
      setSelectedId(null);
      if (!runnerOnline) {
        setElements(initialElements());
        setBackground("#e7ddcf");
        setZoom(45);
        setHydrated(true);
        return;
      }
      try {
        const response = await fetch(`${runnerUrl}/api/designs/project?business=${business}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "读取自动保存失败");
        if (cancelled) return;
        if (data.project?.elements?.length) {
          setElements(data.project.elements);
          setBackground(data.project.background || "#e7ddcf");
          setZoom(data.project.zoom || 45);
          setSaveStatus(`已恢复 ${new Date(data.project.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 的画布`);
        } else {
          setElements(initialElements());
          setBackground("#e7ddcf");
          setZoom(45);
          setSaveStatus("已开启自动保存");
        }
      } catch (error) {
        if (!cancelled) setSaveStatus(error instanceof Error ? error.message : "读取自动保存失败");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [business, runnerOnline, runnerUrl]);

  useEffect(() => {
    if (!hydrated || !runnerOnline) return;
    const timer = window.setTimeout(async () => {
      try {
        setSaveStatus("正在自动保存…");
        const response = await fetch(`${runnerUrl}/api/designs/project?business=${business}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ elements, background, zoom }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "自动保存失败");
        setSaveStatus(`已自动保存 ${new Date(data.project.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
      } catch (error) {
        setSaveStatus(error instanceof Error ? error.message : "自动保存失败");
      }
    }, 850);
    return () => window.clearTimeout(timer);
  }, [background, business, elements, hydrated, runnerOnline, runnerUrl, zoom]);

  const ensureImages = useCallback((items: EditorElement[]) => {
    for (const element of items) {
      if (element.kind !== "image" || !element.src) continue;
      void loadImage(element.src, imageCache.current)
        .then(() => setAssetVersion((value) => value + 1))
        .catch(() => showToast(`无法读取图片：${element.name}`));
    }
  }, [showToast]);

  useEffect(() => {
    ensureImages(elements);
  }, [elements, ensureImages]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawScene(canvas, elements, background, selectedId, imageCache.current);
  }, [assetVersion, background, elements, selectedId]);

  const registerFont = useCallback(async (font: FontRecord) => {
    if (loadedFontIds.current.has(font.id)) return;
    const face = new FontFace(font.family, `url(${runnerUrl}/api/design/fonts/${encodeURIComponent(font.id)}/file)`);
    await face.load();
    document.fonts.add(face);
    loadedFontIds.current.add(font.id);
  }, [runnerUrl]);

  useEffect(() => {
    if (!runnerOnline) return;
    void fetch(`${runnerUrl}/api/design/fonts`)
      .then((response) => response.json())
      .then(async (data) => {
        const fonts = Array.isArray(data.fonts) ? data.fonts as FontRecord[] : [];
        setCustomFonts(fonts);
        await Promise.all(fonts.map((font) => registerFont(font).catch(() => undefined)));
        setAssetVersion((value) => value + 1);
      })
      .catch(() => undefined);
  }, [registerFont, runnerOnline, runnerUrl]);

  const addImageSource = useCallback((src: string, name: string) => {
    const element = imageElement(src, name);
    commit((current) => [...current, element]);
    setSelectedId(element.id);
  }, [commit]);

  useEffect(() => {
    if (!seedImage || !hydrated) return;
    const timer = window.setTimeout(() => {
      addImageSource(seedImage.src, seedImage.name);
      onSeedConsumed?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [addImageSource, hydrated, onSeedConsumed, seedImage]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (command && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
      }
      if (event.key === "Delete" || event.key === "Backspace") deleteSelected();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
      y: (event.clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = canvasPoint(event);
    const active = selected && Math.hypot(point.x - (selected.x + selected.width), point.y - (selected.y + selected.height)) < 32
      ? selected
      : [...elements].reverse().find((element) => !element.locked && point.x >= element.x && point.x <= element.x + element.width && point.y >= element.y && point.y <= element.y + element.height);
    if (!active) {
      setSelectedId(null);
      return;
    }
    setSelectedId(active.id);
    drag.current = {
      mode: selected?.id === active.id && Math.hypot(point.x - (active.x + active.width), point.y - (active.y + active.height)) < 32 ? "resize" : "move",
      id: active.id,
      startX: point.x,
      startY: point.y,
      original: copyElements([active])[0],
      before: copyElements(elements),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return;
    const point = canvasPoint(event);
    const currentDrag = drag.current;
    const dx = point.x - currentDrag.startX;
    const dy = point.y - currentDrag.startY;
    setElements((current) => current.map((element) => {
      if (element.id !== currentDrag.id) return element;
      if (currentDrag.mode === "resize") {
        return { ...element, width: Math.max(50, currentDrag.original.width + dx), height: Math.max(50, currentDrag.original.height + dy) };
      }
      return {
        ...element,
        x: Math.min(CANVAS_WIDTH - 20, Math.max(20 - element.width, currentDrag.original.x + dx)),
        y: Math.min(CANVAS_HEIGHT - 20, Math.max(20 - element.height, currentDrag.original.y + dy)),
      };
    }));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drag.current) remember(drag.current.before);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function undo() {
    const previous = history.current.pop();
    if (!previous) return;
    setElements((current) => {
      future.current.push(copyElements(current));
      return previous;
    });
    setSelectedId(null);
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    setElements((current) => {
      history.current.push(copyElements(current));
      return next;
    });
    setSelectedId(null);
  }

  function deleteSelected() {
    if (!selectedId) return;
    commit((current) => current.filter((element) => element.id !== selectedId));
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!selected) return;
    const duplicate = { ...copyElements([selected])[0], id: uid(), name: `${selected.name} 副本`, x: selected.x + 28, y: selected.y + 28 };
    commit((current) => [...current, duplicate]);
    setSelectedId(duplicate.id);
  }

  function addText() {
    const element = textElement({ text: "输入标题", y: 120 + (elements.filter((item) => item.kind === "text").length % 5) * 120 });
    commit((current) => [...current, element]);
    setSelectedId(element.id);
  }

  function addShape(shape: ShapeKind) {
    const settings: Record<ShapeKind, Partial<EditorElement>> = {
      rectangle: { name: "圆角色块", width: 700, height: 140, radius: 34 },
      circle: { name: "圆形贴纸", width: 260, height: 260 },
      star: { name: "星形贴纸", width: 280, height: 280, fill: "#ffd43b" },
      triangle: { name: "三角贴纸", width: 300, height: 260, fill: "#ff7a18" },
      arrow: { name: "箭头贴纸", width: 440, height: 190, fill: "#ff1818" },
      burst: { name: "爆炸贴纸", width: 320, height: 320, fill: "#ff1818" },
      line: { name: "波浪下划线", width: 520, height: 90, fill: "#ff1818", borderWidth: 18 },
    };
    const element = shapeElement({ shape, ...settings[shape] });
    commit((current) => [...current, element]);
    setSelectedId(element.id);
  }

  async function persistImageFile(file: Blob, name: string) {
    if (!runnerOnline) return URL.createObjectURL(file);
    const response = await fetch(`${runnerUrl}/api/designs/assets/upload?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "图片保存失败");
    return `${runnerUrl}/api/designs/assets/${encodeURIComponent(data.asset.id)}/file`;
  }

  async function addUploadedFiles(files: File[], asSticker = false) {
    if (!files.length) return;
    setSaveStatus("正在保存上传图片…");
    try {
      const sources = await Promise.all(files.map((file) => persistImageFile(file, file.name)));
      const additions = files.map((file, index) => imageElement(sources[index], asSticker ? `贴图 · ${file.name}` : file.name, {
        x: asSticker ? 390 + index * 24 : 80 + (index % 2) * 465,
        y: asSticker ? 520 + index * 24 : 260 + Math.floor(index / 2) * 465,
        width: asSticker ? 300 : files.length === 1 ? 920 : 445,
        height: asSticker ? 300 : files.length === 1 ? 980 : 445,
        fit: asSticker ? "contain" : "cover",
      }));
      commit((current) => [...current, ...additions]);
      setSelectedId(additions[additions.length - 1].id);
      showToast(asSticker ? `已添加 ${files.length} 个自定义贴图` : `已添加 ${files.length} 张图片，可拖动和缩放`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "图片上传失败");
    }
  }

  async function uploadImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await addUploadedFiles(files);
  }

  async function uploadSticker(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await addUploadedFiles(files, true);
  }

  async function uploadFont(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(ttf|otf|woff2?|ttc)$/i.test(file.name)) {
      showToast("字体包需为 TTF、OTF、WOFF 或 WOFF2 格式");
      return;
    }
    try {
      let record: FontRecord;
      if (runnerOnline) {
        const response = await fetch(`${runnerUrl}/api/design/fonts/upload?name=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "字体保存失败");
        record = data.font;
        await registerFont(record);
      } else {
        const family = `用户字体-${file.name.replace(/\.[^.]+$/, "")}`;
        const face = new FontFace(family, await file.arrayBuffer());
        await face.load();
        document.fonts.add(face);
        record = { id: family, name: file.name, family };
      }
      setCustomFonts((current) => [record, ...current.filter((font) => font.id !== record.id)]);
      if (selected?.kind === "text") updateSelected({ fontFamily: record.family });
      setAssetVersion((value) => value + 1);
      showToast(runnerOnline ? "字体已保存到红序并应用" : "字体已应用；启动本地服务后可长期保存");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "字体读取失败");
    }
  }

  async function removeSelectedBackground() {
    if (!selected?.src || selected.kind !== "image") return;
    setRemovingBackground(true);
    setSaveStatus("AI 正在识别主体，首次使用会加载模型…");
    try {
      const sourceResponse = await fetch(selected.src);
      if (!sourceResponse.ok) throw new Error("无法读取当前图片");
      const sourceBlob = await sourceResponse.blob();
      const { default: removeBackground } = await import("@imgly/background-removal");
      const result = await removeBackground(sourceBlob, {
        progress: (_key: string, current: number, total: number) => {
          if (total > 0) setSaveStatus(`AI 抠图 ${Math.min(100, Math.round((current / total) * 100))}%`);
        },
      });
      const name = `${selected.name.replace(/\.[^.]+$/, "")}-AI抠图.png`;
      const src = await persistImageFile(result, name);
      imageCache.current.delete(src);
      updateSelected({ src, name, fit: "contain", brightness: 100, contrast: 100, saturation: 100, blur: 0 });
      showToast("AI 抠图完成，透明背景已自动保存");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "AI 抠图失败，请换一张主体更清晰的图片重试");
    } finally {
      setRemovingBackground(false);
    }
  }

  function applyTemplate(kind: "poster" | "grid" | "detail" | "cinematic" | "comparison") {
    const next = templateElements(kind, elements);
    commit(next);
    setSelectedId(next.at(-1)?.id || null);
    setBackground(kind === "grid" ? "#dfd1bd" : "#eee7dc");
    const labels = { poster: "人物爆款封面", grid: "粉丝权益四宫格", detail: "服务说明大图", cinematic: "电影感案例封面", comparison: "上下拼接案例" };
    showToast(`已套用${labels[kind]}模板`);
  }

  function arrangeImages(layout: "full" | "split" | "grid") {
    const images = elements.filter((element) => element.kind === "image");
    if (!images.length) {
      showToast("请先上传图片或从素材中心选择图片");
      return;
    }
    const ids = new Set(images.map((image) => image.id));
    commit((current) => current.map((element) => {
      if (!ids.has(element.id)) return element;
      const index = images.findIndex((image) => image.id === element.id);
      if (layout === "full") return index === 0 ? { ...element, x: 0, y: 0, width: 1080, height: 1440, radius: 0, fit: "cover" } : element;
      if (layout === "split") return { ...element, x: 40, y: 40 + index * 690, width: 1000, height: 670, radius: 20, fit: "cover" };
      return { ...element, x: 40 + (index % 2) * 510, y: 200 + Math.floor(index / 2) * 510, width: 490, height: 490, radius: 18, fit: "cover" };
    }));
    showToast(layout === "full" ? "主图已铺满画布" : layout === "split" ? "图片已上下拼接" : "图片已排列为四宫格");
  }

  function moveLayer(direction: "up" | "down" | "front") {
    if (!selectedId) return;
    commit((current) => {
      const index = current.findIndex((element) => element.id === selectedId);
      if (index < 0) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      const target = direction === "front" ? next.length : direction === "up" ? Math.min(next.length, index + 1) : Math.max(0, index - 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  async function createOutputBlob() {
    const images = elements.filter((element) => element.kind === "image" && element.src);
    await Promise.all(images.map((element) => loadImage(element.src!, imageCache.current)));
    await document.fonts.ready;
    const output = document.createElement("canvas");
    output.width = CANVAS_WIDTH;
    output.height = CANVAS_HEIGHT;
    drawScene(output, elements, background, null, imageCache.current);
    return new Promise<Blob>((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error("成图生成失败")), "image/png", 1));
  }

  async function downloadPng() {
    try {
      const blob = await createOutputBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `红序成图-${Date.now()}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast("高清 PNG 已下载（1080 × 1440）");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "导出失败");
    }
  }

  async function saveToDraft() {
    if (!runnerOnline) {
      showToast("本地执行器未连接；可先下载 PNG，连接后再加入草稿");
      return;
    }
    setSaving(true);
    try {
      const blob = await createOutputBlob();
      const response = await fetch(`${runnerUrl}/api/designs/save?business=${business}&name=${encodeURIComponent(`红序成图-${Date.now()}.png`)}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: blob,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存成图失败");
      onUseImage(data.design.localPath);
      showToast("成图已保存并加入当前草稿");
      onOpenDraft();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存成图失败");
    } finally {
      setSaving(false);
    }
  }

  const layerLabel = (element: EditorElement) => element.kind === "text" ? element.text?.slice(0, 10) || "文字" : element.name;

  return (
    <section className="designer-page">
      <div className="page-header designer-page-header">
        <div><h1>图片设计</h1><p>按小红书 3:4 规格完成拼图、大字封面和图文说明，成图可直接进入当前发布草稿。</p></div>
        <div className="page-header-actions">
          <span className={`designer-save-status ${saveStatus.includes("失败") || saveStatus.includes("离线") ? "warn" : ""}`}><span />{saveStatus}</span>
          <button className="secondary-button" onClick={downloadPng}><Download size={15} />下载 PNG</button>
          <button className="primary-button" disabled={saving || !runnerOnline} onClick={saveToDraft}>{saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存并加入草稿</button>
        </div>
      </div>

      <div className="designer-template-strip">
        <div><Palette size={16} /><span>案例模板</span></div>
        <button onClick={() => applyTemplate("poster")}><strong>人物爆款封面</strong><span>对应案例 1</span></button>
        <button onClick={() => applyTemplate("grid")}><strong>粉丝权益四宫格</strong><span>对应案例 2</span></button>
        <button onClick={() => applyTemplate("detail")}><strong>服务说明大图</strong><span>对应案例 3</span></button>
        <button onClick={() => applyTemplate("cinematic")}><strong>电影感案例</strong><span>对应案例 4</span></button>
        <button onClick={() => applyTemplate("comparison")}><strong>上下拼接案例</strong><span>对应案例 5</span></button>
      </div>

      <div className="designer-shell">
        <aside className="designer-tools">
          <div className="designer-panel-title"><span>添加内容</span><small>点击后可在画布拖动</small></div>
          <div className="designer-add-grid">
            <button onClick={() => imageInputRef.current?.click()}><Upload size={18} /><span>上传图片</span></button>
            <button onClick={addText}><Type size={18} /><span>添加文字</span></button>
            <button onClick={() => addShape("rectangle")}><Square size={18} /><span>色块</span></button>
            <button onClick={() => addShape("circle")}><Circle size={18} /><span>圆形</span></button>
          </div>
          <input ref={imageInputRef} hidden multiple type="file" accept="image/*" onChange={uploadImages} />

          <div className="designer-panel-title with-line"><span>贴图</span><small>可自由改色和缩放</small></div>
          <div className="sticker-grid">
            <button title="星形" onClick={() => addShape("star")}><Star size={17} /></button>
            <button title="三角形" onClick={() => addShape("triangle")}><Triangle size={17} /></button>
            <button title="箭头" onClick={() => addShape("arrow")}><ArrowRight size={17} /></button>
            <button title="爆炸贴" onClick={() => addShape("burst")}><Sparkles size={17} /></button>
            <button title="波浪下划线" onClick={() => addShape("line")}><Sticker size={17} /></button>
            <button title="上传自己的贴图" onClick={() => stickerInputRef.current?.click()}><Upload size={17} /></button>
          </div>
          <input ref={stickerInputRef} hidden multiple type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={uploadSticker} />

          <div className="designer-panel-title with-line"><span>图片拼版</span><small>对全部图片生效</small></div>
          <div className="layout-buttons">
            <button onClick={() => arrangeImages("full")}><Maximize2 size={15} />铺满</button>
            <button onClick={() => arrangeImages("split")}><Minus size={15} />上下</button>
            <button onClick={() => arrangeImages("grid")}><Layers3 size={15} />四宫格</button>
          </div>

          <div className="designer-panel-title with-line"><span>图层</span><small>{elements.length} 个</small></div>
          <div className="layer-list">
            {[...elements].reverse().map((element) => (
              <button className={selectedId === element.id ? "active" : ""} key={element.id} onClick={() => setSelectedId(element.id)}>
                {element.kind === "text" ? <Type size={13} /> : element.kind === "image" ? <ImageIcon size={13} /> : <Square size={13} />}
                <span>{layerLabel(element)}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="designer-stage-panel">
          <div className="designer-stage-toolbar">
            <div>
              <button title="撤销" disabled={!history.current.length} onClick={undo}><Undo2 size={15} /></button>
              <button title="重做" disabled={!future.current.length} onClick={redo}><Redo2 size={15} /></button>
              <span>1080 × 1440 · 3:4</span>
            </div>
            <label><Minus size={13} /><input aria-label="缩放画布" type="range" min="30" max="62" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><Plus size={13} /><span>{zoom}%</span></label>
          </div>
          <div className="designer-stage" style={{ "--canvas-zoom": zoom / 100 } as React.CSSProperties}>
            <canvas
              ref={canvasRef}
              aria-label="图片设计画布"
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>
          <div className="designer-stage-hint">拖动元素调整位置 · 右下角圆点缩放 · Delete 删除 · ⌘D 复制</div>
        </div>

        <aside className="designer-properties">
          <div className="designer-panel-title"><span>样式设置</span><small>{selected ? selected.name : "未选择元素"}</small></div>
          {!selected ? (
            <div className="property-empty"><Palette size={24} /><strong>选择画布元素</strong><span>选择文字、图片或色块后，可在这里精细调整。</span></div>
          ) : (
            <>
              <div className="layer-quick-actions">
                <button title="下移一层" onClick={() => moveLayer("down")}><ArrowDown size={14} /></button>
                <button title="上移一层" onClick={() => moveLayer("up")}><ArrowUp size={14} /></button>
                <button title="置于顶层" onClick={() => moveLayer("front")}><BringToFront size={14} /></button>
                <button title="复制" onClick={duplicateSelected}><Copy size={14} /></button>
                <button className="danger" title="删除" onClick={deleteSelected}><Trash2 size={14} /></button>
              </div>

              {selected.kind === "text" && (
                <div className="property-section">
                  <label className="full"><span>文字内容</span><textarea rows={4} value={selected.text || ""} onChange={(event) => updateSelected({ text: event.target.value })} /></label>
                  <label className="full"><span>字体</span><select value={selected.fontFamily} onChange={(event) => updateSelected({ fontFamily: event.target.value })}>{builtinFonts.map((font) => <option key={font}>{font}</option>)}{customFonts.map((font) => <option key={font.id} value={font.family}>我的字体 · {font.name.replace(/\.[^.]+$/, "")}</option>)}</select></label>
                  <small className="font-library-note">已载入 {customFonts.length} 个自定义字体{customFonts.length ? "，选择后立即应用到画布" : ""}</small>
                  <button className="font-upload-button" onClick={() => fontInputRef.current?.click()}><Upload size={14} />上传自己的字体包</button>
                  <input ref={fontInputRef} hidden type="file" accept=".ttf,.otf,.woff,.woff2,.ttc" onChange={uploadFont} />
                  <div className="property-grid two">
                    <label><span>字号</span><input type="number" min="12" max="240" value={selected.fontSize} onChange={(event) => updateSelected({ fontSize: Number(event.target.value) })} /></label>
                    <label><span>行高</span><input type="number" min="0.8" max="2" step="0.05" value={selected.lineHeight} onChange={(event) => updateSelected({ lineHeight: Number(event.target.value) })} /></label>
                  </div>
                  <div className="text-format-row">
                    <button className={(selected.fontWeight || 0) >= 800 ? "active" : ""} onClick={() => updateSelected({ fontWeight: (selected.fontWeight || 0) >= 800 ? 500 : 900 })}><Bold size={15} /></button>
                    <button className={selected.align === "left" ? "active" : ""} onClick={() => updateSelected({ align: "left" })}><AlignLeft size={15} /></button>
                    <button className={selected.align === "center" ? "active" : ""} onClick={() => updateSelected({ align: "center" })}><AlignCenter size={15} /></button>
                    <button className={selected.align === "right" ? "active" : ""} onClick={() => updateSelected({ align: "right" })}><AlignRight size={15} /></button>
                  </div>
                  <div className="property-grid two color-fields">
                    <label><span>文字颜色</span><input type="color" value={selected.color || "#ffffff"} onChange={(event) => updateSelected({ color: event.target.value })} /></label>
                    <label><span>描边颜色</span><input type="color" value={selected.strokeColor || "#000000"} onChange={(event) => updateSelected({ strokeColor: event.target.value })} /></label>
                    <label><span>描边粗细</span><input type="number" min="0" max="24" value={selected.strokeWidth} onChange={(event) => updateSelected({ strokeWidth: Number(event.target.value) })} /></label>
                    <label><span>圆角</span><input type="number" min="0" max="100" value={selected.radius} onChange={(event) => updateSelected({ radius: Number(event.target.value) })} /></label>
                  </div>
                  <div className="style-presets">
                    <button onClick={() => updateSelected({ color: "#ffffff", strokeColor: "#000000", strokeWidth: 8, backgroundColor: "transparent", shadowBlur: 12, shadowOffsetY: 9 })}>白字黑边</button>
                    <button onClick={() => updateSelected({ color: "#ff1414", strokeColor: "#000000", strokeWidth: 8, backgroundColor: "transparent" })}>红色强调</button>
                    <button onClick={() => updateSelected({ color: "#ffffff", strokeWidth: 0, backgroundColor: "#ff1818", radius: 32, shadowBlur: 0 })}>红底标签</button>
                  </div>
                </div>
              )}

              {selected.kind === "image" && (
                <div className="property-section">
                  <button className="ai-cutout-button" disabled={removingBackground} onClick={removeSelectedBackground}>{removingBackground ? <LoaderCircle className="spin" size={15} /> : <WandSparkles size={15} />}{removingBackground ? "AI 正在抠图…" : "AI 自动抠图"}</button>
                  <label className="full"><span>图片填充方式</span><select value={selected.fit} onChange={(event) => updateSelected({ fit: event.target.value as ImageFit })}><option value="cover">铺满裁切</option><option value="contain">完整显示</option></select></label>
                  <label className="property-range"><span>方块圆角 <em>{selected.radius || 0}</em></span><input type="range" min="0" max="200" value={selected.radius || 0} onChange={(event) => updateSelected({ radius: Number(event.target.value) })} /></label>
                  <label className="property-range"><span>图片透明度 <em>{Math.round(selected.opacity * 100)}%</em></span><input type="range" min="0" max="100" value={Math.round(selected.opacity * 100)} onChange={(event) => updateSelected({ opacity: Number(event.target.value) / 100 })} /></label>
                  <div className="property-grid two color-fields"><label><span>图片边框</span><input type="color" value={selected.borderColor?.startsWith("#") ? selected.borderColor : "#ffffff"} onChange={(event) => updateSelected({ borderColor: event.target.value })} /></label><label><span>边框粗细</span><input type="number" min="0" max="40" value={selected.borderWidth || 0} onChange={(event) => updateSelected({ borderWidth: Number(event.target.value) })} /></label></div>
                  <label className="property-range"><span>亮度 <em>{selected.brightness ?? 100}%</em></span><input type="range" min="20" max="180" value={selected.brightness ?? 100} onChange={(event) => updateSelected({ brightness: Number(event.target.value) })} /></label>
                  <label className="property-range"><span>对比度 <em>{selected.contrast ?? 100}%</em></span><input type="range" min="20" max="180" value={selected.contrast ?? 100} onChange={(event) => updateSelected({ contrast: Number(event.target.value) })} /></label>
                  <label className="property-range"><span>饱和度 <em>{selected.saturation ?? 100}%</em></span><input type="range" min="0" max="200" value={selected.saturation ?? 100} onChange={(event) => updateSelected({ saturation: Number(event.target.value) })} /></label>
                  {selected.fit === "cover" && <><label className="property-range"><span>图片横向位置 <em>{selected.positionX ?? 50}%</em></span><input type="range" min="0" max="100" value={selected.positionX ?? 50} onChange={(event) => updateSelected({ positionX: Number(event.target.value) })} /></label><label className="property-range"><span>图片纵向位置 <em>{selected.positionY ?? 50}%</em></span><input type="range" min="0" max="100" value={selected.positionY ?? 50} onChange={(event) => updateSelected({ positionY: Number(event.target.value) })} /></label></>}
                  <div className="image-flip-row"><button className={selected.flipX ? "active" : ""} onClick={() => updateSelected({ flipX: !selected.flipX })}><FlipHorizontal2 size={14} />水平翻转</button><button className={selected.flipY ? "active" : ""} onClick={() => updateSelected({ flipY: !selected.flipY })}><FlipVertical2 size={14} />垂直翻转</button></div>
                  <button className="font-upload-button" onClick={() => updateSelected({ x: 0, y: 0, width: 1080, height: 1440, radius: 0, fit: "cover" })}><Maximize2 size={14} />设为铺满主图</button>
                </div>
              )}

              {selected.kind === "shape" && (
                <div className="property-section">
                  <div className="property-grid two color-fields"><label><span>填充颜色</span><input type="color" value={selected.fill?.startsWith("#") ? selected.fill : "#ff1818"} onChange={(event) => updateSelected({ fill: event.target.value })} /></label><label><span>边框颜色</span><input type="color" value={selected.borderColor?.startsWith("#") ? selected.borderColor : "#000000"} onChange={(event) => updateSelected({ borderColor: event.target.value })} /></label><label><span>边框粗细</span><input type="number" min="0" max="30" value={selected.borderWidth} onChange={(event) => updateSelected({ borderWidth: Number(event.target.value) })} /></label><label><span>圆角</span><input type="number" min="0" max="160" value={selected.radius} onChange={(event) => updateSelected({ radius: Number(event.target.value) })} /></label></div>
                  <label className="property-range"><span>贴图透明度 <em>{Math.round(selected.opacity * 100)}%</em></span><input type="range" min="0" max="100" value={Math.round(selected.opacity * 100)} onChange={(event) => updateSelected({ opacity: Number(event.target.value) / 100 })} /></label>
                </div>
              )}

              <div className="property-section common-properties">
                <div className="property-grid two">
                  <label><span>X</span><input type="number" value={Math.round(selected.x)} onChange={(event) => updateSelected({ x: Number(event.target.value) })} /></label>
                  <label><span>Y</span><input type="number" value={Math.round(selected.y)} onChange={(event) => updateSelected({ y: Number(event.target.value) })} /></label>
                  <label><span>宽</span><input type="number" min="20" value={Math.round(selected.width)} onChange={(event) => updateSelected({ width: Number(event.target.value) })} /></label>
                  <label><span>高</span><input type="number" min="20" value={Math.round(selected.height)} onChange={(event) => updateSelected({ height: Number(event.target.value) })} /></label>
                </div>
              </div>
            </>
          )}
          <div className="canvas-background-setting"><span>画布底色</span><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /></div>
        </aside>
      </div>
    </section>
  );
}
