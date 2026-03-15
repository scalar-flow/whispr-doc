//visual-detection.ts
import { DetectedField, DetectionMode, SIGNATURE_REGEX, DATE_REGEX } from "./pdf-utils"

interface LineLabelResult {
    text: string
    source: 'above' | 'left' | 'below'
    bottom?: number
}

interface LabelResult {
    text: string
    insideBottom?: number
}

// --- Polyfills (unchanged) ---
if (typeof Promise.withResolvers === "undefined") {
    // @ts-ignore
    Promise.withResolvers = function () {
        let resolve, reject
        const promise = new Promise((res, rej) => {
            resolve = res
            reject = rej
        })
        return { promise, resolve, reject }
    }
}

if (typeof (global as any).DOMMatrix === "undefined") {
    ; (global as any).DOMMatrix = class DOMMatrix {
        a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
        constructor(init?: string | number[]) {
            if (Array.isArray(init)) {
                const [a, b, c, d, e, f] = init
                this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f
            }
        }
        multiply() { return this }
        transformPoint(p: any) { return p }
        translate() { return this }
        scale() { return this }
        rotate() { return this }
    }
}

// --- Interfaces ---
interface BBox {
    x: number
    y: number
    width: number
    height: number
}

interface GraphicItem {
    type: "rectangle" | "line" | "circle"
    bbox: BBox
    filled?: boolean
}

interface TextItem {
    text: string
    bbox: BBox
    fontSize: number
    fontName: string
    consumed?: boolean
}

// --- Constants ---
const MAX_LABEL_WORDS = 6;

// --- Raw Extraction Logic (Standard PDF Ops) ---
const OPS = {
    save: 10,
    restore: 11,
    transform: 12,
    moveTo: 13,
    lineTo: 14,
    curveTo: 15,
    curveTo2: 16,
    curveTo3: 17,
    constructPath: 91,
    rectangle: 19,
    stroke: 20,
    fill: 22,
    eoFill: 23,
    fillStroke: 24,
}

function analyzePath(points: { x: number; y: number }[], hasCurves: boolean): GraphicItem | null {
    if (points.length < 2) return null

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of points) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
    }

    const width = maxX - minX
    const height = maxY - minY

    if (hasCurves && Math.abs(width - height) < 2 && width >= 2 && width <= 26) {
        return {
            type: "circle",
            bbox: { x: minX, y: minY, width, height }
        }
    }

    if (height <= 5 && width > 5) {
        return {
            type: "line",
            bbox: { x: minX, y: minY, width, height: Math.max(1, height) }
        }
    }

    if (width > 5 && height > 5) {
        return {
            type: "rectangle",
            bbox: { x: minX, y: minY, width, height }
        }
    }

    return null
}

export async function extractGraphicsRaw(pdfJsPage: any, pageHeight: number): Promise<GraphicItem[]> {
    const opList = await pdfJsPage.getOperatorList()
    const items: GraphicItem[] = []
    let pendingItems: GraphicItem[] = []

    const fnArray = opList.fnArray
    const argsArray = opList.argsArray
    let currentPath: { x: number; y: number }[] = []
    let pathHasCurves = false

    let ctm = [1, 0, 0, 1, 0, 0]
    const ctmStack: number[][] = []

    const applyTransform = (x: number, y: number): { x: number; y: number } => {
        return {
            x: ctm[0] * x + ctm[2] * y + ctm[4],
            y: ctm[1] * x + ctm[3] * y + ctm[5]
        }
    }

    const multiplyMatrices = (m1: number[], m2: number[]): number[] => {
        return [
            m1[0] * m2[0] + m1[2] * m2[1],
            m1[1] * m2[0] + m1[3] * m2[1],
            m1[0] * m2[2] + m1[2] * m2[3],
            m1[1] * m2[2] + m1[3] * m2[3],
            m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
            m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
        ]
    }

    // Helper to move pending items to final list with fill status
    const flushPending = (isFilled: boolean) => {
        for (const item of pendingItems) {
            item.filled = isFilled
            items.push(item)
        }
        pendingItems = []
    }

    const commitPath = () => {
        if (currentPath.length > 0) {
            const item = analyzePath(currentPath, pathHasCurves)
            // Push to pending instead of final items
            if (item) pendingItems.push(item)
            currentPath = []
            pathHasCurves = false
        }
    }

    const addRectangle = (x: number, y: number, w: number, h: number) => {
        const corners = [
            applyTransform(x, y),
            applyTransform(x + w, y),
            applyTransform(x + w, y + h),
            applyTransform(x, y + h)
        ]

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const c of corners) {
            if (c.x < minX) minX = c.x
            if (c.x > maxX) maxX = c.x
            if (c.y < minY) minY = c.y
            if (c.y > maxY) maxY = c.y
        }

        const width = maxX - minX
        const height = maxY - minY

        if (width > 500 && height > 500) return

        // Push to pending
        pendingItems.push({
            type: "rectangle",
            bbox: { x: minX, y: minY, width, height }
        })
    }

    for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i]
        const args = argsArray[i]

        if (fn === OPS.save) {
            ctmStack.push([...ctm])
        }
        else if (fn === OPS.restore) {
            if (ctmStack.length > 0) {
                ctm = ctmStack.pop()!
            }
        }
        else if (fn === OPS.transform) {
            ctm = multiplyMatrices(ctm, args)
        }
        else if (fn === OPS.rectangle) {
            const [x, y, w, h] = args
            addRectangle(x, y, w, h)
        }
        else if (fn === OPS.constructPath) {
            const [subOps, subArgs] = args
            let argIdx = 0
            for (let j = 0; j < subOps.length; j++) {
                const op = subOps[j]
                if (op === OPS.moveTo) {
                    commitPath()
                    const x = subArgs[argIdx++]
                    const y = subArgs[argIdx++]
                    const tp = applyTransform(x, y)
                    currentPath.push(tp)
                }
                else if (op === OPS.lineTo) {
                    const x = subArgs[argIdx++]
                    const y = subArgs[argIdx++]
                    const tp = applyTransform(x, y)
                    currentPath.push(tp)
                }
                else if (op === OPS.rectangle) {
                    commitPath()
                    const x = subArgs[argIdx++]
                    const y = subArgs[argIdx++]
                    const w = subArgs[argIdx++]
                    const h = subArgs[argIdx++]
                    addRectangle(x, y, w, h)
                }
                else if (op === OPS.curveTo) {
                    pathHasCurves = true;
                    for (let k = 0; k < 3; k++) {
                        const x = subArgs[argIdx++]
                        const y = subArgs[argIdx++]
                        currentPath.push(applyTransform(x, y))
                    }
                }
                else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
                    pathHasCurves = true;
                    for (let k = 0; k < 2; k++) {
                        const x = subArgs[argIdx++]
                        const y = subArgs[argIdx++]
                        currentPath.push(applyTransform(x, y))
                    }
                }
            }
            commitPath()
        }
        else if (fn === OPS.moveTo) {
            commitPath()
            const tp = applyTransform(args[0], args[1])
            currentPath.push(tp)
        }
        else if (fn === OPS.lineTo) {
            const tp = applyTransform(args[0], args[1])
            currentPath.push(tp)
        }
        else if (fn === OPS.curveTo) {
            pathHasCurves = true;
            currentPath.push(applyTransform(args[0], args[1]))
            currentPath.push(applyTransform(args[2], args[3]))
            currentPath.push(applyTransform(args[4], args[5]))
        }
        else if (fn === OPS.curveTo2 || fn === OPS.curveTo3) {
            pathHasCurves = true;
            currentPath.push(applyTransform(args[0], args[1]))
            currentPath.push(applyTransform(args[2], args[3]))
        }
        else if (fn === OPS.stroke) {
            commitPath()
            flushPending(false) // Not filled (outline)
        }
        else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke) {
            commitPath()
            flushPending(true) // Filled (or filled+stroked, which counts as filled)
        }
    }
    return items
}

