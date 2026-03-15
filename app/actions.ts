"use server"

import { detectVisualFields, detectFieldAtPosition } from "@/lib/visual-detection"
import { DetectedField, DetectionMode } from "@/lib/pdf-utils"

export async function detectVisualFieldsAction(formData: FormData): Promise<DetectedField[]> {
    const file = formData.get("file") as File
    if (!file) {
        throw new Error("No file provided")
    }

    const buffer = await file.arrayBuffer()
    return detectVisualFields(buffer)
}

export async function detectFieldAtPositionAction(
    formData: FormData,
    pageIndex: number,
    x: number,
    y: number,
    mode: string,
    snapOnly: boolean = false,
    width?: number,
    height?: number
): Promise<DetectedField | null> {
    const file = formData.get("file") as File
    if (!file) {
        throw new Error("No file provided")
    }

    const buffer = await file.arrayBuffer()

    // Cast string mode back to specific union type
    return detectFieldAtPosition(buffer, pageIndex, x, y, mode as DetectionMode, snapOnly, width, height)
}