function normalizeVisuals(graphics: GraphicItem[], textItems: TextItem[]): { finalGraphics: GraphicItem[], finalWords: TextItem[] } {
    const newGraphics = [...graphics];
    const remainingWords: TextItem[] = [];

    // --- A. Font-Based Checkbox & Line Detection ---
    // Matches: ☐, ☑, ☒, heavy underscores, or common bracket styles [ ]
    const SYMBOL_REGEX = /^[\u25A0-\u25FF\u2610-\u2612]|^\[\s?\]$/;
    const UNDERSCORE_REGEX = /^_{3,}$/;

    for (const item of textItems) {
        const str = item.text.trim();

        // 1. Convert text squares to Rectangle Graphics
        if (SYMBOL_REGEX.test(str) || (item.fontName.toLowerCase().includes('wingdings') && str.length === 1)) {
            // Force a square aspect ratio based on font size
            const size = Math.max(item.bbox.width, item.bbox.height, 12);
            newGraphics.push({
                type: "rectangle",
                bbox: { x: item.bbox.x, y: item.bbox.y, width: size, height: size },
                filled: false
            });
            continue; // Do not treat as text label
        }

        // 2. Convert underscores to Line Graphics
        if (UNDERSCORE_REGEX.test(str)) {
            newGraphics.push({
                type: "line",
                bbox: { x: item.bbox.x, y: item.bbox.y + item.bbox.height - 1, width: item.bbox.width, height: 1 },
                filled: true
            });
            continue;
        }

        remainingWords.push(item);
    }

    // --- B. Fragmented Line Merging (The "4 lines = 1 box" fix) ---
    // Filter for potential border segments (lines or very thin rectangles)
    const segments = newGraphics.filter(g =>
        (g.type === "line" || (g.type === "rectangle" && (g.bbox.width < 3 || g.bbox.height < 3)))
        && g.bbox.width < 60 && g.bbox.height < 60
    );

    const others = newGraphics.filter(g => !segments.includes(g));
    const mergedRects: GraphicItem[] = [];
    const usedSegments = new Set<GraphicItem>();

    // Naive clustering: Group segments that touch or almost touch
    for (let i = 0; i < segments.length; i++) {
        if (usedSegments.has(segments[i])) continue;

        const cluster = [segments[i]];
        let changed = true;

        // Iteratively expand cluster
        while (changed) {
            changed = false;
            // Get current cluster bounds
            let minX = Math.min(...cluster.map(c => c.bbox.x));
            let maxX = Math.max(...cluster.map(c => c.bbox.x + c.bbox.width));
            let minY = Math.min(...cluster.map(c => c.bbox.y));
            let maxY = Math.max(...cluster.map(c => c.bbox.y + c.bbox.height));

            for (let j = 0; j < segments.length; j++) {
                if (usedSegments.has(segments[j]) || cluster.includes(segments[j])) continue;

                const s = segments[j].bbox;
                const tolerance = 4; // 4px gap tolerance

                // Check if segment touches the cluster's bounding zone
                const intersects = !(s.x > maxX + tolerance || s.x + s.width < minX - tolerance ||
                    s.y > maxY + tolerance || s.y + s.height < minY - tolerance);

                if (intersects) {
                    cluster.push(segments[j]);
                    changed = true;
                    // Update bounds immediately for the next check in this loop
                    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x + s.width);
                    minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y + s.height);
                }
            }
        }

        // Analyze cluster: Does it form a box?
        // A box usually needs 4 strokes, but sometimes 3 if corners overlap well.
        if (cluster.length >= 4) {
            const minX = Math.min(...cluster.map(c => c.bbox.x));
            const maxX = Math.max(...cluster.map(c => c.bbox.x + c.bbox.width));
            const minY = Math.min(...cluster.map(c => c.bbox.y));
            const maxY = Math.max(...cluster.map(c => c.bbox.y + c.bbox.height));

            const w = maxX - minX;
            const h = maxY - minY;

            // Is it square-ish and within checkbox size limits?
            if (w >= 8 && w <= 40 && h >= 8 && h <= 40 && Math.abs(w - h) < 10) {
                mergedRects.push({
                    type: "rectangle",
                    bbox: { x: minX, y: minY, width: w, height: h },
                    filled: false
                });
                cluster.forEach(c => usedSegments.add(c));
            }
        }
    }

    const finalGraphics = [
        ...others,
        ...segments.filter(s => !usedSegments.has(s)), // Keep unused lines
        ...mergedRects // Add the new merged boxes
    ];

    return { finalGraphics, finalWords: remainingWords };
}

// --- Shared Page Parsing ---
async function analyzePage(page: any) {
    let pageHeight = 792
    let pageWidth = 612
    try {
        const size = await (page as any).getSize()
        pageHeight = size.height
        pageWidth = size.width
    } catch (e) {
        pageHeight = (page as any)._page?._pageInfo?.view?.[3] || 792
        pageWidth = (page as any)._page?._pageInfo?.view?.[2] || 612
    }

    let words: TextItem[] = []
    if ((page as any)._page) {
        try {
            const textContent = await (page as any)._page.getTextContent()
            words = textContent.items.map((item: any) => {
                const { transform, width, height, str, fontName } = item
                if (width > pageWidth * 0.8) return null
                const fontSize = Math.abs(transform[3])
                return {
                    text: str,
                    bbox: { x: transform[4], y: transform[5], width: width, height: height || fontSize || 12 },
                    fontSize: fontSize || 12,
                    fontName: fontName || "unknown",
                    consumed: false
                }
            }).filter((w: TextItem | null) => w !== null && w.text.trim() !== "") as TextItem[]
        } catch (e) {
            console.error("Text position extraction failed:", e)
        }
    }

    let graphics: GraphicItem[] = []
    if ((page as any)._page) {
        try {
            graphics = await extractGraphicsRaw((page as any)._page, pageHeight)
        } catch (e) { }
    }

    const { finalGraphics, finalWords } = normalizeVisuals(graphics, words);

    const groupedLabels = groupTextItems(finalWords)

    return { pageHeight, pageWidth, groupedLabels, graphics: finalGraphics }
}


// --- Main Functions ---

export async function detectVisualFields(pdfBuffer: ArrayBuffer): Promise<DetectedField[]> {
    const { PDFExcavator } = await import("pdfexcavator")
    const excavator = await PDFExcavator.fromBuffer(Buffer.from(pdfBuffer))
    const pageIdxCount = (excavator as any).pageCount
    const count = typeof pageIdxCount === 'function' ? await pageIdxCount.call(excavator) : pageIdxCount

    const detectedFields: DetectedField[] = []
    const fieldNameCounts = new Map<string, number>()

    const getUniqueName = (baseName: string): string => {
        const currentCount = fieldNameCounts.get(baseName) || 0
        fieldNameCounts.set(baseName, currentCount + 1)
        if (currentCount === 0) return baseName
        return `${baseName}_${currentCount + 1}`
    }

    for (let i = 0; i < count; i++) {
        const pageIndex = i
        const page = await excavator.getPage(i)

        const { pageHeight, pageWidth, groupedLabels, graphics } = await analyzePage(page)

        const tableRegions = detectTableRegions(graphics, groupedLabels);

        const overlapsTable = (rect: BBox): boolean => {
            return tableRegions.some(region => {
                const table = region.bbox;

                const padding = 15;

                const expanded = {
                    x: table.x - 5,
                    y: table.y - padding,
                    width: table.width + 10,
                    height: table.height + (padding * 2)
                };

                if (intersects(expanded, rect)) return true;

                // 2. Strict Exclusion: Positioned Directly Above
                // Captures headers or top-borders that sit right on top of the text region
                // Check a zone from the top edge extending upwards ~15px
                const tableTop = table.y + table.height;
                const isAboveZone = (rect.y >= tableTop - 2) && (rect.y <= tableTop + 15);

                if (isAboveZone) {
                    // Confirm horizontal overlap
                    const xOverlap = Math.max(0, Math.min(table.x + table.width, rect.x + rect.width) - Math.max(table.x, rect.x));
                    if (xOverlap > 5) return true;
                }

                return false;
            });
        }

        let annotations: any[] = []
        try {
            annotations = await page.getAnnotations()
        } catch (e) { }

        const overlapsAnnotation = (rect: BBox) => {
            return annotations.some((ann: any) => {
                if (!ann.rect) return false
                const [ax1, ay1, ax2, ay2] = ann.rect
                const rx1 = rect.x
                const ry1 = rect.y
                const rx2 = rect.x + rect.width
                const ry2 = rect.y + rect.height
                return rx1 < ax2 && rx2 > ax1 && ry1 < ay2 && ry2 > ay1
            })
        }

        const processedGraphics = new Set<GraphicItem>()

        const NUM_SECTIONS = 24 // 16-32 /* precision */
        const sectionHeight = pageHeight / NUM_SECTIONS
        const NUM_COLS = 4
        const colWidth = pageWidth / NUM_COLS

        for (let s = 0; s < NUM_SECTIONS; s++) {
            // Calculate slice bounds (Top-Down visual order)
            // PDF Coordinates: Y=0 is bottom.
            const sectionMaxY = pageHeight - (s * sectionHeight)
            const sectionMinY = sectionMaxY - sectionHeight

            for (let c = 0; c < NUM_COLS; c++) {
                const colMinX = c * colWidth
                const colMaxX = colMinX + colWidth

                // Filter graphics belonging to this section based on their TOP edge AND LEFT edge.
                // This ensures a graphic is processed exactly once, in the cell where it visually starts.
                const sectionGraphics = graphics.filter(g => {
                    if (processedGraphics.has(g)) return false

                    const gTop = g.bbox.y + g.bbox.height
                    const inRow = gTop <= sectionMaxY && gTop > sectionMinY
                    const inCol = g.bbox.x >= colMinX && g.bbox.x < colMaxX

                    return inRow && inCol
                })

                sectionGraphics.sort((a, b) => {
                    const aTop = a.bbox.y + a.bbox.height
                    const bTop = b.bbox.y + b.bbox.height

                    if (Math.abs(aTop - bTop) < 6) {
                        return a.bbox.x - b.bbox.x
                    }
                    return bTop - aTop
                })

                const lineCandidates = sectionGraphics.filter(g => {
                    if (processedGraphics.has(g)) return false
                    const isLine = g.type === "line"
                    const isThinRect = g.type === "rectangle" && g.bbox.height <= 5
                    if (!isLine && !isThinRect) return false
                    if (g.bbox.width < 20) return false

                    if (overlapsAnnotation(g.bbox)) return false
                    if (overlapsTable(g.bbox)) return false

                    return true
                })

                for (const line of lineCandidates) {
                    const sigMatch = detectSignature(line, groupedLabels, pageWidth)
                    if (sigMatch) {
                        processedGraphics.add(line)
                        const uniqueName = getUniqueName("signature")

                        const SIG_HEIGHT = 45
                        const uiY = pageHeight - line.bbox.y - SIG_HEIGHT

                        detectedFields.push({
                            name: uniqueName,
                            type: "signature",
                            rect: {
                                x: line.bbox.x,
                                y: uiY,
                                width: line.bbox.width,
                                height: SIG_HEIGHT,
                                pageIndex,
                            },
                        })
                        continue
                    }

                    const dateMatch = detectDate(line, groupedLabels, pageWidth)
                    if (dateMatch) {
                        processedGraphics.add(line)
                        const uniqueName = getUniqueName("date")
                        const uiY = pageHeight - line.bbox.y - line.bbox.height

                        let fieldHeight = 24

                        const padding = 2
                        const lineTop = line.bbox.y + line.bbox.height
                        const fieldZone = { x: line.bbox.x, y: lineTop, width: line.bbox.width, height: fieldHeight }

                        detectedFields.push({
                            name: uniqueName,
                            type: "date",
                            rect: {
                                x: line.bbox.x,
                                y: uiY - fieldHeight + 2,
                                width: line.bbox.width,
                                height: fieldHeight,
                                pageIndex,
                            },
                        })
                        continue
                    }

                    const isUnderline = groupedLabels.some(label => {
                        const labelBottom = label.bbox.y
                        const lineTop = line.bbox.y + line.bbox.height
                        const vGap = labelBottom - lineTop
                        if (vGap < 0 || vGap > 12) return false
                        const l1 = label.bbox
                        const r1 = line.bbox
                        const overlapX = Math.max(0, Math.min(l1.x + l1.width, r1.x + r1.width) - Math.max(l1.x, r1.x))
                        return overlapX > 0
                    })

                    if (isUnderline) continue

                    const labelResult = findLabelForLine(line.bbox, groupedLabels, pageWidth)

                    if (!labelResult) continue;

                    processedGraphics.add(line)

                    const rawName = toSnakeCase(labelResult.text)
                    const uniqueName = getUniqueName(rawName)
                    const uiY = pageHeight - line.bbox.y - line.bbox.height
                    let fieldHeight = 24

                    const padding = 2
                    const lineTop = line.bbox.y + line.bbox.height

                    const fieldZone = {
                        x: line.bbox.x,
                        y: lineTop,
                        width: line.bbox.width,
                        height: fieldHeight
                    }

                    const obstacles = [
                        ...groupedLabels,
                        ...graphics.filter(g => g !== line)
                    ]

                    let availableHeight = fieldHeight

                    for (const item of obstacles) {
                        if (intersects(fieldZone, item.bbox)) {
                            if (item.bbox.y >= lineTop) {
                                const gap = item.bbox.y - lineTop
                                if (gap < availableHeight) {
                                    availableHeight = gap
                                }
                            }
                        }
                    }

                    fieldHeight = Math.max(0, availableHeight - padding)

                    detectedFields.push({
                        name: uniqueName,
                        type: "text",
                        rect: {
                            x: line.bbox.x,
                            y: uiY - fieldHeight + 2,
                            width: line.bbox.width,
                            height: fieldHeight,
                            pageIndex,
                        },
                    })
                }

                // --- B. Detect Radios and Checkboxes ---
                let checkboxCandidates = sectionGraphics.filter(g => {
                    if (processedGraphics.has(g)) return false
                    if (g.type !== "rectangle") return false

                    if (g.filled) return false;

                    const { width, height } = g.bbox
                    if (width < 8 || width > 40) return false
                    if (height < 8 || height > 40) return false
                    if (Math.abs(width - height) >= 1.5) return false

                    if (overlapsAnnotation(g.bbox)) return false
                    if (overlapsTable(g.bbox)) return false

                    return true
                })

                let uniqueCheckboxes: GraphicItem[] = []
                for (const box of checkboxCandidates) {
                    const isDuplicate = uniqueCheckboxes.some(existing => intersects(box.bbox, existing.bbox))
                    if (!isDuplicate) {
                        uniqueCheckboxes.push(box)
                    }
                }

                let radioCandidates = sectionGraphics.filter(g => {
                    if (processedGraphics.has(g)) return false
                    if (g.type !== "circle") return false

                    if (g.filled) return false;

                    const { width, height } = g.bbox
                    if (width < 2 || width > 26) return false

                    if (overlapsAnnotation(g.bbox)) return false
                    if (overlapsTable(g.bbox)) return false
                    return true
                })

                let uniqueRadios: GraphicItem[] = []
                for (const circle of radioCandidates) {
                    const isDuplicate = uniqueRadios.some(existing => intersects(circle.bbox, existing.bbox))
                    if (!isDuplicate) uniqueRadios.push(circle)
                }

                uniqueCheckboxes = uniqueCheckboxes.filter(box => {
                    const hasInnerRadio = uniqueRadios.some(radio => {
                        return radio.bbox.x >= box.bbox.x &&
                            radio.bbox.y >= box.bbox.y &&
                            (radio.bbox.x + radio.bbox.width) <= (box.bbox.x + box.bbox.width) &&
                            (radio.bbox.y + radio.bbox.height) <= (box.bbox.y + box.bbox.height);
                    });
                    return !hasInnerRadio;
                });

                for (const box of uniqueCheckboxes) {
                    const labelText = findLabelForCheckbox(box.bbox, groupedLabels, pageWidth)
                    if (!labelText) continue;

                    processedGraphics.add(box)
                    const rawName = toSnakeCase(labelText)
                    const uniqueName = getUniqueName(rawName)
                    const uiY = pageHeight - box.bbox.y - box.bbox.height

                    detectedFields.push({
                        name: uniqueName,
                        type: "checkbox",
                        rect: {
                            x: box.bbox.x,
                            y: uiY,
                            width: box.bbox.width,
                            height: box.bbox.height,
                            pageIndex,
                        },
                    })
                }

                for (const circle of uniqueRadios) {
                    const labelText = findLabelForRadio(circle.bbox, groupedLabels, pageWidth)
                    if (!labelText) continue

                    processedGraphics.add(circle)
                    const rawName = toSnakeCase(labelText)
                    const uniqueName = getUniqueName(rawName)
                    const uiY = pageHeight - circle.bbox.y - circle.bbox.height

                    detectedFields.push({
                        name: uniqueName,
                        type: "radio",
                        rect: {
                            x: circle.bbox.x,
                            y: uiY,
                            width: circle.bbox.width,
                            height: circle.bbox.height,
                            pageIndex
                        }
                    })
                }

                const inputBoxCandidates = sectionGraphics.filter(g => {
                    if (processedGraphics.has(g)) return false
                    if (g.type !== "rectangle") return false
                    const { width, height } = g.bbox
                    if (width <= 20) return false
                    if (height <= 15 || height > 300) return false

                    if (overlapsAnnotation(g.bbox)) return false
                    if (overlapsTable(g.bbox)) return false

                    return true
                })

                for (const box of inputBoxCandidates) {
                    const sigMatch = detectSignature(box, groupedLabels, pageWidth)

                    if (sigMatch) {
                        processedGraphics.add(box)
                        const uniqueName = getUniqueName("signature")

                        const uiY = pageHeight - box.bbox.y - box.bbox.height

                        let customPaddingTop: number | undefined = undefined
                        const labelResult = findLabelForRect(box.bbox, groupedLabels, pageWidth)

                        if (labelResult && labelResult.insideBottom !== undefined) {
                            const boxTop = box.bbox.y + box.bbox.height
                            const gap = boxTop - labelResult.insideBottom
                            customPaddingTop = Math.max(2, Math.round(gap + 2))
                        }

                        detectedFields.push({
                            name: uniqueName,
                            type: "signature",
                            rect: {
                                x: box.bbox.x,
                                y: uiY,
                                width: box.bbox.width,
                                height: box.bbox.height,
                                pageIndex,
                            },
                            paddingTop: customPaddingTop,
                        })
                        continue
                    }

                    const dateMatch = detectDate(box, groupedLabels, pageWidth)
                    if (dateMatch) {
                        processedGraphics.add(box)
                        const uniqueName = getUniqueName("date")
                        const uiY = pageHeight - box.bbox.y - box.bbox.height

                        let customPaddingTop: number | undefined = undefined
                        const labelResult = findLabelForRect(box.bbox, groupedLabels, pageWidth)
                        if (labelResult && labelResult.insideBottom !== undefined) {
                            const boxTop = box.bbox.y + box.bbox.height
                            const gap = boxTop - labelResult.insideBottom
                            customPaddingTop = Math.max(2, Math.round(gap + 2))
                        }

                        detectedFields.push({
                            name: uniqueName,
                            type: "date",
                            rect: {
                                x: box.bbox.x,
                                y: uiY,
                                width: box.bbox.width,
                                height: box.bbox.height,
                                pageIndex,
                            },
                            paddingTop: customPaddingTop,
                        })
                        continue
                    }

                    const labelResult = findLabelForRect(box.bbox, groupedLabels, pageWidth)

                    if (!labelResult) continue;

                    processedGraphics.add(box)

                    const rawName = toSnakeCase(labelResult.text)
                    const uniqueName = getUniqueName(rawName)
                    const uiY = pageHeight - box.bbox.y - box.bbox.height

                    let customPaddingTop: number | undefined = undefined;
                    if (labelResult.insideBottom !== undefined) {
                        const boxTop = box.bbox.y + box.bbox.height;
                        const gap = boxTop - labelResult.insideBottom;
                        customPaddingTop = Math.max(2, Math.round(gap + 2));
                    }

                    const isMultiline = box.bbox.height > 50

                    detectedFields.push({
                        name: uniqueName,
                        type: isMultiline ? "multiline" : "text",
                        rect: {
                            x: box.bbox.x,
                            y: uiY,
                            width: box.bbox.width,
                            height: box.bbox.height,
                            pageIndex,
                        },
                        paddingTop: customPaddingTop,
                    })
                }
            }
        }
    }

    return detectedFields
}

export async function detectFieldAtPosition(
    pdfBuffer: ArrayBuffer,
    pageIndex: number,
    clickX: number,
    clickY: number,
    mode: DetectionMode,
    snapOnly: boolean = false,
    dragWidth?: number,
    dragHeight?: number
): Promise<DetectedField | null> {
    const { PDFExcavator } = await import("pdfexcavator")
    const excavator = await PDFExcavator.fromBuffer(Buffer.from(pdfBuffer))
    const page = await excavator.getPage(pageIndex)

    const { pageHeight, pageWidth, groupedLabels, graphics } = await analyzePage(page)
    const timestamp = Date.now()

    let target: GraphicItem | undefined;

    // --- 1. Selection Logic ---

    // A. Intersection Mode (Signature AND Multiline Dragging)
    // If we have dimensions, we look for physical overlaps anywhere on the dragged box
    if ((mode === 'signature' || mode === 'multiline') && dragWidth && dragHeight) {
        // Convert UI Top-Left Y to PDF Bottom-Left Y for the dragged rect
        // UI Y goes 0 -> Height. PDF Y goes 0 -> Height (starts at bottom).
        const pdfRectY = pageHeight - clickY - dragHeight;

        const draggedBBox: BBox = {
            x: clickX,
            y: pdfRectY,
            width: dragWidth,
            height: dragHeight
        };

        // Find candidates that intersect at all
        let candidates = graphics.filter(g => intersects(g.bbox, draggedBBox));

        // Sort by Intersection Area (Maximize overlap)
        candidates.sort((a, b) => {
            const getArea = (r1: BBox, r2: BBox) => {
                const xOverlap = Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x));
                const yOverlap = Math.max(0, Math.min(r1.y + r1.height, r2.y + r2.height) - Math.max(r1.y, r2.y));
                return xOverlap * yOverlap;
            }
            return getArea(b.bbox, draggedBBox) - getArea(a.bbox, draggedBBox);
        });

        target = candidates[0];
    }
    // B. Proximity Mode (Clicking or Standard Dragging without Dims)
    // Used for clicks or Text/Checkboxes where we search near the point
    else {
        const pdfClickY = pageHeight - clickY

        // Search Zone: Click Y extending DOWN 24px visually
        const searchZoneYMin = pdfClickY - 24
        const searchZoneYMax = pdfClickY

        let candidates = graphics.filter(g => {
            const gY = g.bbox.y
            const gH = g.bbox.height
            const vOverlap = Math.max(0, Math.min(searchZoneYMax, gY + gH) - Math.max(searchZoneYMin, gY))
            return vOverlap > 0
        })

        // Sort by horizontal distance to clickX
        candidates.sort((a, b) => {
            const distA = Math.min(Math.abs(a.bbox.x - clickX), Math.abs((a.bbox.x + a.bbox.width) - clickX))
            const distB = Math.min(Math.abs(b.bbox.x - clickX), Math.abs((b.bbox.x + b.bbox.width) - clickX))
            return distA - distB
        })

        target = candidates[0]

        // Enforce max distance for clicks
        if (target) {
            const distToClick = Math.min(Math.abs(target.bbox.x - clickX), Math.abs((target.bbox.x + target.bbox.width) - clickX))
            if (distToClick > 200) target = undefined
        }
    }


    // --- 2. Field Construction Logic ---

    // 1. Signature
    if (mode === 'signature') {
        if (target && target.type === 'circle') return null

        // If we found a valid target line or box
        if (target && (target.type === 'line' || target.type === 'rectangle')) {
            const w = target.bbox.width
            const h = target.bbox.height
            const isLine = target.type === 'line' || h < 5

            if (!isLine && h < 20) return null;

            if (isLine) {
                const labelResult = findLabelForLine(target.bbox, groupedLabels, pageWidth);

                if (!labelResult) return null;

                if (labelResult.source === 'above' && labelResult.bottom !== undefined) {
                    const lineTop = target.bbox.y + target.bbox.height;
                    const vGap = labelResult.bottom - lineTop;
                    if (vGap < 12) return null;
                }
            }

            const isSmallBox = (w < 40 && h < 40 && Math.abs(w - h) < 5)

            if (!isSmallBox) {
                // Determine if it is a Line (sit above) or a Box (fill completely)
                const isLine = target.type === 'line' || h < 5

                // If it's a line, use fixed height (50). If it's a box, use actual box height.
                const boxHeight = isLine ? 50 : h

                // Calculate UI Top Coordinate
                // Box: pageHeight - BottomY - Height = TopY
                // Line: pageHeight - BottomY - 50 = 50px Above Line
                const uiY = pageHeight - target.bbox.y - boxHeight

                // Check for internal text to apply padding (only for boxes)
                let customPaddingTop: number | undefined = undefined;
                if (!isLine) {
                    const labelResult = findLabelForRect(target.bbox, groupedLabels, pageWidth);
                    if (labelResult && labelResult.insideBottom !== undefined) {
                        const boxTop = target.bbox.y + target.bbox.height;
                        const gap = boxTop - labelResult.insideBottom;
                        customPaddingTop = Math.max(2, Math.round(gap + 2));
                    }
                }

                return {
                    name: "signature",
                    type: "signature",
                    rect: {
                        x: target.bbox.x,
                        y: uiY,
                        width: target.bbox.width > 50 ? target.bbox.width : 200, // Min width
                        height: boxHeight,
                        pageIndex
                    },
                    paddingTop: customPaddingTop
                }
            }
        }

        // Fallback: If "snapOnly" is true (during drag), we return null if no target found.
        if (snapOnly) return null;

        // Otherwise (during click creation), create a default free-floating signature
        return {
            name: "signature",
            type: "signature",
            rect: {
                x: clickX - 100,
                y: clickY - 25,
                width: 200,
                height: 50,
                pageIndex
            }
        }
    }

    // For other modes, if no target is found within range, return null
    if (!target && mode !== 'text' && mode !== 'multiline') return null


    // 2. Checkbox / Radio
    if ((mode === 'checkbox' || mode === 'radio') && target) {
        const isCircle = target.type === 'circle'
        const isRect = target.type === 'rectangle'
        const w = target.bbox.width
        const h = target.bbox.height
        const isSquare = Math.abs(w - h) < 2

        if (isRect && isSquare) {
            const label = findLabelForCheckbox(target.bbox, groupedLabels, pageWidth) || "checkbox"
            return {
                name: toSnakeCase(label),
                type: 'checkbox',
                rect: {
                    x: target.bbox.x,
                    y: pageHeight - target.bbox.y - target.bbox.height,
                    width: target.bbox.width,
                    height: target.bbox.height,
                    pageIndex
                }
            }
        }
        if (isCircle) {
            const label = findLabelForRadio(target.bbox, groupedLabels, pageWidth) || "radio"
            return {
                name: toSnakeCase(label),
                type: 'radio',
                rect: {
                    x: target.bbox.x,
                    y: pageHeight - target.bbox.y - target.bbox.height,
                    width: target.bbox.width,
                    height: target.bbox.height,
                    pageIndex
                }
            }
        }
    }

    // 3. Text / Multiline
    if (mode === 'text' || mode === 'multiline') {

        if (target && (target.type === 'line' || target.type === 'rectangle')) {
            const isLine = target.type === 'line' || target.bbox.height < 5

            if (mode === 'text' && (isLine || target.bbox.height < 50)) {
                let labelResult = isLine
                    ? findLabelForLine(target.bbox, groupedLabels, pageWidth)
                    : findLabelForRect(target.bbox, groupedLabels, pageWidth)

                if (labelResult) {
                    let fieldHeight = 24
                    const uiY = pageHeight - target.bbox.y - target.bbox.height

                    if (isLine) {
                        const padding = 2
                        const lineTop = target.bbox.y + target.bbox.height
                        const fieldZone = { x: target.bbox.x, y: lineTop, width: target.bbox.width, height: fieldHeight }
                        const obstacles = [...groupedLabels, ...graphics.filter(g => g !== target)]
                        let availableHeight = fieldHeight
                        for (const item of obstacles) {
                            if (intersects(fieldZone, item.bbox)) {
                                if (item.bbox.y >= lineTop) {
                                    const gap = item.bbox.y - lineTop
                                    if (gap < availableHeight) availableHeight = gap
                                }
                            }
                        }
                        const calculatedHeight = availableHeight - padding
                        if (calculatedHeight >= 10) fieldHeight = calculatedHeight
                        else return null
                    }

                    return {
                        name: toSnakeCase(labelResult.text),
                        type: 'text',
                        rect: {
                            x: target.bbox.x,
                            y: isLine ? uiY - fieldHeight + 2 : uiY,
                            width: target.bbox.width,
                            height: isLine ? fieldHeight : target.bbox.height,
                            pageIndex
                        }
                    }
                }
            }

            if (mode === 'multiline') {
                // If we hit this via drag, we might have a target from Section 1.A (Intersection Mode)
                // We should use that target's geometry.

                const labelResult = findLabelForRect(target.bbox, groupedLabels, pageWidth)
                // For multiline/signature boxes, we want to snap even if no label is found nearby,
                // but we definitely want to calculate padding if text is inside.

                let paddingTop = undefined
                if (labelResult && labelResult.insideBottom !== undefined) {
                    const boxTop = target.bbox.y + target.bbox.height
                    paddingTop = Math.max(2, Math.round(boxTop - labelResult.insideBottom + 2))
                }

                // If no label found but we have a solid target via overlap, we still snap (using snake case of "multiline" or similar)
                const nameBase = labelResult ? toSnakeCase(labelResult.text) : "multiline"

                return {
                    name: nameBase,
                    type: 'multiline',
                    rect: {
                        x: target.bbox.x,
                        y: pageHeight - target.bbox.y - target.bbox.height,
                        width: target.bbox.width,
                        height: target.bbox.height,
                        pageIndex
                    },
                    paddingTop
                }
            }
        }

        if (snapOnly) return null;

        if (mode === 'multiline') {
            const DEFAULT_W = 100
            const DEFAULT_H = 50
            return {
                name: "multiline",
                type: 'multiline',
                rect: {
                    x: clickX - (DEFAULT_W / 2),
                    y: clickY - (DEFAULT_H / 2),
                    width: DEFAULT_W,
                    height: DEFAULT_H,
                    pageIndex
                }
            }
        }

        if (mode === 'text') {
            const DEFAULT_W = 200
            const DEFAULT_H = 24
            return {
                name: "text",
                type: 'text',
                rect: {
                    x: clickX - (DEFAULT_W / 2),
                    y: clickY - (DEFAULT_H / 2),
                    width: DEFAULT_W,
                    height: DEFAULT_H,
                    pageIndex
                }
            }
        }
    }

    if (mode === 'date') {
        if (target && (target.type === 'line' || target.type === 'rectangle')) {
            const isLine = target.type === 'line' || target.bbox.height < 5


            let labelResult = isLine
                ? findLabelForLine(target.bbox, groupedLabels, pageWidth)
                : findLabelForRect(target.bbox, groupedLabels, pageWidth)

            let fieldHeight = 24
            const uiY = pageHeight - target.bbox.y - target.bbox.height
            let paddingTop: number | undefined = undefined

            if (isLine) {
                const padding = 2
                const lineTop = target.bbox.y + target.bbox.height
                const fieldZone = { x: target.bbox.x, y: lineTop, width: target.bbox.width, height: fieldHeight }
                const obstacles = [...groupedLabels, ...graphics.filter(g => g !== target)]
                let availableHeight = fieldHeight
                for (const item of obstacles) {
                    if (intersects(fieldZone, item.bbox)) {
                        if (item.bbox.y >= lineTop) {
                            const gap = item.bbox.y - lineTop
                            if (gap < availableHeight) availableHeight = gap
                        }
                    }
                }
                const calculatedHeight = availableHeight - padding
                if (calculatedHeight >= 10) fieldHeight = calculatedHeight
                else return null
            } else {
                fieldHeight = target.bbox.height
                if (labelResult && 'insideBottom' in labelResult && labelResult.insideBottom !== undefined) {
                    const boxTop = target.bbox.y + target.bbox.height
                    paddingTop = Math.max(2, Math.round(boxTop - labelResult.insideBottom + 2))
                }
            }

            return {
                name: "date",
                type: 'date',
                rect: {
                    x: target.bbox.x,
                    y: isLine ? uiY - fieldHeight + 2 : uiY,
                    width: target.bbox.width,
                    height: fieldHeight,
                    pageIndex
                },
                paddingTop
            }
        }
    }

    // 4. Auto Mode
    if (mode === 'auto') {
        if (!target) return null;

        // Try Checkbox/Radio first
        if (target.type === 'rectangle' && Math.abs(target.bbox.width - target.bbox.height) < 2) {
            const lbl = findLabelForCheckbox(target.bbox, groupedLabels, pageWidth)
            if (lbl) return detectFieldAtPosition(pdfBuffer, pageIndex, clickX, clickY, 'checkbox')
        }
        if (target.type === 'circle') {
            return detectFieldAtPosition(pdfBuffer, pageIndex, clickX, clickY, 'radio')
        }

        // Try Signature
        const sig = detectSignature(target, groupedLabels, pageWidth)
        if (sig) return detectFieldAtPosition(pdfBuffer, pageIndex, clickX, clickY, 'signature')

        // Try Date
        const dateMatch = detectDate(target, groupedLabels, pageWidth)
        if (dateMatch) return detectFieldAtPosition(pdfBuffer, pageIndex, clickX, clickY, 'date')

        // Default Text
        if (target.bbox.height > 50) return detectFieldAtPosition(pdfBuffer, pageIndex, clickX, clickY, 'multiline')
        return detectFieldAtPosition(pdfBuffer, pageIndex, clickX, clickY, 'text')
    }

    return null
}

// --- Table Detection Logic ---
// export function detectTableRegions(graphics: GraphicItem[], textItems: TextItem[], pageWidth: number, pageHeight: number): BBox[] {
//     const tableRegions: BBox[] = [];

//     const lines = graphics.filter(g => {
//         if (g.type === 'line') return true;
//         if (g.type === 'rectangle') return g.bbox.width < 5 || g.bbox.height < 5;
//         return false;
//     });

//     if (lines.length > 0) {
//         const parent = new Map<number, number>();
//         const find = (i: number): number => {
//             if (!parent.has(i)) parent.set(i, i);
//             if (parent.get(i) !== i) parent.set(i, find(parent.get(i)!));
//             return parent.get(i)!;
//         };
//         const union = (i: number, j: number) => {
//             const rootI = find(i);
//             const rootJ = find(j);
//             if (rootI !== rootJ) parent.set(rootI, rootJ);
//         };

//         for (let i = 0; i < lines.length; i++) {
//             for (let j = i + 1; j < lines.length; j++) {
//                 const r1 = lines[i].bbox;
//                 const r2 = lines[j].bbox;
//                 const tolerance = 2;

//                 const intersects = !(
//                     r2.x > r1.x + r1.width + tolerance ||
//                     r2.x + r2.width < r1.x - tolerance ||
//                     r2.y > r1.y + r1.height + tolerance ||
//                     r2.y + r2.height < r1.y - tolerance
//                 );

//                 if (intersects) {
//                     union(i, j);
//                 }
//             }
//         }

//         const groups = new Map<number, GraphicItem[]>();
//         for (let i = 0; i < lines.length; i++) {
//             const root = find(i);
//             if (!groups.has(root)) groups.set(root, []);
//             groups.get(root)!.push(lines[i]);
//         }

//         for (const [_, group] of groups) {
//             let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
//             let vLines = 0;
//             let hLines = 0;

//             for (const line of group) {
//                 minX = Math.min(minX, line.bbox.x);
//                 minY = Math.min(minY, line.bbox.y);
//                 maxX = Math.max(maxX, line.bbox.x + line.bbox.width);
//                 maxY = Math.max(maxY, line.bbox.y + line.bbox.height);

//                 if (line.bbox.height > line.bbox.width) vLines++;
//                 else hLines++;
//             }

//             let intersections = 0;
//             for (let i = 0; i < group.length; i++) {
//                 for (let j = i + 1; j < group.length; j++) {
//                     const l1 = group[i].bbox;
//                     const l2 = group[j].bbox;
//                     const xOverlap = Math.max(0, Math.min(l1.x + l1.width, l2.x + l2.width) - Math.max(l1.x, l2.x));
//                     const yOverlap = Math.max(0, Math.min(l1.y + l1.height, l2.y + l2.height) - Math.max(l1.y, l2.y));
//                     if (xOverlap > 0 && yOverlap > 0) intersections++;
//                 }
//             }

//             const width = maxX - minX;
//             const height = maxY - minY;
//             const validSize = width > 40 && height > 20;
//             const isGrid = intersections >= 1 && (vLines >= 1 && hLines >= 1);

//             if (validSize && isGrid) {
//                 tableRegions.push({ x: minX, y: minY, width, height });
//             }
//         }
//     }

//     const rows: { y: number, items: TextItem[] }[] = [];
//     const sortedText = [...textItems].sort((a, b) => a.bbox.y - b.bbox.y);

//     if (sortedText.length > 0) {
//         let currentRow = { y: sortedText[0].bbox.y, items: [sortedText[0]] };
//         for (let i = 1; i < sortedText.length; i++) {
//             const item = sortedText[i];
//             if (Math.abs(item.bbox.y - currentRow.y) < 5) {
//                 currentRow.items.push(item);
//             } else {
//                 rows.push(currentRow);
//                 currentRow = { y: item.bbox.y, items: [item] };
//             }
//         }
//         rows.push(currentRow);
//     }

//     const multiColRows = rows.filter(r => r.items.length >= 2);

//     let currentTableItems: TextItem[] = [];
//     let tableChainCount = 0;

//     for (let i = 0; i < multiColRows.length - 1; i++) {
//         const rowA = multiColRows[i];
//         const rowB = multiColRows[i + 1];

//         if (rowB.y - rowA.y > 50) {
//             if (tableChainCount >= 2 && currentTableItems.length > 0) {
//                 tableRegions.push(getBBoxFromItems(currentTableItems));
//             }
//             currentTableItems = [];
//             tableChainCount = 0;
//             continue;
//         }

//         let alignedCols = 0;
//         for (const itemA of rowA.items) {
//             for (const itemB of rowB.items) {
//                 if (Math.abs(itemA.bbox.x - itemB.bbox.x) < 5) {
//                     alignedCols++;
//                 }
//             }
//         }

//         if (alignedCols >= 2) {
//             if (currentTableItems.length === 0) currentTableItems.push(...rowA.items);
//             currentTableItems.push(...rowB.items);
//             tableChainCount++;
//         } else {
//             if (tableChainCount >= 2 && currentTableItems.length > 0) {
//                 tableRegions.push(getBBoxFromItems(currentTableItems));
//             }
//             currentTableItems = [];
//             tableChainCount = 0;
//         }
//     }
//     if (tableChainCount >= 2 && currentTableItems.length > 0) {
//         tableRegions.push(getBBoxFromItems(currentTableItems));
//     }

//     return tableRegions;
// }

interface TableRegion {
    bbox: BBox
    columns: { start: number; end: number }[]
}

function getGroupBBox(items: TextItem[] | GraphicItem[]): BBox {
    if (items.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of items) {
        minX = Math.min(minX, item.bbox.x);
        minY = Math.min(minY, item.bbox.y);
        maxX = Math.max(maxX, item.bbox.x + item.bbox.width);
        maxY = Math.max(maxY, item.bbox.y + item.bbox.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function groupIntoVisualLines(items: TextItem[]): { y: number, items: TextItem[], bbox: BBox }[] {
    if (items.length === 0) return [];
    const sorted = [...items].sort((a, b) => b.bbox.y - a.bbox.y);
    const lines: { y: number, items: TextItem[], bbox: BBox }[] = [];
    const avgFontSize = items.reduce((s, i) => s + i.fontSize, 0) / (items.length || 1);

    let currentLine = { y: sorted[0].bbox.y, items: [sorted[0]] };
    for (let i = 1; i < sorted.length; i++) {
        const item = sorted[i];
        if (Math.abs(item.bbox.y - currentLine.y) < avgFontSize * 0.4) {
            currentLine.items.push(item);
        } else {
            currentLine.items.sort((a, b) => a.bbox.x - b.bbox.x);
            lines.push({ y: currentLine.y, items: currentLine.items, bbox: getGroupBBox(currentLine.items) });
            currentLine = { y: item.bbox.y, items: [item] };
        }
    }
    currentLine.items.sort((a, b) => a.bbox.x - b.bbox.x);
    lines.push({ y: currentLine.y, items: currentLine.items, bbox: getGroupBBox(currentLine.items) });
    return lines;
}

function findColumnBoundaries(
    lines: { y: number; items: TextItem[]; bbox: BBox }[],
    blockBBox: BBox,
    avgFontSize: number
): { start: number; end: number }[] {
    if (lines.length < 3) return []

    const minGapWidth = avgFontSize * 1.5
    const gapObservations: { left: number; right: number }[] = []

    for (const line of lines) {
        if (line.items.length < 2) continue
        const sorted = [...line.items].sort((a, b) => a.bbox.x - b.bbox.x)
        for (let i = 0; i < sorted.length - 1; i++) {
            const rightEdge = sorted[i].bbox.x + sorted[i].bbox.width
            const nextLeftEdge = sorted[i + 1].bbox.x
            if (nextLeftEdge - rightEdge >= minGapWidth) {
                gapObservations.push({ left: rightEdge, right: nextLeftEdge })
            }
        }
    }

    if (gapObservations.length === 0) return []

    gapObservations.sort((a, b) => (a.left + a.right) / 2 - (b.left + b.right) / 2)
    const clusterRadius = avgFontSize * 2
    const clusters: { lefts: number[]; rights: number[] }[] = []

    for (const gap of gapObservations) {
        const mid = (gap.left + gap.right) / 2
        let bestCluster: (typeof clusters)[0] | null = null
        let bestDist = Infinity
        for (const c of clusters) {
            const cMid = (c.lefts.reduce((s, v) => s + v, 0) / c.lefts.length +
                c.rights.reduce((s, v) => s + v, 0) / c.rights.length) / 2
            const dist = Math.abs(cMid - mid)
            if (dist < clusterRadius && dist < bestDist) {
                bestCluster = c
                bestDist = dist
            }
        }
        if (bestCluster) {
            bestCluster.lefts.push(gap.left)
            bestCluster.rights.push(gap.right)
        } else {
            clusters.push({ lefts: [gap.left], rights: [gap.right] })
        }
    }

    const linesWithMultipleItems = lines.filter(l => l.items.length >= 2).length
    const minOccurrence = Math.max(2, linesWithMultipleItems * 0.25)

    const significantGaps = clusters
        .filter(c => c.lefts.length >= minOccurrence)
        .map(c => ({
            left: c.lefts.reduce((s, v) => s + v, 0) / c.lefts.length,
            right: c.rights.reduce((s, v) => s + v, 0) / c.rights.length,
        }))
        .sort((a, b) => a.left - b.left)

    if (significantGaps.length === 0) return []

    const columns: { start: number; end: number }[] = []
    columns.push({ start: blockBBox.x, end: significantGaps[0].left })
    for (let i = 0; i < significantGaps.length - 1; i++) {
        columns.push({ start: significantGaps[i].right, end: significantGaps[i + 1].left })
    }
    columns.push({
        start: significantGaps[significantGaps.length - 1].right,
        end: blockBBox.x + blockBBox.width
    })

    return columns.filter(c => (c.end - c.start) > avgFontSize * 0.5)
}

function calculateGridDensity(
    lines: { y: number; items: TextItem[]; bbox: BBox }[],
    columns: { start: number; end: number }[]
): any {
    if (columns.length < 2 || lines.length < 3) {
        return { fillRatio: 0, rowConsistency: 0, significantCols: 0, spanViolations: 0, gridScore: 0 }
    }

    const totalCells = lines.length * columns.length
    let populatedCells = 0
    const colPopCount = new Array(columns.length).fill(0)
    let rowsWithMultipleCols = 0
    let spanViolations = 0

    for (const line of lines) {
        const rowCols = new Set<number>()
        for (const item of line.items) {
            const itemLeft = item.bbox.x
            const itemRight = item.bbox.x + item.bbox.width
            const itemMid = (itemLeft + itemRight) / 2

            let spansMultiple = false
            for (let k = 0; k < columns.length - 1; k++) {
                const gapCenter = (columns[k].end + columns[k + 1].start) / 2
                if (itemLeft < gapCenter - 5 && itemRight > gapCenter + 5) {
                    spansMultiple = true
                    break
                }
            }
            if (spansMultiple) { spanViolations++; continue }

            for (let k = 0; k < columns.length; k++) {
                if (itemMid >= columns[k].start - 5 && itemMid <= columns[k].end + 5) {
                    rowCols.add(k)
                    break
                }
            }
        }

        populatedCells += rowCols.size
        rowCols.forEach(k => colPopCount[k]++)
        if (rowCols.size >= 2) rowsWithMultipleCols++
    }

    const fillRatio = populatedCells / totalCells
    const rowConsistency = rowsWithMultipleCols / lines.length
    const significantCols = colPopCount.filter(c => c / lines.length > 0.3).length

    const totalItems = lines.reduce((s, l) => s + l.items.length, 0)
    const violationRatio = spanViolations / (totalItems || 1)
    const minColUsage = Math.min(...colPopCount.map(c => c / lines.length))

    const gridScore = (fillRatio * 0.3 + rowConsistency * 0.4 + minColUsage * 0.3) * (1 - violationRatio * 2)

    return { fillRatio, rowConsistency, significantCols, spanViolations, gridScore }
}

function clusterLinesIntoBlocks(
    lines: { y: number; items: TextItem[]; bbox: BBox }[],
    threshold: number
): { lines: typeof lines; bbox: BBox }[] {
    if (lines.length === 0) return []
    const blocks: { lines: typeof lines; bbox: BBox }[] = []
    let currentBlock = [lines[0]]

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        const prevLine = currentBlock[currentBlock.length - 1]
        const gap = prevLine.y - line.y
        const overlap = Math.min(
            prevLine.bbox.x + prevLine.bbox.width,
            line.bbox.x + line.bbox.width
        ) - Math.max(prevLine.bbox.x, line.bbox.x)

        if (gap > threshold || overlap < 0) {
            blocks.push({ lines: currentBlock, bbox: getGroupBBox(currentBlock.flatMap(l => l.items)) })
            currentBlock = [line]
        } else {
            currentBlock.push(line)
        }
    }
    blocks.push({ lines: currentBlock, bbox: getGroupBBox(currentBlock.flatMap(l => l.items)) })
    return blocks
}

export function detectTableRegions(graphics: GraphicItem[], textItems: TextItem[]): TableRegion[] {
    const lines = groupIntoVisualLines(textItems)
    if (lines.length < 3) return []

    const avgFontSize = textItems.reduce((s, i) => s + i.fontSize, 0) / (textItems.length || 1)
    const blocks = clusterLinesIntoBlocks(lines, avgFontSize * 2.5)
    const tableRegions: TableRegion[] = []

    for (const block of blocks) {
        const candidates = (block.lines.length > 12)
            ? clusterLinesIntoBlocks(block.lines, avgFontSize * 1.5)
            : [block]

        for (const sub of candidates) {
            if (sub.lines.length < 3) continue

            const columns = findColumnBoundaries(sub.lines, sub.bbox, avgFontSize)
            if (columns.length < 2) continue

            const density = calculateGridDensity(sub.lines, columns)

            const hLines = graphics.filter(g =>
                (g.type === "line" || g.type === "rectangle") &&
                g.bbox.width > sub.bbox.width * 0.5 &&
                g.bbox.y >= sub.bbox.y - 20 &&
                g.bbox.y <= sub.bbox.y + sub.bbox.height + 20
            )
            const hasGraphicSupport = hLines.length >= 2

            const totalItems = sub.lines.reduce((s, l) => s + l.items.length, 0)
            const violationRatio = density.spanViolations / (totalItems || 1)
            if (violationRatio > 0.3) continue

            let accepted = false
            if (density.significantCols >= 2) {
                if (density.gridScore > 0.35) {
                    accepted = true
                } else if (hasGraphicSupport && density.gridScore > 0.20) {
                    accepted = true
                }
            }

            if (columns.length === 2 && density.gridScore < 0.65) accepted = false
            if (density.rowConsistency < 0.20 && !hasGraphicSupport) accepted = false

            if (accepted) tableRegions.push({ bbox: sub.bbox, columns })
        }
    }

    if (tableRegions.length < 2) return tableRegions
    tableRegions.sort((a, b) => b.bbox.y - a.bbox.y)
    const merged: TableRegion[] = []
    let current = tableRegions[0]
    for (let i = 1; i < tableRegions.length; i++) {
        const next = tableRegions[i]
        const gap = current.bbox.y - (next.bbox.y + next.bbox.height)
        const overlap = Math.min(current.bbox.x + current.bbox.width, next.bbox.x + next.bbox.width) -
            Math.max(current.bbox.x, next.bbox.x)
        if (gap < 120 && (overlap > 0 || Math.abs(current.bbox.x - next.bbox.x) < 50)) {
            const minY = Math.min(current.bbox.y, next.bbox.y)
            const maxY = Math.max(current.bbox.y + current.bbox.height, next.bbox.y + next.bbox.height)
            const minX = Math.min(current.bbox.x, next.bbox.x)
            const maxX = Math.max(current.bbox.x + current.bbox.width, next.bbox.x + next.bbox.width)
            const mergedBBox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
            const cols = current.bbox.height >= next.bbox.height ? current.columns : next.columns
            current = { bbox: mergedBBox, columns: cols }
        } else {
            merged.push(current)
            current = next
        }
    }
    merged.push(current)
    return merged
}

export function detectSignature(
    graphic: GraphicItem,
    labels: TextItem[],
    pageWidth: number
): string | null {
    const { bbox } = graphic
    const available = labels.filter(l => !l.consumed)
    let candidateText: string | null = null

    const isSigText = (t: string) => SIGNATURE_REGEX.test(t)

    if (graphic.type === "rectangle") {
        // A. Inside (Priority)
        const inside = available.filter(l => intersects(bbox, l.bbox))
        if (inside.length > 0) {
            inside.sort((a, b) => (b.bbox.y - a.bbox.y) || (a.bbox.x - b.bbox.x))

            for (const item of inside) {
                if (isSigText(item.text)) return item.text
            }
        }

        // B. Above (Close proximity)
        const regionAbove = { ...bbox, y: bbox.y + bbox.height, height: 30 }
        const above = available.filter(l => intersects(regionAbove, l.bbox))
        if (above.some(l => isSigText(l.text))) return "signature"

        // C. Right
        const regionRight = { x: bbox.x + bbox.width, y: bbox.y, width: pageWidth / 2, height: bbox.height }
        const right = available.filter(l => intersects(regionRight, l.bbox))
        if (right.some(l => isSigText(l.text))) return "signature"

        // D. Below
        const regionBelow = { ...bbox, y: bbox.y - 30, height: 30 }
        const below = available.filter(l => intersects(regionBelow, l.bbox))
        if (below.some(l => isSigText(l.text))) return "signature"
    }

    // 2. LINES: Above, Below, Left
    if (graphic.type === "line" || (graphic.type === "rectangle" && graphic.bbox.height <= 5)) {
        // A. Above
        const regionAbove = { ...bbox, y: bbox.y + bbox.height, height: 30 }
        const above = available.filter(l => intersects(regionAbove, l.bbox))
        if (above.some(l => isSigText(l.text))) return "signature"

        // B. Below
        const regionBelow = { ...bbox, y: bbox.y - 30, height: 30 }
        const below = available.filter(l => intersects(regionBelow, l.bbox))
        if (below.some(l => isSigText(l.text))) return "signature"

        // C. Left
        const regionLeft = { x: 0, y: bbox.y - 10, width: bbox.x, height: bbox.height + 20 }
        const left = available.filter(l => intersects(regionLeft, l.bbox))
        if (left.some(l => isSigText(l.text))) return "signature"
    }

    return null
}

export function detectDate(
    graphic: GraphicItem,
    labels: TextItem[],
    pageWidth: number
): string | null {
    const { bbox } = graphic
    const available = labels.filter(l => !l.consumed)
    let candidateText: string | null = null

    const isDateText = (t: string) => DATE_REGEX.test(t)

    if (graphic.type === "rectangle") {
        // A. Inside (Priority)
        const inside = available.filter(l => intersects(bbox, l.bbox))
        if (inside.length > 0) {
            inside.sort((a, b) => (b.bbox.y - a.bbox.y) || (a.bbox.x - b.bbox.x))
            for (const item of inside) { if (isDateText(item.text)) return item.text }
        }
        // B. Above
        const regionAbove = { ...bbox, y: bbox.y + bbox.height, height: 30 }
        const above = available.filter(l => intersects(regionAbove, l.bbox))
        if (above.some(l => isDateText(l.text))) return "date"
        // C. Left/Right/Below checks omitted for brevity, logic mimics signature
        const regionLeft = { x: bbox.x - 200, y: bbox.y, width: 200, height: bbox.height } // Look left for "Date:"
        const left = available.filter(l => intersects(regionLeft, l.bbox))
        if (left.some(l => isDateText(l.text))) return "date"
    }

    // 2. LINES: Above, Left
    if (graphic.type === "line" || (graphic.type === "rectangle" && graphic.bbox.height <= 5)) {
        // A. Above
        const regionAbove = { ...bbox, y: bbox.y + bbox.height, height: 30 }
        const above = available.filter(l => intersects(regionAbove, l.bbox))
        if (above.some(l => isDateText(l.text))) return "date"

        // B. Left
        const regionLeft = { x: 0, y: bbox.y - 10, width: bbox.x, height: bbox.height + 20 }
        const left = available.filter(l => intersects(regionLeft, l.bbox))
        if (left.some(l => isDateText(l.text))) return "date"
    }

    return null
}

export function getBBoxFromItems(items: TextItem[] | GraphicItem[]): BBox {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of items) {
        minX = Math.min(minX, item.bbox.x);
        minY = Math.min(minY, item.bbox.y);
        maxX = Math.max(maxX, item.bbox.x + item.bbox.width);
        maxY = Math.max(maxY, item.bbox.y + item.bbox.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function groupTextItems(items: TextItem[]): TextItem[] {
    if (items.length === 0) return []
    const sorted = [...items].sort((a, b) => {
        const yDiff = b.bbox.y - a.bbox.y
        if (Math.abs(yDiff) < 5) {
            return a.bbox.x - b.bbox.x
        }
        return yDiff
    })

    const groups: TextItem[] = []
    let currentGroup: TextItem | null = null

    for (const item of sorted) {
        if (!currentGroup) {
            currentGroup = { ...item }
            continue
        }

        if (item.fontName !== currentGroup.fontName) {
            groups.push(currentGroup)
            currentGroup = { ...item }
            continue
        }

        const fontSize = Math.max(item.fontSize, currentGroup.fontSize)
        const spaceWidthPx = fontSize * 0.3
        const tolerance = spaceWidthPx + 1

        const vGap = Math.abs(item.bbox.y - currentGroup.bbox.y)
        const hGap = item.bbox.x - (currentGroup.bbox.x + currentGroup.bbox.width)

        if (vGap <= tolerance && hGap <= tolerance) {
            const addSpace = hGap > (fontSize * 0.1)
            currentGroup.text += (addSpace ? " " : "") + item.text
            currentGroup.bbox.width = (item.bbox.x + item.bbox.width) - currentGroup.bbox.x
            currentGroup.fontSize = Math.max(currentGroup.fontSize, item.fontSize)
        } else {
            groups.push(currentGroup)
            currentGroup = { ...item }
        }
    }
    if (currentGroup) groups.push(currentGroup)
    return groups
}

export function toSnakeCase(str: string): string {
    return str.trim()
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, '_')
}

function isValidLabel(text: string): boolean {
    if (!text) return false;
    const cleanText = text.replace(/\([^)]*\)/g, "").trim();

    if (!cleanText) return true;

    const wordCount = cleanText.split(/\s+/).length;
    return wordCount <= MAX_LABEL_WORDS;
}

// --- Proximity & Zone Logic ---

function intersects(r1: BBox, r2: BBox): boolean {
    return !(r2.x > r1.x + r1.width ||
        r2.x + r2.width < r1.x ||
        r2.y > r1.y + r1.height ||
        r2.y + r2.height < r1.y);
}

export function findLabelForLine(line: BBox, labels: TextItem[], pageWidth: number): LineLabelResult | null {
    const availableLabels = labels.filter(l => !l.consumed);

    const LEFT_SEARCH_WIDTH = pageWidth * 0.99

    const regionAbove: BBox = {
        x: line.x,
        y: line.y + line.height,
        width: line.width,
        height: 28
    }

    const matchesAbove = availableLabels.filter(l => intersects(regionAbove, l.bbox));
    if (matchesAbove.length > 0) {
        const text = collectLabel(matchesAbove, 'above', line);
        if (text) {
            const bottom = Math.min(...matchesAbove.map(m => m.bbox.y));
            return { text, source: 'above', bottom };
        }
    }

    const regionLeft: BBox = {
        x: line.x - LEFT_SEARCH_WIDTH,
        y: line.y - 5,
        width: LEFT_SEARCH_WIDTH,
        height: line.height + 28
    }

    const matchesLeft = availableLabels.filter(l => intersects(regionLeft, l.bbox));
    if (matchesLeft.length > 0) {
        const text = collectLabel(matchesLeft, 'left', line);
        if (text) return { text, source: 'left' };
    }

    const regionBelow: BBox = {
        x: line.x,
        y: line.y - 18,
        width: line.width,
        height: 18
    }
    const matchesBelow = labels.filter(l => intersects(regionBelow, l.bbox))
    if (matchesBelow.length > 0) {
        matchesBelow.sort((a, b) => b.bbox.y - a.bbox.y || a.bbox.x - b.bbox.x)
        const candidate = matchesBelow.map(m => m.text).join(" ")
        if (isValidLabel(candidate)) return { text: candidate, source: 'below' }
    }

    return null
}

function collectLabel(
    candidates: TextItem[],
    direction: 'left' | 'right' | 'above',
    fieldRect: BBox
): string | null {
    if (candidates.length === 0) return null;

    let sorted = [...candidates];

    if (direction === 'left') {
        sorted.sort((a, b) => {
            const midY = fieldRect.y + fieldRect.height / 2;
            const distYa = Math.abs((a.bbox.y + a.bbox.height / 2) - midY);
            const distYb = Math.abs((b.bbox.y + b.bbox.height / 2) - midY);

            if (Math.abs(distYa - distYb) > 3) {
                return distYa - distYb;
            }
            return (b.bbox.x + b.bbox.width) - (a.bbox.x + a.bbox.width);
        });
    } else if (direction === 'right') {
        sorted.sort((a, b) => {
            const midY = fieldRect.y + fieldRect.height / 2;
            const distYa = Math.abs((a.bbox.y + a.bbox.height / 2) - midY);
            const distYb = Math.abs((b.bbox.y + b.bbox.height / 2) - midY);
            if (Math.abs(distYa - distYb) > 3) return distYa - distYb;

            return a.bbox.x - b.bbox.x;
        });
    } else {
        sorted.sort((a, b) => a.bbox.y - b.bbox.y);
    }

    const anchor = sorted[0];
    if (!isValidLabel(anchor.text)) return null;

    const itemsToConsume = [anchor];
    let collectedText = anchor.text;
    let prev = anchor;

    const others = sorted.slice(1);

    if (direction === 'left') {
        others.sort((a, b) => b.bbox.x - a.bbox.x); // Right-to-left
    } else if (direction === 'right') {
        others.sort((a, b) => a.bbox.x - b.bbox.x); // Left-to-right
    } else {
        others.sort((a, b) => a.bbox.y - b.bbox.y); // Bottom-to-top
    }

    for (const item of others) {
        const fontSize = Math.max(item.fontSize, prev.fontSize);
        const spaceWidthPx = fontSize * 0.4;

        let gap = 0;
        let isAligned = true;

        if (direction === 'left') {
            gap = prev.bbox.x - (item.bbox.x + item.bbox.width);
            if (Math.abs(item.bbox.y - prev.bbox.y) > fontSize * 0.8) isAligned = false;
        } else if (direction === 'right') {
            gap = item.bbox.x - (prev.bbox.x + prev.bbox.width);
            if (Math.abs(item.bbox.y - prev.bbox.y) > fontSize * 0.8) isAligned = false;
        } else {
            gap = item.bbox.y - (prev.bbox.y + prev.bbox.height);
            const overlapX = Math.max(0, Math.min(item.bbox.x + item.bbox.width, prev.bbox.x + prev.bbox.width) - Math.max(item.bbox.x, prev.bbox.x));
            if (overlapX === 0) isAligned = false;
        }

        if (!isAligned) break;
        if (gap < -(fontSize * 0.5) || gap > spaceWidthPx + 2) break;

        const newText = (direction === 'left' || direction === 'above')
            ? item.text + " " + collectedText
            : collectedText + " " + item.text;

        if (!isValidLabel(newText)) break;

        itemsToConsume.push(item);
        collectedText = newText;
        prev = item;
    }

    itemsToConsume.forEach(i => i.consumed = true);
    return collectedText;
}

export function findLabelForCheckbox(rect: BBox, labels: TextItem[], pageWidth: number): string | null {
    const availableLabels = labels.filter(l => !l.consumed);

    const SEARCH_WIDTH = Math.min(pageWidth * 0.4, 200);
    const searchHeight = Math.max(rect.height, 14);
    const yCenterOffset = (searchHeight - rect.height) / 2;

    const regionLeft: BBox = {
        x: rect.x - SEARCH_WIDTH,
        y: rect.y - yCenterOffset,
        width: SEARCH_WIDTH,
        height: searchHeight
    }

    const regionRight: BBox = {
        x: rect.x + rect.width,
        y: rect.y - yCenterOffset,
        width: SEARCH_WIDTH,
        height: searchHeight
    }

    const matchesLeft = availableLabels.filter(l => intersects(regionLeft, l.bbox));
    const matchesRight = availableLabels.filter(l => intersects(regionRight, l.bbox));

    let leftDist = Infinity;
    if (matchesLeft.length > 0) {
        matchesLeft.sort((a, b) => b.bbox.x - a.bbox.x);
        leftDist = rect.x - (matchesLeft[0].bbox.x + matchesLeft[0].bbox.width);
    }

    let rightDist = Infinity;
    if (matchesRight.length > 0) {
        matchesRight.sort((a, b) => a.bbox.x - b.bbox.x);
        rightDist = matchesRight[0].bbox.x - (rect.x + rect.width);
    }

    if (leftDist < rightDist && leftDist !== Infinity) {
        const text = collectLabel(matchesLeft, 'left', rect);
        if (text) return text;
        const textR = collectLabel(matchesRight, 'right', rect);
        if (textR) return textR;
    } else if (rightDist !== Infinity) {
        const text = collectLabel(matchesRight, 'right', rect);
        if (text) return text;
        const textL = collectLabel(matchesLeft, 'left', rect);
        if (textL) return textL;
    }

    const regionAbove: BBox = {
        x: rect.x - 10,
        y: rect.y + rect.height,
        width: rect.width + 20,
        height: 30
    }
    const matchesAbove = availableLabels.filter(l => intersects(regionAbove, l.bbox));
    if (matchesAbove.length > 0) {
        const text = collectLabel(matchesAbove, 'above', rect);
        if (text) return text;
    }

    return null;
}

export function findLabelForRadio(rect: BBox, labels: TextItem[], pageWidth: number): string | null {
    const availableLabels = labels.filter(l => !l.consumed);

    const SEARCH_WIDTH = Math.min(pageWidth * 0.4, 200);
    const searchHeight = Math.max(rect.height, 14);
    const yCenterOffset = (searchHeight - rect.height) / 2;

    const regionLeft: BBox = {
        x: rect.x - SEARCH_WIDTH,
        y: rect.y - yCenterOffset,
        width: SEARCH_WIDTH,
        height: searchHeight
    }

    const regionRight: BBox = {
        x: rect.x + rect.width,
        y: rect.y - yCenterOffset,
        width: SEARCH_WIDTH,
        height: searchHeight
    }

    const matchesLeft = availableLabels.filter(l => intersects(regionLeft, l.bbox));
    const matchesRight = availableLabels.filter(l => intersects(regionRight, l.bbox));

    let leftDist = Infinity;
    if (matchesLeft.length > 0) {
        matchesLeft.sort((a, b) => b.bbox.x - a.bbox.x);
        leftDist = rect.x - (matchesLeft[0].bbox.x + matchesLeft[0].bbox.width);
    }

    let rightDist = Infinity;
    if (matchesRight.length > 0) {
        matchesRight.sort((a, b) => a.bbox.x - b.bbox.x);
        rightDist = matchesRight[0].bbox.x - (rect.x + rect.width);
    }

    if (leftDist < rightDist && leftDist !== Infinity) {
        const text = collectLabel(matchesLeft, 'left', rect);
        if (text) return text;
        const textR = collectLabel(matchesRight, 'right', rect);
        if (textR) return textR;
    } else if (rightDist !== Infinity) {
        const text = collectLabel(matchesRight, 'right', rect);
        if (text) return text;
        const textL = collectLabel(matchesLeft, 'left', rect);
        if (textL) return textL;
    }

    const regionAbove: BBox = {
        x: rect.x - 10,
        y: rect.y + rect.height,
        width: rect.width + 20,
        height: 30
    }

    const matchesAbove = availableLabels.filter(l => intersects(regionAbove, l.bbox));
    if (matchesAbove.length > 0) {
        const text = collectLabel(matchesAbove, 'above', rect);
        if (text) return text;
    }

    return null;
}

export function findLabelForRect(rect: BBox, labels: TextItem[], pageWidth: number): LabelResult | null {
    const availableLabels = labels.filter(l => !l.consumed);

    // 1. Always check for text inside first to capture padding info (insideBottom)
    const matchesInside = availableLabels.filter(l => {
        const centerX = l.bbox.x + l.bbox.width / 2
        const centerY = l.bbox.y + l.bbox.height / 2
        return centerX > rect.x && centerX < (rect.x + rect.width) &&
            centerY > rect.y && centerY < (rect.y + rect.height)
    })

    let insideBottom: number | undefined = undefined;
    let insideText: string | undefined = undefined;

    if (matchesInside.length > 0) {
        matchesInside.sort((a, b) => b.bbox.y - a.bbox.y || a.bbox.x - b.bbox.x)
        insideBottom = Math.min(...matchesInside.map(m => m.bbox.y));
        insideText = matchesInside.map(m => m.text).join(" ");
    }

    // PRIORITY 1: INSIDE TEXT
    if (insideText && isValidLabel(insideText)) {
        matchesInside.forEach(m => m.consumed = true);
        return { text: insideText, insideBottom };
    }

    // 2. Search for external labels (Left/Right)
    const SEARCH_WIDTH = Math.min(pageWidth * 0.4, 200);
    const searchHeight = Math.max(rect.height, 14)
    const yCenterOffset = (searchHeight - rect.height) / 2

    const regionLeft: BBox = {
        x: rect.x - SEARCH_WIDTH,
        y: rect.y - yCenterOffset,
        width: SEARCH_WIDTH,
        height: searchHeight
    }

    const regionRight: BBox = {
        x: rect.x + rect.width,
        y: rect.y - yCenterOffset,
        width: SEARCH_WIDTH,
        height: searchHeight
    }

    const matchesLeft = availableLabels.filter(l => intersects(regionLeft, l.bbox))
    const matchesRight = availableLabels.filter(l => intersects(regionRight, l.bbox))

    let leftDist = Infinity;
    let rightDist = Infinity;

    if (matchesLeft.length > 0) {
        matchesLeft.sort((a, b) => {
            const midY = rect.y + rect.height / 2;
            const distYa = Math.abs((a.bbox.y + a.bbox.height / 2) - midY);
            const distYb = Math.abs((b.bbox.y + b.bbox.height / 2) - midY);
            if (Math.abs(distYa - distYb) > 3) return distYa - distYb;
            return (b.bbox.x + b.bbox.width) - (a.bbox.x + a.bbox.width);
        });
        const bestL = matchesLeft[0];
        leftDist = rect.x - (bestL.bbox.x + bestL.bbox.width);
    }

    if (matchesRight.length > 0) {
        const bestR = matchesRight.reduce((prev, curr) =>
            prev.bbox.x < curr.bbox.x ? prev : curr
        );
        rightDist = bestR.bbox.x - (rect.x + rect.width);
    }

    // PRIORITY 2: Return best label priority: Left vs Right (Pick closest)
    if (leftDist < rightDist && leftDist !== Infinity) {
        const text = collectLabel(matchesLeft, 'left', rect);
        if (text) return { text, insideBottom };
        const textR = collectLabel(matchesRight, 'right', rect);
        if (textR) return { text: textR, insideBottom };
    } else if (rightDist !== Infinity) {
        const text = collectLabel(matchesRight, 'right', rect);
        if (text) return { text, insideBottom };
        const textL = collectLabel(matchesLeft, 'left', rect);
        if (textL) return { text: textL, insideBottom };
    }

    // PRIORITY 3: Check Above
    const regionAbove: BBox = {
        x: rect.x,
        y: rect.y + rect.height,
        width: rect.width,
        height: 30
    }
    const matchesAbove = availableLabels.filter(l => intersects(regionAbove, l.bbox))
    if (matchesAbove.length > 0) {
        const text = collectLabel(matchesAbove, 'above', rect);
        if (text) return { text, insideBottom };
    }

    // Fallback: If nothing else found but text is inside, we still want to create the field
    // even if the label is "invalid" (long). We'll shorten it for the field name and consume it to prevent overlaps.
    if (insideText) {
        matchesInside.forEach(m => m.consumed = true);
        return { text: insideText.substring(0, 30), insideBottom };
    }

    return null
}